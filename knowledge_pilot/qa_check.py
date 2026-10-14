#!/usr/bin/env python3
"""Deterministic chunk QA. No API, no network, no database.

Works on any chunks.jsonl, including the pilot's older format (missing fields are
tolerated: flags, source_id, prev_id, page_start, section, chapter).

Gate: flagged chunks < 3% AND median words in 200-450.

Usage:
  python knowledge_pilot/qa_check.py knowledge_pilot/everything_store/chunks.jsonl [...] [--json]
"""

from __future__ import annotations

import argparse
import json
import re
import statistics
import sys
from collections import Counter
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

from library_text import (  # noqa: E402
    DATELINE_RE, FOOTNOTE_MARK_RE, NOTE_DIGIT_RE, SUPERSCRIPT_DIGITS, dictionary, ends_with_lead_in,
    ends_with_question, ends_with_setup, is_bare_chapter_label, opens_mid_quote, section_restates_chapter,
    is_attribution, is_figure_caption, is_list_item, is_sentence_complete, opens_dependent, word_count,
)

GATE_MAX_FLAGGED_PCT = 3.0
GATE_MEDIAN_RANGE = (200, 450)
ACCEPTED_OVERSIZE_FLAGS = {"oversized_story", "oversized_paragraph"}

# Heuristics that count a chunk as flagged.
HEURISTICS = (
    "continuation_opener", "no_terminal_punctuation", "lead_in_at_end", "under_150_words",
    "over_700_unflagged", "lost_hyphen", "footnote_marker", "figure_caption",
    "epigraph_at_chapter_end", "runin_heading_or_dateline", "question_options_split",
    # Added with the dialogue / setup / label rules.
    "question_answer_split", "opens_mid_quote", "setup_without_payoff", "section_restates_chapter",
    "chapter_title_missing",
)

HYPHEN_FORM_RE = re.compile(r"[A-Za-z][A-Za-z]*(?:-[A-Za-z][A-Za-z]*)+")
TOKEN_RE = re.compile(r"\b[a-z]{7,}\b")
PREFIXES = (
    "self", "well", "long", "short", "high", "low", "half", "full", "first", "second", "third", "fourth",
    "fifth", "sixth", "seventh", "eighth", "ninth", "tenth", "twenty", "thirty", "forty", "fifty", "sixty",
    "seventy", "eighty", "ninety", "hundred", "year", "ever", "ill", "old", "three", "four", "five",
)
# Solid compounds that are correctly written without a hyphen but are missing from a 1934 word list.
SOLID_ALLOWLIST = {
    "healthcare", "workplace", "smartphone", "smartphones", "worldview", "website", "websites", "software",
    "hardware", "database", "databases", "startup", "startups", "offline", "online", "playbook", "workflow",
    "workforce", "bandwidth", "download", "downloads", "headquarters", "stakeholder", "stakeholders",
    "bookkeeping", "paperwork", "teammates", "anything", "everything", "everyone", "somewhere", "whatever",
    "breakthrough", "breakthroughs", "framework", "frameworks", "feedback", "overview", "lifestyle",
    "viewpoint", "viewpoints", "timeframe", "marketplace", "marketplaces", "newsletter", "spreadsheet",
    "spreadsheets", "storefront", "headcount", "benchmark", "benchmarks", "downside", "upside", "tradeoff",
    "tradeoffs", "takeaway", "takeaways", "withdrawals", "paycheck", "paychecks", "blockbuster", "lifespan",
    "checklist", "checklists", "roadmap", "playground", "backstory", "bloodline", "shortfall", "networking",
    "crowdfunding", "namesake", "wholesale", "wholesaler", "outsourcing", "outsourced", "infrastructure",
    "salesperson", "salespeople", "uptick", "bottleneck", "bottlenecks", "makeshift", "blueprint",
    "blindsided", "breathtaking", "coworkers", "doubleheader", "freshwater", "fundraising", "groundbreaking",
    "masterstroke", "piggybacked", "piggybacking", "skunkworks", "sledgehammer", "spaceflight", "speakerphone",
    "steakhouse", "goodbye", "brainpower", "multitask", "multimedia", "multilane", "reconfigured", "speechwriter",
    "storyboard", "blacklisted", "unpredictability", "straitlaced", "billionaire", "dotcoms", "ereaders",
    "straitjacket", "rollercoaster", "wheelchair", "worthwhile", "longstanding", "businesspeople", "standalone", "watercooler", "grandchildren",
    "disintermediating", "coronavirus", "gerontologist", "wellbeing", "bestselling", "steadystate", "longtime", "ecommerce", "girlfriend", "boyfriend", "overarching",
}


# Parts that form ordinary solid words, so a split on them is not evidence of a lost hyphen.
OPEN_PREFIXES = {"hyper", "under", "super", "inter", "intra", "extra", "ultra", "micro", "macro", "mega", "semi",
                 "anti", "counter", "cross", "after", "fore", "multi", "trans", "every", "other", "water",
                 "world", "wheel", "worth"}
