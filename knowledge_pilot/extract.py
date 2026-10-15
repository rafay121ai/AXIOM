"""Phase 1 of the library rebuild: extraction. Source file -> paragraphs (the atoms), headings, notes, metrics.

No API calls, no database. One paragraph rule for every book (see library_paragraphs.py):
two lines are in the same paragraph unless ALL hold: the previous line ends with terminal punctuation
(. ? ! or a closing quote), the next line starts with a capital, opening quote or digit, AND PyMuPDF shows a
layout signal (first-line indent, vertical gap larger than normal, or a new text block).

Outputs per source, under <out-root>/<source_id>/:
  paragraphs_<version>.jsonl   body paragraphs only, ids <source_id>_p0000 ...
  headings.jsonl               chapter and section headings, never in body text
  extraction_notes.json        what was left out and why (front/back matter, forewords by others,
                               unpunctuated blocks, stripped furniture), plus status
  extraction_metrics.json      numbers used by EXTRACTION_REPORT.md

Line-end hyphen rule (same for every book): keep the hyphen and join with no space ("self-control"),
EXCEPT drop the hyphen when the joined word is an ordinary solid word. "Ordinary" means the joined word
appears solid (no hyphen) at least 3 times elsewhere in the same book, or it is in data/solid_words.txt, a
list of words that at least 3 different books of this library print solid (built offline by
build_wordlist.py). A compound such as "sixth-grader" is never in either set, so it keeps its hyphen.

Page numbers in output are PDF page indexes (1 based), which is what render_pages.py draws.
"""

from __future__ import annotations

import argparse
import json
import re
import statistics
import sys
import time
import traceback
from collections import Counter
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import library_paragraphs as lp  # noqa: E402
import library_text as lt  # noqa: E402

EXTRACT_VERSION = "v3.1"
DEFAULT_VERSION = "v3.1"
DEFAULT_OUT_ROOT = HERE / "library"
WORDLIST_PATH = HERE / "data" / "solid_words.txt"

# ---------------------------------------------------------------------------
# Word sets and the hyphen rule
# ---------------------------------------------------------------------------

_SOLID_RE = re.compile(r"(?<![\w\-‐‑'’])[a-z]{4,}(?![\w\-‐‑'’])")
_LEFT_RE = re.compile(r"(?<![\w\-‐‑])([A-Za-z]+)-$")
_RIGHT_RE = re.compile(r"^([a-z]+)")
_global_words: frozenset[str] | None = None


def global_solid_words() -> frozenset[str]:
    global _global_words
    if _global_words is None:
        _global_words = frozenset(w.strip() for w in WORDLIST_PATH.read_text(encoding="utf-8").splitlines()
                                  if w.strip()) if WORDLIST_PATH.exists() else frozenset()
    return _global_words


_known_words: frozenset[str] | None = None


def known_words() -> frozenset[str]:
    global _known_words
    if _known_words is None:
        f = HERE / "data" / "known_words.txt"
        _known_words = frozenset(w.strip() for w in f.read_text(encoding="utf-8").splitlines() if w.strip()) \
            if f.exists() else frozenset()
    return _known_words


def book_solid_counts(texts: list[str]) -> Counter:
    c: Counter = Counter()
    for t in texts:
        c.update(_SOLID_RE.findall(t))
    return c


class HyphenRule:
    """hook(text_so_far, next_line) -> True to drop the line-end hyphen."""

    MIN_BOOK_COUNT = 3

    def __init__(self, book_counts: Counter, global_words: frozenset[str] | None = None):
        self.book = book_counts
        self.glob = global_solid_words() if global_words is None else global_words
        self.dropped: Counter = Counter()
        self.kept: Counter = Counter()

    def is_solid(self, joined: str) -> bool:
        j = joined.lower()
        return self.book.get(j, 0) >= self.MIN_BOOK_COUNT or j in self.glob

    def __call__(self, out: str, line: str) -> bool:
        left = _LEFT_RE.search(out)
        right = _RIGHT_RE.match(line.lstrip())
        if not left or not right:
            return False
        joined = left.group(1) + right.group(1)
        # "Wells-" + "Fargo" (capital after the hyphen) is a compound of names.
        if self.is_solid(joined) and len(left.group(1)) >= 2:
            self.dropped[joined.lower()] += 1
            return True
        self.kept[f"{left.group(1)}-{right.group(1)}".lower()] += 1
        return False


