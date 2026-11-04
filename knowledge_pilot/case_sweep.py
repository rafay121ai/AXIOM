"""Case sweep (PROMPT_VERSION 'sweep-v1'): recover worked cases the main extractor skipped.

For every window, find runs of 3+ consecutive window paragraphs that no lesson in that window cites. Each run
(plus 1 context paragraph each side, never citable) goes to the model with one question: does this passage hold
a worked case that demonstrates a principle a founder could use? Answer is lessons in the v3 schema
(lesson_type 'story') or {"lessons": []}. Reuses client, schema, validation, cache and cost logging of
library_lessons_v3. No database.

  python case_sweep.py --lessons runs/round_5/lessons.jsonl --windows golden/windows.json --out <dir> [--dry-run]
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import library_lessons as v2  # noqa: E402
import library_lessons_v3 as l3  # noqa: E402
import library_state as state  # noqa: E402

SWEEP_VERSION = "sweep-v2"
MIN_RUN = 3
CAP_USD = l3.CAP_USD

_RULES = l3.INSTRUCTIONS.split("Rules for each field:", 1)[1].split("The window to read comes last", 1)[0].strip()

SWEEP_INSTRUCTIONS = f"""You read one passage from a book, paper or transcript that a first extraction pass found no lesson in. Answer one question: does this passage contain a worked case or example that demonstrates a principle a startup founder could use?

If no, return {{"lessons": []}}. Scene setting, introductions, transitions, banter, exhortations, market commentary and anecdotes with no transferable point are a no. So is any case whose point is not stated or plainly shown by the paragraphs you cite. If yes, return one lesson per distinct case (usually one), in the lesson schema below.

Sweep rules:
- lesson_type is always "story": cite up to 8 CONTIGUOUS paragraphs (every paragraph from the first id to the last, no gaps; to skip a paragraph, end the span before it), including the paragraph with the payoff or outcome of the case.
- principle: what the case demonstrates, grounded ONLY in what the case shows. Do not add concepts, advice or consequences the text does not show.
- Attribute by the actual speaker's name as it appears in the cited text. In a transcript every paragraph is tagged with its speaker: use that name, never "the speaker", "the host" or "the guest". In a book, do NOT add names that are not in the cited text; if the text does not name the person, say "the author".
- CONTEXT ONLY paragraphs help you read the case but must never be cited.

Rules for each field:
{_RULES}

