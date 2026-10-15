"""Stages 1 and 2 of the lessons pipeline: paragraphs (atoms) and reading windows.

Stage 1. Paragraph detection follows ONE general rule, no per-book config.
Two physical lines are in the same paragraph unless ALL of these hold:
  (a) the previous line ends with terminal punctuation (. ? ! ... optionally
      followed by closing quotes/brackets) -- a colon also counts when the next
      line starts a list item (documented deviation, see COLON_LEAD_IN);
  (b) the next line starts with a capital, an opening quote or a digit
      (bullets count as a start for list items);
  (c) there is a layout signal: first-line indent, a vertical gap bigger than the
      normal line spacing, a new PyMuPDF text block (only when blocks are
      informative for this document), or a clearly short previous line (only in
      documents whose body is justified, so line length is meaningful).
Plain text has no layout; a blank line is the layout signal. Unpunctuated text
(speech-to-text dumps) is reported as unsupported, never guessed at.

Headings are short lines with no terminal punctuation that are larger, bold, all
caps, or in the PDF outline. They are never body text; they set the heading path.
A line-end hyphen is kept and joined with no space ("self-" + "control").
Page numbers, running heads and feet, footnote markers/text, figure captions,
front matter and back matter (about the author, acknowledgments, ads, index,
bibliography) never reach the paragraphs.

Stage 2. Reading windows: ~2,000 words of paragraphs inside one chapter, cut only
at paragraph boundaries, preferably where a section heading starts. Each window
carries the last 2 paragraphs of the previous window as CONTEXT ONLY.
"""

from __future__ import annotations

import hashlib
import json
import re
import statistics
import sys
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import library_extract as lx  # noqa: E402
from library_text import (  # noqa: E402
    clean_inline, dictionary, is_attribution, is_attribution_line, is_caption_line, is_dateline,
    is_figure_caption, is_photo_credit, is_scene_break, join_lines, looks_like_index, repair_glued_words,
    split_bullet_separators, strip_ascii_diagram, strip_footnote_markers, strip_leading_label,
    strip_ocr_noise, strip_sponsor_reads, tidy_spacing, word_count, CAPTION_START_RE,
)

try:  # PyMuPDF is only needed for PDFs.
    import fitz  # type: ignore
except Exception:  # pragma: no cover
    fitz = None

PARAGRAPH_VERSION = "paragraphs-2026.10.a1"
ROOT = HERE.parent
LIBRARY_DIR = HERE / "library"
MANIFEST_PATH = HERE / "library_manifest.json"

WINDOW_TARGET_WORDS = 2000
WINDOW_MAX_WORDS = 2600       # hard ceiling when no good break exists
CONTEXT_PARAGRAPHS = 2


class UnsupportedSource(Exception):
    """The source cannot be turned into paragraphs by a rule (scanned, unpunctuated, unknown)."""


# ----------------------------------------------------------------------------
# Manifest helpers
# ----------------------------------------------------------------------------

def load_manifest(path: Path | None = None) -> dict:
    return json.loads(Path(path or MANIFEST_PATH).read_text(encoding="utf-8"))


def manifest_entry(source_id: str, manifest: dict | None = None) -> dict:
    manifest = manifest or load_manifest()
    for entry in manifest["sources"]:
        if entry["source_id"] == source_id:
            return entry
    raise KeyError(f"{source_id!r} is not in the manifest")


def source_path(entry: dict) -> Path:
    p = Path(entry["path"])
    return p if p.is_absolute() else ROOT / p


def source_dir(source_id: str, library_dir: Path | None = None) -> Path:
    return Path(library_dir or LIBRARY_DIR) / source_id


def clean_author(raw: str | None) -> str | None:
    """"Kiyosaki, Robert" -> "Robert Kiyosaki"; "A; B" -> "A and B"; junk -> None."""
    if not raw:
        return None
    raw = re.sub(r"\s+", " ", raw).strip()
    if not raw or raw.lower() in {"unknown", "anonymous", "author", "admin", "user", "none"}:
        return None
    parts = [p.strip() for p in re.split(r"\s*;\s*|\s+&\s+|\s+and\s+(?=[A-Z])", raw) if p.strip()]
    names = []
    for p in parts:
        m = re.fullmatch(r"([^,]+),\s*([^,]+)", p)
        if m:
            p = f"{m.group(2).strip()} {m.group(1).strip()}"
        names.append(p)
    if not names:
        return None
    return names[0] if len(names) == 1 else ", ".join(names[:-1]) + " and " + names[-1]


# ----------------------------------------------------------------------------
# Line level primitives (pure, unit tested)
# ----------------------------------------------------------------------------

TERMINAL_RE = re.compile(r"[.!?…][\"”’')\]*]*$")
ABBREV_END_RE = re.compile(
    r"(?:\b(?:Mr|Mrs|Ms|Dr|Prof|St|Jr|Sr|vs|Inc|Ltd|Co|Corp|No|Fig|Vol|approx)\.|\b[A-Z]\.|\be\.g\.|\bi\.e\.)[\"”’')\]]*$")
OPENERS = "\"'“‘(["
BULLET_RE = re.compile(r"^(?:[•●▪◦■□‣⁃*–—-]\s+\S|\(?\d{1,2}[.)]\s+\S|\(?[a-hA-H][.)]\s+\S)")
COLON_LEAD_IN_RE = re.compile(r":[\"”’')\]]*$")


def ends_terminal(text: str) -> bool:
    t = text.rstrip()
    if not TERMINAL_RE.search(t):
        return False
    if ABBREV_END_RE.search(t) and not re.search(r"[!?…]", t[-3:]):
        # "Mr." / "Dr." / an initial at a line end is not a sentence end.
        return False
    return True


def starts_paragraph(text: str) -> bool:
    """Capital, opening quote or digit (after any opening bracket); bullets start list items."""
    t = text.lstrip()
    if not t:
        return False
    if BULLET_RE.match(t):
        return True
    if t[0] in "\"'“‘":
        return True
    t = t.lstrip(OPENERS + " …")
    return bool(t) and (t[0].isupper() or t[0].isdigit())


def is_list_start(text: str) -> bool:
    return bool(BULLET_RE.match(text.lstrip()))


def ends_colon(text: str) -> bool:
    return bool(COLON_LEAD_IN_RE.search(text.rstrip()))


@dataclass
class Item:
    """One thing in reading order: a body line, a heading, a chapter start or a scene break."""
    kind: str                       # line | heading | chapter | break
    text: str = ""
    page: int = 0
    x0: float = 0.0
    x1: float = 0.0
    y0: float = 0.0
    y1: float = 0.0
    size: float = 12.0
    block: int = 0
    italic: bool = False
    # Explicit layout override for text sources and tests: True = a layout signal precedes this line.
    signal: bool | None = None
    bold: bool = False
    bullet: bool = False      # a drawn bullet sits left of this line (list item start)
    epi: bool = False         # the line belongs to an epigraph block (indented italic / smaller quotation)
    attr: bool = False        # the line is an attribution or credit line ("—NAME", "TRANSLATED BY ...")


@dataclass
class Geometry:
    median_gap: float = 2.5
    blocks_informative: bool = True
    short_valid: bool = False
    right_margin: float = 0.0
    base_x: dict[int, float] = field(default_factory=dict)   # page -> left margin of body text
    default_base_x: float = 0.0


