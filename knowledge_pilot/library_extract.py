"""Generic source extraction for the Axiom library: PDF and plain text.

No per-book configuration. Chapters come from the PDF outline first, then
heading font-size/bold heuristics, then roughly fixed sections. Sections come
from outline entries or from heading typography. Everything that is not body
prose (headers, footers, page numbers, chapter titles, datelines, run-in
headings, figure captions, footnotes) is removed from the body and recorded in
the extraction report so nothing disappears silently.

Output is a list of Para objects (body paragraphs in reading order) plus a
report dict that becomes extraction.json.
"""

from __future__ import annotations

import re
import statistics
from collections import Counter
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

from library_text import (
    clean_inline, dictionary, is_attribution, is_dateline, is_figure_caption, is_photo_credit,
    looks_like_index, is_heading_like, repair_glued_words, is_bare_chapter_label, section_restates_chapter, strip_ascii_diagram, is_scene_break, split_runin_heading, is_sentence_complete, join_lines, strip_footnote_markers, word_count,
)

try:  # PyMuPDF is only needed for PDFs; text sources and tests work without it.
    import fitz  # type: ignore
except Exception:  # pragma: no cover
    fitz = None


class UnsupportedFormat(Exception):
    """Raised when a source cannot be extracted as text (scanned, unknown format)."""


@dataclass
class Para:
    text: str
    page_start: int | None
    page_end: int | None
    chapter: str
    section: str | None = None
    kind: str = "body"          # body | epigraph
    scene_break: bool = False   # a scene break (* * *) precedes this paragraph
    italic: bool = False
    chapter_untitled: bool = False   # the book prints no title for this chapter (only a number)

    @property
    def words(self) -> int:
        return word_count(self.text)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


# ----------------------------------------------------------------------------
# Chapter planning from the PDF outline
# ----------------------------------------------------------------------------

FRONT_RE = re.compile(
    r"^(?:title page|half title|cover|copyright|dedication|contents|table of contents|praise|"
    r"also by|about the (?:author|publisher|book)|newsletters?|welcome|epigraph|foreword|"
    r"acknowledg|photos?|list of|illustrations|credits|permissions|reading group|"
    r"sign up|keep reading|discover more|frontmatter|front matter|by the same author)", re.I)
BACK_RE = re.compile(
    r"^(?:notes?|endnotes?|references?(?: and notes)?|bibliography|index|appendix|appendices|"
    r"glossary|further reading|selected bibliography|resources|toolkit|about the author|"
    r"acknowledg|newsletters?|copyright|credits|permissions|sources|recommended reading|"
    r"photos?|illustrations|photo insert)", re.I)
PART_RE = re.compile(r"^\s*part\b", re.I)
CHAPTER_TITLE_RE = re.compile(
    r"^\s*(?:chapter|ch\.?)\s*(?:\d+|[ivxlc]+|one|two|three|four|five|six|seven|eight|nine|ten)\b"
    r"|^\s*\d{1,3}\s*[.:|–—-]\s*\S|^\s*\d{1,3}\s+[A-Z]", re.I)
MAIN_UNNUMBERED_RE = re.compile(
    r"^\s*(?:prologue|introduction|preface|epilogue|postscript|conclusion|afterword|final thoughts|coda|"
    r"the beginning|a note|author's note)\b", re.I)


def norm(text: str) -> str:
    return re.sub(r"[\W_]+", " ", text.lower()).strip()


@dataclass
class ChapterPlan:
    title: str
    start_page: int
    end_page: int
    level: int = 1
    sections: list[tuple[str, int]] = field(default_factory=list)  # (title, page)
    subtitles: list[str] = field(default_factory=list)


def plan_chapters_from_toc(toc: list[list], n_pages: int) -> list[ChapterPlan]:
    """Turn a PyMuPDF TOC ([level, title, page]) into chapter plans.

    Front/back matter and Part dividers are skipped. Entries on a chapter's own
    start page at the same or higher level are subtitles; deeper entries are
    sections. Returns [] if the outline does not look like chapters.
    """
    entries = [(int(l), str(t).strip(), int(p)) for l, t, p in toc if isinstance(p, int) and p >= 1 and str(t).strip()]
    if not entries:
        return []
    first_main = next((i for i, (_, t, _) in enumerate(entries)
                       if (CHAPTER_TITLE_RE.match(t) or MAIN_UNNUMBERED_RE.match(t)) and not PART_RE.match(t)), None)
    numbered_any = any(CHAPTER_TITLE_RE.match(t) and not PART_RE.match(t) and not BACK_RE.match(t)
                       and not FRONT_RE.match(t) for _, t, _ in entries)
    if first_main is None or not numbered_any:
        # Unnumbered chapter titles: take the shallowest level that is not Part/front matter.
        usable = [(l, t, p) for l, t, p in entries if not FRONT_RE.match(t) and not BACK_RE.match(t) and not PART_RE.match(t)]
        if len(usable) < 2:
            return []
        chapter_level = min(l for l, _, _ in usable)
        main = [(l, t, p) for l, t, p in usable if l == chapter_level]
    else:
        numbered = [(l, t, p) for l, t, p in entries if CHAPTER_TITLE_RE.match(t) and not PART_RE.match(t)
                    and not BACK_RE.match(t) and not FRONT_RE.match(t)]
        levels = Counter(l for l, _, _ in numbered)
        chapter_level = levels.most_common(1)[0][0] if levels else min(l for l, _, _ in entries)
        main = []
        numbered_pages = {p for l, t, p in numbered if l == chapter_level}
        for l, t, p in entries:
            if PART_RE.match(t) or BACK_RE.match(t) or FRONT_RE.match(t):
                continue
            if (CHAPTER_TITLE_RE.match(t) and l == chapter_level) or (MAIN_UNNUMBERED_RE.match(t) and l <= chapter_level):
                main.append((l, t, p))
            elif l == chapter_level and p not in numbered_pages and p > min(numbered_pages) \
                    and not any(p == m[2] for m in main):
                # Unnumbered entry between numbered chapters (e.g. "Postscript"): its own chapter.
                main.append((l, t, p))
    if len(main) < 2:
        return []
    # A Part page followed by several pages before the next chapter is a Part introduction essay.
    if first_main is not None:
        starts = sorted(p for _, _, p in main)
        for l, t, p in entries:
            if PART_RE.match(t) and p not in starts:
                later = [s for s in starts if s > p]
                if later and later[0] - p >= 3 and any(s < p for s in starts):
                    main.append((l, t, p))
    main.sort(key=lambda e: (e[2], entries.index(e)))
    # Boundaries: next entry (any kind) that ends a chapter at the chapter level or above.
    boundary_pages = sorted({p for l, t, p in entries if l <= chapter_level})
    plans: list[ChapterPlan] = []
    for i, (l, t, p) in enumerate(main):
        later = [bp for bp in boundary_pages if bp > p]
        # A back-matter entry deeper than chapter level cannot end a chapter; only <= chapter_level.
        nxt = later[0] if later else n_pages + 1
        plan = ChapterPlan(title=t, start_page=p, end_page=max(p, nxt - 1), level=l)
        for l2, t2, p2 in entries:
            if p2 < p or p2 > plan.end_page or (l2, t2, p2) == (l, t, p):
                continue
            if BACK_RE.match(t2) or FRONT_RE.match(t2):
                continue
            if l2 > chapter_level:
                plan.sections.append((t2, p2))
            elif p2 == p and not PART_RE.match(t2) and not CHAPTER_TITLE_RE.match(t2):
                plan.subtitles.append(t2)
        plans.append(plan)
    # Chapters that share a start page: the earlier one ends on that page too (mid-page start).
    for a, b in zip(plans, plans[1:]):
        if b.start_page == a.start_page:
            a.end_page = a.start_page
    return plans