# ---------------------------------------------------------------------------
# Front / back matter classification (by chapter title)
# ---------------------------------------------------------------------------

BACK_TITLE_RE = re.compile(
    r"^\s*(?:notes?(?: on (?:sources|the text))?|endnotes?|index|bibliography|selected bibliography|references|"
    r"sources|further reading|recommended reading|suggested reading|acknowledg\w*|about the authors?|"
    r"also by\b.*|other books by\b.*|credits|permissions|image credits|photo credits|illustration credits|"
    r"reading group guide|discussion questions|a note on sources|praise for\b.*|copyright|"
    r"about the publisher|sign up\b.*|excerpt\b.*|dedication)\s*$", re.I)
FRONT_TITLE_RE = re.compile(
    r"^\s*(?:copyright|title page|half title|dedication|epigraph|contents|table of contents|praise for\b.*|"
    r"also by\b.*|list of (?:figures|illustrations|tables)|publisher'?s? note|a note to the reader)\s*$", re.I)
FOREWORD_RE = re.compile(r"^\s*(?:foreword|forward)\b", re.I)
AUTHOR_INTRO_RE = re.compile(
    r"^\s*(?:introduction|preface|prologue|afterword|epilogue|author'?s? note|a note from the author)\b", re.I)
_NAME_LINE_RE = re.compile(r"^[—–\-~\s]*((?:[A-Z][\w.'’-]*\.?\s+){0,3}[A-Z][\w'’-]+)\s*[,.]?$")
_FOREWORD_BY_RE = re.compile(r"\b(?:foreword|introduction|preface|afterword|prologue)\s+by\s+([A-Z][\w.'’-]+(?:\s+[A-Z][\w.'’-]+){0,3})")
_NAME_STOP = {"The", "A", "An", "And", "Chapter", "Part", "Introduction", "Preface", "Foreword", "Epilogue",
              "Conclusion", "Notes", "Index", "New", "San", "Los", "York", "Boston", "London", "California"}


_TITLE_BY_RE = re.compile(r",?\s+by\s+([A-Z][\w.'’-]+(?:\s+[A-Z][\w.'’-]+){0,3})\s*$")
_FRONT_FOREWORD_RE = re.compile(
    r"(?i:foreword)\s*(?:by\s+|[•:|\-\u2013\u2014]\s*)\s*([A-Z][A-Za-z.'’-]+(?:\s+[A-Z][A-Za-z.'’-]+){1,3})")


def front_foreword_author(path: Path, pages: list[int], max_pages: int = 40) -> str | None:
    """Name after 'Foreword by' / 'FOREWORD • NAME' in the front-matter pages (contents page or title of the
    foreword). None when the text does not say."""
    try:
        import fitz
        doc = fitz.open(path)
        text = " ".join(doc[n - 1].get_text("text").replace("\n", " ")
                        for n in range(pages[0], min(pages[1], len(doc), pages[0] + max_pages - 1) + 1))
    except Exception:
        return None
    m = _FRONT_FOREWORD_RE.search(text)
    if not m:
        return None
    words = m.group(1).split()
    while words and words[-1].lower().strip(".") in {"preface", "contents", "introduction", "foreword", "prologue",
                                                      "preface,", "acknowledgments", "chapter", "part", "by"}:
        words.pop()
    name = " ".join(words)
    if len(words) < 2:
        return None
    return name.title() if name.isupper() else name


def signature_name(texts: list[str]) -> str | None:
    """A sign-off line at the end of a chapter: a short capitalised name without terminal punctuation,
    or a dateline-style 'Name, City, Month Year' tail. None when there is none."""
    for t in reversed(texts[-3:]):
        t = t.strip()
        if lt.word_count(t) > 8:
            continue
        m = _NAME_LINE_RE.match(t)
        if m:
            name = m.group(1).strip()
            toks = name.split()
            if 2 <= len(toks) <= 4 and toks[0] not in _NAME_STOP and not any(w in _NAME_STOP for w in toks[:1]):
                return name
    return None