def compute_geometry(items: list[Item]) -> Geometry:
    lines = [i for i in items if i.kind == "line"]
    geo = Geometry()
    if not lines:
        return geo
    by_page: dict[int, list[Item]] = {}
    for l in lines:
        by_page.setdefault(l.page, []).append(l)
    allx = Counter()
    for page, ls in by_page.items():
        # Left margin = most common x0 among lines that run most of the width (not indented first lines).
        c = Counter(round(l.x0) for l in ls)
        base = c.most_common(1)[0][0]
        # Prefer the smallest x0 that holds >= 15% of the lines, so a page of indented dialogue
        # (first lines) still finds the true margin.
        for x, n in sorted(c.items()):
            if n >= max(2, 0.15 * len(ls)):
                base = x
                break
        geo.base_x[page] = float(base)
        allx[base] += len(ls)
    geo.default_base_x = float(allx.most_common(1)[0][0])
    # A page whose every line is a paragraph opener (dialogue) looks fully indented on its own. Margins
    # alternate left/right in books, so borrow the smallest margin of the same-parity neighbours.
    parity: dict[int, float] = {}
    for par in (0, 1):
        c = Counter(round(l.x0) for l in lines if l.page % 2 == par)
        tot = sum(c.values())
        if tot:
            parity[par] = float(next(x for x, n in sorted(c.items()) if n >= max(2, 0.15 * tot)) if any(
                n >= max(2, 0.15 * tot) for n in c.values()) else c.most_common(1)[0][0])
    raw_base = dict(geo.base_x)
    for page in raw_base:
        geo.base_x[page] = min([raw_base.get(q, raw_base[page]) for q in (page - 2, page, page + 2)]
                               + [parity.get(page % 2, raw_base[page])])
    gaps: list[float] = []
    blocks_lines: list[int] = []
    run = 0
    prev: Item | None = None
    for l in lines:
        if prev is not None and prev.page == l.page and l.y0 >= prev.y0:
            g = l.y0 - prev.y1
            if -1 < g < l.size * 1.5:
                gaps.append(g)
        if prev is not None and prev.page == l.page and prev.block == l.block:
            run += 1
        else:
            if run:
                blocks_lines.append(run + 1)
            run = 0
        prev = l
    if gaps:
        geo.median_gap = statistics.median(gaps)
    if blocks_lines:
        geo.blocks_informative = statistics.median(blocks_lines) >= 2
    xs = sorted(l.x1 for l in lines)
    geo.right_margin = xs[int(len(xs) * 0.9)] if xs else 0.0
    sizes = statistics.median(l.size for l in lines)
    near = sum(1 for l in lines if l.x1 >= geo.right_margin - 1.5 * sizes)
    geo.short_valid = near / len(lines) >= 0.55
    return geo


def layout_signal(prev: Item, cur: Item, geo: Geometry, para_first: Item | None = None) -> str | None:
    """Name of the layout signal between two consecutive body lines, or None.

    A first-line indent is an indent RELATIVE TO THE PREVIOUS LINE: a whole block that is indented (a hanging
    list item, a block quote) does not give every line an indent signal. The exception is a paragraph that is
    still one line long and itself indented (consecutive one-line indented paragraphs, as in dialogue)."""
    if cur.signal is not None:
        return "explicit" if cur.signal else None
    size = cur.size or 12.0
    base = geo.base_x.get(cur.page, geo.default_base_x)
    rel = cur.x0 - base
    prev_rel = prev.x0 - geo.base_x.get(prev.page, geo.default_base_x)
    if rel > 0.5 * size and (rel > prev_rel + 0.5 * size or (para_first is prev and prev_rel > 0.5 * size)):
        return "indent"
    if prev.page == cur.page:
        if cur.y0 < prev.y0 - 2:
            return "new_column"
        if cur.y0 - prev.y1 > geo.median_gap + 0.2 * size:
            return "gap"
        if geo.blocks_informative and cur.block != prev.block:
            return "block"
    if geo.short_valid and prev.x1 < geo.right_margin - 2.5 * size:
        return "short_line"
    return None


_COLON_SIGNALS = {"indent", "gap", "block", "new_column", "explicit", "marker"}


def should_split(prev: Item, cur: Item, geo: Geometry, para_first: Item | None = None,
                n_lines: int | None = None) -> str | None:
    """The general rule. Returns the reason to start a new paragraph, or None to join the lines.
    para_first is the first line of the paragraph being built (used for the list rules).

    Lists: a drawn bullet or a text marker starts an item. Inside an item only a new marker, a vertical gap or
    leaving the list (the next line is less indented) starts a new paragraph, so a long item is never cut at a
    sentence end. A colon-ended line followed by a line that starts a paragraph with a real layout signal
    (indent, gap, new block) starts a new paragraph: the lead-in is its own paragraph."""
    sig = layout_signal(prev, cur, geo, para_first)
    if cur.bullet:
        return sig or "bullet"
    marker = is_list_start(cur.text)
    in_list = para_first is not None and (para_first.bullet or is_list_start(para_first.text))
    if sig is None and marker and (ends_terminal(prev.text) or ends_colon(prev.text) or in_list):
        sig = "marker"
    if in_list:
        if marker:
            return sig or "list"
        if not starts_paragraph(cur.text):
            return None
        size = cur.size or 12.0
        if para_first is prev and sig and sig != "indent":
            return sig + "+after_list"          # one-line item, then ordinary text
        if sig in ("gap", "new_column") or (sig == "block" and ends_terminal(prev.text)):
            return sig + "+after_list"
        # A short list item (one or two lines) that ends a sentence at a page end, followed by a first-line
        # indented line on the next page, is the end of the list: ordinary text follows.
        rel_x = cur.x0 - geo.base_x.get(cur.page, geo.default_base_x)
        if (sig == "indent" or (sig in (None, "short_line") and rel_x > 0.5 * size)) and cur.page != prev.page \
                and ends_terminal(prev.text) and n_lines is not None and n_lines <= 2:
            return "indent+after_list_page"
        # A numbered paragraph without a hanging indent (its lines all start at one margin) is not a list item:
        # a first-line indent after a full stop starts the next paragraph.
        if sig == "indent" and para_first is not prev and ends_terminal(prev.text) \
                and cur.page == prev.page and cur.x0 > prev.x0 + 0.5 * size and para_first.x0 >= prev.x0 - 1.0 \
                and not para_first.bullet:
            return "indent+after_numbered"
        if cur.page == prev.page and cur.x0 < prev.x0 - 0.5 * size and ends_terminal(prev.text):
            return "dedent"
        return None
    if sig is None:
        return None
    if not starts_paragraph(cur.text):
        return None
    if ends_terminal(prev.text):
        return sig
    # A lone Title Case line (no terminal punctuation) standing apart from the next line is a heading.
    if para_first is prev and is_title_case_line(prev.text) and sig != "indent":
        return sig + "+title_line"
    # A lead-in colon: what follows starts a new paragraph when there is a real layout signal.
    if ends_colon(prev.text) and (sig in _COLON_SIGNALS or marker):
        return sig + "+colon"
    return None


# ----------------------------------------------------------------------------
# Assembly: items -> paragraphs
# ----------------------------------------------------------------------------

@dataclass
class RawPara:
    lines: list[Item]
    chapter: str
    section: str | None
    scene_break: bool = False

    @property
    def text(self) -> str:
        return join_lines([l.text for l in self.lines])


def hard_boundary(prev: Item, cur: Item) -> bool:
    """Epigraphs are their own blocks: a change between epigraph and body, a new epigraph block, or the line
    after an attribution always starts a new paragraph, so two epigraphs never merge."""
    if prev.epi != cur.epi:
        return True
    if cur.epi:
        if prev.attr and not cur.attr:
            return True
        if prev.page == cur.page and cur.block != prev.block and not cur.attr:
            return True
    return False


def assemble(items: list[Item], geo: Geometry | None = None) -> list[RawPara]:
    geo = geo or compute_geometry(items)
    out: list[RawPara] = []
    chapter, section = "Body", None
    cur: RawPara | None = None
    prev: Item | None = None
    scene = False
    for it in items:
        if it.kind == "chapter":
            chapter, section = it.text, None
            cur = prev = None
            continue
        if it.kind == "heading":
            section = it.text
            cur = prev = None
            continue
        if it.kind == "break":
            scene = True
            cur = prev = None
            continue
        if cur is None or prev is None or hard_boundary(prev, it) or should_split(prev, it, geo, cur.lines[0], len(cur.lines)):
            cur = RawPara([it], chapter, section, scene)
            out.append(cur)
            scene = False
        else:
            cur.lines.append(it)
        prev = it
    return out