# ----------------------------------------------------------------------------
# PDF page reading
# ----------------------------------------------------------------------------

@dataclass
class Line:
    text: str
    x0: float
    y0: float
    x1: float
    y1: float
    size: float
    bold: bool
    italic: bool
    block: int
    big_first: bool = False  # starts with a drop-cap sized span


def _is_bold(span: dict) -> bool:
    return bool(span["flags"] & 16) or bool(re.search(r"bold|black|heavy|semibold|demi", span["font"], re.I))


def _is_italic(span: dict) -> bool:
    return bool(span["flags"] & 2) or bool(re.search(r"italic|oblique", span["font"], re.I))


def _span_text(spans: list[dict]) -> str:
    out = ""
    for span in spans:
        value = span["text"]
        if span["flags"] & 1 and re.fullmatch(r"[-−]?\d+", value.strip()):
            # Superscript number: a note reference, unless it is an exponent after 10 or a unit.
            if re.search(r"(?:\b10|\b(?:m|cm|km|s))$", out):
                out += "^" + value.strip().replace("−", "-")
            continue
        out += value
    return re.sub(r"\bfn\d{1,3}\b", "", out)


def read_page_blocks(page: Any) -> list[list[Line]]:
    blocks: list[list[Line]] = []
    for bi, block in enumerate(page.get_text("dict", sort=True)["blocks"]):
        if "lines" not in block:
            continue
        lines: list[Line] = []
        for line in block["lines"]:
            spans = [s for s in line["spans"] if s["text"].strip() or s["text"]]
            text = _span_text(spans)
            if not text.strip():
                continue
            weight = Counter()
            bold_chars = italic_chars = total = 0
            for s in spans:
                n = len(s["text"].strip())
                if not n:
                    continue
                weight[round(s["size"], 1)] += n
                total += n
                bold_chars += n if _is_bold(s) else 0
                italic_chars += n if _is_italic(s) else 0
            if not total:
                continue
            size = weight.most_common(1)[0][0]
            first = next((s for s in spans if s["text"].strip()), spans[0])
            big_first = len(first["text"].strip()) <= 2 and first["size"] >= size * 1.6 and total > 3
            lines.append(Line(text=text, x0=line["bbox"][0], y0=line["bbox"][1], x1=line["bbox"][2],
                              y1=line["bbox"][3], size=size, bold=bold_chars >= total * 0.9,
                              italic=italic_chars >= total * 0.7, block=bi, big_first=big_first))
        if lines:
            blocks.append(lines)
    return blocks


def merge_detached_drop_caps(blocks: list[list[Line]], body: float, words: frozenset[str]) -> int:
    """Rejoin a lone oversized initial letter with the block it starts (geometry, not order)."""
    merged = 0
    for cap_block in list(blocks):
        if len(cap_block) != 1:
            continue
        cap = cap_block[0]
        letter = cap.text.strip()
        if not (len(letter) <= 2 and letter.isalpha() and cap.size >= body * 1.6):
            continue
        candidates = [b for b in blocks if b is not cap_block and re.match(r"[A-Za-z]", b[0].text.strip())
                      and b[0].size < body * 1.5 and b[0].x0 >= cap.x0 - 3
                      and -12 <= b[0].y0 - cap.y0 <= 50]
        if not candidates:
            continue
        target = min(candidates, key=lambda b: abs(b[0].y0 - cap.y0))
        target[0].text = _join_drop_cap(letter, target[0].text.lstrip())
        blocks.remove(cap_block)
        merged += 1
    return merged