def author_matches(name: str | None, main_author: str | None) -> bool | None:
    if not name or not main_author:
        return None
    last = name.split()[-1].lower().strip(".")
    return last in main_author.lower()


def classify_chapters(recs: list[dict], main_author: str | None, front_text: str) -> tuple[list[dict], list[dict]]:
    """Return (kept_recs, excluded_entries). Works on whole chapters, never on single paragraphs."""
    by_chapter: dict[str, list[dict]] = {}
    for r in recs:
        by_chapter.setdefault(r["chapter"], []).append(r)
    drop: dict[str, dict] = {}
    for ch, rs in by_chapter.items():
        pages = [p for r in rs for p in (r["page_start"], r["page_end"]) if p]
        entry = {"chapter": ch, "pages": [min(pages), max(pages)] if pages else None,
                 "words": sum(lt.word_count(r["text"]) for r in rs)}
        if BACK_TITLE_RE.match(ch):
            entry.update(kind="back_matter", reason=f"chapter titled '{ch}' is back matter")
        elif FRONT_TITLE_RE.match(ch):
            entry.update(kind="front_matter", reason=f"chapter titled '{ch}' is front matter")
        elif FOREWORD_RE.match(ch):
            name = signature_name([r["text"] for r in rs])
            m = _FOREWORD_BY_RE.search(ch) or _TITLE_BY_RE.search(ch) or _FOREWORD_BY_RE.search(front_text)
            name = name or (m.group(1) if m else None)
            entry.update(kind="foreword_other_author", author=name,
                         reason="foreword, written by " + (name if name else "someone other than the main author "
                                                           "(name not found in the text)"))
        elif AUTHOR_INTRO_RE.match(ch):
            name = signature_name([r["text"] for r in rs])
            m = _FOREWORD_BY_RE.search(ch) or _TITLE_BY_RE.search(ch)
            titled = bool(m)
            name = (m.group(1) if m else None) or name
            same = author_matches(name, main_author)
            if same is False or (titled and same is None):
                entry.update(kind="introduction_other_author", author=name,
                             reason=f"'{ch}' signed by {name}, not the main author ({main_author})")
            else:
                continue
        else:
            continue
        entry["starts"] = rs[0]["text"][:160]
        drop[ch] = entry
    kept = [r for r in recs if r["chapter"] not in drop]
    return kept, list(drop.values())


# ---------------------------------------------------------------------------
# Metrics
# ---------------------------------------------------------------------------

LIST_PREFIX_RE = re.compile(r"^(?:[•●▪◦■□‣⁃*–—-]\s+|\(?\d{1,2}[.)]\s+|\(?[a-hA-H][.)]\s+)")
TERMINAL_END_RE = re.compile(r"[.!?…][\"”’')\]*]*$|[\"”’]$")
_GLUE_RE = re.compile(r"(?<![\w\-‐‑'’])[a-z]{9,}(?![\w\-‐‑'’])")


_dict_cache: frozenset[str] | None = None


def _dict() -> frozenset[str]:
    global _dict_cache
    if _dict_cache is None:
        _dict_cache = lt.dictionary()
    return _dict_cache


def suspected_glued(texts: list[str], counts: Counter, glob: frozenset[str]) -> list[str]:
    known = lambda w: w in glob or w in known_words() or w in _dict() or counts.get(w, 0) >= 2  # noqa: E731
    found: Counter = Counter()
    for t in texts:
        for tok in _GLUE_RE.findall(t):
            if known(tok):
                continue
            for i in range(3, len(tok) - 2):
                a, b = tok[:i], tok[i:]
                if len(b) >= 3 and (a in glob or a in known_words()) and (b in glob or b in known_words()):
                    found[tok] += 1
                    break
    return [w for w, _ in found.most_common()]


