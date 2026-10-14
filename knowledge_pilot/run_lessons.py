"""CLI for the lessons pipeline.

  python run_lessons.py --source ID --stages paragraphs,windows            # offline
  python run_lessons.py --source ID --dry-run-estimate                     # offline, both models
  python run_lessons.py --source ID --model gpt-4.1-mini                   # real calls (extract onward)
  python run_lessons.py --source ID --model gpt-4.1 --out-suffix ab_big    # A/B into its own directory

Outputs: library/<source>/paragraphs_v2.jsonl, windows_v2.jsonl (shared), and per run
library/<source>/lessons_<suffix or model>/ with window_cache.jsonl, extracted.jsonl, candidates.jsonl,
dropped.jsonl, deduped.jsonl, merges.jsonl, lessons.jsonl, run_report.json.
An existing lessons.jsonl is copied to _archive/<source>/ before it is overwritten.
The offline stages (paragraphs, windows) and --dry-run-estimate never call the API.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import library_lessons as ll  # noqa: E402
import library_paragraphs as lp  # noqa: E402
import library_state as state  # noqa: E402

STAGES = ["paragraphs", "windows", "extract", "validate", "dedupe", "embed"]
OFFLINE_STAGES = {"paragraphs", "windows", "validate"}


def run_source(source_id: str, model: str, stages: list[str], client: Any = None, embed_client: Any = None,
               library_dir: Path | None = None, state_path: Path | str | None = None, suffix: str | None = None,
               limit: int | None = None, workers: int = 1, manifest: dict | None = None,
               archive_root: Path | None = None, preflight: bool = True, sleep=None) -> dict:
    report: dict[str, Any] = {"source_id": source_id, "model": model, "stages": stages,
                              "pipeline_version": ll.PIPELINE_VERSION}
    sdir = lp.source_dir(source_id, library_dir)
    out = ll.lessons_dir(source_id, model, suffix, library_dir)
    out.mkdir(parents=True, exist_ok=True)

    if "paragraphs" in stages:
        rep = lp.run_stage_paragraphs(source_id, library_dir, manifest, archive_root)
        if rep.get("unsupported"):
            report["unsupported"] = rep["unsupported"]
            return report
        report["paragraphs"] = rep.get("paragraph_count")
    if "windows" in stages:
        report["windows"] = len(lp.run_stage_windows(source_id, library_dir))

    paragraphs = lp.read_jsonl(sdir / "paragraphs_v2.jsonl")
    windows = lp.read_jsonl(sdir / "windows_v2.jsonl")
    meta = ll.source_meta(source_id, library_dir, manifest)
    report.update({"book": meta["book"], "author": meta["author"]})

    if "extract" in stages:
        if client is None:
            raise RuntimeError("extract needs an OpenAI client")
        ex = ll.Extractor(source_id, model, client, out, state_path, meta["book"], meta["author"], sleep, workers)
        if preflight:
            uncached = [w for w in (windows[:limit] if limit else windows) if ex.cache_key(w) not in ex.cache]
            need = ll.EST_RETRY_MARGIN * sum(ll.estimate_window_cost(
                model, w["word_count"], sum(ll.word_count(p["text"]) for p in w["context"])) for w in uncached)
            state.refuse_to_start(need, state_path)
        rows = ex.run(windows, limit)
        lp.write_jsonl(out / "extracted.jsonl", rows)
        report["extract"] = dict(ex.stats, extracted_lessons=sum(len(r["lessons"]) for r in rows))

    if "validate" in stages:
        extracted = lp.read_jsonl(out / "extracted.jsonl")
        valid, dropped = ll.validate_all(extracted, windows, meta["author"])
        lp.write_jsonl(out / "candidates.jsonl", valid)
        lp.write_jsonl(out / "dropped.jsonl", dropped)
        reasons: dict[str, int] = {}
        for d in dropped:
            for r in d["reasons"]:
                k = r.split(":")[0]
                reasons[k] = reasons.get(k, 0) + 1
        report["validate"] = {"valid": len(valid), "dropped": len(dropped), "drop_reasons": reasons}

    emb = None
    if {"dedupe", "embed"} & set(stages):
        cands = lp.read_jsonl(out / "candidates.jsonl")
        if embed_client is None and cands:
            embed_client = client
        if cands and embed_client is None:
            raise RuntimeError("dedupe/embed needs an OpenAI client")
        emb = ll.Embedder(source_id, embed_client, out / "embeddings_cache.jsonl", state_path, sleep) if cands else None
        vectors = emb.embed([ll.embedding_text(c["lesson"]) for c in cands]) if cands else []
        if "dedupe" in stages:
            kept, merges = ll.dedupe(cands, vectors)
            lp.write_jsonl(out / "deduped.jsonl", kept)
            lp.write_jsonl(out / "merges.jsonl", merges)
            report["dedupe"] = {"before": len(cands), "after": len(kept), "merges": len(merges),
                                "rule": ll.DEDUPE_RULE}
        else:
            kept = [{"window_id": c["window_id"], "lesson": c["lesson"], "embedding": v} for c, v in zip(cands, vectors)]
        if "embed" in stages:
            if "dedupe" not in stages and (out / "deduped.jsonl").exists():
                kept = lp.read_jsonl(out / "deduped.jsonl")
            rows = ll.build_rows(source_id, kept, paragraphs, model, meta)
            target = out / "lessons.jsonl"
            lp.archive_if_exists(target, source_id, archive_root, label=f"lessons_{out.name}")
            lp.write_jsonl(target, rows)
            report["embed"] = {"lessons": len(rows)}

    report["cost_by_model_usd"] = state.cost_by_model(source_id, state_path)
    (out / "run_report.json").write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    return report


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Axiom lessons pipeline")
    ap.add_argument("--source", action="append", help="source_id (repeatable)")
    ap.add_argument("--all", action="store_true", help="every non-excluded source in the manifest (estimate only)")
    ap.add_argument("--model", choices=ll.MODELS, default=None)
    ap.add_argument("--stages", default="paragraphs,windows,extract,validate,dedupe,embed")
    ap.add_argument("--dry-run-estimate", action="store_true", help="project cost from real paragraph counts; no API")
    ap.add_argument("--out-suffix", default=None, help="output dir library/<source>/lessons_<suffix>/ (default: model name)")
    ap.add_argument("--limit-windows", type=int, default=None)
    ap.add_argument("--workers", type=int, default=1)
    ap.add_argument("--budget", type=float, default=None, help="set the shared budget (USD) before running")
    ap.add_argument("--state", default=None)
    ap.add_argument("--library-dir", default=None)
    ap.add_argument("--no-preflight", action="store_true", help="skip the whole-source budget check (per-call checks stay)")
    args = ap.parse_args(argv)
    libdir = Path(args.library_dir) if args.library_dir else None
    manifest = lp.load_manifest()
    ids = args.source or ([e["source_id"] for e in manifest["sources"]] if args.all else [])
    if not ids:
        ap.error("choose --source <id> or --all")
    known = {e["source_id"] for e in manifest["sources"]}
    if set(ids) - known:
        ap.error(f"unknown source_id: {sorted(set(ids) - known)}")

    if args.dry_run_estimate:
        for model in ([args.model] if args.model else list(ll.MODELS)):
            est = ll.estimate_library(model, libdir, manifest, ids)
            for r in est["per_source"]:
                print(f"{model:13s} {r['source_id']:55s} paragraphs={r['paragraphs']:5d} windows={r['windows']:4d} "
                      f"est=${r['est_usd'] if r['est_usd'] is not None else 'n/a'}  ({r['basis']})")
            print(f"{model:13s} TOTAL windows={est['windows']} est=${est['est_usd']} "
                  f"({est['sources_without_paragraphs']} sources without paragraphs)")
        return 0

    stages = [s.strip() for s in args.stages.split(",") if s.strip()]
    bad = [s for s in stages if s not in STAGES]
    if bad:
        ap.error(f"unknown stages {bad}; choose from {STAGES}")
    model = args.model or ll.DEFAULT_MODEL
    if args.budget is not None:
        state.set_budget(args.budget, args.state)
    client = None
    if set(stages) - OFFLINE_STAGES - {"windows"}:
        client = ll.get_client()
    for sid in ids:
        try:
            rep = run_source(sid, model, stages, client, client, libdir, args.state, args.out_suffix,
                             args.limit_windows, args.workers, manifest, preflight=not args.no_preflight)
        except state.BudgetExhausted as exc:
            print(f"{sid}: refused to start: {exc}")
            return 2
        print(json.dumps({k: v for k, v in rep.items() if k != "dedupe"} | (
            {"dedupe": {k: v for k, v in rep["dedupe"].items() if k != "rule"}} if "dedupe" in rep else {}),
            indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
