"""Offline regression run: the new pipeline on The Everything Store and Thinking in Bets.

No API calls. Boundaries come from the pilot's own earlier decisions (its chunk starts and
stage3_cache), mapped onto the newly extracted paragraphs. Output goes to
knowledge_pilot/regression/<book>/, never to library/.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import qa_check  # noqa: E402
import run_library as rl  # noqa: E402

FIXTURES = [
    {"source_id": "everything_store", "path": "sources/money_game/biographies/everything-store.pdf",
     "pillar": "money_game", "type": "book", "format": "pdf", "title": "The Everything Store",
     "author": "Brad Stone", "is_pilot": True, "status_hint": None, "duplicate_of": None, "text_native": True},
    {"source_id": "thinking_in_bets", "path": "sources/think_sharper/books/Thinking in Bets.pdf",
     "pillar": "think_sharper", "type": "book", "format": "pdf", "title": "Thinking in Bets",
     "author": "Annie Duke", "is_pilot": True, "status_hint": None, "duplicate_of": None, "text_native": True},
]

# Chunks the pilot audit named as broken: (pilot chunk id, what was wrong, regex to find the text in the new chunks).
AUDIT_CASES = [
    ("everything_store_0001", "lost line-break hyphen: 'sixthgrader'", r"sandy-haired sixth-grader", r"sixthgrader"),
    ("everything_store_0084", "opens on a continuation: 'But the deluge of spending...'", r"But the deluge of spending", None),
    ("everything_store_0186", "opens on a continuation: 'And then Manber decided to leave.'", r"And then Manber decided to leave\.", None),
    ("thinking_in_bets_0223", "footnote marker '*' spliced into the body: 'budgeting.* ASAS, founded...'", r"into their budgeting\.[^\n]{0,40}ASAS, founded", r"budgeting\.\*"),
    ("thinking_in_bets_0006", "lost hyphens: 'shortyardage', 'third- or fourth-down'", r"short-yardage situation", r"shortyardage"),
]


def _old_chunk(book: str, chunk_id: str) -> dict[str, Any] | None:
    for row in qa_check.load_chunks(HERE / book / "chunks.jsonl"):
        if row["id"] == chunk_id:
            return row
    return None


def _window(text: str, pattern: str, before: int = 160, after: int = 220) -> str:
    m = re.search(pattern, text)
    if not m:
        return "(pattern not found)"
    a, b = max(0, m.start() - before), min(len(text), m.end() + after)
    return ("..." if a else "") + text[a:b].replace("\n\n", "  //  ") + ("..." if b < len(text) else "")


def run_regression(out_root: Path | None = None, write_report: bool = True, quiet: bool = False) -> dict[str, Any]:
    out_root = Path(out_root) if out_root else HERE / "regression"
    out_root.mkdir(parents=True, exist_ok=True)
    opts = rl.Options(offline=True, force=True, out_root=out_root, archive_root=out_root / "_archive",
                      state_path=out_root / "library_state.json", legacy_root=HERE, quiet=quiet)
    results: dict[str, Any] = {"books": {}, "audit_cases": []}
    for entry in FIXTURES:
        sid = entry["source_id"]
        rl.process_source(entry, ("extract", "chunk", "qa"), opts)
        before = qa_check.qa_file(HERE / sid / "chunks.jsonl")
        after = qa_check.qa_file(out_root / sid / "chunks.jsonl")
        stats = json.loads((out_root / sid / "chunk_stats.json").read_text(encoding="utf-8"))
        extraction = json.loads((out_root / sid / "extraction.json").read_text(encoding="utf-8"))
        results["books"][sid] = {"before": before, "after": after, "stats": stats, "extraction": extraction}
    for chunk_id, problem, new_pattern, old_pattern in AUDIT_CASES:
        book = chunk_id.rsplit("_", 1)[0]
        old = _old_chunk(book, chunk_id)
        new_chunks = qa_check.load_chunks(out_root / book / "chunks.jsonl")
        holder = next((c for c in new_chunks if re.search(new_pattern, c["text"])), None)
        case = {"old_id": chunk_id, "problem": problem, "found": holder is not None}
        if holder:
            case["new_id"] = holder["id"]
            case["new_words"] = holder["word_count"]
            case["new_window"] = _window(holder["text"], new_pattern)
            case["new_opening"] = holder["text"][:140].replace("\n\n", "  //  ")
            case["opens_on_pattern"] = re.search(new_pattern, holder["text"]).start() == 0
            case["old_defect_still_present"] = bool(old_pattern and re.search(old_pattern, holder["text"]))
        case["old_window"] = _window(old["text"], old_pattern or new_pattern) if old else "(old chunk missing)"
        case["old_opening"] = old["text"][:140].replace("\n\n", "  //  ") if old else ""
        results["audit_cases"].append(case)
    results["pilot_before_all"] = {}
    for d in sorted(HERE.iterdir()):
        if (d / "chunks.jsonl").exists() and d.name not in ("library", "regression"):
            results["pilot_before_all"][d.name] = qa_check.qa_file(d / "chunks.jsonl")
    if write_report:
        (out_root / "REGRESSION.md").write_text(render_report(results), encoding="utf-8")
    return results


def _row(name: str, r: dict[str, Any]) -> str:
    h = r["heuristic_counts"]
    return (f"| {name} | {r['chunks']} | {r['flagged']} ({r['flagged_pct']}%) | {r['median_words']} | "
            f"{'PASS' if r['gate']['passed'] else 'FAIL'} | " +
            " | ".join(str(h[k]) for k in qa_check.HEURISTICS) + " |")


def render_report(results: dict[str, Any]) -> str:
    head = ("| Run | Chunks | Flagged | Median words | Gate | " +
            " | ".join(qa_check.HEURISTICS) + " |\n|---|---:|---:|---:|---|" + "---:|" * len(qa_check.HEURISTICS))
    lines = ["# Regression: pilot chunks vs new library pipeline", "",
             "Offline, no API calls. Source: the pilot PDFs. BEFORE = the pilot `chunks.jsonl` exactly as it was; "
             "AFTER = the new pipeline (generic extraction, rules-first chunking) with boundaries taken from the "
             "pilot's cached decisions. Both measured with `qa_check.py`.", "",
             "Gate: flagged < 3% and median 200-450 words.", "", "## Before and after", "", head]
    for sid, data in results["books"].items():
        lines.append(_row(f"{sid} BEFORE", data["before"]))
        lines.append(_row(f"{sid} AFTER", data["after"]))
    lines += ["", "## How boundaries were obtained (AFTER)", "",
              "| Book | Oversized segments | Pilot seed hits | Exact cache hits | LLM calls | Rule fallbacks (cache miss) | Seeds unmatched | Rule splits | Merged continuation | Merged short |",
              "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|"]
    for sid, data in results["books"].items():
        s, p = data["stats"], data["stats"]["provider"]
        lines.append(f"| {sid} | {s.get('oversized_segments', 0)} | {p['seed_hits']} | {p['cache_hits']} | {p['llm_calls']} | "
                     f"{p['rule_fallback_segments']} | {s.get('legacy_seed_unmatched', 0)} | {s.get('rule_splits', 0)} | "
                     f"{s.get('merged_continuation', 0)} | {s.get('merged_short_forward', 0) + s.get('merged_short_back', 0)} |")
    lines += ["", "Cache misses are handled by the rule split (paragraph boundary nearest the middle where a topic can "
              "start) and counted above. A zero means every oversized segment was covered by a pilot decision.", ""]
    lines += ["## Audit failures: old vs new", ""]
    for case in results["audit_cases"]:
        lines += [f"### {case['old_id']}: {case['problem']}", ""]
        lines.append(f"- OLD: `{case['old_window']}`")
        if case["found"]:
            lines.append(f"- NEW ({case['new_id']}, {case['new_words']} words): `{case['new_window']}`")
            lines.append(f"- NEW chunk opens: `{case['new_opening']}`")
            lines.append(f"- Fixed: {'yes' if not case.get('old_defect_still_present') and not case.get('opens_on_pattern') else 'NO'}")
        else:
            lines.append("- NEW: text not found in new chunks (extraction changed the wording)")
        lines.append("")
    if results.get("pilot_before_all"):
        lines += ["## Context: BEFORE numbers for all ten pilot books", "", head]
        for sid, r in results["pilot_before_all"].items():
            lines.append(_row(f"{sid} BEFORE", r))
        lines.append("")
    lines += ["## Known limits (read before trusting the AFTER column)", "",
              "- AFTER boundaries are the pilot model's own topic decisions, mapped onto the new paragraphs and then repaired by rules "
              "(continuation merges, short merges, 700-word splits). They were not re-judged by a model or a person.",
              "- qa_check is a set of deterministic heuristics. It cannot see an unresolved NAME or a reference like \"similar disputes\" "
              "at a chunk opening, a story that is cut at a sensible-looking paragraph break, or a lost hyphen on a word that is also a "
              "valid solid word. A 0% flagged rate means no heuristic fired, not that every chunk is good.",
              "- Thinking in Bets footnotes: the PDF inlines the footnote sentence right after the `*` marker (for example "
              "\"ASAS, founded in 1992...\"). The marker is stripped. The sentence is still in the body because nothing in the text "
              "layer separates it from prose. Only small-type footnote blocks at the page foot are moved out (extraction.json `footnotes`).",
              "- Line-break hyphens follow the rule literally: a line ending in a hyphen keeps it. A purely typographic break such as "
              "\"mom-\" + \"entum\" would read \"mom-entum\". None was found in these two books.",
              "- The footnote and caption rules were also exercised on a synthetic PDF in test_library.py, not only on these two books.", ""]
    lines += ["## Extraction report (AFTER)", "", "| Book | Paragraphs | Words | Chapters | Detection | Footnote markers stripped | Datelines removed | Figure captions dropped | Epigraphs moved |",
              "|---|---:|---:|---:|---|---:|---:|---:|---:|"]
    for sid, data in results["books"].items():
        e = data["extraction"]
        lines.append(f"| {sid} | {e['paragraphs']} | {e['words']} | {e['chapters_extracted']} | {e.get('chapter_detection')} | "
                     f"{e['footnote_markers_stripped']} | {len(e['datelines_removed'])} | {len(e['figure_captions_dropped'])} | {len(e['epigraphs_moved'])} |")
    lines.append("")
    return "\n".join(lines)


if __name__ == "__main__":
    run_regression()