def compute_metrics(paras: list[dict], counts: Counter, hyph: HyphenRule | None) -> dict:
    texts = [p["text"] for p in paras]
    n = len(texts)
    wc = [p["word_count"] for p in paras]
    glued = suspected_glued(texts, counts, global_solid_words())
    first_alpha = [next((c for c in LIST_PREFIX_RE.sub("", t, count=1) if c.isalpha()), "") for t in texts]
    pages = {p["page_start"] for p in paras if p.get("page_start")}
    return {
        "paragraph_count": n,
        "words": sum(wc),
        "median_words": statistics.median(wc) if wc else 0,
        "pct_not_terminal": round(100 * sum(1 for t in texts if not TERMINAL_END_RE.search(t.rstrip())) / n, 1) if n else 0.0,
        "pct_lowercase_start": round(100 * sum(1 for c in first_alpha if c.islower()) / n, 1) if n else 0.0,
        "pct_colon_or_list_item": round(100 * sum(1 for t in texts if not TERMINAL_END_RE.search(t.rstrip())
                                                  and (lp.ends_colon(t) or lp.is_list_start(t))) / n, 1) if n else 0.0,
        "suspected_glued_count": len(glued),
        "suspected_glued_examples": glued[:3],
        "body_pages": len(pages),
        "hyphens_dropped": sum(hyph.dropped.values()) if hyph else 0,
        "hyphens_kept": sum(hyph.kept.values()) if hyph else 0,
    }


# ---------------------------------------------------------------------------
# Build one source
# ---------------------------------------------------------------------------

def _paragraph_pass(items: list, source_id: str) -> tuple[list[dict], dict]:
    report: dict[str, Any] = {"footnote_markers_stripped": 0}
    raws = lp.assemble(items)
    if items and any(i.page == 0 for i in items if i.kind == "line"):
        raws = lp._merge_text_continuations(raws)
    recs = lp.make_records(raws, source_id, report)
    return recs, report


def demote_fragment_headings(items: list) -> int:
    """A 'heading' whose next body line starts lowercase is a sentence fragment (a line the heading detector
    mistook, usually the last line of a page), not a heading. It goes back into the body flow."""
    n = 0
    for i, it in enumerate(items[:-1]):
        nxt = items[i + 1]
        if it.kind == "heading" and nxt.kind == "line" and nxt.text.strip()[:1].islower() \
                and not lp.ends_terminal(it.text):
            it.kind, it.signal = "line", False
            n += 1
    return n


def defer_interrupting_markers(items: list, lookahead: int = 80) -> int:
    """The outline places a chapter/heading marker at the START of the page its title is on, but the printed
    title can sit further down the page. A marker that lands between an unfinished sentence and its lowercase
    continuation is moved to the next real paragraph boundary (sentence end plus layout signal), so no
    sentence is cut in two. Returns the number of markers moved."""
    geo = lp.compute_geometry(items)
    moved = 0
    i = 1
    while i < len(items) - 1:
        it = items[i]
        prev, nxt = items[i - 1], items[i + 1]
        if it.kind in ("chapter", "heading") and prev.kind == "line" and nxt.kind == "line" \
                and not lp.ends_terminal(prev.text) and not lp.ends_colon(prev.text) \
                and nxt.text.strip()[:1].islower():
            j = i + 1
            target = None
            while j < min(len(items) - 1, i + lookahead):
                a, b = items[j], items[j + 1]
                if a.kind != "line" or b.kind != "line":
                    break
                if lp.ends_terminal(a.text) and lp.should_split(a, b, geo, None):
                    target = j + 1
                    break
                j += 1
            if target:
                items.insert(target, items.pop(i))
                moved += 1
                continue
        i += 1
    return moved


def prepare_text(raw: str) -> str:
    """Plain text structure is blank lines. Some dumps have none and put one paragraph per long line; those
    newlines are the structure. Dumps with short one-sentence lines and no blank lines carry no paragraph
    signal at all and are unsupported (never guessed)."""
    raw = raw.replace("\r\n", "\n")
    blocks = [b for b in re.split(r"\n\s*\n", raw) if b.strip()]
    lines = [l.strip() for l in raw.split("\n") if l.strip()]
    if len(blocks) <= 2 and len(lines) > 10:
        med = statistics.median(lt.word_count(l) for l in lines)
        if med < 60:
            raise lp.UnsupportedSource(
                f"no blank lines and short lines (median {med:g} words): no paragraph signal in the text")
        return "\n\n".join(lines)
    return raw


