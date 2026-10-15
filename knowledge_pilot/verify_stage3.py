#!/usr/bin/env python3
"""Local Stage3 export checks; writes knowledge_pilot/checks.json.

Run: knowledge_pilot/.venv/bin/python knowledge_pilot/verify_stage3.py
Exit 1 for issues; missing final outputs are pending, not failures.
"""
import hashlib
import json
import re
import signal
import statistics
import time
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent
KEYS = (
    "seven_powers", "lean_startup", "thinking_fast_and_slow",
    "laws_of_human_nature", "never_split_the_difference", "psychology_of_money",
    "thinking_in_bets", "superforecasting", "how_the_world_really_works",
    "everything_store",
)
WORDS = re.compile(r"\b[\w\u2019'-]+\b")


def read(path):
    text = path.read_text(encoding="utf-8")
    return ([json.loads(line) for line in text.splitlines() if line.strip()]
            if path.suffix == ".jsonl" else json.loads(text))


def distribution(counts):
    if not counts:
        return None
    q = statistics.quantiles(counts, n=4) if len(counts) > 1 else [counts[0]] * 3
    return {"min": min(counts), "p25": round(q[0]),
            "median": round(statistics.median(counts)), "p75": round(q[2]),
            "max": max(counts), "mean": round(statistics.mean(counts), 1),
            "under_200": sum(n < 200 for n in counts),
            "over_500": sum(n > 500 for n in counts),
            "over_700": sum(n > 700 for n in counts)}


def check_book(key, book):
    result = {"key": key, "status": "pending", "issues": [], "pending": []}
    folder = ROOT / key
    paths = [folder / name for name in (
        "paragraphs.jsonl", "chunks.jsonl", "summary.json", "extraction.json")]
    missing = [p.name for p in paths if not p.is_file()]
    if book is None or missing:
        result["pending"] = missing + ([] if book else ["manifest entry"])
        return result
    review_path = folder / "short_chunk_review.jsonl"
    if review_path.is_file():
        paths.append(review_path)
    stamps = {p: (p.stat().st_size, p.stat().st_mtime_ns) for p in paths}
    if any(stamp[1] > stamps[folder / "summary.json"][1]
           for stamp in stamps.values()):
        result["pending"] = ["summary older than current inputs"]
        return result
    errors = result["issues"]

    def fail(code, **evidence):
        errors.append({"code": code, **evidence})

    try:
        paragraphs, chunks, summary, extraction = [read(p) for p in paths[:4]]
        reviews = read(review_path) if review_path in stamps else []
        if not paragraphs or not chunks:
            fail("empty_final_output")
        flat = [part for c in chunks for part in c["text"].split("\n\n")]
        exact = flat == [p["text"] for p in paragraphs]
        result["paragraphs_exact_in_order_once"] = exact
        if not exact:
            fail("paragraph_loss_rewrite_duplication_or_reordering",
                 source_count=len(paragraphs), exported_count=len(flat))
        by_chapter = {}
        for p in paragraphs:
            by_chapter.setdefault(p.get("chapter"), []).append(p)
        offsets, ids = Counter(), set()
        counts, evidence = [], []
        accepted = {}
        for row, review in enumerate(reviews, 1):
            if isinstance(review.get("candidate_text"), str):
                accepted[(review.get("chapter"), review["candidate_text"])] = (row, review)
        headings = extraction.get("real_section_headings")
        allowed = ({(h["chapter"], h["section"]) for h in headings}
                   if headings is not None else None)
        for row, p in enumerate(paragraphs, 1):
            if allowed is not None and p.get("section") is not None and (p.get("chapter"), p["section"]) not in allowed:
                fail("paragraph_section_not_in_extraction", row=row, section=p["section"])
        for row, chunk in enumerate(chunks, 1):
            cid, chapter = chunk.get("id"), chunk.get("chapter")
            if cid in ids or cid != f"{key}_{row:04d}":
                fail("invalid_or_duplicate_chunk_id", row=row, id=cid)
            ids.add(cid)
            for field in ("book", "author", "book_pillar"):
                if field not in chunk or chunk[field] != book.get(field):
                    fail("metadata_mismatch", row=row, field=field,
                         expected=book.get(field), actual=chunk.get(field))
            if chunk.get("pillars") != [] or "pillar" in chunk:
                fail("pillars_not_empty_or_legacy_pillar", row=row)
            parts = chunk["text"].split("\n\n")
            start = offsets[chapter]
            body = by_chapter.get(chapter, [])[start:start + len(parts)]
            if parts != [p["text"] for p in body]:
                fail("chapter_paragraph_order_mismatch", row=row)
            expected_range = [start + 1, start + len(parts)]
            if [chunk.get("start_paragraph"), chunk.get("end_paragraph")] != expected_range:
                fail("paragraph_range_mismatch", row=row, expected=expected_range)
            offsets[chapter] += len(parts)
            if body and ("section" not in chunk or chunk["section"] != body[0].get("section")):
                fail("section_not_first_paragraph_section", row=row)
            if body and chunk.get("page_range") != [body[0]["page_start"], body[-1]["page_end"]]:
                fail("page_range_mismatch", row=row)
            wc = len(WORDS.findall(chunk["text"]))
            counts.append(wc)
            if chunk.get("word_count") != wc:
                fail("word_count_mismatch", row=row, actual=chunk.get("word_count"), expected=wc)
            if wc < 120:
                review_row, review = accepted.get((chapter, chunk["text"]), (None, {}))
                valid = (review.get("self_contained") is True and review.get("merge") == "keep"
                         and isinstance(review.get("reason"), str) and bool(review["reason"].strip()))
                evidence.append({"id": cid, "words": wc, "review_row": review_row,
                                 "exact_accepted_review": valid, "reason": review.get("reason")})
                if not valid:
                    fail("under120_missing_exact_accepted_review", id=cid, review_row=review_row)
        current = {"book": book["book"], "key": key, "chunks": len(chunks),
                   "word_count_distribution": distribution(counts),
                   "under_120": sum(n < 120 for n in counts),
                   "over_700": [{"id": c["id"], "words": n} for c, n in zip(chunks, counts) if n > 700],
                   "paragraphs_preserved_exactly_once": exact,
                   "size_limit_splits": sum(c.get("boundary_kind") == "size_limit" for c in chunks)}
        for field, value in current.items():
            if field not in summary or summary[field] != value:
                fail("summary_not_current", field=field, expected=value, actual=summary.get(field))
        for field, value in {"paragraphs": len(paragraphs),
                             "words": sum(len(WORDS.findall(p["text"])) for p in paragraphs)}.items():
            if extraction.get(field) != value:
                fail("extraction_count_mismatch", field=field, expected=value, actual=extraction.get(field))
        result.update(current_summary=current, under120_review_evidence=evidence,
                      section_authority="extraction headings" if allowed is not None else "unavailable; paragraph equality only",
                      source_extraction_issues=extraction.get("extraction_issues", []))
    except (ValueError, TypeError, KeyError, IndexError, OSError) as exc:
        fail("invalid_output", detail=str(exc))
    try:
        changed = any((p.stat().st_size, p.stat().st_mtime_ns) != stamp for p, stamp in stamps.items())
    except OSError:
        changed = True
    if changed:
        result["issues"] = []
        result["pending"] = ["inputs changed during check; rerun"]
    result["status"] = "pending" if result["pending"] else "issues" if result["issues"] else "pass"
    return result


