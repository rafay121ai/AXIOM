#!/usr/bin/env python3
"""Phase 1 driver for the real library run.

Order: books, then biographies, then everything else; smallest size_kb first in each group.
Per source: budget check -> extract -> chunk -> qa -> gate -> enrich (with boundary) -> merge_pass
(re-enrich merged chunks) -> embed (final text) -> done.

  python knowledge_pilot/run_phase1.py --dry-run
  python knowledge_pilot/run_phase1.py --limit 3
  python knowledge_pilot/run_phase1.py --source ID
  python knowledge_pilot/run_phase1.py --retry-failed        # after a chunker fix
  python knowledge_pilot/run_phase1.py --stop-after-spend 2.50

Safety: refuses to run without an OpenAI key, never prints keys, no database access,
never deletes anything under _archive.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path
from typing import Any, Callable

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import library_state as state  # noqa: E402
import run_library as rl  # noqa: E402

BUDGET_USD = 15.0
FINAL_SKIP = ("excluded", "duplicate", "done", "needs_review", "unsupported_format")
MIN_WORDS = 1500            # below this a source has too little text
PUNCT_MIN_SHARE = 0.20      # share of paragraphs ending in sentence punctuation
GATE_SPOT_FLAG_PCT = 2.0
GROUP_RANK = {"book": 0, "biography": 1}
WORDS_PER_PDF_PAGE = 300
WORDS_PER_CHUNK = 300
PER_CHUNK_UPLOAD_OVERHEAD = 1024 + 1330 + 300  # halfvec + index + meta, bytes
ENRICH_KEYS = ("context_line", "summary", "key_takeaway", "example_questions", "chunk_type",
               "applies_to", "claim_strength", "pillar_tags")


class Cfg:
    def __init__(self, manifest: Path | None = None, state_path: Path | None = None,
                 library_root: Path | None = None, archive_root: Path | None = None,
                 tasks_dir: Path | None = None, budget: float = BUDGET_USD,
                 quiet: bool = False, enrich_fn: Callable | None = None,
                 embed_fn: Callable | None = None, legacy_root: Path | None = None,
                 offline: bool = False, merge_fn: Callable | None = None):
        self.manifest = Path(manifest or rl.DEFAULT_MANIFEST)
        self.state_path = Path(state_path or state.DEFAULT_STATE_PATH)
        self.library_root = Path(library_root or rl.LIBRARY_ROOT)
        self.archive_root = Path(archive_root or rl.ARCHIVE_ROOT)
        self.dir = Path(tasks_dir or HERE)
        self.budget = budget
        self.quiet = quiet
        self.enrich_fn = enrich_fn
        self.embed_fn = embed_fn
        self.merge_fn = merge_fn
        self.legacy_root = legacy_root
        self.offline = offline

    @property
    def queue_path(self): return self.dir / "needs_fix_queue.json"
    @property
    def spot_path(self): return self.dir / "spot_check_queue.json"
    @property
    def checks_path(self): return self.dir / "agent_checks.json"
    @property
    def report_path(self): return self.dir / "LIBRARY_REPORT.md"

    def opts(self, force: bool = False) -> rl.Options:
        return rl.Options(offline=self.offline, force=force, out_root=self.library_root,
                          archive_root=self.archive_root, state_path=self.state_path,
                          legacy_root=self.legacy_root, quiet=True)

    def log(self, msg: str) -> None:
        if not self.quiet:
            print(msg, flush=True)


# ---------------------------------------------------------------- small io
def read_json(path: Path, default: Any) -> Any:
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def get_key(cfg: Cfg) -> str | None:
    return rl._api_key_loader(rl.REPO_ROOT)()


# ---------------------------------------------------------------- ordering and estimates
def order_sources(sources: list[dict]) -> list[dict]:
    return sorted(sources, key=lambda s: (GROUP_RANK.get(s.get("type"), 2), s.get("size_kb") or 0,
                                          s["source_id"]))


def premarked_verdict(entry: dict) -> tuple[str | None, str | None]:
    verdict, reason = rl.manifest_verdict(entry)
    if verdict:
        return verdict, reason
    if entry.get("text_native_first5") is False:
        return "unsupported_format", "scanned or no extractable text (manifest text_native_first5 false)"
    return None, None


def estimate_words(entry: dict) -> int:
    if entry.get("pages") and (entry.get("format") or "pdf") == "pdf":
        return int(entry["pages"] * WORDS_PER_PDF_PAGE)
    return int((entry.get("size_kb") or 0) * 1024 / 5.8)


def estimate_cost_from_words(words: int) -> dict[str, float]:
    """Boundary LLM + enrich + embed. Synthetic chunks; uses part B's estimator."""
    import enrich_library as E
    n = max(1, round(words / WORDS_PER_CHUNK))
    synth = [{"word_count": WORDS_PER_CHUNK, "text": ""}] * n
    enrich_embed = E.estimate_source_cost(synth, ("enrich", "embed"))
    # boundary calls only where rules cannot decide: assume a quarter of the text, with margin
    boundary = round((words * 0.25 * 1.4 * 0.40 + n * 0.25 * 150 * 1.60) / 1e6 * 1.25, 6)
    return {"chunks": n, "boundary": boundary, "enrich_embed": enrich_embed,
            "total": round(boundary + enrich_embed, 6)}