def build_source(entry: dict, version: str = DEFAULT_VERSION) -> dict:
    """Pure function of the source file. Returns dict(status, paragraphs, headings, notes, metrics)."""
    sid = entry["source_id"]
    path = lp.source_path(entry)
    notes: dict[str, Any] = {"source_id": sid, "title": entry.get("title"), "format": entry.get("format"),
                             "extract_version": EXTRACT_VERSION, "paragraph_rule": lp.PARAGRAPH_VERSION,
                             "version": version, "excluded": [], "unpunctuated_blocks": [], "warnings": []}
    result: dict[str, Any] = {"status": "ok", "paragraphs": [], "headings": [], "notes": notes, "metrics": {}}
    if entry.get("status_hint") == "duplicate":
        notes["status"] = result["status"] = "skipped_duplicate"
        notes["reason"] = f"duplicate of {entry.get('duplicate_of')}"
        return result
    fmt = (entry.get("format") or path.suffix.lstrip(".")).lower()
    report: dict[str, Any] = {"source_id": sid, "footnote_markers_stripped": 0}
    lt.HYPHEN_DROP_HOOK = None
    try:
        if fmt == "pdf":
            items = lp.pdf_items(path, report, entry.get("title"))
        elif fmt in ("txt", "text", "md"):
            raw = prepare_text(path.read_text(encoding="utf-8", errors="replace"))
            items = lp.text_items(raw, report)
            items.insert(0, lp.Item("chapter", entry.get("title") or path.stem))
        else:
            raise lp.UnsupportedSource(f"Unsupported format: {fmt}")
    except lp.UnsupportedSource as exc:
        fmt_problem = "text layer" in str(exc) or "format" in str(exc)
        notes["status"] = result["status"] = "unsupported_format" if fmt_problem else "unsupported_text"
        notes["reason"] = str(exc)
        return result

    plans, body_size = report.pop("_plans", None), report.pop("_body", None)
    demoted = demote_fragment_headings(items) if fmt == "pdf" else 0
    moved = defer_interrupting_markers(items) if fmt == "pdf" else 0
    if moved:
        notes["markers_moved_to_paragraph_boundary"] = moved
    if demoted:
        notes["fragment_headings_returned_to_body"] = demoted
    # Pass 1 (hyphens kept) only to learn which words this book prints solid.
    scratch_recs, _ = _paragraph_pass(items, sid)
    counts = book_solid_counts([r["text"] for r in scratch_recs])
    hyph = HyphenRule(counts)
    lt.HYPHEN_DROP_HOOK = hyph
    try:
        recs, prep = _paragraph_pass(items, sid)
    finally:
        lt.HYPHEN_DROP_HOOK = None
    report["footnote_markers_stripped"] = prep.get("footnote_markers_stripped", 0)
    report["dropped"] = report.get("dropped", []) + prep.get("dropped", [])
    report.setdefault("headings", []).extend(prep.get("headings", []))
    if plans and fmt == "pdf":
        recs = lp._attach_chapter_titles(path, plans, body_size, recs, report)
    known = frozenset(lt.dictionary()) | global_solid_words() | known_words() | frozenset(w for w, c in counts.items() if c >= 2)
    texts, fixes = lt.repair_glued_words([r["text"] for r in recs], known)
    if fixes:
        for r, t in zip(recs, texts):
            r["text"] = t
        notes["glued_words_repaired"] = fixes

    # Exclusions. Only plain body paragraphs reach the output.
    main_author = lp.clean_author(report.get("meta_author")) if fmt == "pdf" else None
    notes["main_author"] = main_author
    front_text = " ".join(f.get("starts", "") for f in report.get("front_matter", []))
    recs, excluded = classify_chapters(recs, main_author, front_text)
    notes["excluded"].extend(excluded)
    epi = [r for r in recs if r["kind"] == "epigraph"]
    if epi:
        notes["epigraphs_excluded"] = len(epi)
    recs = [r for r in recs if r["kind"] in ("body", "list_item")]
    unp = [r for r in recs if lt.word_count(r["text"]) >= 80 and lp.terminal_density(r["text"]) < 0.5]
    for r in unp:
        notes["unpunctuated_blocks"].append({"page": r["page_start"], "words": lt.word_count(r["text"]),
                                             "starts": r["text"][:120],
                                             "why": "long block with no sentence boundaries; not guessed at"})
    recs = [r for r in recs if r not in unp]
    for r in recs:
        r["kind"] = "body"
    for f in report.get("front_matter", []):
        label = "front matter before the first chapter"
        low = f.get("starts", "").lower()
        m = _FOREWORD_BY_RE.search(f.get("starts", ""))
        entry_ = {"kind": "front_matter", "pages": f["pages"], "words": f["words"], "reason": label,
                  "starts": f.get("starts", "")[:160]}
        if "foreword" in low:
            entry_["kind"] = "foreword_other_author"
            who = m.group(1) if m else front_foreword_author(path, f["pages"])
            entry_["author"] = who
            entry_["reason"] = "foreword before the first chapter" + (f", by {who}" if who else ", author not stated in the text")
        notes["excluded"].append(entry_)
    for b in report.get("back_matter", []):
        notes["excluded"].append({"kind": "back_matter", "pages": b["pages"], "words": b["words"],
                                  "reason": b["why"], "starts": b.get("starts", "")[:160]})
    for t in report.get("tables", []):
        notes["excluded"].append({"kind": "table", "pages": [t["page"], t["page"]], "words": t["words"],
                                  "reason": "cells aligned in columns: not running prose, left out"})
    for d in report.get("duplicate_blocks", []):
        notes["excluded"].append({"kind": "duplicate", "pages": None, "words": d["words"],
                                  "reason": f"second copy of text already in the file (6-gram overlap {d['overlap']})",
                                  "starts": d["starts"], "kept_leading_turns": d["kept_leading_turns"],
                                  "unmatched_leading_turns": d["unmatched_leading_turns"]})
    if fmt != "pdf":
        notes["sponsor_reads_removed_words"] = report.get("sponsor_reads_removed", 0)
        notes["punct_artifacts_collapsed"] = report.get("punct_artifacts_collapsed", 0)
    notes["epigraph_blocks_flagged"] = report.get("epigraph_blocks", 0)
    notes["ocr_noise_removed"] = prep.get("ocr_noise_removed", 0)
    notes["figure_labels_stripped"] = prep.get("figure_labels_stripped", 0)
    notes["stripped_furniture"] = report.get("removed", {})
    notes["footnote_markers_stripped"] = report["footnote_markers_stripped"]
    notes["footnote_text_blocks_removed"] = len(report.get("footnotes", []))
    drops = Counter(d["reason"] for d in report.get("dropped", []))
    notes["captions_and_debris_dropped"] = dict(drops)
    notes["warnings"].extend(report.get("warnings", []))
    if report.get("unsupported_blocks"):
        notes["unpunctuated_blocks"].extend(report["unsupported_blocks"])
    notes["hyphen_rule"] = {"dropped": sum(hyph.dropped.values()), "kept": sum(hyph.kept.values()),
                            "dropped_examples": [w for w, _ in hyph.dropped.most_common(8)],
                            "kept_examples": [w for w, _ in hyph.kept.most_common(8)]}
    notes["pages_total"] = report.get("pages")
    notes["chapter_detection"] = report.get("chapter_detection")

    if not recs:
        notes["status"] = result["status"] = "unsupported_text"
        notes["reason"] = "no body paragraphs survived extraction"
        return result

    paras = lp.finalize(recs, sid)
    paras = [{**{k: p[k] for k in ("id", "source_id", "index", "text", "chapter", "section", "heading_path",
                                  "page", "page_start", "page_end", "word_count")}, "kind": "body"} for p in paras]
    heads = build_headings(paras, report.get("headings", []), sid)
    notes["status"] = "ok"
    result.update(paragraphs=paras, headings=heads, metrics=compute_metrics(paras, counts, hyph))
    result["metrics"].update(source_id=sid, title=entry.get("title"), status="ok",
                             excluded_summary=summarize_excluded(notes["excluded"]),
                             tables_dropped=len(report.get("tables", [])),
                             ocr_noise_removed=notes["ocr_noise_removed"],
                             unpunctuated_blocks=len(notes["unpunctuated_blocks"]))
    return result