def doc_style(doc: Any, pages: list[int]) -> tuple[float, float]:
    """Return (body_size, bold_fraction) sampled over the given 1-based pages."""
    sizes: Counter = Counter()
    bold = total = 0
    step = max(1, len(pages) // 60)
    for n in pages[::step]:
        for block in read_page_blocks(doc[n - 1]):
            for line in block:
                chars = len(line.text.strip())
                sizes[line.size] += chars
                total += chars
                if line.bold and line.size < 18:
                    bold += chars
    body = sizes.most_common(1)[0][0] if sizes else 12.0
    return body, (bold / total if total else 0.0)


# ----------------------------------------------------------------------------
# PDF extraction
# ----------------------------------------------------------------------------

WATERMARK_RE = re.compile(r"^\s*(?:OceanofPDF\.com|www\.\S+\.(?:com|org|net)|\S*(?:z-lib|libgen)\S*)\s*$", re.I)
BACKMATTER_HEAD_RE = re.compile(r"^(?:notes|endnotes|acknowledg\w*|index|bibliography|references|about the author)$", re.I)
ROMAN_OR_DIGIT_RE = re.compile(r"^(?:\d{1,4}|[ivxlcdm]{1,7})$", re.I)
FOOTNOTE_START_RE = re.compile(r"^(?:[*†‡§]|\d{1,3}[.)]?\s+\S|[¹²³])")


def _heading_candidate(line: Line, body: float, bold_frac: float, single_line_block: bool,
                      first_in_block: bool, run_in_ok: bool, following: Line | None = None) -> str | None:
    """Return heading kind ('size' | 'caps' | 'bold') or None."""
    text = line.text.strip()
    if text[:1].islower():
        return None  # mid-sentence fragment, never a heading
    if following is not None and following.text.strip()[:1].islower() and not line.big_first \
            and line.size < body * 1.12:
        return None  # a bold or caps line that flows into lowercase text is a sentence, not a heading
    n = word_count(text)
    if not text or n == 0 or n > 14 or ROMAN_OR_DIGIT_RE.match(text) or line.big_first:
        return None
    if re.search(r"[,;]$", text):
        return None
    if line.size >= body * 1.12 and not (n > 10 and text.endswith(".")):
        return "size"
    # Plain (not bold) ALL-CAPS line standing alone above real prose: a section heading.
    if single_line_block and not line.bold and following is not None:
        letters = re.sub(r"[^A-Za-z]", "", text)
        ftext = following.text.strip()
        if (text == text.upper() and n >= 2 and len(letters) >= 6 and n <= 10
                and not re.search(r"[\d$=%&@/\\\u2014\u2013]", text) and word_count(ftext) >= 6
                and ftext != ftext.upper() and ftext[:1].isupper()):
            return "caps"
    if line.bold and line.size >= body * 0.95 and bold_frac < 0.25:
        letters = re.sub(r"[^A-Za-z]", "", text)
        if letters and text == text.upper() and len(letters) >= 3:
            return "caps"
        # Plain bold at body size is a heading only when it stands alone on its own short line.
        if n <= 8 and not re.search(r"[.,;:!?]$", text) and single_line_block:
            return "bold"
    return None


def extract_pdf(path: Path, title: str | None = None, source_id: str = "") -> tuple[list[Para], dict[str, Any]]:
    if fitz is None:
        raise UnsupportedFormat("PyMuPDF is not installed")
    doc = fitz.open(path)
    n_pages = len(doc)
    report: dict[str, Any] = {"format": "pdf", "pages": n_pages, "removed": Counter(), "footnote_markers_stripped": 0,
                              "footnotes": [], "datelines_removed": [], "figure_captions_dropped": [],
                              "run_in_or_standalone_headings": [], "epigraphs_moved": [], "warnings": []}
    meta_author = (doc.metadata or {}).get("author") or None
    toc = doc.get_toc()
    plans = plan_chapters_from_toc(toc, n_pages)
    detection = "toc"
    pages_all = list(range(1, n_pages + 1))
    # Scanned / image-only check on a sample of pages.
    sample = pages_all[min(5, n_pages - 1)::max(1, n_pages // 40)][:40]
    sample_words = [word_count(doc[n - 1].get_text("text")) for n in sample] or [0]
    if statistics.mean(sample_words) < 30:
        raise UnsupportedFormat("No usable text layer (scanned or image-only PDF)")
    if plans:
        body_pages = list(range(plans[0].start_page, plans[-1].end_page + 1))
    else:
        body_pages = pages_all
    body, bold_frac = doc_style(doc, body_pages)
    report["body_font_size"] = body
    report["bold_fraction"] = round(bold_frac, 3)

    if not plans:
        plans, detection = plan_chapters_from_fonts(doc, body_pages, body)
        if plans:
            body_pages = list(range(plans[0].start_page, plans[-1].end_page + 1))
        else:
            detection = "fixed"
            start = _first_body_page(doc)
            plans = [ChapterPlan("Body", start, n_pages, 1)]
            body_pages = list(range(start, n_pages + 1))
    report["chapter_detection"] = detection

    # Pass 1: read every body page once; collect furniture statistics.
    page_blocks: dict[int, list[list[Line]]] = {}
    furniture: Counter = Counter()
    heights: dict[int, float] = {}
    for n in body_pages:
        blocks = read_page_blocks(doc[n - 1])
        page_blocks[n] = blocks
        h = doc[n - 1].rect.height
        heights[n] = h
        for block in blocks:
            text = " ".join(l.text for l in block)
            block_in_margin = block[0].y0 < h * 0.11 or block[-1].y1 > h * 0.90
            if word_count(text) <= 8 or (block_in_margin and word_count(text) <= 20):
                furniture[re.sub(r"\d+", "#", norm(text))] += 1
    margin_texts: Counter = Counter()
    for n in body_pages:
        for block in page_blocks[n]:
            if block[0].y0 < heights[n] * 0.11 or block[-1].y1 > heights[n] * 0.90:
                text = " ".join(l.text for l in block)
                if 1 <= word_count(text) <= 14:
                    margin_texts[re.sub(r"\d+", "#", norm(text))] += 1
    repeated = {k for k, c in furniture.items() if k and c >= max(5, int(len(body_pages) * 0.25))}
    margin_repeated = {k for k, c in furniture.items() if k and c >= max(4, int(len(body_pages) * 0.12))}
    # A running head repeats verbatim (page number aside) in the margin; body text never does.
    margin_repeated |= {k for k, c in margin_texts.items() if k.strip("# ") and c >= 3}

    chapter_by_page: dict[int, ChapterPlan] = {}
    for plan in plans:
        for n in range(plan.start_page, plan.end_page + 1):
            chapter_by_page.setdefault(n, plan)
    start_pages = {p.start_page: p for p in plans}

    paras: list[Para] = []
    cur_chapter = plans[0].title
    cur_section: str | None = None
    pending_scene_break = False
    pending_cap: list[str] = []
    absorbed: set[int] = set()
    stopped = False
    # The previous chapter owns body text that sits above a mid-page chapter title.
    prev_plan: ChapterPlan | None = None

    for n in body_pages:
        if stopped:
            break
        plan = chapter_by_page.get(n)
        if plan is None:
            continue
        h = heights[n]
        blocks = page_blocks[n]
        report["removed"]["detached_drop_caps_rejoined"] += merge_detached_drop_caps(blocks, body, dictionary())
        flat_lines = [l for b in blocks for l in b]
        next_line = {id(a): b for a, b in zip(flat_lines, flat_lines[1:])}
        toc_sections = {norm(t) for t, p in plan.sections if p == n}
        chapter_norm = norm(plan.title)
        sub_norms = {norm(s) for s in plan.subtitles}
        on_start_page = plan.start_page == n
        # Where does the chapter title sit on its own start page? Blocks above it with real prose
        # belong to the previous chapter (mid-page chapter starts).
        title_block_idx = None
        if on_start_page and paras:
            for bi, block in enumerate(blocks):
                text_n = norm(" ".join(l.text for l in block))
                if text_n and (text_n in chapter_norm or re.match(r"^chapter \d+$", text_n)) and block[0].size >= body * 0.95:
                    title_block_idx = bi
                    break
        if plan.title != cur_chapter:
            prev_plan = next((p for p in plans if p.title == cur_chapter), None)
        seen_body_in_page = False
        for bi, block in enumerate(blocks):
            owner = plan
            if on_start_page and title_block_idx is not None and bi < title_block_idx:
                words_above = sum(word_count(" ".join(l.text for l in b)) for b in blocks[:title_block_idx])
                if words_above >= 40 and prev_plan is not None:
                    owner = prev_plan
            if owner.title != cur_chapter:
                cur_chapter = owner.title
                cur_section = None
                pending_scene_break = False
            # A bare page number sitting in the margin inside a larger block is furniture, not text.
            while len(block) > 1 and ROMAN_OR_DIGIT_RE.match(block[-1].text.strip()) and block[-1].y1 > h * 0.90:
                block = block[:-1]
                report["removed"]["headers_footers_page_numbers"] += 1
            while len(block) > 1 and ROMAN_OR_DIGIT_RE.match(block[0].text.strip()) and block[0].y0 < h * 0.11:
                block = block[1:]
                report["removed"]["headers_footers_page_numbers"] += 1
            text_block = " ".join(l.text for l in block).strip()
            tn = re.sub(r"\d+", "#", norm(text_block))
            in_margin = block[0].y0 < h * 0.11 or block[-1].y1 > h * 0.90
            if WATERMARK_RE.match(text_block):
                report["removed"]["watermarks"] += 1
                continue
            if tn in repeated or (in_margin and (tn in margin_repeated or ROMAN_OR_DIGIT_RE.match(text_block))):
                report["removed"]["headers_footers_page_numbers"] += 1
                continue
            if word_count(text_block) <= 5 and PART_RE.match(text_block):
                report["removed"]["part_dividers"] += 1
                continue
            if BACKMATTER_HEAD_RE.match(text_block) and plan is plans[-1] and word_count(text_block) <= 3 \
                    and block[0].size >= body * 1.05 and n > body_pages[0] + 2:
                stopped = True
                report["warnings"].append(f"Stopped at back-matter heading '{text_block}' on page {n}")
                break
            # Footnote text (small type at the bottom of the page, starting with a marker).
            if block[0].size <= body * 0.9 and block[0].y0 > h * 0.55 and FOOTNOTE_START_RE.match(text_block):
                report["footnotes"].append({"page": n, "text": clean_inline(join_lines([l.text for l in block]))})
                report["removed"]["footnote_text_moved_out"] += 1
                continue
            if is_scene_break(text_block):
                pending_scene_break = True
                continue
            # Walk lines: split heading runs from body runs.
            run: list[Line] = []
            single = len(block) == 1
            base_x = min(l.x0 for l in block)
            i = 0

            def flush_body(lines: list[Line]) -> None:
                nonlocal pending_scene_break, cur_section
                if not lines:
                    return
                for piece in _split_paragraph_lines(lines, base_x):
                    text = join_lines([l.text for l in piece])
                    text, removed = strip_footnote_markers(clean_inline(text))
                    report["footnote_markers_stripped"] += removed
                    if not text or ROMAN_OR_DIGIT_RE.match(text):
                        continue
                    if is_scene_break(text):
                        pending_scene_break = True
                        continue
                    if is_figure_caption(text) or is_photo_credit(text):
                        report["figure_captions_dropped"].append({"page": n, "text": text})
                        continue
                    if re.search(r"-{5,}|-{2,}>|\+-{3,}", text):
                        text, diagram = strip_ascii_diagram(text)
                        report["removed"]["ascii_diagram_art"] += 1
                        if diagram:
                            report["figure_captions_dropped"].append({"page": n, "text": diagram, "why": "diagram"})
                        if not text:
                            continue
                    if looks_like_index(text):
                        report["removed"]["index_or_page_reference_debris"] += 1
                        continue
                    runin = split_runin_heading(text)
                    if runin:
                        head, text = runin
                        _claim_trailing_epigraph(paras, cur_chapter, head, report)
                        cur_section = head
                        report["run_in_or_standalone_headings"].append({"page": n, "text": head, "kind": "runin_caps"})
                    dl = re.match(r"^((?:January|February|March|April|May|June|July|August|September|October|November|December)"
                                  r"\s+\d{1,2},?\s+\d{4})\s+(?=[A-Z“\"])", text)
                    if dl and word_count(text) - word_count(dl.group(1)) >= 8:
                        report["datelines_removed"].append({"page": n, "text": dl.group(1)})
                        text = text[dl.end():]
                    if is_dateline(text):
                        report["datelines_removed"].append({"page": n, "text": text})
                        continue
                    if pending_cap:
                        text = _join_drop_cap(pending_cap.pop(), text)
                        report["removed"]["detached_drop_caps_rejoined"] += 1
                    ital = sum(1 for l in piece if l.italic) >= len(piece) * 0.7
                    _append_paragraph(paras, Para(text, n, n, cur_chapter, cur_section, "body",
                                                  pending_scene_break, ital))
                    pending_scene_break = False

            while i < len(block):
                line = block[i]
                if id(line) in absorbed:
                    i += 1
                    continue
                # Detached drop cap: a lone big letter in its own block (check before headings).
                if len(line.text.strip()) <= 2 and line.text.strip().isalpha() and line.size >= body * 1.6:
                    pending_cap.append(line.text.strip())
                    i += 1
                    continue
                kind = _heading_candidate(line, body, bold_frac, single, i == 0, run_in_ok=len(block) > 1,
                                          following=next_line.get(id(line)))
                if kind:
                    # Gather wrapped heading lines of the same style.
                    j = i + 1
                    parts = [line.text.strip()]
                    while j < len(block) and kind != "bold" and abs(block[j].size - line.size) < 0.4 \
                            and block[j].bold == line.bold and sum(word_count(x) for x in parts) < 14 \
                            and (kind == "size" or _heading_candidate(block[j], body, bold_frac, single, False, False) == kind):
                        parts.append(block[j].text.strip())
                        j += 1
                    # A heading that wraps into the next block (lines can arrive as separate blocks).
                    tail = block[j - 1]
                    nl = next_line.get(id(tail))
                    while kind != "bold" and nl is not None and id(nl) not in absorbed \
                            and j >= len(block) and abs(nl.size - line.size) < 0.4 and nl.bold == line.bold \
                            and 0 <= nl.y0 - tail.y1 < 0.9 * line.size and sum(word_count(x) for x in parts) < 14 \
                            and not is_sentence_complete(" ".join(parts)):
                        parts.append(nl.text.strip())
                        absorbed.add(id(nl))
                        tail, nl = nl, next_line.get(id(nl))
                    flush_body(run)
                    run = []
                    text = clean_inline(" ".join(parts))
                    tnorm = norm(text)
                    if tnorm in toc_sections or (kind in ("size", "caps", "bold") and tnorm not in sub_norms
                                                 and not _is_chapter_furniture(tnorm, chapter_norm, on_start_page, bi, title_block_idx)):
                        if is_dateline(text):
                            report["datelines_removed"].append({"page": n, "text": text})
                        elif is_figure_caption(text):
                            report["figure_captions_dropped"].append({"page": n, "text": text})
                        elif WATERMARK_RE.match(text):
                            report["removed"]["watermarks"] += 1
                        elif kind != "size" and plan.sections and tnorm not in toc_sections:
                            # The outline lists this chapter's sections; a bold/caps label that is not one of
                            # them is a figure or exhibit label, not a section. Out of the body, not a section.
                            report["removed"]["figure_or_exhibit_labels"] += 1
                        else:
                            _claim_trailing_epigraph(paras, cur_chapter, text, report)
                            cur_section = text
                            report["run_in_or_standalone_headings"].append({"page": n, "text": text, "kind": kind})
                    else:
                        report["removed"]["chapter_title_furniture"] += 1
                    i = j
                    continue
                # A chapter-number/title line at body size on a start page.
                tnorm = norm(line.text)
                if on_start_page and _is_chapter_furniture(tnorm, chapter_norm, True, bi, title_block_idx) \
                        and word_count(line.text) <= 8 and (tnorm in chapter_norm or tnorm in sub_norms) and not run:
                    report["removed"]["chapter_title_furniture"] += 1
                    i += 1
                    continue
                run.append(line)
                i += 1
            flush_body(run)

    paras = [p for p in paras if p.words > 0]
    doc.close()
    paras = _tag_epigraphs(paras, report)
    paras = _relocate_trailing_epigraphs(paras, plans, report)
    paras = _drop_trailing_heading_debris(paras, report)
    paras = _repair_glued(paras, report)
    if detection == "fixed":
        paras = _assign_fixed_sections(paras)
    paras = _apply_chapter_titles(doc_path=path, plans=plans, paras=paras, body=body, report=report)
    report["chapters"] = [{"title": p.title, "start_page": p.start_page, "end_page": p.end_page,
                           "sections_in_outline": len(p.sections)} for p in plans] if detection != "fixed" else []
    report["meta_author"] = meta_author
    report["removed"] = dict(report["removed"])
    return paras, report


def find_chapter_title(blocks: list[list[Line]], label: str, body: float) -> str | None:
    """The title printed under a bare chapter label ("CHAPTER TWO" / "Lesson One: The Rich Don't Work For Money")."""
    target = norm(label)
    for bi, block in enumerate(blocks):
        lines = [l.text.strip() for l in block]
        if norm(lines[0]) != target:
            continue
        rest = block[1:]
        if not rest and bi + 1 < len(blocks):
            rest = blocks[bi + 1]
        if not rest:
            return None
        first = rest[0]
        parts = [first.text.strip()]
        for nxt in rest[1:3]:   # a title may wrap onto a second line of the same size
            joined = " ".join(parts)
            dangling = joined.rstrip().endswith((":", "-", "—")) or \
                joined.split()[-1].lower().strip(",") in {"of", "the", "and", "a", "an", "in", "to", "for", "on", "or",
                                                          "at", "by", "with", "from", "as", "is", "that"}
            if abs(nxt.size - first.size) < 0.4 and nxt.bold == first.bold and word_count(joined) < 12 and dangling:
                parts.append(nxt.text.strip())
            else:
                break
        title = re.sub(r":(?=\S)", ": ", clean_inline(" ".join(parts)))
        n = word_count(title)
        if not title or n > 14 or title[:1].islower() or ROMAN_OR_DIGIT_RE.match(title):
            return None
        if re.search(r"[.!,;]$", title) or is_dateline(title) or is_figure_caption(title):
            return None
        full = max((l.x1 for l in rest), default=first.x1) - min((l.x0 for l in rest), default=first.x0)
        short_line = len(rest) > 1 and (first.x1 - first.x0) < 0.75 * full and word_count(title) <= 10
        styled = short_line or first.size >= body * 1.05 or first.bold or title == title.upper() \
            or all(w[0].isupper() or w.lower() in {"of", "the", "and", "a", "an", "in", "to", "for", "on", "or", "is",
                                                    "it", "at", "by", "with", "from", "don't", "do", "not", "your", "my"}
                   or not w[0].isalpha() for w in title.split())
        return title if styled else None
    return None


def _apply_chapter_titles(doc_path: Path, plans: list[ChapterPlan], paras: list[Para], body: float,
                          report: dict) -> list[Para]:
    """Carry the printed chapter title in the chapter field ("Chapter Two: <Title>") and drop section
    labels that only repeat the chapter. A book that prints only numbers keeps the bare label, marked untitled."""
    bare = [p for p in plans if is_bare_chapter_label(p.title)]
    renames: dict[str, str] = {}
    untitled: set[str] = set()
    if bare and fitz is not None:
        doc = fitz.open(doc_path)
        try:
            for plan in bare:
                title = None
                for pn in range(plan.start_page, min(plan.start_page + 3, len(doc) + 1)):   # outlines are often a page early
                    title = find_chapter_title(read_page_blocks(doc[pn - 1]), plan.title, body)
                    if title:
                        break
                if title and norm(title) != norm(plan.title):
                    label = plan.title.title() if plan.title.isupper() else plan.title
                    renames[plan.title] = f"{label}: {title}"
                else:
                    untitled.add(plan.title)
        finally:
            doc.close()
    for p in paras:
        old = p.chapter
        if p.section and (section_restates_chapter(p.section, old)
                          or section_restates_chapter(p.section, renames.get(old))):
            p.section = None
        if old in renames:
            p.chapter = renames[old]
        elif old in untitled:
            p.chapter_untitled = True
    # A section left over that repeats the new chapter title.
    for p in paras:
        if p.section and section_restates_chapter(p.section, p.chapter):
            p.section = None
    if renames:
        report["chapter_titles_attached"] = renames
    if untitled:
        report["chapters_without_title"] = sorted(untitled)
    return paras


def _repair_glued(paras: list[Para], report: dict) -> list[Para]:
    new_texts, fixes = repair_glued_words([p.text for p in paras])
    if fixes:
        for p, t in zip(paras, new_texts):
            p.text = t
        report["glued_words_repaired"] = fixes
    return paras


def _drop_trailing_heading_debris(paras: list[Para], report: dict) -> list[Para]:
    """A bare title-like line left at the end of a section or chapter, directly after prose, is a
    stray heading, running head, picture caption or the next chapter's number. It is not body text
    and cannot end a chunk, so it is taken out (and recorded in the report for audit)."""
    out: list[Para] = []
    dropped = 0
    for i, p in enumerate(paras):
        nxt = paras[i + 1] if i + 1 < len(paras) else None
        boundary = nxt is not None and (nxt.chapter != p.chapter or nxt.section != p.section)
        prev = out[-1] if out else None
        if (boundary and p.kind == "body" and not p.scene_break and prev is not None
                and prev.chapter == p.chapter and prev.kind == "body" and prev.words >= 12
                and is_sentence_complete(prev.text)
                and (is_heading_like(p.text) or re.search(r"^[^()]*\)$", p.text.strip()) and p.words <= 8)):
            report["removed"]["trailing_heading_debris"] = report["removed"].get("trailing_heading_debris", 0) + 1
            report.setdefault("trailing_heading_debris", []).append(
                {"page": p.page_start, "chapter": p.chapter, "text": p.text})
            dropped += 1
            continue
        out.append(p)
    return out


def _claim_trailing_epigraph(paras: list[Para], chapter: str, new_section: str, report: dict) -> None:
    """A quotation + attribution directly above a section heading is that section's epigraph."""
    if not paras or paras[-1].chapter != chapter or not is_attribution(paras[-1].text):
        return
    group = [paras[-1]]
    if len(paras) >= 2 and paras[-2].chapter == chapter and paras[-2].words <= 90 and not is_attribution(paras[-2].text):
        group.insert(0, paras[-2])
    if sum(p.words for p in group) > 130:
        return
    for p in group:
        p.section = new_section
        p.kind = "epigraph"
    report["epigraphs_moved"].append({"to_section": new_section, "text": " ".join(p.text for p in group)[:160]})


def _is_chapter_furniture(tnorm: str, chapter_norm: str, on_start_page: bool, bi: int, title_idx: int | None) -> bool:
    """A heading-like line that only restates the chapter title/number (anywhere in the chapter)."""
    if not tnorm:
        return False
    core = re.sub(r"^(?:chapter|ch|part)\s+\w+\s*", "", chapter_norm).strip()
    if len(core) >= 6 and tnorm == core:
        return True
    if not on_start_page:
        return False
    if tnorm in chapter_norm or chapter_norm in tnorm:
        return True
    return bool(re.fullmatch(r"(?:chapter|part)\s+\w+|\d+", tnorm))


LIST_ITEM_LINE_RE = re.compile(r"^(?:[•●▪◦]\s*\S|\d{1,2}[.)]\s+[A-Z]|(?:Lesson|Step|Rule|Principle|Tip)\s*#\s*\d+\b)")


def _split_paragraph_lines(lines: list[Line], base_x: float) -> list[list[Line]]:
    pieces: list[list[Line]] = []
    current: list[Line] = []
    for line in lines:
        if current:
            prev = current[-1]
            complete = is_sentence_complete(prev.text)
            if is_attribution(line.text):
                pieces.append(current)   # "—Name" under a quotation is its own paragraph
                current = [line]
                continue
            if is_figure_caption(line.text) or is_figure_caption(prev.text):
                pieces.append(current)   # a caption line is its own piece, never glued to prose
                current = []
                current.append(line)
                continue
            if LIST_ITEM_LINE_RE.match(line.text) and (complete or not re.match(r"\d", line.text)):
                pieces.append(current)   # each list entry is its own paragraph
                current = [line]
                continue
            indent = line.x0 > base_x + 0.5 * line.size and line.x0 > prev.x0 + 0.4 * line.size
            gap = line.y0 - prev.y1 > 0.55 * line.size
            if complete and (indent or gap):
                pieces.append(current)
                current = []
        current.append(line)
    if current:
        pieces.append(current)
    return pieces


def _join_drop_cap(letter: str, text: str) -> str:
    """Rejoin a detached initial ("T" + "he old...") using the dictionary as a tiebreak."""
    words = dictionary()
    m = re.match(r"[A-Za-z]+", text)
    tail = m.group(0).lower() if m else ""
    if letter.lower() in ("a", "i") and tail and tail not in words and (letter + tail).lower() in words:
        return letter + text
    if letter.lower() in ("a", "i") and tail in words and (letter + tail).lower() not in words:
        return letter + " " + text
    return letter + text


def _append_paragraph(paras: list[Para], new: Para) -> None:
    if paras:
        last = paras[-1]
        # A lowercase opener on the next page continues the previous paragraph even when an outline
        # entry (chapter or section) starts on that page: the heading sits below, the text belongs above.
        if (last.kind == "body" and new.text[:1].islower() and not new.scene_break
                and (last.chapter != new.chapter or last.section != new.section)
                and not is_sentence_complete(last.text)
                and 0 <= (new.page_start or 0) - (last.page_end or 0) <= 1):
            last.text = join_lines([last.text, new.text])
            last.page_end = new.page_end
            return
        # A long paragraph that stops on a lowercase word or a comma has not ended, even when the PDF
        # started a new text block (same page) for the rest of the sentence.
        open_ended = bool(re.search(r"[a-z,;][”\"’]?$", last.text.rstrip())) and word_count(last.text) >= 12
        if (last.kind == "body" and last.chapter == new.chapter and last.section == new.section
                and not new.scene_break and not is_sentence_complete(last.text)
                and (new.page_start != last.page_end or new.text[:1].islower() or open_ended)
                and (new.text[:1].islower() or last.text.rstrip().endswith(("-", ",")) or open_ended
                     or (new.page_start or 0) > (last.page_end or 0))):
            last.text = join_lines([last.text, new.text])
            last.page_end = new.page_end
            return
    paras.append(new)


def _tag_epigraphs(paras: list[Para], report: dict) -> list[Para]:
    """Mark short italic/attributed quotations at the head of a chapter as epigraphs."""
    out_idx = 0
    by_chapter: dict[str, list[int]] = {}
    for i, p in enumerate(paras):
        by_chapter.setdefault(p.chapter, []).append(i)
    for chapter, idxs in by_chapter.items():
        for k, i in enumerate(idxs[:3]):
            p = paras[i]
            if p.section is not None:
                break
            if p.words <= 90 and (p.italic or is_attribution(p.text)):
                p.kind = "epigraph"
                if is_attribution(p.text) and k > 0 and paras[idxs[k - 1]].words <= 90:
                    paras[idxs[k - 1]].kind = "epigraph"   # the quotation above its attribution
            elif p.words > 90:
                break
    return paras


def _relocate_trailing_epigraphs(paras: list[Para], plans: list[ChapterPlan], report: dict) -> list[Para]:
    """A quotation at the very end of a chapter belongs to the NEXT chapter."""
    order = list(dict.fromkeys(p.chapter for p in paras))
    for ci, chapter in enumerate(order[:-1]):
        idxs = [i for i, p in enumerate(paras) if p.chapter == chapter]
        if len(idxs) < 3:
            continue
        tail = idxs[-1]
        if not is_attribution(paras[tail].text):
            continue
        group = [tail]
        if paras[tail - 1].words <= 90 and tail - 1 > idxs[0]:
            group.insert(0, tail - 1)
        if sum(paras[i].words for i in group) > 120:
            continue
        next_chapter = order[ci + 1]
        moved = [paras[i] for i in group]
        for p in moved:
            p.chapter = next_chapter
            p.section = None
            p.kind = "epigraph"
            p.scene_break = False
        report["epigraphs_moved"].append({"from": chapter, "to": next_chapter, "text": " ".join(p.text for p in moved)[:160]})
        rest = [p for j, p in enumerate(paras) if j not in group]
        first_next = next(k for k, p in enumerate(rest) if p.chapter == next_chapter)
        # Keep any epigraph already at the head of the next chapter after the moved one.
        rest[first_next:first_next] = moved
        paras = rest
    return paras


def _assign_fixed_sections(paras: list[Para], target_words: int = 3500) -> list[Para]:
    """No outline and no usable headings: divide into roughly fixed sections."""
    count, k, acc = 0, 1, 0
    for p in paras:
        if acc >= target_words and is_sentence_complete(p.text):
            k += 1
            acc = 0
        p.chapter = f"Section {k}"
        acc += p.words
    return paras


def plan_chapters_from_fonts(doc: Any, pages: list[int], body: float) -> tuple[list[ChapterPlan], str]:
    """Heading heuristics: chapter openers are large, short lines near the top of a page."""
    cands: list[tuple[int, str]] = []
    for n in pages:
        h = doc[n - 1].rect.height
        lines = [l for b in read_page_blocks(doc[n - 1]) for l in b]
        big = [l for l in lines if l.size >= body * 1.4 and l.y0 < h * 0.45 and word_count(l.text) <= 14 and not l.big_first]
        if not big:
            continue
        # Chapter opener pages have little body text above the big line.
        above = sum(word_count(l.text) for l in lines if l.y1 < big[0].y0)
        if above > 25:
            continue
        title = clean_inline(" ".join(l.text for l in big[:3]))
        cands.append((n, title))
    # Keep openers at least 3 pages apart.
    kept: list[tuple[int, str]] = []
    for n, t in cands:
        if kept and n - kept[-1][0] < 3:
            continue
        kept.append((n, t))
    if len(kept) < 3:
        return [], "none"
    plans = []
    for i, (n, t) in enumerate(kept):
        end = kept[i + 1][0] - 1 if i + 1 < len(kept) else pages[-1]
        plans.append(ChapterPlan(t, n, end, 1))
    return plans, "font"


def _first_body_page(doc: Any) -> int:
    for n in range(1, min(len(doc), 25) + 1):
        text = doc[n - 1].get_text("text")
        if word_count(text) > 150 and not re.search(r"all rights reserved|isbn|library of congress|table of contents", text, re.I):
            return n
    return 1


# ----------------------------------------------------------------------------
# Plain text sources (transcripts, articles)
# ----------------------------------------------------------------------------

def _pack_caption_dump(lines: list[str], target: int = 120) -> list[str]:
    """Caption/transcript dumps: one sentence per physical line, the full stop sometimes written at the
    start of the NEXT line (". and once Warren was..."). Move it back to the end of its own sentence,
    then pack whole sentences into paragraphs of about `target` words. No sentence is split or invented."""
    sentences: list[str] = []
    for line in lines:
        t = line.strip()
        if t.startswith(". ") or t == ".":
            if sentences and not sentences[-1].endswith((".", "!", "?")):
                sentences[-1] += "."
            t = t[1:].strip()
        if t:
            sentences.append(t)
    if sentences and not sentences[-1].endswith((".", "!", "?", "\"", "”")):
        sentences[-1] += "."
    packed: list[str] = []
    cur: list[str] = []
    words = 0
    for sent in sentences:
        cur.append(sent)
        words += word_count(sent)
        if words >= target:
            packed.append(" ".join(cur))
            cur, words = [], 0
    if cur:
        packed.append(" ".join(cur))
    return packed


def extract_text_file(path: Path, title: str | None = None) -> tuple[list[Para], dict[str, Any]]:
    raw = path.read_text(encoding="utf-8", errors="replace")
    report: dict[str, Any] = {"format": "txt", "chapter_detection": "single", "warnings": [], "removed": {},
                              "footnote_markers_stripped": 0, "footnotes": [], "datelines_removed": [],
                              "figure_captions_dropped": [], "run_in_or_standalone_headings": [], "epigraphs_moved": []}
    blocks = [b for b in re.split(r"\n\s*\n", raw.replace("\r\n", "\n")) if b.strip()]
    if blocks and max(word_count(b) for b in blocks) > 900 and len(raw.splitlines()) > 5:
        # Caption dumps arrive with no blank lines: fall back to physical lines.
        report["warnings"].append("No blank-line paragraphs; split on physical lines. Text is unpunctuated, expect QA review.")
        blocks = _pack_caption_dump([l for l in raw.splitlines() if l.strip()])
    chapter = title or path.stem
    paras: list[Para] = []
    pending_break = False
    for block in blocks:
        text = join_lines(block.splitlines())
        text, removed = strip_footnote_markers(text)
        report["footnote_markers_stripped"] += removed
        if not text:
            continue
        if is_scene_break(text):
            pending_break = True
            continue
        paras.append(Para(text, None, None, chapter, None, "body", pending_break))
        pending_break = False
    paras = _repair_glued(paras, report)
    return paras, report


def extract_source(path: Path, fmt: str, title: str | None = None, source_id: str = "") -> tuple[list[Para], dict[str, Any]]:
    fmt = (fmt or path.suffix.lstrip(".")).lower()
    if fmt == "pdf":
        return extract_pdf(path, title, source_id)
    if fmt in ("txt", "text", "md"):
        return extract_text_file(path, title)
    raise UnsupportedFormat(f"Unsupported format: {fmt}")