OPEN_SUFFIX_WORDS = {"while", "chair", "place", "where", "thing", "times", "ships", "ward", "wards", "wise",
                     "like", "ness", "ship", "hood", "able", "ible", "ment", "ments", "ways", "side", "sides"}


def load_chunks(path: Path) -> list[dict[str, Any]]:
    rows = []
    with Path(path).open(encoding="utf-8") as handle:
        for line in handle:
            if line.strip():
                rows.append(json.loads(line))
    return rows


def _wc(chunk: dict) -> int:
    return word_count(chunk.get("text", ""))


def _paragraphs(chunk: dict) -> list[str]:
    return [p for p in chunk.get("text", "").split("\n\n") if p.strip()]


def lost_hyphen_tokens(chunks: list[dict]) -> dict[str, list[str]]:
    """Map chunk id -> suspected glued compounds. Conservative by construction.

    A token is suspected when it is not a dictionary word and
      (a) the same source writes it with hyphens elsewhere ("self-control" exists), or
      (b) it is a known compound prefix plus a dictionary word ("sixthgrader"), or
      (c) it is rare (<=2 occurrences) and splits into two dictionary words of 4+ letters
          ("businessdevelopment"), unless it is a known solid compound.
    Without a system dictionary only (a) is used.
    """
    words = dictionary()
    hyphenated = Counter()
    freq: Counter = Counter()
    for c in chunks:
        text = c.get("text", "")
        for m in HYPHEN_FORM_RE.finditer(text):
            hyphenated[m.group(0).lower().replace("-", "")] += 1
        for m in TOKEN_RE.finditer(text):
            freq[m.group(0)] += 1
    suspects: dict[str, list[str]] = {}

    def known(token: str) -> bool:
        """Dictionary word, allowing common inflections (the system list has none)."""
        if token in words:
            return True
        for suf, repl in (("ies", "y"), ("ied", "y"), ("ing", ""), ("ing", "e"), ("ed", ""), ("ed", "e"),
                          ("es", ""), ("s", ""), ("ly", ""), ("er", ""), ("ers", ""), ("est", ""), ("ness", ""),
                          ("ment", ""), ("ments", ""), ("ally", "al"), ("ier", "y"), ("iest", "y")):
            if token.endswith(suf) and len(token) - len(suf) >= 3:
                stem = token[: -len(suf)] + repl
                if stem in words or (len(stem) > 3 and stem[-1] == stem[-2] and stem[:-1] in words):
                    return True
        return False

    def split_pair(token: str) -> bool:
        for i in range(6, len(token) - 5):
            a, b = token[:i], token[i:]
            if a in words and b in words and a not in OPEN_PREFIXES and b not in OPEN_SUFFIX_WORDS:
                return True
        return False

    def prefix_compound(token: str) -> bool:
        for p in PREFIXES:
            if token.startswith(p) and len(token) - len(p) >= 4 and token[len(p):] in words:
                return True
        return False

    verdict: dict[str, bool] = {}
    for token in freq:
        if token in SOLID_ALLOWLIST:
            verdict[token] = False
        elif token in hyphenated and (not words or not known(token)):
            verdict[token] = True
        elif not words or known(token):
            verdict[token] = False
        elif prefix_compound(token):
            verdict[token] = True
        else:
            verdict[token] = freq[token] <= 2 and split_pair(token)
    for c in chunks:
        found = sorted({m.group(0) for m in TOKEN_RE.finditer(c.get("text", "")) if verdict.get(m.group(0))})
        if found:
            suspects[c.get("id", "?")] = found
    return suspects


def _footnote_marker(text: str) -> bool:
    return bool(FOOTNOTE_MARK_RE.search(text) or NOTE_DIGIT_RE.search(text)
                or text.translate(SUPERSCRIPT_DIGITS) != text)


RUNIN_RE = re.compile(r"^(?:[A-Z][A-Z’'&-]+[,:]?\s+){3,}(?=[A-Z][a-z])")