# ----------------------------------------------------------------------------
# Paragraph post-processing
# ----------------------------------------------------------------------------

def finish_text(text: str, report: dict) -> str:
    text, removed = strip_footnote_markers(clean_inline(text))
    report["footnote_markers_stripped"] = report.get("footnote_markers_stripped", 0) + removed
    text, noise = strip_ocr_noise(text)
    if noise:
        report["ocr_noise_removed"] = report.get("ocr_noise_removed", 0) + noise
    return tidy_spacing(text)


TITLE_FILLER = {"of", "and", "the", "in", "by", "vs", "for", "to", "a", "an", "on", "at", "with", "from", "or", "is",
                "it", "as", "your", "my", "our", "not", "do", "don't", "you", "are", "be", "how", "why", "what", "can"}


def is_title_case_line(text: str) -> bool:
    """A short run of Title Case words (3 to 14 words) is a heading, even when it ends in a ? or a closing
    quote: no ordinary sentence capitalises every content word. Ends in a full stop = a sentence, not a heading."""
    t = text.strip().strip("\"“”‘’'").strip()
    words = [w for w in t.split() if any(c.isalpha() for c in w)]
    if not 3 <= len(words) <= 14 or re.search(r"[.!]$", t) or t.endswith((",", ";")):
        return False
    if not words[0].lstrip("\"“‘'(")[:1].isupper():
        return False
    content = [w for w in words if w.lower().strip(",:?\"“”") not in TITLE_FILLER]
    return bool(content) and all(w.lstrip("\"“‘'(")[:1].isupper() or not w[0].isalpha() for w in content)


def make_records(raws: list[RawPara], source_id: str, report: dict, start_index: int = 0) -> list[dict]:
    """Turn RawParas into paragraph records, dropping captions/datelines/debris and tagging kinds."""
    recs: list[dict] = []
    dropped = report.setdefault("dropped", [])
    override: tuple[str, str | None, str] | None = None     # (chapter, original section, promoted heading)
    sizes = [l.size for r in raws for l in r.lines if l.size]
    med_size = statistics.median(sizes) if sizes else 12.0
    seen_chapter: set[str] = set()
    for raw in raws:
        first_in_chapter = raw.chapter not in seen_chapter
        seen_chapter.add(raw.chapter)
        is_epi = all(l.epi for l in raw.lines)
        l0 = raw.lines[0]
        # A promoted heading needs a typographic signal (bold, larger type) or a position (first block after a
        # chapter break); a text source has no typography, so its blank-line structure is the signal.
        heading_signal = l0.signal is not None or l0.bold or first_in_chapter \
            or abs((l0.size or med_size) - med_size) >= med_size * 0.05 \
            or (lx_caps_ratio(raw.text) >= 0.99 and word_count(raw.text) >= 2)
        for text in split_bullet_separators(finish_text(raw.text, report)):
            if override and (override[0], override[1]) != (raw.chapter, raw.section):
                override = None
            text, glued = strip_leading_label(text)
            if glued:
                report["figure_labels_stripped"] = report.get("figure_labels_stripped", 0) + 1
            if not is_epi and (is_figure_caption(text) or is_caption_line(text)):
                dropped.append({"page": l0.page or None, "reason": "figure_caption", "text": text[:200]})
                continue
            if text and not raw.scene_break and not is_epi and heading_signal and is_title_case_line(text) \
                    and not is_attribution_line(text):
                override = (raw.chapter, raw.section, text)
                report.setdefault("headings", []).append({"page": l0.page, "text": text, "kind": "title_case_paragraph"})
                continue
            cur_raw = RawPara(raw.lines, raw.chapter, override[2], raw.scene_break) if override else raw
            pages = [l.page for l in cur_raw.lines if l.page] or [None]
            page = pages[0]
            if not text or re.fullmatch(r"(?:\d{1,4}|[ivxlcdm]{1,7})", text, re.I):
                continue
            reason = None
            if is_figure_caption(text) or is_photo_credit(text):
                reason = "figure_caption"
            elif is_dateline(text):
                reason = "dateline"
            elif looks_like_index(text):
                reason = "index_debris"
            elif re.search(r"-{5,}|-{2,}>|\+-{3,}", text):
                text, diagram = strip_ascii_diagram(text)
                if not text:
                    reason = "ascii_diagram"
            if reason:
                dropped.append({"page": page, "reason": reason, "text": text[:200]})
                continue
            kind = "epigraph" if is_epi else ("list_item" if is_list_start(text) or cur_raw.lines[0].bullet else "body")
            recs.append({
                "text": text, "chapter": cur_raw.chapter, "section": cur_raw.section,
                "page_start": min(pages) if pages[0] else None, "page_end": max(pages) if pages[0] else None,
                "kind": kind, "scene_break": cur_raw.scene_break,
                "italic": sum(1 for l in cur_raw.lines if l.italic) >= 0.7 * len(cur_raw.lines),
            })
    _tag_epigraphs(recs)
    return recs


def _tag_epigraphs(recs: list[dict]) -> None:
    """Short italic or attributed quotations at the head of a chapter are epigraphs of THEIR chapter."""
    seen: dict[str, int] = {}
    for i, r in enumerate(recs):
        k = seen.get(r["chapter"], 0)
        seen[r["chapter"]] = k + 1
        if k >= 3 or r["section"] is not None:
            continue
        w = word_count(r["text"])
        if w <= 90 and r["kind"] == "body" and (r["italic"] or is_attribution(r["text"])):
            r["kind"] = "epigraph"
            if is_attribution(r["text"]) and k > 0 and recs[i - 1]["chapter"] == r["chapter"] \
                    and word_count(recs[i - 1]["text"]) <= 90:
                recs[i - 1]["kind"] = "epigraph"


def finalize(recs: list[dict], source_id: str) -> list[dict]:
    """Assign ids, heading path and word counts. Only here do paragraphs get their final shape."""
    out = []
    for i, r in enumerate(recs):
        path = [r["chapter"]] + ([r["section"]] if r["section"] and r["section"] != r["chapter"] else [])
        out.append({
            "id": f"{source_id}_p{i:04d}",
            "source_id": source_id,
            "index": i,
            "text": r["text"],
            "chapter": r["chapter"],
            "section": r["section"] if r["section"] != r["chapter"] else None,
            "heading_path": path,
            "page": r["page_start"],
            "page_start": r["page_start"],
            "page_end": r["page_end"],
            "word_count": word_count(r["text"]),
            "kind": r["kind"],
            "scene_break": bool(r.get("scene_break")),
        })
    return out


# ----------------------------------------------------------------------------
# PDF reading
# ----------------------------------------------------------------------------

AD_HEAD_RE = re.compile(
    r"^(?:also by|other books by|praise for|books by|more from|about the (?:author|authors)|"
    r"acknowledg\w*|index|notes|endnotes|bibliography|references|sources|a note on sources|"
    r"sign up for|join our|discover more|keep reading|about rich global|about the publisher)\b", re.I)


BACK_LINE_RE = re.compile(r"^(?:about the authors?\b|acknowledg(?:e)?ments?\s*$|also by\b|other books by\b|praise for\b)", re.I)


def _line_items_from_block(block: list[lx.Line], page: int) -> list[Item]:
    return [Item("line", l.text, page, l.x0, l.x1, l.y0, l.y1, l.size, l.block, l.italic) for l in block]