def summarize_excluded(excluded: list[dict]) -> str:
    parts = []
    tables = [e for e in excluded if e["kind"] == "table"]
    if tables:
        parts.append(f"table x{len(tables)} ({sum(e['words'] for e in tables)} words)")
    for e in excluded:
        if e["kind"] == "table":
            continue
        pg = e.get("pages")
        rng = f" p{pg[0]}-{pg[1]}" if pg else ""
        who = f" ({e['author']})" if e.get("author") else ""
        parts.append(f"{e['kind']}{who}{rng}")
    return "; ".join(parts)


def build_headings(paras: list[dict], found: list[dict], sid: str) -> list[dict]:
    """Headings come from chapter/section changes in reading order, kept out of the body text."""
    pages_for: dict[str, list[int]] = {}
    for h in found:
        if h.get("page"):
            pages_for.setdefault(lt.clean_inline(h["text"]), []).append(h["page"])
    out: list[dict] = []
    last_ch, last_sec = None, None

    def page_of(text: str, fallback: int | None) -> int | None:
        cands = [p for p in pages_for.get(text, []) if fallback is None or p <= fallback]
        return max(cands) if cands else fallback

    for p in paras:
        if p["chapter"] != last_ch:
            out.append({"id": f"{sid}_h{len(out):04d}", "level": "chapter", "text": p["chapter"],
                        "page": page_of(p["chapter"], p["page_start"]), "before_paragraph": p["id"]})
            last_ch, last_sec = p["chapter"], None
        if p["section"] and p["section"] != last_sec:
            out.append({"id": f"{sid}_h{len(out):04d}", "level": "section", "text": p["section"],
                        "page": page_of(p["section"], p["page_start"]), "before_paragraph": p["id"],
                        "chapter": p["chapter"]})
        last_sec = p["section"]
    return out


