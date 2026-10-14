"""Boundary merge pass for the Axiom library (runs after enrichment, before embedding).

Enrichment judges every chunk's boundary against its neighbours:
  starts_mid  - opens in the middle of something that began in the previous chunk
  ends_early  - stops before the payoff that sits in the next chunk
This pass acts on those judgements and nothing else (no extra boundary heuristics):

  * starts_mid merges the chunk into the previous chunk, ends_early merges it with the next chunk;
  * only inside one chapter, and only while the merged text stays <= MERGE_CAP words;
  * runs of flagged chunks are resolved left to right and merged as far as the cap allows;
  * merged chunks (and only those) are enriched again, under the cost purpose 'enrich_merge';
  * at most MAX_PASSES passes; what is still flagged afterwards gets the flag
    boundary_unmerged_starts_mid / boundary_unmerged_ends_early.

Chunk id policy after a merge: the merged chunk KEEPS THE ID OF THE FIRST CHUNK of the group. The ids
of the absorbed chunks disappear and nothing else is renumbered, so ids are stable keys but not
consecutive. Order lives in `position` (1..n, rewritten after every merge) and in prev_id / next_id.
The merged chunk lists the absorbed ids in `merged_from`. `continues` is never set by a merge: it keeps
the first chunk's value (see library_chunk). Paragraphs are never edited, only re-joined: the merged
text is the group's texts joined with a blank line, so every source paragraph still appears once.

Embedding must run AFTER this pass (embed_source embeds the final text and drops stale vectors).
No database access. Every rewrite of chunks.jsonl is archived first.
"""
from __future__ import annotations

import json
from typing import List, Optional

import enrich_library as E
from library_text import word_count

MERGE_CAP = 900
MAX_PASSES = 2
UNMERGED = {"starts_mid": "boundary_unmerged_starts_mid", "ends_early": "boundary_unmerged_ends_early"}
SIZE_FLAGS = {"oversized_paragraph", "oversized_story", "oversized_unsplittable", "short_unmergeable"}
DROP_ON_MERGE = set(E.ENRICH_FIELDS) | {"embedding", "embedding_hash"}
STALE_FLAGS = {"enrichment_failed", "summary_truncated_verbatim", *UNMERGED.values()}


def _wc(chunk: dict) -> int:
    return int(chunk.get("word_count") or word_count(chunk["text"]))


def _linked(a: dict, b: dict) -> bool:
    """Does the enrichment judgement ask for a and b (adjacent) to be one chunk?"""
    return b.get("boundary") == "starts_mid" or a.get("boundary") == "ends_early"


def plan_merges(chunks: List[dict], cap: int = MERGE_CAP) -> List[List[int]]:
    """Groups of consecutive indices to merge. Deterministic, left to right."""
    groups: List[List[int]] = []
    i = 0
    while i < len(chunks):
        group, words = [i], _wc(chunks[i])
        j = i
        while j + 1 < len(chunks):
            nxt = chunks[j + 1]
            if not _linked(chunks[j], nxt):
                break
            if nxt.get("chapter") != chunks[j].get("chapter"):
                break                                  # never across a chapter
            if words + _wc(nxt) > cap:
                break                                  # would exceed the cap
            group.append(j + 1)
            words += _wc(nxt)
            j += 1
        groups.append(group)
        i = j + 1
    return groups


def _size_flags(wc: int, n_paras: int) -> set:
    flags = set()
    if wc > 700:
        flags.add("oversized_paragraph" if n_paras == 1 else "oversized_story" if wc <= 900
                  else "oversized_unsplittable")
    if wc < 150:
        flags.add("short_unmergeable")
    return flags