def estimate_entry(entry: dict, cfg: Cfg) -> dict[str, float]:
    chunks_path = cfg.library_root / entry["source_id"] / "chunks.jsonl"
    if chunks_path.exists():  # real chunks: exact enrich/embed estimate
        import enrich_library as E
        chunks = rl.read_jsonl(chunks_path)
        ee = E.estimate_source_cost(chunks, ("enrich", "embed"))
        return {"chunks": len(chunks), "boundary": 0.0, "enrich_embed": ee, "total": ee}
    return estimate_cost_from_words(estimate_words(entry))


def pending_sources(cfg: Cfg) -> list[dict]:
    st = state.load(cfg.state_path)["sources"]
    out = []
    for e in order_sources(rl.load_manifest(cfg.manifest)):
        if premarked_verdict(e)[0]:
            continue
        if st.get(e["source_id"], {}).get("status") in FINAL_SKIP:
            continue
        out.append(e)
    return out


# ---------------------------------------------------------------- queues
def add_fix_queue(cfg: Cfg, sid: str, reasons: list[str], qa: dict) -> None:
    q = [r for r in read_json(cfg.queue_path, []) if r.get("source_id") != sid]
    q.append({"source_id": sid, "reasons": reasons, "qa": qa})
    rl.write_json_atomic(cfg.queue_path, q)


def drop_fix_queue(cfg: Cfg, sid: str) -> None:
    q = read_json(cfg.queue_path, [])
    rl.write_json_atomic(cfg.queue_path, [r for r in q if r.get("source_id") != sid])


def register_spot_check(cfg: Cfg, sid: str, flagged_pct: float) -> bool:
    data = read_json(cfg.spot_path, {"processed": [], "queue": []})
    if sid in data["processed"]:
        return any(r["source_id"] == sid for r in data["queue"])
    data["processed"].append(sid)
    n = len(data["processed"])
    reasons = []
    if n <= 3:
        reasons.append("first_3")
    if n % 10 == 0:
        reasons.append("every_10th")
    if flagged_pct > GATE_SPOT_FLAG_PCT:
        reasons.append(f"qa_flagged_{flagged_pct}pct")
    if reasons:
        data["queue"].append({"source_id": sid, "reasons": reasons, "position": n})
        state.set_status(sid, state.get_status(sid, cfg.state_path), cfg.state_path,
                         agent_check_pending=True)
    rl.write_json_atomic(cfg.spot_path, data)
    return bool(reasons)


# ---------------------------------------------------------------- checks
def qa_failure_reasons(qa: dict) -> list[str]:
    g = qa["gate"]
    reasons = []
    if not g["flagged_ok"]:
        reasons.append(f"flagged {qa['flagged_pct']}% (limit 3%)")
        top = sorted(qa.get("heuristic_counts", {}).items(), key=lambda kv: -kv[1])[:3]
        reasons.append("top heuristics: " + ", ".join(f"{k}={v}" for k, v in top if v))
    if not g["median_ok"]:
        reasons.append(f"median words {qa['median_words']} (needs 200-450)")
    if qa.get("chunks", 0) == 0:
        reasons.append("no chunks")
    return reasons


def punctuation_share(paras_path: Path) -> float:
    rows = rl.read_jsonl(paras_path)
    if not rows:
        return 0.0
    ok = sum(1 for r in rows if r["text"].rstrip().endswith((".", "?", "!", '"', "”", "’", ")")))
    return ok / len(rows)


# ---------------------------------------------------------------- per source
def mark(cfg: Cfg, sid: str, status: str, note: str | None = None, **fields) -> None:
    state.set_status(sid, status, cfg.state_path, note=note, **fields)