def qa_chunks(chunks: list[dict[str, Any]]) -> dict[str, Any]:
    n = len(chunks)
    counts: Counter = Counter()
    examples: dict[str, list[str]] = {h: [] for h in HEURISTICS}
    flagged_ids: set[str] = set()
    suspects = lost_hyphen_tokens(chunks)
    info: Counter = Counter()

    def hit(heuristic: str, chunk_id: str) -> None:
        counts[heuristic] += 1
        flagged_ids.add(chunk_id)
        if len(examples[heuristic]) < 5:
            examples[heuristic].append(chunk_id)

    for i, c in enumerate(chunks):
        cid = c.get("id", f"#{i}")
        text = c.get("text", "")
        paras = _paragraphs(c)
        wc = _wc(c)
        prev = chunks[i - 1] if i else None
        nxt = chunks[i + 1] if i + 1 < n else None
        flags = set(c.get("flags") or [])
        chapter_start = prev is None or prev.get("chapter") != c.get("chapter")
        section_start = prev is not None and c.get("section") != prev.get("section") and c.get("section") is not None
        if opens_dependent(text) and not chapter_start and not section_start:
            hit("continuation_opener", cid)
        if text.strip() and not is_sentence_complete(text):
            hit("no_terminal_punctuation", cid)
        if ends_with_lead_in(text):
            hit("lead_in_at_end", cid)
        if wc < 150:
            hit("under_150_words", cid)
        if wc > 700:
            if flags & ACCEPTED_OVERSIZE_FLAGS and wc <= 900 or (flags & {"oversized_paragraph"}):
                info["over_700_flagged_ok"] += 1
            else:
                hit("over_700_unflagged", cid)
        if cid in suspects:
            hit("lost_hyphen", cid)
        if _footnote_marker(text):
            hit("footnote_marker", cid)
        if any(is_figure_caption(p) for p in paras):
            hit("figure_caption", cid)
        last_in_chapter = nxt is None or nxt.get("chapter") != c.get("chapter")
        before_new_section = nxt is not None and nxt.get("section") != c.get("section") and nxt.get("section") is not None
        if paras and is_attribution(paras[-1]) and (last_in_chapter or before_new_section or wc <= 90):
            hit("epigraph_at_chapter_end", cid)
        if RUNIN_RE.match(text) or (paras and DATELINE_RE.match(paras[0].strip()) and len(paras[0].split()) <= 8):
            hit("runin_heading_or_dateline", cid)
        same_chapter_next = nxt is not None and nxt.get("chapter") == c.get("chapter")
        if same_chapter_next and ends_with_question(text):
            next_paras = _paragraphs(nxt)
            reply = bool(next_paras) and next_paras[0].lstrip()[:1] in ("“", '"')
            if word_count(paras[-1]) <= 45 or reply:   # a bare question, or a spoken reply follows
                hit("question_answer_split", cid)
        if prev is not None and not chapter_start and paras and opens_mid_quote(_paragraphs(prev)[-1] if _paragraphs(prev) else "", paras[0]):
            hit("opens_mid_quote", cid)
        if same_chapter_next and ends_with_setup(text):
            hit("setup_without_payoff", cid)
        if c.get("section") and section_restates_chapter(c.get("section"), c.get("chapter")):
            hit("section_restates_chapter", cid)
        if is_bare_chapter_label(c.get("chapter")) and "chapter_untitled" not in flags:
            hit("chapter_title_missing", cid)
        if nxt is not None and text.rstrip().endswith("?") and is_list_item(_paragraphs(nxt)[0] if _paragraphs(nxt) else ""):
            hit("question_options_split", cid)
    sizes = [_wc(c) for c in chunks]
    median = round(statistics.median(sizes)) if sizes else 0
    flagged_pct = round(100.0 * len(flagged_ids) / n, 2) if n else 0.0
    result = {
        "chunks": n,
        "flagged": len(flagged_ids),
        "flagged_pct": flagged_pct,
        "heuristic_counts": {h: counts.get(h, 0) for h in HEURISTICS},
        "heuristic_examples": examples,
        "median_words": median,
        "words_p25_p75": [round(q) for q in (statistics.quantiles(sizes, n=4)[0], statistics.quantiles(sizes, n=4)[2])] if len(sizes) >= 2 else [],
        "info": dict(info),
        "lost_hyphen_samples": dict(list(suspects.items())[:5]),
    }
    result["gate"] = gate(result)
    return result


def gate(result: dict[str, Any]) -> dict[str, Any]:
    ok_flag = result["flagged_pct"] < GATE_MAX_FLAGGED_PCT
    ok_median = GATE_MEDIAN_RANGE[0] <= result["median_words"] <= GATE_MEDIAN_RANGE[1]
    return {"passed": bool(ok_flag and ok_median and result["chunks"] > 0), "flagged_ok": ok_flag, "median_ok": ok_median,
            "rule": f"flagged < {GATE_MAX_FLAGGED_PCT}% and median {GATE_MEDIAN_RANGE[0]}-{GATE_MEDIAN_RANGE[1]} words"}


def qa_file(path: Path) -> dict[str, Any]:
    return qa_chunks(load_chunks(Path(path)))


def format_row(name: str, r: dict[str, Any]) -> str:
    h = r["heuristic_counts"]
    return (f"{name}: {r['chunks']} chunks, flagged {r['flagged']} ({r['flagged_pct']}%), median {r['median_words']} words, "
            f"gate {'PASS' if r['gate']['passed'] else 'FAIL'} | " + ", ".join(f"{k}={v}" for k, v in h.items() if v))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("paths", nargs="+")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)
    results = {p: qa_file(Path(p)) for p in args.paths}
    if args.json:
        print(json.dumps(results, indent=2))
    else:
        for p, r in results.items():
            print(format_row(p, r))
    return 0 if all(r["gate"]["passed"] for r in results.values()) else 1


if __name__ == "__main__":
    sys.exit(main())