def main():
    started = time.monotonic()
    report = {"expected_books": 10, "books": [], "issues": [], "pending": [],
              "scope": "Local export consistency and review evidence; no API, database or PDF/source audit; no inferred semantic quality."}

    def timeout(_signum, _frame):
        raise TimeoutError("30-second local budget reached")

    signal.signal(signal.SIGALRM, timeout)
    signal.setitimer(signal.ITIMER_REAL, 30)
    try:
        path = ROOT / "corpus_manifest.json"
        books = read(path) if path.is_file() else []
        keys = [b["key"] for b in books]
        if books and (len(keys) != 10 or set(keys) != set(KEYS)):
            report["issues"].append({"code": "manifest_not_exact_ten_books", "keys": keys})
        for key in KEYS:
            matches = [b for b in books if b["key"] == key]
            report["books"].append(check_book(key, matches[0] if len(matches) == 1 else None))
    except TimeoutError as exc:
        report["pending"].append(str(exc))
    except (ValueError, TypeError, KeyError, OSError) as exc:
        report["issues"].append({"code": "invalid_manifest", "detail": str(exc)})
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
    checked = {b["key"] for b in report["books"]}
    report["books"].extend({"key": key, "status": "pending", "issues": [],
                            "pending": ["not checked in this run"]} for key in KEYS if key not in checked)
    report["status_counts"] = dict(Counter(b["status"] for b in report["books"]))
    errors = bool(report["issues"] or any(b["issues"] for b in report["books"]))
    pending = bool(report["pending"] or any(b["status"] == "pending" for b in report["books"]))
    report["status"] = "issues" if errors else "pending" if pending else "pass"
    report["elapsed_seconds"] = round(time.monotonic() - started, 3)
    target = ROOT / "checks.json"
    temporary = ROOT / ".checks.json.tmp"
    temporary.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    temporary.replace(target)
    print(json.dumps({"status": report["status"], "books": report["status_counts"],
                      "report": str(target), "elapsed_seconds": report["elapsed_seconds"]}))
    return int(errors)


if __name__ == "__main__":
    raise SystemExit(main())
