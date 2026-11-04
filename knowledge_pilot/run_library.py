#!/usr/bin/env python3
"""Axiom library pipeline, part A: extract -> chunk -> qa.

Examples
  python knowledge_pilot/run_library.py --source everything_store --stages extract,chunk,qa --offline
  python knowledge_pilot/run_library.py --all --offline          # never touches the network
  python knowledge_pilot/run_library.py --all                    # may call gpt-4.1-mini for oversized segments
  python knowledge_pilot/run_library.py --regression             # offline fixture run, writes regression/
  python knowledge_pilot/run_library.py --test                   # unit tests (no API)

Rules
  * --offline means no API call, ever; cached boundary decisions are used and
    cache misses fall back to the rule-based split (counted and reported).
  * State is resumable (library_state.json). A stage is skipped when the source
    already progressed past it, unless --force.
  * chunks.jsonl is archived to _archive/<source_id>/chunks_<YYYYMMDD_HHMM>.jsonl
    before it is overwritten. Nothing under _archive is ever deleted.
  * No database access. Costs are recorded only from returned API usage.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import tempfile
import time
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parent
sys.path.insert(0, str(HERE))

import library_state as state  # noqa: E402
import qa_check  # noqa: E402
from library_chunk import (  # noqa: E402
    BoundaryProvider, build_chunks, distribution, seeds_from_legacy, verify_paragraphs_once,
)
from library_extract import Para, UnsupportedFormat, extract_source  # noqa: E402
from library_text import PIPELINE_VERSION  # noqa: E402

STAGES = ("extract", "chunk", "qa")
DEFAULT_MANIFEST = HERE / "library_manifest.json"
LIBRARY_ROOT = HERE / "library"
ARCHIVE_ROOT = HERE / "_archive"
LEGACY_ROOT = HERE
SUPPORTED_FORMATS = {"pdf", "txt", "text", "md"}


# ----------------------------------------------------------------------------
# Files
# ----------------------------------------------------------------------------

def write_jsonl_atomic(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=path.name + ".", suffix=".tmp", dir=path.parent)
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(tmp, path)


def write_json_atomic(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=path.name + ".", suffix=".tmp", dir=path.parent)
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        json.dump(data, handle, indent=2, ensure_ascii=False)
        handle.write("\n")
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(tmp, path)


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def archive_existing(chunks_path: Path, archive_root: Path, source_id: str) -> Path | None:
    """Copy an existing chunks file to _archive before it is overwritten. Never deletes."""
    if not chunks_path.exists():
        return None
    target_dir = archive_root / source_id
    target_dir.mkdir(parents=True, exist_ok=True)
    stamp = time.strftime("%Y%m%d_%H%M")
    target = target_dir / f"chunks_{stamp}.jsonl"
    n = 1
    while target.exists():  # same-minute rerun: never overwrite an archive
        target = target_dir / f"chunks_{stamp}_{n}.jsonl"
        n += 1
    shutil.copy2(chunks_path, target)
    return target


# ----------------------------------------------------------------------------
# Manifest
# ----------------------------------------------------------------------------

def load_manifest(path: Path) -> list[dict[str, Any]]:
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    sources = data["sources"] if isinstance(data, dict) else data
    ids = [s["source_id"] for s in sources]
    if len(ids) != len(set(ids)):
        raise ValueError("Manifest has duplicate source_id values")
    return sources


def manifest_verdict(entry: dict[str, Any]) -> tuple[str | None, str | None]:
    """Terminal status implied by the manifest alone, with a reason."""
    if entry.get("duplicate_of"):
        return "duplicate", f"duplicate of {entry['duplicate_of']}"
    hint = (entry.get("status_hint") or "").lower()
    if hint in ("excluded", "exclude"):
        return "excluded", "excluded by manifest status_hint"
    if hint == "duplicate":
        return "duplicate", "duplicate by manifest status_hint"
    fmt = (entry.get("format") or Path(entry.get("path", "")).suffix.lstrip(".")).lower()
    if fmt not in SUPPORTED_FORMATS:
        return "unsupported_format", f"format {fmt!r} is not supported"
    if entry.get("text_native") is False:
        return "unsupported_format", "not text native (scanned)"
    return None, None


# ----------------------------------------------------------------------------
# Options and orchestration
# ----------------------------------------------------------------------------

class Options:
    def __init__(self, offline: bool = True, force: bool = False, out_root: Path = LIBRARY_ROOT,
                 archive_root: Path = ARCHIVE_ROOT, state_path: Path | None = None,
                 legacy_root: Path | None = LEGACY_ROOT, budget: float | None = None,
                 repo_root: Path = REPO_ROOT, quiet: bool = False):
        self.offline = offline
        self.force = force
        self.out_root = Path(out_root)
        self.archive_root = Path(archive_root)
        self.state_path = Path(state_path) if state_path else state.DEFAULT_STATE_PATH
        self.legacy_root = Path(legacy_root) if legacy_root else None
        self.budget = budget
        self.repo_root = Path(repo_root)
        self.quiet = quiet

    def log(self, message: str) -> None:
        if not self.quiet:
            print(message, flush=True)


def _api_key_loader(repo_root: Path):
    def load() -> str | None:
        try:
            from dotenv import dotenv_values
        except Exception:
            return os.environ.get("OPENAI_API_KEY")
        return dotenv_values(repo_root / ".env").get("OPENAI_API_KEY") or os.environ.get("OPENAI_API_KEY")
    return load


def source_dir(entry: dict[str, Any], opts: Options) -> Path:
    return opts.out_root / entry["source_id"]


def run_extract(entry: dict[str, Any], opts: Options) -> dict[str, Any]:
    sid = entry["source_id"]
    out = source_dir(entry, opts)
    path = Path(entry["path"])
    path = path if path.is_absolute() else opts.repo_root / path
    fmt = (entry.get("format") or path.suffix.lstrip(".")).lower()
    try:
        paras, report = extract_source(path, fmt, entry.get("title"), sid)
    except UnsupportedFormat as error:
        state.set_status(sid, "unsupported_format", opts.state_path, note=str(error))
        opts.log(f"[{sid}] unsupported_format: {error}")
        return {"status": "unsupported_format", "reason": str(error)}
    if not paras:
        state.set_status(sid, "needs_review", opts.state_path, note="Extraction produced no paragraphs")
        return {"status": "needs_review", "reason": "no paragraphs"}
    report.update({"source_id": sid, "path": entry["path"], "title": entry.get("title"),
                   "paragraphs": len(paras), "words": sum(p.words for p in paras),
                   "chapters_extracted": len(dict.fromkeys(p.chapter for p in paras)),
                   "pipeline_version": PIPELINE_VERSION})
    write_jsonl_atomic(out / "paragraphs.jsonl", [p.to_dict() for p in paras])
    write_json_atomic(out / "extraction.json", report)
    state.set_status(sid, "extracted", opts.state_path, paragraphs=len(paras), words=report["words"])
    opts.log(f"[{sid}] extracted {len(paras)} paragraphs, {report['words']} words, "
             f"{report['chapters_extracted']} chapters ({report.get('chapter_detection')})")
    return {"status": "extracted", "paragraphs": len(paras)}


def load_paragraphs(out: Path) -> list[Para]:
    return [Para(**row) for row in read_jsonl(out / "paragraphs.jsonl")]


def run_chunk(entry: dict[str, Any], opts: Options) -> dict[str, Any]:
    sid = entry["source_id"]
    out = source_dir(entry, opts)
    paras = load_paragraphs(out)
    report = json.loads((out / "extraction.json").read_text(encoding="utf-8"))
    author = entry.get("author") or report.get("meta_author")
    meta = {"source_id": sid, "book": entry.get("title"), "author": author, "pillar": entry.get("pillar")}
    seeds, legacy_cache = None, []
    unmatched = 0
    if opts.legacy_root:
        legacy_dir = opts.legacy_root / sid
        if (legacy_dir / "chunks.jsonl").exists():
            seeds, unmatched = seeds_from_legacy(paras, read_jsonl(legacy_dir / "chunks.jsonl"))
        for name in ("stage3_cache", "boundaries"):
            if (legacy_dir / name).is_dir():
                legacy_cache.append(legacy_dir / name)
    if not opts.offline:
        state.refuse_to_start(path=opts.state_path)
    provider = BoundaryProvider(
        cache_dir=out / "stage3_cache", offline=opts.offline, legacy_cache_dirs=legacy_cache, seeds=seeds,
        record_cost=lambda usd, purpose, usage: state.add_cost(sid, usd, purpose, opts.state_path,
                                                               model="gpt-4.1-mini", usage=usage),
        budget_ok=lambda estimate: state.budget_remaining(opts.state_path) >= estimate,
        api_key_loader=_api_key_loader(opts.repo_root))
    chunks, rows, stats = build_chunks(paras, meta, provider)
    verify_paragraphs_once(paras, chunks)
    archived = archive_existing(out / "chunks.jsonl", opts.archive_root, sid)
    write_jsonl_atomic(out / "chunks.jsonl", chunks)
    write_jsonl_atomic(out / "boundaries.jsonl", rows)
    stats["legacy_seed_unmatched"] = unmatched
    stats["legacy_seeds_used"] = len(seeds) if seeds is not None else 0
    stats["distribution"] = distribution(chunks)
    stats["archived_previous_chunks"] = str(archived) if archived else None
    write_json_atomic(out / "chunk_stats.json", stats)
    state.set_status(sid, "chunked", opts.state_path, chunks=len(chunks))
    opts.log(f"[{sid}] chunked {len(chunks)} chunks, median {stats['distribution'].get('median')} words, "
             f"rule fallbacks {stats['provider']['rule_fallback_segments']}, llm calls {stats['provider']['llm_calls']}")
    return {"status": "chunked", "chunks": len(chunks), "stats": stats}


def run_qa(entry: dict[str, Any], opts: Options) -> dict[str, Any]:
    sid = entry["source_id"]
    out = source_dir(entry, opts)
    result = qa_check.qa_file(out / "chunks.jsonl")
    write_json_atomic(out / "qa.json", result)
    status = "qa_passed" if result["gate"]["passed"] else "needs_review"
    if not state.at_least(sid, "enriched", opts.state_path):
        state.set_status(sid, status, opts.state_path, qa_flagged_pct=result["flagged_pct"],
                         qa_median_words=result["median_words"])
    opts.log(f"[{sid}] qa {status}: " + qa_check.format_row(sid, result).split(": ", 1)[1])
    return {"status": status, "qa": result}


def process_source(entry: dict[str, Any], stages: tuple[str, ...], opts: Options) -> dict[str, Any]:
    sid = entry["source_id"]
    state.ensure_source(sid, opts.state_path, title=entry.get("title"), source_path=entry.get("path"))
    verdict, reason = manifest_verdict(entry)
    if verdict:
        state.set_status(sid, verdict, opts.state_path, note=reason)
        opts.log(f"[{sid}] {verdict}: {reason}")
        return {"status": verdict}
    current = state.get_status(sid, opts.state_path)
    if current in state.TERMINAL_STATUSES and not opts.force:
        opts.log(f"[{sid}] skipped ({current})")
        return {"status": current}
    if state.at_least(sid, "enriched", opts.state_path) and not opts.force and "chunk" in stages:
        opts.log(f"[{sid}] already {current}; refusing to overwrite enriched chunks without --force")
        return {"status": current, "skipped": "downstream_work_exists"}
    out = source_dir(entry, opts)
    result: dict[str, Any] = {"status": current}
    ran_extract = False
    if "extract" in stages:
        if opts.force or current == "pending" or not (out / "paragraphs.jsonl").exists():
            result = run_extract(entry, opts)
            ran_extract = True
            if result["status"] in ("unsupported_format", "needs_review"):
                return result
        else:
            opts.log(f"[{sid}] extract: already done")
    if "chunk" in stages:
        if not (out / "paragraphs.jsonl").exists():
            result = run_extract(entry, opts)
            ran_extract = True
            if result["status"] in ("unsupported_format", "needs_review"):
                return result
        current = state.get_status(sid, opts.state_path)
        if opts.force or ran_extract or not (out / "chunks.jsonl").exists() \
                or current in ("pending", "extracted"):
            result = run_chunk(entry, opts)
        else:
            opts.log(f"[{sid}] chunk: already done")
    if "qa" in stages:
        if (out / "chunks.jsonl").exists():
            result = run_qa(entry, opts)
        else:
            opts.log(f"[{sid}] qa: no chunks yet")
    return result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Axiom library pipeline part A")
    parser.add_argument("--source", action="append", help="source_id (repeatable)")
    parser.add_argument("--all", action="store_true")
    parser.add_argument("--stages", default="extract,chunk,qa")
    parser.add_argument("--offline", action="store_true", help="no API calls, ever")
    parser.add_argument("--manifest", default=str(DEFAULT_MANIFEST))
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--budget", type=float, default=None)
    parser.add_argument("--state", default=None)
    parser.add_argument("--out-root", default=str(LIBRARY_ROOT))
    parser.add_argument("--legacy-root", default=str(LEGACY_ROOT))
    parser.add_argument("--no-legacy", action="store_true")
    parser.add_argument("--regression", action="store_true", help="offline fixture run into regression/")
    parser.add_argument("--test", action="store_true", help="run knowledge_pilot/test_library.py")
    args = parser.parse_args(argv)

    if args.test:
        import unittest
        suite = unittest.defaultTestLoader.discover(str(HERE), pattern="test_library.py")
        return 0 if unittest.TextTestRunner(verbosity=2).run(suite).wasSuccessful() else 1
    if args.regression:
        import regression
        regression.run_regression()
        return 0

    stages = tuple(s.strip() for s in args.stages.split(",") if s.strip())
    bad = [s for s in stages if s not in STAGES]
    if bad:
        parser.error(f"unknown stages {bad}; choose from {STAGES}")
    manifest_path = Path(args.manifest)
    if not manifest_path.is_absolute():
        manifest_path = REPO_ROOT / manifest_path
    sources = load_manifest(manifest_path)
    if args.source:
        wanted = set(args.source)
        missing = wanted - {s["source_id"] for s in sources}
        if missing:
            parser.error(f"unknown source_id: {sorted(missing)}")
        sources = [s for s in sources if s["source_id"] in wanted]
    elif not args.all:
        parser.error("choose --source <id> or --all")

    opts = Options(offline=args.offline, force=args.force, out_root=Path(args.out_root),
                   state_path=Path(args.state) if args.state else None,
                   legacy_root=None if args.no_legacy else Path(args.legacy_root), budget=args.budget)
    if args.budget is not None:
        state.set_budget(args.budget, opts.state_path)
    if not opts.offline:
        try:
            state.refuse_to_start(path=opts.state_path)
        except state.BudgetExhausted as error:
            print(f"Refusing to start: {error}", file=sys.stderr)
            return 2
    failures = 0
    for entry in sources:
        try:
            process_source(entry, stages, opts)
        except state.BudgetExhausted as error:
            print(f"Stopping: {error}", file=sys.stderr)
            return 2
        except Exception as error:  # keep going; record and move on
            failures += 1
            state.set_status(entry["source_id"], "needs_review", opts.state_path,
                             note=f"{type(error).__name__}: {error}")
            print(f"[{entry['source_id']}] FAILED {type(error).__name__}: {error}", file=sys.stderr)
    print(f"Done. Global cost ${state.total_cost(opts.state_path):.4f}, "
          f"budget remaining ${state.budget_remaining(opts.state_path):.4f}.")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