def merge_group(chunks: List[dict], group: List[int]) -> dict:
    parts = [chunks[i] for i in group]
    first = parts[0]
    if len(parts) == 1:
        return dict(first)
    text = "\n\n".join(p["text"] for p in parts)
    merged = {k: v for k, v in first.items() if k not in DROP_ON_MERGE}
    pages_s = [p["page_start"] for p in parts if p.get("page_start") is not None]
    pages_e = [p["page_end"] for p in parts if p.get("page_end") is not None]
    flags = set()
    for p in parts:
        flags |= set(p.get("flags") or [])
    flags -= SIZE_FLAGS | STALE_FLAGS
    flags |= _size_flags(word_count(text), len(text.split("\n\n")))
    flags.add("merged_by_boundary")
    merged.update({
        "text": text, "word_count": word_count(text),
        "page_start": min(pages_s) if pages_s else None, "page_end": max(pages_e) if pages_e else None,
        "flags": sorted(flags),
        "merged_from": [x for p in parts for x in (p.get("merged_from") or [])] + [p["id"] for p in parts[1:]],
        "continues": bool(first.get("continues")),     # a merge never sets continues
    })
    return merged


def relink(chunks: List[dict]) -> List[dict]:
    for i, c in enumerate(chunks):
        c["position"] = i + 1
        c["prev_id"] = chunks[i - 1]["id"] if i else None
        c["next_id"] = chunks[i + 1]["id"] if i + 1 < len(chunks) else None
    return chunks


def count_boundaries(chunks: List[dict]) -> dict:
    return {"starts_mid": sum(c.get("boundary") == "starts_mid" for c in chunks),
            "ends_early": sum(c.get("boundary") == "ends_early" for c in chunks)}


def flag_unmerged(chunks: List[dict]) -> List[dict]:
    """After the last pass, whatever is still starts_mid / ends_early is unmerged: flag it."""
    for c in chunks:
        flags = [f for f in c.get("flags", []) if f not in UNMERGED.values()]
        if c.get("boundary") in UNMERGED:
            flags.append(UNMERGED[c["boundary"]])
        c["flags"] = flags
    return chunks


def _record(source_id: str, **fields) -> None:
    update = getattr(E.STATE, "update_fields", None)
    if update:
        update(source_id, **fields)


def merge_pass(source_id: str, client=None, log=print, max_passes: int = MAX_PASSES,
               cap: int = MERGE_CAP) -> dict:
    path = E.source_dir(source_id) / "chunks.jsonl"
    chunks = E.read_jsonl(path)
    if not chunks:
        raise FileNotFoundError(f"no chunks for {source_id}")
    if any("boundary" not in c for c in chunks):
        raise RuntimeError(f"{source_id}: chunks have no boundary judgement; run enrich first")
    flagged = count_boundaries(chunks)
    merged_per_pass: List[int] = []
    cost = 0.0
    failed: List[str] = []
    for n in range(max_passes):
        chunks = E.read_jsonl(path)
        groups = plan_merges(chunks, cap)
        absorbed = sum(len(g) - 1 for g in groups)
        if absorbed == 0:
            merged_per_pass.append(0)
            break
        merged = relink([merge_group(chunks, g) for g in groups])
        E.archive_and_write_chunks(source_id, merged)
        log(f"merge {source_id}: pass {n + 1} merged {absorbed} chunks into "
            f"{sum(len(g) > 1 for g in groups)} ({len(chunks)} -> {len(merged)})")
        res = E.enrich_source(source_id, client=client, log=log, purpose="enrich_merge")
        cost += res.get("cost_usd", 0.0)
        merged_per_pass.append(absorbed)
        if res.get("failed"):
            failed = res["failed"]
            break
    chunks = flag_unmerged(relink(E.read_jsonl(path)))
    E.archive_and_write_chunks(source_id, chunks)
    unmerged = count_boundaries(chunks)
    out = {"source": source_id, "boundary_flagged": flagged, "merged_per_pass": merged_per_pass,
           "unmerged": unmerged, "chunks": len(chunks), "cost_usd": round(cost, 8), "failed": failed}
    _record(source_id, boundary_flagged=flagged, boundary_merged_per_pass=merged_per_pass,
            boundary_unmerged=unmerged, merge_cost_usd=round(cost, 8), merge_done=not failed)
    return out