The passage comes last."""


class SweepExtractor(l3.ExtractorV3):
    prompt_version = SWEEP_VERSION
    purpose = "case_sweep"

    def __init__(self, client, model=l3.DEFAULT_MODEL, examples=None, **kw):
        stub = {"good": [{"lesson": {}}] * 3, "bad": [{"lesson": {}}] * 3}   # sweep prompt has no examples
        super().__init__(client, model, stub, **kw)
        self.system = SWEEP_INSTRUCTIONS


# ----------------------------------------------------------------------------

def find_runs(paragraphs: list[dict], cited: set[str], min_run: int = MIN_RUN) -> list[tuple[int, int]]:
    """(start, end_exclusive) index ranges of 3+ consecutive uncited paragraphs."""
    runs, i, n = [], 0, len(paragraphs)
    while i < n:
        if paragraphs[i]["id"] in cited:
            i += 1
            continue
        j = i
        while j < n and paragraphs[j]["id"] not in cited:
            j += 1
        if j - i >= min_run:
            runs.append((i, j))
        i = j
    return runs


def build_run_windows(window: dict, lessons: list[dict], min_run: int = MIN_RUN) -> list[dict]:
    cited = {pid for l in lessons if l.get("window_id") == window["window_id"] for pid in l.get("paragraph_ids", [])}
    paras = window["paragraphs"]
    ctx_before = (window.get("context") or [])
    out = []
    for k, (a, b) in enumerate(find_runs(paras, cited, min_run)):
        before = paras[a - 1] if a > 0 else (ctx_before[-1] if ctx_before else None)
        after = paras[b] if b < len(paras) else None
        out.append({"window_id": f"{window['window_id']}_sw{k}", "parent_window": window["window_id"],
                    "source_id": window["source_id"], "chapter": window["chapter"],
                    "sections": window.get("sections") or [], "word_count": sum(p["word_count"] for p in paras[a:b]),
                    "paragraphs": paras[a:b], "context": [p for p in (before, after) if p]})
    return out


def run_sweep(windows: list[dict], lessons: list[dict], extractor: SweepExtractor, out_dir: Path,
              max_cost: float | None = None) -> dict:
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    runs = [r for w in windows for r in build_run_windows(w, lessons)]
    sweep_rows, dropped, stopped = [], [], None
    for r in runs:
        if max_cost is not None and not extractor.is_cached(r) and \
                extractor.stats["cost_usd"] + extractor.estimate(r) > max_cost:
            stopped = f"max_cost {max_cost} reached"
            break
        try:
            raw = extractor.extract(r)
        except state.BudgetExhausted as exc:
            stopped = str(exc)
            break
        except RuntimeError as exc:
            dropped.append({"window_id": r["window_id"], "reasons": [f"call_failed:{exc}"], "lesson": None})
            continue
        kept, drops = l3.validate_all(raw, r)
        dropped += drops
        pm = {p["id"]: p for p in r["paragraphs"]}
        for i, l in enumerate(kept):
            l["lesson_type"] = "story"
            pages = [pm[x].get(f) for x in l["paragraph_ids"] for f in ("page_start", "page_end")]
            pages = [x for x in pages if x is not None]
            sweep_rows.append({"lesson_id": f"{r['window_id']}_l{i:02d}", "window_id": r["parent_window"],
                               "sweep_run": r["window_id"], "source_id": r["source_id"], "chapter": r["chapter"],
                               "prompt_version": SWEEP_VERSION, "model": extractor.model, "source": "sweep", **l,
                               "page_start": min(pages) if pages else None, "page_end": max(pages) if pages else None,
                               "evidence_paragraphs": [{"id": x, "text": pm[x]["text"]} for x in l["paragraph_ids"]]})
    merged = [dict(l) for l in lessons] + sweep_rows

    def dump(name, rows):
        (out_dir / name).write_text("".join(json.dumps(x, ensure_ascii=False) + "\n" for x in rows), encoding="utf-8")
    dump("sweep_lessons.jsonl", sweep_rows)
    dump("merged.jsonl", merged)
    dump("dropped.jsonl", dropped)
    cost = {"model": extractor.model, "prompt_version": SWEEP_VERSION, "runs": len(runs),
            "calls_cached": extractor.stats["cached"], "api_calls": extractor.stats["called"],
            "cost_usd": round(extractor.stats["cost_usd"], 6), "sweep_lessons_kept": len(sweep_rows),
            "sweep_lessons_dropped": len(dropped), "stopped": stopped,
            "library_total_cost_usd": state.total_cost(extractor.state_path)}
    (out_dir / "cost.json").write_text(json.dumps(cost, indent=2) + "\n", encoding="utf-8")
    return cost


def dry_run(windows: list[dict], lessons: list[dict], model: str, out=print) -> dict:
    ex = SweepExtractor(None, model)
    runs = [r for w in windows for r in build_run_windows(w, lessons)]
    usd = sum(ex.estimate(r) for r in runs)
    words = sum(r["word_count"] for r in runs)
    out(f"{len(runs)} runs ({words} words) across {len(windows)} windows, est ${usd:.4f} on {model}")
    return {"runs": len(runs), "words": words, "usd": round(usd, 4)}


def read_jsonl(path: Path) -> list[dict]:
    return [json.loads(l) for l in Path(path).read_text(encoding="utf-8").splitlines() if l.strip()]


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--lessons", type=Path, required=True)
    ap.add_argument("--windows", type=Path, default=l3.WINDOWS_PATH)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--model", default=l3.DEFAULT_MODEL, choices=l3.MODELS)
    ap.add_argument("--max-cost", type=float, default=None)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args(argv)
    windows, lessons = l3.load_windows(args.windows), read_jsonl(args.lessons)
    if args.dry_run:
        dry_run(windows, lessons, args.model)
        return 0
    ex = SweepExtractor(v2.get_client(), args.model)
    print(json.dumps(run_sweep(windows, lessons, ex, args.out, args.max_cost), indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