def run_enrich_embed(cfg: Cfg, entry: dict) -> str:
    """enrich (with boundary) -> merge_pass (re-enrich merged chunks) -> embed the FINAL text -> done."""
    sid = entry["source_id"]
    import enrich_library as E
    enrich_fn = cfg.enrich_fn or (lambda s: E.enrich_source(s, log=lambda *_: None))
    embed_fn = cfg.embed_fn or (lambda s: E.embed_source(s, log=lambda *_: None))
    merge_fn = cfg.merge_fn
    if merge_fn is None:
        import merge_library
        merge_fn = lambda s: merge_library.merge_pass(s, log=lambda *_: None)  # noqa: E731
    est = estimate_entry(entry, cfg)["total"]
    state.refuse_to_start(est, cfg.state_path)
    if not state.at_least(sid, "enriched", cfg.state_path):
        res = enrich_fn(sid)
        if res.get("failed"):
            mark(cfg, sid, "needs_review", f"enrichment failed for {len(res['failed'])} chunks: "
                 f"{res['failed'][:5]}")
            return "needs_review"
        mark(cfg, sid, "enriched")
    if not state.load(cfg.state_path)["sources"].get(sid, {}).get("merge_done") \
            and not state.at_least(sid, "embedded", cfg.state_path):
        res = merge_fn(sid) or {}
        if res.get("failed"):
            mark(cfg, sid, "needs_review", f"re-enrichment after boundary merge failed for "
                 f"{len(res['failed'])} chunks: {res['failed'][:5]}")
            return "needs_review"
        state.update_fields(sid, cfg.state_path, merge_done=True)
    if not state.at_least(sid, "embedded", cfg.state_path):
        embed_fn(sid)
        mark(cfg, sid, "embedded")
    mark(cfg, sid, "done")
    return "done"


def process_source(cfg: Cfg, entry: dict, retry: bool = False) -> str:
    """Returns the resulting status, or 'budget_refused' (caller stops the loop)."""
    sid = entry["source_id"]
    opts = cfg.opts()
    st = state.load(cfg.state_path)["sources"].get(sid, {})
    status = st.get("status", "pending")
    state.ensure_source(sid, cfg.state_path, title=entry.get("title"), pillar=entry.get("pillar"),
                        source_path=entry.get("path"))
    verdict, reason = premarked_verdict(entry)
    if verdict:
        mark(cfg, sid, verdict, reason)
        return verdict
    if status in FINAL_SKIP:
        return status
    try:
        # (a) budget check
        est = estimate_entry(entry, cfg)
        try:
            state.refuse_to_start(est["total"], cfg.state_path)
        except state.BudgetExhausted as error:
            cfg.log(f"[{sid}] REFUSED: {error}")
            return "budget_refused"

        out = cfg.library_root / sid
        if status in ("pending",) or not (out / "paragraphs.jsonl").exists():
            # (b) extract
            r = rl.process_source(entry, ("extract",), opts)
            if r["status"] in ("unsupported_format", "needs_review"):
                return r["status"]
            words = state.load(cfg.state_path)["sources"][sid].get("words", 0)
            if words < MIN_WORDS:
                mark(cfg, sid, "unsupported_format", f"too little text ({words} words)")
                return "unsupported_format"
            share = punctuation_share(out / "paragraphs.jsonl")
            if share < PUNCT_MIN_SHARE:
                mark(cfg, sid, "needs_review",
                     f"no sentence punctuation (only {share:.0%} of paragraphs end a sentence)")
                return "needs_review"
            est = estimate_entry({**entry, "pages": None, "size_kb": words * 5.8 / 1024}, cfg)
            try:
                state.refuse_to_start(est["total"], cfg.state_path)
            except state.BudgetExhausted as error:
                cfg.log(f"[{sid}] REFUSED after extraction: {error}")
                return "budget_refused"

        if status in ("pending", "extracted", "qa_failed_pending_fix") or not (out / "chunks.jsonl").exists():
            force = status == "qa_failed_pending_fix"
            rl.process_source(entry, ("chunk",), cfg.opts(force=force))
        if not state.at_least(sid, "enriched", cfg.state_path):
            qa_res = rl.run_qa(entry, opts)
            qa = qa_res["qa"]
            register_spot_check(cfg, sid, qa["flagged_pct"])
            if not qa["gate"]["passed"]:
                reasons = qa_failure_reasons(qa)
                if retry or status == "qa_failed_pending_fix" or st.get("qa_retries", 0) >= 1:
                    mark(cfg, sid, "needs_review", "QA failed again after retry: " + "; ".join(reasons),
                         qa_retries=st.get("qa_retries", 0) + 1)
                    drop_fix_queue(cfg, sid)
                    return "needs_review"
                mark(cfg, sid, "qa_failed_pending_fix", "QA failed: " + "; ".join(reasons),
                     qa_flagged_pct=qa["flagged_pct"], qa_median_words=qa["median_words"])
                add_fix_queue(cfg, sid, reasons, qa)
                return "qa_failed_pending_fix"
            drop_fix_queue(cfg, sid)
            mark(cfg, sid, "qa_passed", qa_flagged_pct=qa["flagged_pct"],
                 qa_median_words=qa["median_words"])
        # (d) enrich + embed
        return run_enrich_embed(cfg, entry)
    except state.BudgetExhausted as error:
        cfg.log(f"[{sid}] REFUSED: {error}")
        return "budget_refused"
    except Exception as error:  # never stall
        mark(cfg, sid, "needs_review", f"{type(error).__name__}: {error}")
        return "needs_review"
    finally:
        try:
            write_report(cfg)
        except Exception as error:  # report must never stop the run
            cfg.log(f"report write failed: {type(error).__name__}: {error}")