def _doc_margins(page_blocks: dict[int, list[list[lx.Line]]], body: float) -> dict[str, float]:
    """Left margin per page parity and right margin of the body text, from lines that look like running prose."""
    by_par: dict[int, Counter] = {0: Counter(), 1: Counter()}
    rights: list[float] = []
    for n, blocks in page_blocks.items():
        for block in blocks:
            for l in block:
                if l.size >= body * 0.9 and word_count(l.text) >= 5:
                    by_par[n % 2][round(l.x0)] += 1
                    rights.append(l.x1)
    out: dict[str, float] = {}
    for par, c in by_par.items():
        tot = sum(c.values())
        keep = [x for x, k in sorted(c.items()) if k >= max(2, 0.12 * tot)]
        out[f"left{par}"] = float(keep[0]) if keep else (float(c.most_common(1)[0][0]) if c else 0.0)
    rights.sort()
    out["right"] = rights[int(len(rights) * 0.9)] if rights else 0.0
    return out


def epigraph_flags(blocks: list[list[lx.Line]], body: float, left: float, right: float) -> dict[int, str]:
    """id(line) -> 'epi' or 'attr' for lines that belong to epigraphs.

    An epigraph is a block set apart from the body: indented well in from the left margin and not running to
    the right margin, and italic or in smaller type. A line that starts with a dash and a CAPS name (or a
    translator credit) is an attribution; the lines above it in the same block, or the block just above it, are
    its epigraph; a CAPS tail line that wraps the attribution is part of it."""
    flags: dict[int, str] = {}
    cut: dict[int, int] = {}            # block index -> index of its first attribution line
    attr_blocks: set[int] = set()
    for bi, block in enumerate(blocks):
        k = next((k for k, l in enumerate(block) if is_attribution_line(l.text)), None)
        if k is not None and len(block) - k <= 4:
            cut[bi] = k
            attr_blocks.add(bi)
    for bi, block in enumerate(blocks):
        txt = " ".join(l.text for l in block)
        if bi - 1 in attr_blocks and bi not in attr_blocks and len(block) <= 2 and word_count(txt) <= 12 \
                and lx_caps_ratio(txt) >= 0.6 and block[0].x0 > left + 4 * body:
            cut[bi] = 0
            attr_blocks.add(bi)
    for bi in attr_blocks:
        for l in blocks[bi][cut[bi]:]:
            flags[id(l)] = "attr"
    for bi, block in enumerate(blocks):
        lines = block[:cut[bi]] if bi in cut else block
        if not lines:
            continue
        txt = " ".join(l.text for l in lines)
        words = word_count(txt)
        x0 = min(l.x0 for l in lines)
        x1 = max(l.x1 for l in lines)
        italic = sum(1 for l in lines if l.italic) >= 0.7 * len(lines)
        # Small type only counts for a block of running text; a short all-caps line in small type is a heading.
        small = statistics.median(l.size for l in lines) <= body * 0.93 \
            and not (lx_caps_ratio(txt) >= 0.8 and words <= 14)
        before_attr = bi in cut and cut[bi] > 0 or (bi + 1) in attr_blocks and cut.get(bi + 1) == 0 or \
            (bi + 1) in attr_blocks and bi + 1 in cut and cut[bi + 1] == 0
        quote_shape = x0 >= left + 2.5 * body and x1 <= right - 0.5 * body
        limit = 500 if italic else 150
        if words <= limit and quote_shape and (italic or small) \
                and (len(lines) >= 2 or ends_terminal(txt) or before_attr):
            for l in lines:
                flags[id(l)] = "epi"
        elif before_attr and words <= 120 and (x0 >= left + 1.5 * body or x1 <= right - 2 * body):
            for l in lines:
                flags[id(l)] = "epi"
    return flags


def lx_caps_ratio(text: str) -> float:
    letters = [c for c in text if c.isalpha()]
    return sum(1 for c in letters if c.isupper()) / len(letters) if letters else 0.0


def _table_cells(blocks: list[list[lx.Line]]) -> list[tuple[float, float, float, float, int, int]]:
    """Cells = runs of vertically adjacent lines that share a left edge, taken line by line so two cells that
    PyMuPDF put in one block stay two cells. Returns (y0, y1, x0, x1, words, block index)."""
    cells: list[list] = []
    for bi, block in enumerate(blocks):
        open_cells: list[list] = []
        for l in block:
            for c in open_cells:
                if abs(c[2] - l.x0) <= 3 and -1 <= l.y0 - c[1] <= 0.7 * l.size:
                    c[1] = max(c[1], l.y1)
                    c[3] = max(c[3], l.x1)
                    c[4] += word_count(l.text)
                    break
            else:
                c = [l.y0, l.y1, l.x0, l.x1, word_count(l.text), bi]
                open_cells.append(c)
                cells.append(c)
    return [tuple(c) for c in cells]  # type: ignore[misc]


