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
    clean_inline, dictionary, is_attribution, is_dateline, is_figure_caption, is_photo_credit,
    is_scene_break, join_lines, looks_like_index, repair_glued_words, strip_ascii_diagram,
    strip_footnote_markers, word_count,
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
    t = t.lstrip(OPENERS + " ")
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


def layout_signal(prev: Item, cur: Item, geo: Geometry) -> str | None:
    """Name of the layout signal between two consecutive body lines, or None."""
    if cur.signal is not None:
        return "explicit" if cur.signal else None
    size = cur.size or 12.0
    base = geo.base_x.get(cur.page, geo.default_base_x)
    if cur.x0 > base + 0.5 * size:
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


def should_split(prev: Item, cur: Item, geo: Geometry, para_first: Item | None = None) -> str | None:
    """The general rule. Returns the reason to start a new paragraph, or None to join the lines.
    para_first is the first line of the paragraph being built (used for the list-item exemption)."""
    sig = layout_signal(prev, cur, geo)
    if sig is None:
        return None
    if not starts_paragraph(cur.text):
        return None
    if ends_terminal(prev.text):
        return sig
    # A lone Title Case line (no terminal punctuation) standing apart from the next line is a heading.
    if para_first is prev and is_title_case_line(prev.text) and sig != "indent":
        return sig + "+title_line"
    # A list item (it opened with a bullet or number) rarely ends in a full stop. The text after the
    # list is a new paragraph when separated by a gap/block/short line; a bare indent is a hanging wrap.
    # Only a one-line item: a numbered paragraph that runs over several lines (numbered aphorisms) is prose.
    if para_first is not None and para_first is prev and is_list_start(para_first.text) and sig != "indent":
        return sig + "+after_list"
    # A lead-in colon followed by a list item that has a layout signal: the item is its own paragraph.
    if ends_colon(prev.text) and is_list_start(cur.text):
        return sig + "+colon_list"
    # A list item (bullet / number) followed by another list item: items rarely end in full stops.
    if is_list_start(prev.text) and is_list_start(cur.text):
        return sig + "+list"
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
        if cur is None or prev is None or should_split(prev, it, geo, cur.lines[0]):
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
    return text


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
    for raw in raws:
        text = finish_text(raw.text, report)
        if override and (override[0], override[1]) != (raw.chapter, raw.section):
            override = None
        if text and not raw.scene_break and is_title_case_line(text):
            override = (raw.chapter, raw.section, text)
            report.setdefault("headings", []).append({"page": raw.lines[0].page, "text": text, "kind": "title_case_paragraph"})
            continue
        if override:
            raw = RawPara(raw.lines, raw.chapter, override[2], raw.scene_break)
        pages = [l.page for l in raw.lines if l.page] or [None]
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
        kind = "list_item" if is_list_start(text) else "body"
        recs.append({
            "text": text, "chapter": raw.chapter, "section": raw.section,
            "page_start": min(pages) if pages[0] else None, "page_end": max(pages) if pages[0] else None,
            "kind": kind, "scene_break": raw.scene_break,
            "italic": sum(1 for l in raw.lines if l.italic) >= 0.7 * len(raw.lines),
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

    chapter_by_page: dict[int, lx.ChapterPlan] = {}
    for plan in plans:
        for n in range(plan.start_page, plan.end_page + 1):
            chapter_by_page.setdefault(n, plan)

    items: list[Item] = []
    cur_chapter: str | None = None
    stopped_at: int | None = None
    pending_cap: list[str] = []
    absorbed: set[int] = set()

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
                            tnorm, chapter_norm, on_start, bi, title_idx)):
                        if is_dateline(text) or is_figure_caption(text) or lx.WATERMARK_RE.match(text):
                            report["removed"]["dateline_caption_or_watermark_heading"] += 1
                        elif kind != "size" and plan.sections and tnorm not in toc_sections:
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
                item = Item("line", line.text, n, line.x0, line.x1, line.y0, line.y1, line.size, line.block, line.italic)
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


def text_items(raw: str, report: dict) -> list[Item]:
    """Plain text: blank lines are the layout signal. Unpunctuated blocks are reported, never guessed."""
    report.update({"format": "txt", "chapter_detection": "single", "headings": [], "back_matter": [],
                   "front_matter": [], "warnings": [], "removed": {}, "unsupported_blocks": []})
    blocks = []
    for b in re.split(r"\n\s*\n", raw.replace("\r\n", "\n")):
        # A speaker label (**Name:**) is a layout signal: each turn is its own block.
        blocks.extend(x for x in re.split(r"\s*(?=\*\*[A-Z][^*\n]{1,40}:\*\*)", b) if x.strip())
    items: list[Item] = []
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
        if words >= 150 and terminal_density(joined) < 1.0:
            report["unsupported_blocks"].append({"block": bi, "words": words, "starts": joined[:120],
                                                 "why": "unpunctuated text: no sentence boundaries to detect"})
            items.append(Item("break"))
            continue
        for k, line in enumerate(lines):
            # Blank line before the block = layout signal on its first line. Physical wraps inside a
            # block are NOT a signal, so they always join (the hyphen rule applies on join).
            items.append(Item("line", line, 0, 0, 0, 0, 0, 12.0, bi, False, signal=(k == 0)))
    total_words = sum(word_count(b) for b in blocks)
    skipped = sum(u["words"] for u in report["unsupported_blocks"])
    report["unsupported_words"] = skipped
    if total_words and skipped / total_words > 0.9:
        raise UnsupportedSource(f"{skipped} of {total_words} words are unpunctuated; no rule-based paragraphs")
    if skipped:
        report["warnings"].append(f"{len(report['unsupported_blocks'])} unpunctuated block(s) left out ({skipped} words)")
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