# ---------------------------------------------------------------- report
def dir_size(path: Path) -> int:
    total = 0
    for root, _, files in os.walk(path):
        for f in files:
            try:
                total += os.path.getsize(os.path.join(root, f))
            except OSError:
                pass
    return total


def upload_estimate_bytes(cfg: Cfg, sid: str) -> int:
    p = cfg.library_root / sid / "chunks.jsonl"
    if not p.exists():
        return 0
    total = 0
    for c in rl.read_jsonl(p):
        total += len(c.get("text", "").encode("utf-8"))
        total += len(json.dumps({k: c[k] for k in ENRICH_KEYS if k in c}, ensure_ascii=False).encode("utf-8"))
        total += PER_CHUNK_UPLOAD_OVERHEAD
    return total


def fmt_mb(n: float) -> str:
    return f"{n / 1_048_576:.1f} MB"


def write_report(cfg: Cfg) -> Path:
    manifest = rl.load_manifest(cfg.manifest)
    st = state.load(cfg.state_path)
    checks = read_json(cfg.checks_path, {})
    spot = read_json(cfg.spot_path, {"queue": []})
    queue_ids = {r["source_id"] for r in spot.get("queue", [])}
    rows, counts, upload = [], {}, 0
    notes_by_status = {"needs_review": [], "duplicate": [], "unsupported_format": [], "excluded": []}
    for e in order_sources(manifest):
        sid = e["source_id"]
        s = st["sources"].get(sid, {})
        status = s.get("status") or premarked_verdict(e)[0] or e.get("status_hint") or "pending"
        if status == "pending" and e.get("status_hint") in ("excluded", "duplicate"):
            status = e["status_hint"]
        if status == "pending" and premarked_verdict(e)[0]:
            status = premarked_verdict(e)[0]
        counts[status] = counts.get(status, 0) + 1
        qa = read_json(cfg.library_root / sid / "qa.json", {})
        chunks = s.get("chunks") or qa.get("chunks") or ""
        median = qa.get("median_words", "")
        flagged = f"{qa['flagged_pct']}%" if "flagged_pct" in qa else ""
        chk = checks.get(sid)
        if chk:
            agent = f"{chk.get('agent', '?')}: {chk.get('result', '?')}"
        elif s.get("agent_check_pending") or sid in queue_ids:
            agent = "pending"
        else:
            agent = ""
        last_note = (s.get("notes") or [{}])[-1].get("note", "")
        if chk and chk.get("notes"):
            last_note = (last_note + " | " if last_note else "") + str(chk["notes"])
        rows.append((e.get("title") or sid, e.get("pillar", ""), status, chunks, median, flagged,
                     agent, f"${s.get('cost_usd', 0.0):.4f}", last_note.replace("|", "/").replace("\n", " ")))
        if status in notes_by_status:
            notes_by_status[status].append((e.get("title") or sid, sid, last_note or reason_for(e, status)))
        if status == "done":
            upload += upload_estimate_bytes(cfg, sid)
    spent = round(sum(x.get("cost_usd", 0.0) for x in st["sources"].values()), 4)
    lines = ["# Library Report", "",
             f"Last updated: {time.strftime('%Y-%m-%d %H:%M:%S %z')}", "",
             "## Totals", "",
             "| Status | Sources |", "|---|---|"]
    for k in sorted(counts):
        lines.append(f"| {k} | {counts[k]} |")
    lines += ["", f"- OpenAI spend: ${spent:.4f} of ${cfg.budget:.2f} budget "
                  f"(${cfg.budget - spent:.4f} remaining)",
              f"- Local storage used (library/): {fmt_mb(dir_size(cfg.library_root))}",
              f"- Estimated upload size so far (done sources): {fmt_mb(upload)}", "",
              "## Sources", "",
              "| Title | Pillar | Status | Chunks | Median words | QA flagged | Agent check | Cost | Notes |",
              "|---|---|---|---|---|---|---|---|---|"]
    for r in rows:
        lines.append("| " + " | ".join(str(x) for x in r) + " |")
    for key, heading in (("needs_review", "Needs review"), ("duplicate", "Duplicates"),
                         ("unsupported_format", "Unsupported formats"),
                         ("excluded", "Excluded pilot books")):
        lines += ["", f"## {heading}", ""]
        items = notes_by_status[key]
        lines += [f"- {t} (`{sid}`): {n}" for t, sid, n in items] or ["None."]
    cfg.report_path.parent.mkdir(parents=True, exist_ok=True)
    tmp = cfg.report_path.with_suffix(".md.tmp")
    tmp.write_text("\n".join(lines) + "\n", encoding="utf-8")
    os.replace(tmp, cfg.report_path)
    return cfg.report_path