def detect_table_blocks(blocks: list[list[lx.Line]], body: float) -> tuple[set[int], int]:
    """Indexes of blocks that form a table (cells in columns), and their word count.

    Cells are grouped into rows by vertical overlap. A row with two or more disjoint short cells is a table
    row. A page with 3 or more such rows whose cells share one vertical gutter is a table; every block whose
    middle lies between its first and last table row is returned."""
    cells = _table_cells(blocks)
    if len(cells) < 6:
        return set(), 0
    cells.sort(key=lambda c: c[0])
    rows: list[list[tuple]] = []
    for c in cells:
        if rows:
            ymin = min(x[0] for x in rows[-1])
            ymax = max(x[1] for x in rows[-1])
            over = min(c[1], ymax) - max(c[0], ymin)
            if over >= 0.5 * min(c[1] - c[0], ymax - ymin):
                rows[-1].append(c)
                continue
        rows.append([c])
    table_rows = []
    for row in rows:
        if len(row) < 2 or any(c[4] > 80 for c in row):
            continue
        row.sort(key=lambda c: c[2])
        if all(b[2] >= a[3] - 2 for a, b in zip(row, row[1:])):
            table_rows.append(row)
    if len(table_rows) < 3:
        return set(), 0
    # The cells must line up in columns: one vertical gutter that most table rows share.
    gaps = [(row[0][3], row[1][2]) for row in table_rows]
    best = max(sum(1 for lo, hi in gaps if lo <= x <= hi) for x in {g for pair in gaps for g in pair})
    if best < max(3, 0.6 * len(table_rows)):
        return set(), 0
    words = sorted(c[4] for row in table_rows for c in row)
    if words[len(words) // 2] > 40:
        return set(), 0
    top = min(c[0] for row in table_rows for c in row)
    bottom = max(c[1] for row in table_rows for c in row)
    inside: set[int] = set()
    total = 0
    for bi, b in enumerate(blocks):
        mid = (min(l.y0 for l in b) + max(l.y1 for l in b)) / 2
        if top - 1 <= mid <= bottom + 1:
            inside.add(bi)
            total += word_count(" ".join(l.text for l in b))
    return inside, total


def pdf_items(path: Path, report: dict, title: str | None = None) -> list[Item]:
    """Read a PDF into ordered Items, stripping furniture, footnotes, front and back matter."""
    if fitz is None:
        raise UnsupportedSource("PyMuPDF is not installed")
    doc = fitz.open(path)
    n_pages = len(doc)
    report.update({"format": "pdf", "pages": n_pages, "removed": Counter(), "footnotes": [],
                   "headings": [], "back_matter": [], "front_matter": [], "warnings": []})
    toc = doc.get_toc()
    plans = lx.plan_chapters_from_toc(toc, n_pages)
    detection = "toc"
    pages_all = list(range(1, n_pages + 1))
    sample = pages_all[::max(1, n_pages // 40)][:40]
    sample_words = [word_count(doc[n - 1].get_text("text")) for n in sample] or [0]
    if sum(1 for w in sample_words if w < 5) / len(sample_words) > 0.6:
        raise UnsupportedSource("No usable text layer (scanned or image-only PDF)")
    body_pages = list(range(plans[0].start_page, plans[-1].end_page + 1)) if plans else pages_all
    body, bold_frac = lx.doc_style(doc, body_pages)
    intro = _find_intro(doc, plans, body) if plans else None
    if intro:
        plans.insert(0, intro)
        body_pages = list(range(intro.start_page, plans[-1].end_page + 1))
        report["removed"]["_note"] = 0
        del report["removed"]["_note"]
        report["warnings"].append(f"Included '{intro.title}' (pages {intro.start_page}-{intro.end_page}) that the outline skips")
    if not plans:
        plans, detection = lx.plan_chapters_from_fonts(doc, body_pages, body)
        if plans:
            body_pages = list(range(plans[0].start_page, plans[-1].end_page + 1))
        else:
            detection = "fixed"
            start = lx._first_body_page(doc)
            plans = [lx.ChapterPlan("Body", start, n_pages, 1)]
            body_pages = list(range(start, n_pages + 1))
    report["chapter_detection"] = detection
    report["body_font_size"] = body
    meta = (doc.metadata or {})
    report["meta_author"] = meta.get("author") or None

    # Front matter: everything before the first body page (kept out, previewed in the report).
    if body_pages and body_pages[0] > 1:
        report["front_matter"].append(_preview(doc, 1, body_pages[0] - 1, "before first chapter"))

    # Pass 1: read pages once; collect furniture statistics.
    page_blocks: dict[int, list[list[lx.Line]]] = {}
    heights: dict[int, float] = {}
    furniture: Counter = Counter()
    margin_texts: Counter = Counter()
    for n in body_pages:
        blocks = lx.read_page_blocks(doc[n - 1])
        page_blocks[n] = blocks
        h = heights[n] = doc[n - 1].rect.height
        for block in blocks:
            text = " ".join(l.text for l in block)
            in_margin = block[0].y0 < h * 0.11 or block[-1].y1 > h * 0.90
            if word_count(text) <= 8 or (in_margin and word_count(text) <= 20):
                furniture[re.sub(r"\d+", "#", lx.norm(text))] += 1
            if in_margin and 1 <= word_count(text) <= 14:
                margin_texts[re.sub(r"\d+", "#", lx.norm(text))] += 1
    repeated = {k for k, c in furniture.items() if k and c >= max(5, int(len(body_pages) * 0.25))}
    margin_repeated = {k for k, c in furniture.items() if k and c >= max(4, int(len(body_pages) * 0.12))}
    margin_repeated |= {k for k, c in margin_texts.items() if k.strip("# ") and c >= 3}

    margins = _doc_margins(page_blocks, body)
    report["tables"] = []
    report["epigraph_blocks"] = 0

    chapter_by_page: dict[int, lx.ChapterPlan] = {}
    for plan in plans:
        for n in range(plan.start_page, plan.end_page + 1):
            chapter_by_page.setdefault(n, plan)

    items: list[Item] = []
    cur_chapter: str | None = None
    stopped_at: int | None = None
    pending_cap: list[str] = []
    absorbed: set[int] = set()
    caption_pending = False       # a bare "Figure 9" label was just dropped: its caption text follows

    def emit_chapter(plan: lx.ChapterPlan) -> None:
        nonlocal cur_chapter
        if plan.title != cur_chapter:
            cur_chapter = plan.title
            items.append(Item("chapter", plan.title))

    for n in body_pages:
        plan = chapter_by_page.get(n)
        if plan is None:
            continue
        h = heights[n]
        blocks = page_blocks[n]
        lx.merge_detached_drop_caps(blocks, body, dictionary())
        lx.mark_graphic_bullets(doc[n - 1], blocks, body)
        table_idx, table_words = detect_table_blocks(blocks, body)
        if table_idx:
            report["tables"].append({"page": n, "words": table_words})
            blocks = [b for bi, b in enumerate(blocks) if bi not in table_idx]
            if not blocks:
                continue
        eflags = epigraph_flags(blocks, body, margins[f"left{n % 2}"], margins["right"])
        report["epigraph_blocks"] += len({id(b) for b in blocks if any(id(l) in eflags for l in b)})
        flat = [l for b in blocks for l in b]
        next_line = {id(a): b for a, b in zip(flat, flat[1:])}
        chapter_norm = lx.norm(plan.title)
        sub_norms = {lx.norm(s) for s in plan.subtitles}
        toc_sections = {lx.norm(t) for t, p in plan.sections if p == n}
        on_start = plan.start_page == n
        # On a chapter's start page, text above the printed title belongs to the previous chapter.
        title_idx = None
        if on_start and items:
            for bi, block in enumerate(blocks):
                tn = lx.norm(" ".join(l.text for l in block))
                if tn and (tn in chapter_norm or re.match(r"^chapter \d+$", tn)) and block[0].size >= body * 0.95:
                    title_idx = bi
                    break
        prev_plan = next((p for p in plans if p.title == cur_chapter), None)
        for bi, block in enumerate(blocks):
            owner = plan
            if on_start and title_idx is not None and bi < title_idx and prev_plan is not None \
                    and sum(word_count(" ".join(l.text for l in b)) for b in blocks[:title_idx]) >= 40:
                owner = prev_plan
            emit_chapter(owner)
            while len(block) > 1 and lx.ROMAN_OR_DIGIT_RE.match(block[-1].text.strip()) and block[-1].y1 > h * 0.90:
                block = block[:-1]
                report["removed"]["page_furniture"] += 1
            while len(block) > 1 and lx.ROMAN_OR_DIGIT_RE.match(block[0].text.strip()) and block[0].y0 < h * 0.11:
                block = block[1:]
                report["removed"]["page_furniture"] += 1
            text_block = " ".join(l.text for l in block).strip()
            tn = re.sub(r"\d+", "#", lx.norm(text_block))
            in_margin = block[0].y0 < h * 0.11 or block[-1].y1 > h * 0.90
            if lx.WATERMARK_RE.match(text_block):
                report["removed"]["watermarks"] += 1
                continue
            if tn in repeated or (in_margin and (tn in margin_repeated or lx.ROMAN_OR_DIGIT_RE.match(text_block))):
                report["removed"]["page_furniture"] += 1
                continue
            if word_count(text_block) <= 5 and lx.PART_RE.match(text_block):
                report["removed"]["part_dividers"] += 1
                continue
            is_last_plan = plan is plans[-1] or owner is plans[-1]
            if is_last_plan and n > body_pages[0] + 2 and block[0].size >= body * 1.0 and word_count(text_block) <= 6 \
                    and (lx.BACKMATTER_HEAD_RE.match(text_block) or AD_HEAD_RE.match(text_block)):
                stopped_at = n
                report["back_matter"].append(_preview(doc, n, body_pages[-1] if body_pages[-1] >= n else n,
                                                      f"heading '{text_block}'"))
                break
            late = n >= body_pages[0] + 0.85 * len(body_pages)
            cut = next((k for k, l in enumerate(block) if late and BACK_LINE_RE.match(l.text.strip())), None)
            if cut is not None:
                stopped_at = n
                report["back_matter"].append(_preview(doc, n, n_pages, f"line '{block[cut].text.strip()[:60]}'"))
                report["back_matter"][-1]["starts"] = clean_inline(" ".join(l.text for l in block[cut:]))[:240]
                block = block[:cut]
                if not block:
                    break
                text_block = " ".join(l.text for l in block).strip()
            if block[0].size <= body * 0.9 and block[0].y0 > h * 0.55 and lx.FOOTNOTE_START_RE.match(text_block):
                report["footnotes"].append({"page": n, "text": clean_inline(join_lines([l.text for l in block]))})
                report["removed"]["footnote_text_moved_out"] += 1
                continue
            if is_scene_break(text_block):
                items.append(Item("break"))
                continue
            single = len(block) == 1
            drop_caption_block = caption_pending and statistics.median(l.size for l in block) <= body * 0.95
            caption_pending = False
            i = 0
            while i < len(block):
                line = block[i]
                if id(line) in absorbed:
                    i += 1
                    continue
                if len(line.text.strip()) <= 2 and line.text.strip().isalpha() and line.size >= body * 1.6:
                    pending_cap.append(line.text.strip())
                    i += 1
                    continue
                if drop_caption_block and line.size <= body * 0.95:
                    # The caption text under a bare "Figure 9" label, in smaller type.
                    report["removed"]["figure_or_exhibit_labels"] += 1
                    i += 1
                    continue
                if is_caption_line(line.text, line.italic, line.size < body * 0.97):
                    j = i + 1
                    while j < len(block) and block[j].italic == line.italic and abs(block[j].size - line.size) < 0.4 \
                            and (line.italic or line.size < body * 0.97) and id(block[j]) not in eflags:
                        j += 1
                    report["removed"]["figure_or_exhibit_labels"] += 1
                    report.setdefault("dropped", []).append({"page": n, "reason": "figure_caption",
                                                             "text": clean_inline(" ".join(l.text for l in block[i:j]))[:200]})
                    if not CAPTION_START_RE.sub("", line.text.strip(), count=1).strip(" :.\u2014\u2013-"):
                        caption_pending = True
                    i = j
                    continue
                flag = eflags.get(id(line))
                if flag:
                    items.append(Item("line", line.text, n, line.x0, line.x1, line.y0, line.y1, line.size, line.block,
                                      line.italic, bold=line.bold, epi=True, attr=(flag == "attr")))
                    i += 1
                    continue
                if is_scene_break(line.text.strip()):
                    items.append(Item("break"))
                    report["removed"]["ornaments_and_rules"] += 1
                    i += 1
                    continue
                kind = lx._heading_candidate(line, body, bold_frac, single, i == 0, run_in_ok=len(block) > 1,
                                             following=next_line.get(id(line)))
                if kind:
                    j = i + 1
                    parts = [line.text.strip()]
                    while j < len(block) and kind != "bold" and abs(block[j].size - line.size) < 0.4 \
                            and block[j].bold == line.bold and sum(word_count(x) for x in parts) < 14 \
                            and (kind == "size" or lx._heading_candidate(block[j], body, bold_frac, single, False, False) == kind):
                        parts.append(block[j].text.strip())
                        j += 1
                    tail = block[j - 1]
                    nl = next_line.get(id(tail))
                    while kind != "bold" and nl is not None and id(nl) not in absorbed and j >= len(block) \
                            and abs(nl.size - line.size) < 0.4 and nl.bold == line.bold \
                            and 0 <= nl.y0 - tail.y1 < 0.9 * line.size and sum(word_count(x) for x in parts) < 14 \
                            and not re.search(r"[.!?][\"”’)]*$", " ".join(parts)):
                        parts.append(nl.text.strip())
                        absorbed.add(id(nl))
                        tail, nl = nl, next_line.get(id(nl))
                    text = clean_inline(" ".join(parts))
                    tnorm = lx.norm(text)
                    if title and tnorm == lx.norm(title) and tnorm not in toc_sections:
                        report["removed"]["book_title_running_head"] += 1
                    elif tnorm in toc_sections or (tnorm not in sub_norms and not lx._is_chapter_furniture(
                            tnorm, chapter_norm, on_start, bi, title_idx,
                            in_margin=line.y0 < h * 0.11 or line.y1 > h * 0.90)):
                        if is_dateline(text) or is_figure_caption(text) or lx.WATERMARK_RE.match(text):
                            report["removed"]["dateline_caption_or_watermark_heading"] += 1
                        elif kind != "size" and plan.sections and tnorm not in toc_sections \
                                and (re.search(r"\d", text) or lx_caps_ratio(text) < 0.2 and word_count(text) > 8):
                            # With an outline, a bold or caps line that is not in it is a heading only when it
                            # reads like one: figure labels, numbered labels and long bold lines are not.
                            report["removed"]["figure_or_exhibit_labels"] += 1
                        else:
                            items.append(Item("heading", text, n))
                            report["headings"].append({"page": n, "text": text, "kind": kind})
                    else:
                        report["removed"]["chapter_title_furniture"] += 1
                    i = j
                    continue
                tnorm = lx.norm(line.text)
                if on_start and lx._is_chapter_furniture(tnorm, chapter_norm, True, bi, title_idx) \
                        and word_count(line.text) <= 8 and (tnorm in chapter_norm or tnorm in sub_norms) \
                        and (not items or items[-1].kind in ("chapter", "heading")):
                    report["removed"]["chapter_title_furniture"] += 1
                    i += 1
                    continue
                item = Item("line", line.text, n, line.x0, line.x1, line.y0, line.y1, line.size, line.block, line.italic,
                            bold=line.bold, bullet=line.bullet)
                if pending_cap:
                    item.text = lx._join_drop_cap(pending_cap.pop(), item.text.lstrip())
                    report["removed"]["drop_caps_rejoined"] += 1
                items.append(item)
                i += 1
            if stopped_at is not None:
                break
        if stopped_at is not None:
            break
    # Back matter that the outline already excluded.
    last_body = body_pages[-1] if body_pages else n_pages
    if stopped_at is None and last_body < n_pages:
        report["back_matter"].append(_preview(doc, last_body + 1, n_pages, "outside the last chapter (outline)"))
    doc.close()
    report["removed"] = dict(report["removed"])
    report["_plans"], report["_body"] = plans, body
    return items


def _find_intro(doc: Any, plans: list[lx.ChapterPlan], body: float) -> lx.ChapterPlan | None:
    """An Introduction/Preface/Prologue that sits before the first outlined chapter but is missing from
    the outline: found by a large heading line, kept only if it holds real prose."""
    first = plans[0].start_page
    for n in range(1, first):
        h = doc[n - 1].rect.height
        for block in lx.read_page_blocks(doc[n - 1]):
            for line in block:
                t = line.text.strip()
                if lx.MAIN_UNNUMBERED_RE.match(t) and word_count(t) <= 4 and line.size >= body * 1.05 \
                        and line.y0 < h * 0.5:
                    words = sum(word_count(doc[m - 1].get_text("text")) for m in range(n, first))
                    if words >= 400:
                        return lx.ChapterPlan(t.title() if t.isupper() else t, n, first - 1, 1)
    return None


def _preview(doc: Any, first: int, last: int, why: str) -> dict:
    last = min(last, len(doc))
    words = 0
    snippet = ""
    for n in range(first, last + 1):
        t = doc[n - 1].get_text("text")
        words += word_count(t)
        if len(snippet) < 240:
            snippet += " " + clean_inline(t)
    return {"pages": [first, last], "words": words, "why": why, "starts": snippet.strip()[:240]}


# ----------------------------------------------------------------------------
# Plain text reading
# ----------------------------------------------------------------------------

MD_EMPH_RE = re.compile(r"(\*\*|__)(.+?)\1|(?<![\w*])\*(?!\s)([^*\n]+?)(?<!\s)\*(?![\w*])|(?<![\w])_(?!\s)([^_\n]+?)(?<!\s)_(?![\w])")


def strip_markdown_emphasis(text: str) -> str:
    return MD_EMPH_RE.sub(lambda m: m.group(2) or m.group(3) or m.group(4) or "", text)


def terminal_density(text: str) -> float:
    """Sentence-ending marks per 100 words (a punctuated transcript or book is well above 2)."""
    w = word_count(text)
    return 100 * len(re.findall(r"[.!?…](?:[\"”’')\]]*)(?:\s|$)", text)) / w if w else 0.0


_SPEAKER_RE = re.compile(r"^(?:\*\*)?[A-Z][\w .'’-]{1,40}:(?:\*\*)?\s+")
SHINGLE_N = 6
DUPLICATE_MIN_WORDS = 60
DUPLICATE_OVERLAP = 0.5


def norm_words(text: str) -> list[str]:
    return re.findall(r"[a-z0-9]+", text.lower().replace("'", "").replace("’", ""))


def shingles(words: list[str], n: int = SHINGLE_N) -> set[str]:
    return {" ".join(words[i:i + n]) for i in range(max(0, len(words) - n + 1))}


def duplicate_overlap(words: list[str], seen: set[str]) -> float:
    sh = shingles(words)
    return len(sh & seen) / len(sh) if sh else 0.0


def split_duplicate_head(lines: list[str], seen: set[str], seen_text: str, all_words: list[str]
                         ) -> tuple[list[str], list[str]]:
    """The turns at the start of a duplicate block that are NOT in the first copy (the first copy was cut off
    before them) are kept; they are recognised only when every one of them is new text AND the same words
    reappear at the end of the duplicate (where the first copy lost them). Returns (kept lines, unmatched)."""
    head: list[str] = []
    for line in lines:
        body = _SPEAKER_RE.sub("", line, count=1)
        w = norm_words(body)
        if len(w) < 3 or not ends_terminal(body) and not re.search(r"[.!?]$", body.strip()):
            break
        novel = duplicate_overlap(w, seen) < 0.2 and " ".join(w) not in seen_text
        if not novel:
            break
        head.append(line)
    if not head:
        return [], []
    group = " ".join(" ".join(norm_words(_SPEAKER_RE.sub("", l, count=1))) for l in head)
    tail = " ".join(all_words[-(len(group.split()) + 120):])
    if group in tail:
        return head, []
    return [], head


def text_items(raw: str, report: dict) -> list[Item]:
    """Plain text: blank lines are the layout signal. Unpunctuated blocks are reported, never guessed."""
    report.update({"format": "txt", "chapter_detection": "single", "headings": [], "back_matter": [],
                   "front_matter": [], "warnings": [], "removed": {}, "unsupported_blocks": [],
                   "duplicate_blocks": [], "sponsor_reads_removed": 0, "punct_artifacts_collapsed": 0})
    # Transcript artifact: a question or exclamation mark followed by a stray full stop ("?.", "!.").
    raw, n_art = re.subn(r"(?<=[?!])\.(?=\s|$)", "", raw)
    report["punct_artifacts_collapsed"] = n_art
    blocks = []
    for b in re.split(r"\n\s*\n", raw.replace("\r\n", "\n")):
        # A speaker label (**Name:**) is a layout signal: each turn is its own block.
        blocks.extend(x for x in re.split(r"\s*(?=\*\*[A-Z][^*\n]{1,40}:\*\*)", b) if x.strip())
    items: list[Item] = []
    seen: set[str] = set()
    seen_words: list[str] = []
    for bi, block in enumerate(blocks):
        cleaned = strip_markdown_emphasis(block)
        lines = [l.strip() for l in cleaned.splitlines() if l.strip()]
        joined = join_lines(lines)
        words = word_count(joined)
        if re.fullmatch(r"(?:#{1,6}\s*)?[-*_=]{3,}|\*\s*\*\s*\*", joined):
            items.append(Item("break"))
            continue
        md = re.match(r"^#{1,6}\s+(.+)$", joined)
        if md:
            items.append(Item("heading", md.group(1).strip(), 0))
            report["headings"].append({"page": None, "text": md.group(1).strip(), "kind": "markdown"})
            continue
        if len(lines) == 1 and 0 < words <= 10 and not ends_terminal(joined) and not ends_colon(joined) \
                and not re.search(r"[,;]$", joined) and joined[:1].isupper() and bi + 1 < len(blocks) \
                and not re.match(r"^[A-Z][\w .'-]{0,40}:\s", joined):
            items.append(Item("heading", joined, 0))
            report["headings"].append({"page": None, "text": joined, "kind": "short_line"})
            continue
        bw = norm_words(joined)
        if words >= DUPLICATE_MIN_WORDS and seen and duplicate_overlap(bw, seen) >= DUPLICATE_OVERLAP:
            kept, unmatched = split_duplicate_head(lines, seen, " ".join(seen_words), bw)
            report["duplicate_blocks"].append({
                "block": bi, "words": words, "overlap": round(duplicate_overlap(bw, seen), 3),
                "starts": joined[:100], "kept_leading_turns": len(kept),
                "unmatched_leading_turns": [u[:100] for u in unmatched]})
            lines = kept
            if not lines:
                continue
            joined = join_lines(lines)
            words = word_count(joined)
            bw = norm_words(joined)
        elif words >= 150 and terminal_density(joined) < 1.0:
            # Lines of the block that are properly punctuated (a short turn in front of an unpunctuated dump)
            # are real text and stay; only the unpunctuated lines are left out.
            good = [l for l in lines if terminal_density(l) >= 1.0 and word_count(l) < 150]
            bad = [l for l in lines if l not in good]
            if len(lines) > 1 and good and bad:
                lines = good
                bad_words = sum(word_count(l) for l in bad)
                report["unsupported_blocks"].append({"block": bi, "words": bad_words, "starts": bad[0][:120],
                                                     "why": "unpunctuated text: no sentence boundaries to detect"})
                items.append(Item("break"))
                joined = join_lines(lines)
                bw = norm_words(joined)
            else:
                report["unsupported_blocks"].append({"block": bi, "words": words, "starts": joined[:120],
                                                     "why": "unpunctuated text: no sentence boundaries to detect"})
                items.append(Item("break"))
                continue
        seen |= shingles(bw)
        seen_words.extend(bw)
        for k, line in enumerate(lines):
            line, gone = strip_sponsor_reads(line)
            if gone:
                report["sponsor_reads_removed"] += gone
            if not line:
                continue
            # Blank line before the block = layout signal on its first line. Physical wraps inside a
            # block are NOT a signal, so they always join (the hyphen rule applies on join).
            items.append(Item("line", line, 0, 0, 0, 0, 0, 12.0, bi, False, signal=(k == 0)))
    total_words = sum(word_count(b) for b in blocks)
    skipped = sum(u["words"] for u in report["unsupported_blocks"])
    dup_words = sum(d["words"] for d in report["duplicate_blocks"])
    report["unsupported_words"] = skipped
    report["duplicate_words"] = dup_words
    if total_words and skipped / total_words > 0.9:
        raise UnsupportedSource(f"{skipped} of {total_words} words are unpunctuated; no rule-based paragraphs")
    if skipped:
        report["warnings"].append(f"{len(report['unsupported_blocks'])} unpunctuated block(s) left out ({skipped} words)")
    if dup_words:
        report["warnings"].append(
            f"{len(report['duplicate_blocks'])} duplicate block(s) left out ({dup_words} words): a second copy of "
            "text already in the file")
    return items


def _merge_text_continuations(raws: list[RawPara]) -> list[RawPara]:
    """Blank-line blocks that do not end a sentence and are followed by a lowercase opener are one paragraph
    split by a page or a transcript break; the general rule (terminal AND capital) joins them."""
    out: list[RawPara] = []
    for r in raws:
        if out and out[-1].chapter == r.chapter and out[-1].section == r.section and not r.scene_break:
            prev_text = out[-1].text
            if not (ends_terminal(prev_text) or ends_colon(prev_text)) and not starts_paragraph(r.text):
                out[-1].lines.extend(r.lines)
                continue
        out.append(r)
    return out


# ----------------------------------------------------------------------------
# Driver for stage 1
# ----------------------------------------------------------------------------

def build_paragraphs(source_id: str, manifest: dict | None = None, path_override: Path | None = None
                     ) -> tuple[list[dict], dict]:
    entry = manifest_entry(source_id, manifest)
    path = path_override or source_path(entry)
    report: dict[str, Any] = {"source_id": source_id, "paragraph_version": PARAGRAPH_VERSION,
                              "footnote_markers_stripped": 0}
    fmt = (entry.get("format") or path.suffix.lstrip(".")).lower()
    if fmt == "pdf":
        items = pdf_items(path, report, entry.get("title"))
        raws = assemble(items)
    elif fmt in ("txt", "text", "md"):
        raw = path.read_text(encoding="utf-8", errors="replace")
        items = text_items(raw, report)
        for it in items:
            if it.kind == "chapter":
                break
        items.insert(0, Item("chapter", entry.get("title") or path.stem))
        raws = _merge_text_continuations(assemble(items))
    else:
        raise UnsupportedSource(f"Unsupported format: {fmt}")
    recs = make_records(raws, source_id, report)
    plans, body_size = report.pop("_plans", None), report.pop("_body", None)
    if plans and fmt == "pdf":
        recs = _attach_chapter_titles(path, plans, body_size, recs, report)
    # Glued-word repair (PDF text layers sometimes lose spaces).
    texts, fixes = repair_glued_words([r["text"] for r in recs])
    if fixes:
        for r, t in zip(recs, texts):
            r["text"] = t
        report["glued_words_repaired"] = fixes
    paras = finalize(recs, source_id)
    report["paragraph_count"] = len(paras)
    report["words"] = sum(p["word_count"] for p in paras)
    report["chapters"] = list(dict.fromkeys(p["chapter"] for p in paras))
    report["title"] = entry.get("title")
    report["author"] = clean_author(report.get("meta_author")) if fmt == "pdf" else None
    return paras, report


def _attach_chapter_titles(path: Path, plans: list, body: float, recs: list[dict], report: dict) -> list[dict]:
    """Bare labels ("CHAPTER TWO") get the printed title ("Chapter Two: <Title>") via the extractor's logic."""
    paras = [lx.Para(r["text"], r["page_start"], r["page_end"], r["chapter"], r["section"], r["kind"]) for r in recs]
    paras = lx._apply_chapter_titles(path, plans, paras, body, report)
    for r, p in zip(recs, paras):
        r["chapter"], r["section"] = p.chapter, p.section
    return recs


def write_jsonl(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as fh:
        for r in rows:
            fh.write(json.dumps(r, ensure_ascii=False) + "\n")


def read_jsonl(path: Path) -> list[dict]:
    if not path.exists():
        return []
    return [json.loads(l) for l in path.read_text(encoding="utf-8").splitlines() if l.strip()]


def archive_if_exists(path: Path, source_id: str, archive_root: Path | None = None,
                      label: str | None = None) -> Path | None:
    """Copy an existing output to _archive/<source_id>/<name>_<YYYYMMDD_HHMM> before it is overwritten."""
    import shutil
    import time
    if not path.exists() or path.stat().st_size == 0:
        return None
    root = Path(archive_root or HERE / "_archive") / source_id
    root.mkdir(parents=True, exist_ok=True)
    stem = label or path.stem
    dest = root / f"{stem}_{time.strftime('%Y%m%d_%H%M')}{path.suffix}"
    n = 1
    while dest.exists():
        dest = root / f"{stem}_{time.strftime('%Y%m%d_%H%M')}_{n}{path.suffix}"
        n += 1
    shutil.copy2(path, dest)
    return dest


def run_stage_paragraphs(source_id: str, library_dir: Path | None = None, manifest: dict | None = None,
                         archive_root: Path | None = None) -> dict:
    out_dir = source_dir(source_id, library_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    try:
        paras, report = build_paragraphs(source_id, manifest)
    except UnsupportedSource as exc:
        rep = {"source_id": source_id, "unsupported": str(exc), "paragraph_version": PARAGRAPH_VERSION}
        (out_dir / "paragraphs_v2_report.json").write_text(json.dumps(rep, indent=2), encoding="utf-8")
        return rep
    target = out_dir / "paragraphs_v2.jsonl"
    archive_if_exists(target, source_id, archive_root)
    write_jsonl(target, paras)
    (out_dir / "paragraphs_v2_report.json").write_text(
        json.dumps(report, indent=2, ensure_ascii=False, default=list), encoding="utf-8")
    return report


# ----------------------------------------------------------------------------
# Stage 2: reading windows
# ----------------------------------------------------------------------------

def _glued(prev: dict, cur: dict) -> bool:
    """True when a cut between prev and cur would separate a lead-in from its list."""
    return cur["kind"] == "list_item" or ends_colon(prev["text"])


def build_windows(paragraphs: list[dict], target: int = WINDOW_TARGET_WORDS, max_words: int = WINDOW_MAX_WORDS,
                  context_n: int = CONTEXT_PARAGRAPHS) -> list[dict]:
    """~target words per window, inside one chapter, cut only at paragraph boundaries.

    Cut choice: among legal cut points (never between a lead-in and its list), prefer a section
    heading change whose cumulative size is within 60%..140% of the target (closest to the target);
    otherwise the legal cut closest to the target. A remainder that fits within 130% of the target
    is taken whole; a remainder under 35% of the target is folded into the window before it.
    Epigraph paragraphs are skipped (not teachable text).
    """
    body = [p for p in paragraphs if p["kind"] != "epigraph"]
    chapters: list[list[dict]] = []
    for p in body:
        if not chapters or chapters[-1][0]["chapter"] != p["chapter"]:
            chapters.append([])
        chapters[-1].append(p)
    windows: list[dict] = []
    for chap in chapters:
        prev_tail: list[dict] = []        # context never crosses a chapter
        i = 0
        while i < len(chap):
            remaining = sum(p["word_count"] for p in chap[i:])
            if remaining <= 1.3 * target:
                end = len(chap)
            else:
                cum = 0
                cuts: list[tuple[int, int, bool]] = []     # (index, words so far, section change)
                for j in range(i, len(chap) - 1):
                    cum += chap[j]["word_count"]
                    nxt = chap[j + 1]
                    if _glued(chap[j], nxt):
                        continue
                    cuts.append((j + 1, cum, nxt.get("section") != chap[j].get("section")))
                    if cum > max_words:
                        break
                pool = [c for c in cuts if c[2] and 0.6 * target <= c[1] <= 1.4 * target]
                pool = pool or [c for c in cuts if c[1] <= max_words] or cuts[:1]
                end = min(pool, key=lambda c: abs(c[1] - target))[0] if pool else len(chap)
                rest = sum(p["word_count"] for p in chap[end:])
                if rest < 0.35 * target and sum(p["word_count"] for p in chap[i:end]) + rest <= max_words:
                    end = len(chap)
            members = chap[i:end]
            windows.append(_make_window(len(windows), members, prev_tail))
            prev_tail = members[-context_n:]
            i = end
    return windows


def _make_window(idx: int, members: list[dict], context: list[dict]) -> dict:
    sid = members[0]["source_id"]
    paras = [{"id": p["id"], "text": p["text"], "section": p.get("section"), "page": p.get("page"),
              "context_only": False} for p in members]
    ctx = [{"id": p["id"], "text": p["text"], "section": p.get("section"), "page": p.get("page"),
            "context_only": True} for p in context]
    wid = f"{sid}_w{idx:04d}"
    digest = hashlib.sha256(json.dumps(
        [(p["id"], p["text"], p["context_only"]) for p in ctx + paras], ensure_ascii=False).encode()).hexdigest()[:16]
    pages = [p["page_start"] for p in members if p.get("page_start")] + [p["page_end"] for p in members if p.get("page_end")]
    return {
        "window_id": wid, "source_id": sid, "index": idx, "chapter": members[0]["chapter"],
        "sections": list(dict.fromkeys(p["section"] for p in members if p.get("section"))),
        "page_start": min(pages) if pages else None, "page_end": max(pages) if pages else None,
        "word_count": sum(p["word_count"] for p in members),
        "context": ctx, "paragraphs": paras, "hash": digest,
    }


def run_stage_windows(source_id: str, library_dir: Path | None = None) -> list[dict]:
    out_dir = source_dir(source_id, library_dir)
    paras = read_jsonl(out_dir / "paragraphs_v2.jsonl")
    windows = build_windows(paras)
    write_jsonl(out_dir / "windows_v2.jsonl", windows)
    return windows
