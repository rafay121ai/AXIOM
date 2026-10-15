"""Run the v3.3 lesson extractor over whole sources (optionally the case sweep too). No database.

  python run_source.py --dry-run SOURCE_ID [SOURCE_ID ...]
  python run_source.py --windows-only SOURCE_ID ...      # writes library/<id>/lessons_v3.3/windows.jsonl, no calls
  python run_source.py [--sweep] [--max-cost USD] SOURCE_ID ...

Windows: same logic as golden_windows.build_windows (about 2,000 words, inside a chapter, heading breaks
preferred, last 2 paragraphs of the previous window in the same chapter as CONTEXT ONLY), one call per window.
Output: library/<id>/lessons_v3.3/{lessons.jsonl,dropped.jsonl,cost.json,state.json,windows.jsonl}.
Resumable: windows already in the cache cost nothing; state.json records progress and failures.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import case_sweep  # noqa: E402
import golden_windows as gw  # noqa: E402
import library_lessons as v2  # noqa: E402
import library_lessons_v3 as l3  # noqa: E402
import library_state as state  # noqa: E402

OUT_NAME = "lessons_v3.3"


def source_windows(source_id: str, library_dir: Path = l3.LIB) -> list[dict]:
    paras, heads, _ = gw.load_source(source_id, library_dir)
    wins = gw.build_windows(paras, heads)
    out = []
    for k, w in enumerate(wins):
        prev = wins[k - 1] if k > 0 and wins[k - 1][0]["chapter"] == w[0]["chapter"] else []
        out.append({"window_id": f"{source_id}_w{k:04d}", "source_id": source_id, "chapter": w[0]["chapter"],
                    "sections": sorted({p["section"] for p in w if p.get("section")}),
                    "word_count": sum(p["word_count"] for p in w), "paragraphs": w, "context": prev[-gw.CONTEXT_N:]})
    return out


def _page(p, key):
    return p.get(key) or p.get("page")


def lesson_rows(window: dict, kept: list[dict], model: str) -> list[dict]:
    pm = {p["id"]: p for p in window["paragraphs"]}
    rows = []
    for i, l in enumerate(kept):
        ps = [pm[x] for x in l["paragraph_ids"]]
        pages = [v for p in ps for v in (_page(p, "page_start"), _page(p, "page_end")) if v is not None]
        rows.append({"lesson_id": f"{window['window_id']}_l{i:02d}", "window_id": window["window_id"],
                     "source_id": window["source_id"], "chapter": window["chapter"],
                     "page_start": min(pages) if pages else None, "page_end": max(pages) if pages else None,
                     "prompt_version": l3.PROMPT_VERSION, "model": model, **l,
                     "evidence_paragraphs": [{"id": p["id"], "text": p["text"]} for p in ps]})
    return rows


def dump(path: Path, rows: list[dict]) -> None:
    path.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows), encoding="utf-8")


def write_windows(source_id: str, windows: list[dict], library_dir: Path = l3.LIB) -> Path:
    d = library_dir / source_id / OUT_NAME
    d.mkdir(parents=True, exist_ok=True)
    dump(d / "windows.jsonl", [{"window_id": w["window_id"], "chapter": w["chapter"], "word_count": w["word_count"],
                                "paragraph_ids": [p["id"] for p in w["paragraphs"]],
                                "context_ids": [p["id"] for p in w["context"]]} for w in windows])
    return d


def dry_run(source_ids: list[str], model: str, examples: dict, library_dir: Path = l3.LIB, out=print) -> dict:
    system = l3.system_prompt(examples)
    total = {"windows": 0, "words": 0, "usd": 0.0}
    for sid in source_ids:
        ws = source_windows(sid, library_dir)
        book, author = l3.source_info(sid, library_dir)
        usd = sum(l3.estimate_cost(model, system, l3.render_user(w, book, author))[2] for w in ws)
        words = sum(w["word_count"] for w in ws)
        out(f"{sid}: {len(ws)} windows, {words} words, est ${usd:.4f} on {model}")
        total["windows"] += len(ws); total["words"] += words; total["usd"] += usd
    total["usd"] = round(total["usd"], 4)
    out(f"TOTAL: {total['windows']} windows, {total['words']} words, est ${total['usd']:.4f} (output estimated at "
        f"{l3.EST_LESSONS_PER_WINDOW} lessons per window; dense windows run higher)")
    return total


def run_source(source_id: str, extractor: l3.ExtractorV3, max_cost: float | None = None, sweep: bool = False,
               library_dir: Path = l3.LIB) -> dict:
    windows = source_windows(source_id, library_dir)
    d = write_windows(source_id, windows, library_dir)
    st_path = d / "state.json"
    st = json.loads(st_path.read_text()) if st_path.exists() else {"done": [], "failed": {}}
    done, lessons, dropped, stopped = set(st["done"]), [], [], None
    start_cost = extractor.stats["cost_usd"]
    for w in windows:
        if max_cost is not None and not extractor.is_cached(w) and \
                extractor.stats["cost_usd"] - start_cost + extractor.estimate(w) > max_cost:
            stopped = f"max_cost {max_cost} reached"
            break
        try:
            raw = extractor.extract(w)
        except state.BudgetExhausted as exc:
            stopped = str(exc)
            break
        except RuntimeError as exc:
            st["failed"][w["window_id"]] = str(exc)
            continue
        st["failed"].pop(w["window_id"], None)
        kept, drops = l3.validate_all(raw, w)
        lessons += lesson_rows(w, kept, extractor.model)
        dropped += drops
        done.add(w["window_id"])
    st.update(done=sorted(done), updated=datetime.now(timezone.utc).isoformat(), windows_total=len(windows),
              stopped=stopped)
    dump(d / "lessons.jsonl", lessons)
    dump(d / "dropped.jsonl", dropped)
    st_path.write_text(json.dumps(st, indent=2) + "\n", encoding="utf-8")
    cost = {"source_id": source_id, "model": extractor.model, "prompt_version": l3.PROMPT_VERSION,
            "windows": len(windows), "windows_done": len(done), "cached_windows": extractor.stats["cached"],
            "api_calls": extractor.stats["called"], "cost_usd": round(extractor.stats["cost_usd"] - start_cost, 6),
            "lessons_kept": len(lessons), "lessons_dropped": len(dropped), "failed": len(st["failed"]),
            "stopped": stopped, "library_total_cost_usd": state.total_cost(extractor.state_path)}
    if sweep and not stopped:
        sx = case_sweep.SweepExtractor(extractor.client, extractor.model, cache_path=extractor.cache_path,
                                       state_path=extractor.state_path, sleep=extractor.sleep, cap=extractor.cap,
                                       library_dir=extractor.library_dir)
        remaining = None if max_cost is None else max(0.0, max_cost - cost["cost_usd"])
        cost["sweep"] = case_sweep.run_sweep(windows, lessons, sx, d / "sweep", remaining)
    (d / "cost.json").write_text(json.dumps(cost, indent=2) + "\n", encoding="utf-8")
    return cost


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("source_ids", nargs="+")
    ap.add_argument("--model", default=l3.DEFAULT_MODEL, choices=l3.MODELS)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--windows-only", action="store_true")
    ap.add_argument("--sweep", action="store_true")
    ap.add_argument("--max-cost", type=float, default=None, help="USD cap per source for this run")
    args = ap.parse_args(argv)
    examples = l3.load_examples()
    if args.dry_run:
        dry_run(args.source_ids, args.model, examples)
        return 0
    if args.windows_only:
        for sid in args.source_ids:
            ws = source_windows(sid)
            print(f"{sid}: {len(ws)} windows -> {write_windows(sid, ws)}")
        return 0
    if examples.get("_placeholder"):
        print("Refusing to spend: placeholder examples.", file=sys.stderr)
        return 2
    ex = l3.ExtractorV3(v2.get_client(), args.model, examples)
    for sid in args.source_ids:
        print(json.dumps(run_source(sid, ex, args.max_cost, args.sweep), indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