# ---------------------------------------------------------------------------
# Writing
# ---------------------------------------------------------------------------

def _suffix(version: str) -> str:
    return "" if version == "v3" else f"_{version}"


def write_source(result: dict, entry: dict, out_root: Path, version: str, archive_root: Path | None = None) -> Path:
    sid = entry["source_id"]
    d = out_root / sid
    d.mkdir(parents=True, exist_ok=True)
    sfx = _suffix(version)
    paths = {
        "paras": d / f"paragraphs_{version}.jsonl",
        "heads": d / f"headings{sfx}.jsonl",
        "notes": d / f"extraction_notes{sfx}.json",
        "metrics": d / f"extraction_metrics{sfx}.json",
    }
    for p in paths.values():
        lp.archive_if_exists(p, sid, archive_root)
    for p in (paths["paras"], paths["heads"]):
        if p.exists():
            p.unlink()   # replaced below; the previous copy is already archived
    if result["status"] == "ok":
        lp.write_jsonl(paths["paras"], result["paragraphs"])
        lp.write_jsonl(paths["heads"], result["headings"])
    else:
        for k in ("paras", "heads"):
            if paths[k].exists():
                paths[k].unlink()
    paths["notes"].write_text(json.dumps(result["notes"], indent=2, ensure_ascii=False), encoding="utf-8")
    metrics = result["metrics"] or {"source_id": sid, "title": entry.get("title"), "status": result["status"],
                                    "reason": result["notes"].get("reason")}
    metrics["version"] = version
    paths["metrics"].write_text(json.dumps(metrics, indent=2, ensure_ascii=False), encoding="utf-8")
    return d


def run_one(args: tuple) -> dict:
    sid, out_root, version = args
    t0 = time.time()
    try:
        entry = lp.manifest_entry(sid)
        res = build_source(entry, version)
        write_source(res, entry, Path(out_root), version)
        return {"source_id": sid, "status": res["status"], "paragraphs": len(res["paragraphs"]),
                "seconds": round(time.time() - t0, 1)}
    except Exception as exc:  # keep going; one bad book must not stop the run
        return {"source_id": sid, "status": "error", "error": f"{type(exc).__name__}: {exc}",
                "trace": traceback.format_exc()[-600:], "seconds": round(time.time() - t0, 1)}