def reason_for(entry: dict, status: str) -> str:
    if status == "duplicate":
        return f"duplicate of {entry.get('duplicate_of') or 'keeper in same group'}"
    if status == "excluded":
        return "pilot book, already chunked in the pilot" if entry.get("is_pilot") else "excluded"
    v = premarked_verdict(entry)[1]
    return v or ""


# ---------------------------------------------------------------- loop
def run_loop(cfg: Cfg, entries: list[dict], limit: int | None = None,
             stop_after_spend: float | None = None, retry: bool = False) -> dict:
    start_spend = state.total_cost(cfg.state_path)
    results: dict[str, str] = {}
    for entry in entries:
        if limit is not None and len(results) >= limit:
            break
        if stop_after_spend is not None and state.total_cost(cfg.state_path) - start_spend >= stop_after_spend:
            cfg.log(f"Stopping: spent ${state.total_cost(cfg.state_path) - start_spend:.4f} this run "
                    f"(limit ${stop_after_spend:.2f})")
            break
        res = process_source(cfg, entry, retry=retry)
        results[entry["source_id"]] = res
        cfg.log(f"[{entry['source_id']}] -> {res}")
        if res == "budget_refused":
            cfg.log("Stopping cleanly: budget would be exceeded.")
            break
    write_report(cfg)
    return results


def dry_run(cfg: Cfg, entries: list[dict], limit: int | None = None) -> float:
    total = 0.0
    print(f"{'#':>3} {'source_id':<64} {'type':<9} {'size_kb':>9} {'chunks~':>7} {'est USD':>8}")
    for i, e in enumerate(entries, 1):
        est = estimate_entry(e, cfg)
        total += est["total"]
        if limit is None or i <= limit:
            print(f"{i:>3} {e['source_id']:<64} {e.get('type', ''):<9} {e.get('size_kb', 0):>9.1f} "
                  f"{est['chunks']:>7} {est['total']:>8.4f}")
    print(f"Pending sources: {len(entries)}; projected total cost: ${total:.2f} "
          f"(budget ${cfg.budget:.2f}, spent ${state.total_cost(cfg.state_path):.4f})")
    return total


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Phase 1 library run")
    ap.add_argument("--limit", type=int)
    ap.add_argument("--source")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--stop-after-spend", type=float)
    ap.add_argument("--retry-failed", action="store_true")
    ap.add_argument("--list", type=int, default=15, help="rows to print in --dry-run")
    args = ap.parse_args(argv)
    cfg = Cfg()
    if not args.dry_run and not get_key(cfg):
        print("Refusing to run: OPENAI_API_KEY is missing.", file=sys.stderr)
        return 2
    state.set_budget(cfg.budget, cfg.state_path) if not args.dry_run else None
    manifest = {e["source_id"]: e for e in rl.load_manifest(cfg.manifest)}
    if args.retry_failed:
        ids = state.sources_with_status("qa_failed_pending_fix", path=cfg.state_path)
        entries = [manifest[i] for i in ids if i in manifest]
    elif args.source:
        if args.source not in manifest:
            ap.error(f"unknown source_id {args.source}")
        entries = [manifest[args.source]]
    else:
        entries = pending_sources(cfg)
    if args.dry_run:
        dry_run(cfg, entries, args.list if not args.limit else args.limit)
        return 0
    results = run_loop(cfg, entries, args.limit, args.stop_after_spend, retry=args.retry_failed)
    print(f"Processed {len(results)} sources. Spend ${state.total_cost(cfg.state_path):.4f} "
          f"of ${cfg.budget:.2f}. Report: {cfg.report_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