# ---------------------------------------------------------------------------
# Report
# ---------------------------------------------------------------------------

def badness(m: dict) -> float:
    if m.get("status") != "ok":
        return 1e6
    n = max(m.get("paragraph_count", 0), 1)
    return m["pct_not_terminal"] + 2 * m["pct_lowercase_start"] + min(m["suspected_glued_count"], 50) * 0.5 \
        + (30 if n < 40 else 0)


def write_report(out_root: Path, version: str, dest: Path) -> int:
    sfx = _suffix(version)
    rows = []
    for d in sorted(out_root.iterdir()):
        f = d / f"extraction_metrics{sfx}.json"
        if f.exists():
            rows.append(json.loads(f.read_text(encoding="utf-8")))
    rows.sort(key=badness, reverse=True)
    esc = lambda s: str(s).replace("|", "/").replace("\n", " ")  # noqa: E731
    lines = [f"# Extraction report ({version}, {EXTRACT_VERSION})", "",
             f"{len(rows)} sources. Sorted worst first by: % not ending in terminal punctuation + 2 x % starting "
             "lowercase + 0.5 x suspected glued words (capped) + 30 if under 40 paragraphs; unsupported sources first.", "",
             "| Source | Status | Paragraphs | Median words | % no terminal punct | % lowercase start | "
             "Suspected glued (3 examples) | Excluded matter |", "|---|---|---|---|---|---|---|---|"]
    for m in rows:
        if m.get("status") != "ok":
            lines.append(f"| {esc(m['source_id'])} | {m.get('status')} | 0 | - | - | - | - | {esc(m.get('reason', ''))[:160]} |")
            continue
        ex = ", ".join(m["suspected_glued_examples"])
        lines.append(f"| {m['source_id']} | ok | {m['paragraph_count']} | {m['median_words']:g} | {m['pct_not_terminal']} | "
                     f"{m['pct_lowercase_start']} | {m['suspected_glued_count']} ({esc(ex)}) | {esc(m['excluded_summary'])[:300]} |")
    dest.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return len(rows)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Extract paragraphs, headings, notes and metrics from library sources.")
    ap.add_argument("--source", action="append", default=[], help="source id (repeatable)")
    ap.add_argument("--all", action="store_true", help="every non-duplicate source in the manifest")
    ap.add_argument("--out-root", default=str(DEFAULT_OUT_ROOT))
    ap.add_argument("--version", default=DEFAULT_VERSION, help="tag used in file names (default v3.1)")
    ap.add_argument("--report", action="store_true", help="write EXTRACTION_REPORT.md from existing metrics")
    ap.add_argument("--report-path", default=str(HERE / "EXTRACTION_REPORT.md"))
    ap.add_argument("--jobs", type=int, default=6)
    a = ap.parse_args(argv)
    out_root = Path(a.out_root)
    if not out_root.is_absolute():
        out_root = HERE / out_root
    manifest = lp.load_manifest()
    ids = list(a.source)
    if a.all:
        ids += [s["source_id"] for s in manifest["sources"]
                if s.get("status_hint") != "duplicate" and s["source_id"] not in ids]
    if ids:
        jobs = [(i, str(out_root), a.version) for i in ids]
        if len(jobs) > 1 and a.jobs > 1:
            from multiprocessing import Pool
            with Pool(a.jobs) as pool:
                results = []
                for r in pool.imap_unordered(run_one, jobs):
                    print(json.dumps(r), flush=True)
                    results.append(r)
        else:
            results = []
            for j in jobs:
                r = run_one(j)
                print(json.dumps(r), flush=True)
                results.append(r)
        bad = [r for r in results if r["status"] == "error"]
        if bad:
            print(f"{len(bad)} source(s) errored", file=sys.stderr)
    if a.report:
        n = write_report(out_root, a.version, Path(a.report_path))
        print(f"report: {n} sources -> {a.report_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
