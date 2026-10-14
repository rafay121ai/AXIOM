"""Tests for extract.py (phase 1). Offline, no API, no database. Synthetic PDFs are built with PyMuPDF."""

from __future__ import annotations

import json
import re
import sys
from collections import Counter
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import extract as ex  # noqa: E402
import library_paragraphs as lp  # noqa: E402
import library_text as lt  # noqa: E402

fitz = pytest.importorskip("fitz")

# --- fixtures: a small synthetic book ------------------------------------------------------------

LOREM = ("The founder who talks to ten customers a week learns faster than the founder who reads ten reports. "
         "Nobody can fake that advantage for long because the habit compounds in the open. "
         "Each conversation sharpens the next question and the next decision. "
         "That is why the author insists on starting small and starting today.")


def wrap(text: str, width: int = 70) -> list[str]:
    words, lines, cur = text.split(), [], ""
    for w in words:
        if len(cur) + len(w) + 1 > width:
            lines.append(cur)
            cur = w
        else:
            cur = (cur + " " + w).strip()
    if cur:
        lines.append(cur)
    return lines


def make_book(path: Path, chapters: list[tuple[str, list[str]]], running_head: str = "THE BOOK") -> None:
    """chapters: (title, paragraphs). Every chapter starts a new page; long chapters flow onto more pages.
    Paragraphs get a first-line indent. Page numbers and a running head are added."""
    doc = fitz.open()
    toc = []
    page_no = 0
    for title, paras in chapters:
        page = doc.new_page(width=595, height=842)
        page_no += 1
        toc.append([1, title, page_no])
        page.insert_text((72, 110), title, fontsize=22, fontname="hebo")
        y = 160.0

        def new_page():
            nonlocal page, page_no, y
            page = doc.new_page(width=595, height=842)
            page_no += 1
            y = 90.0

        for para in paras:
            lines = wrap(para)
            for k, line in enumerate(lines):
                if y > 740:
                    new_page()
                page.insert_text((72 + (18 if k == 0 else 0), y), line, fontsize=11, fontname="helv")
                y += 14.5
            y += 0.0
        # furniture on every page of the chapter
    for n, page in enumerate(doc, start=1):
        page.insert_text((250, 40), running_head, fontsize=8, fontname="helv")
        page.insert_text((290, 810), str(n), fontsize=9, fontname="helv")
    doc.set_toc(toc)
    doc.save(path)


def entry_for(path: Path, sid: str = "t-book", fmt: str = "pdf") -> dict:
    return {"source_id": sid, "path": str(path), "format": fmt, "title": "The Book", "status_hint": "pending"}


@pytest.fixture()
def book(tmp_path):
    paras = [LOREM, LOREM.replace("ten", "twelve"), "Start with one call. Then make another. " * 6,
             LOREM.replace("founder", "builder")]
    chapters = [("Chapter One", paras * 3), ("Chapter Two", paras * 3), ("Chapter Three", paras * 3),
                ("Acknowledgments", ["Thanks to everyone who read the draft. " * 5, "Thanks to my editor. " * 8])]
    p = tmp_path / "book.pdf"
    make_book(p, chapters)
    return p, chapters


# --- paragraph rule -------------------------------------------------------------------------------

def test_every_paragraph_exactly_once_and_ids(book):
    path, chapters = book
    res = ex.build_source(entry_for(path))
    assert res["status"] == "ok"
    paras = res["paragraphs"]
    ids = [p["id"] for p in paras]
    assert ids == [f"t-book_p{i:04d}" for i in range(len(paras))]
    assert len(set(ids)) == len(ids)
    assert all(p["kind"] == "body" for p in paras)
    # words of the three body chapters appear once each: counts match the source text
    expected = sum(len(x.split()) for _, ps in chapters[:3] for x in ps)
    assert sum(p["word_count"] for p in paras) == expected


def test_no_sentence_split_across_paragraphs(book):
    path, _ = book
    paras = ex.build_source(entry_for(path))["paragraphs"]
    for a, b in zip(paras, paras[1:]):
        if a["chapter"] == b["chapter"]:
            assert ex.TERMINAL_END_RE.search(a["text"]), a["text"][-60:]
            assert b["text"][0].isupper() or b["text"][0] in "\"“‘'(" or b["text"][0].isdigit()


def test_layout_signal_required_to_split():
    """Terminal punctuation plus a capital is NOT enough: without a layout signal the lines join."""
    def L(text, y, x=72.0, block=0):
        return lp.Item("line", text, 1, x, 500.0, y, y + 11, 11.0, block)
    items = [L("He stopped. It was late.", 100), L("Then he started again.", 112.5)]
    assert len(lp.assemble(items)) == 1
    items = [L("He stopped. It was late.", 100), L("Then he started again.", 112.5, x=90.0)]
    assert len(lp.assemble(items)) == 2          # first-line indent
    items = [L("He stopped and then", 100), L("Then he started again.", 125.0)]
    assert len(lp.assemble(items)) == 1          # gap but the previous line is not terminal


# --- headings never in the body -------------------------------------------------------------------

def test_headings_are_separate_and_not_in_body(book):
    path, _ = book
    res = ex.build_source(entry_for(path))
    texts = " ".join(p["text"] for p in res["paragraphs"])
    heads = res["headings"]
    assert {h["text"] for h in heads if h["level"] == "chapter"} >= {"Chapter One", "Chapter Two", "Chapter Three"}
    for h in heads:
        assert h["before_paragraph"] in {p["id"] for p in res["paragraphs"]}
    for title in ("Chapter One", "Chapter Two", "Chapter Three"):
        assert title not in texts
    assert "THE BOOK" not in texts                 # running head stripped


def test_page_numbers_and_running_heads_stripped(book):
    path, _ = book
    paras = ex.build_source(entry_for(path))["paragraphs"]
    for p in paras:
        assert not re.fullmatch(r"\d+", p["text"])
        assert "THE BOOK" not in p["text"]


# --- back matter and front matter -----------------------------------------------------------------

def test_back_matter_stripped_and_noted(book):
    path, _ = book
    res = ex.build_source(entry_for(path))
    assert not any("Thanks to" in p["text"] for p in res["paragraphs"])
    kinds = [e["kind"] for e in res["notes"]["excluded"]]
    assert "back_matter" in kinds
    entry = next(e for e in res["notes"]["excluded"] if e["kind"] == "back_matter")
    assert entry["pages"][0] <= entry["pages"][1]


def _rec(ch, text, page):
    return {"chapter": ch, "text": text, "page_start": page, "page_end": page, "kind": "body", "section": None}


def test_foreword_by_other_author_is_excluded_with_name():
    recs = [_rec("Foreword", "This book changed how I run my company. " * 10, 5),
            _rec("Foreword", "Jim Collins", 7),
            _rec("Chapter 1", "Body text starts here. It is real.", 9)]
    kept, excluded = ex.classify_chapters(recs, "Jane Doe", "")
    assert [r["chapter"] for r in kept] == ["Chapter 1"]
    assert excluded[0]["kind"] == "foreword_other_author" and excluded[0]["author"] == "Jim Collins"
    assert excluded[0]["pages"] == [5, 7]


def test_introduction_kept_when_by_main_author_dropped_when_by_someone_else():
    own = [_rec("Introduction", "I started this company in a garage. " * 5, 3), _rec("Introduction", "Jane Doe", 4)]
    kept, excluded = ex.classify_chapters(own, "Jane Doe", "")
    assert kept and not excluded
    other = [_rec("Introduction", "She taught me everything. " * 5, 3), _rec("Introduction", "Mark Smith", 4)]
    kept, excluded = ex.classify_chapters(other, "Jane Doe", "")
    assert not kept and excluded[0]["kind"] == "introduction_other_author" and excluded[0]["author"] == "Mark Smith"


# --- hyphen rule ----------------------------------------------------------------------------------

def make_rule(solid_in_book: dict[str, int] | None = None) -> ex.HyphenRule:
    return ex.HyphenRule(Counter(solid_in_book or {}), frozenset({"management", "business"}))


def join_with(rule, lines):
    lt.HYPHEN_DROP_HOOK = rule
    try:
        return lt.join_lines(lines)
    finally:
        lt.HYPHEN_DROP_HOOK = None


def test_hyphen_kept_for_compounds():
    rule = make_rule()
    assert join_with(rule, ["a very self-", "control matters"]) == "a very self-control matters"
    assert join_with(rule, ["the sixth-", "grader said"]) == "the sixth-grader said"
    assert "sixthgrader" not in join_with(rule, ["the sixth-", "grader said"])


def test_hyphen_dropped_for_dictionary_word():
    rule = make_rule()
    assert join_with(rule, ["good man-", "agement helps"]) == "good management helps"
    assert rule.dropped["management"] == 1


def test_hyphen_dropped_when_book_prints_the_word_solid_three_times():
    assert join_with(make_rule({"reorganise": 3}), ["we re-", "organise now"]) == "we reorganise now"
    assert join_with(make_rule({"reorganise": 2}), ["we re-", "organise now"]) == "we re-organise now"


def test_hyphen_kept_before_capital_and_in_compound_chain():
    rule = make_rule()
    assert join_with(rule, ["at Wells-", "Fargo today"]) == "at Wells-Fargo today"


def test_hook_is_off_by_default():
    assert lt.HYPHEN_DROP_HOOK is None
    assert lt.join_lines(["good man-", "agement"]) == "good man-agement"


def test_hook_is_reset_after_build(book):
    path, _ = book
    ex.build_source(entry_for(path))
    assert lt.HYPHEN_DROP_HOOK is None


# --- text sources and unsupported sources ----------------------------------------------------------

def test_txt_blank_lines_are_paragraphs(tmp_path):
    f = tmp_path / "t.txt"
    f.write_text("The first idea is simple. It takes one sentence.\n\nThe second idea follows. It matters more.\n\n"
                 "A third paragraph closes the talk. Nothing else.\n", encoding="utf-8")
    res = ex.build_source(entry_for(f, "t-txt", "txt"))
    assert res["status"] == "ok" and len(res["paragraphs"]) == 3


def test_unpunctuated_asr_is_unsupported_not_guessed(tmp_path):
    f = tmp_path / "asr.txt"
    f.write_text(("so we just kept going and nobody knew what would happen next " * 40 + "\n\n") * 3, encoding="utf-8")
    res = ex.build_source(entry_for(f, "t-asr", "txt"))
    assert res["status"] == "unsupported_text" and not res["paragraphs"]


def test_sentence_per_line_dump_without_blank_lines_is_unsupported(tmp_path):
    f = tmp_path / "s.txt"
    f.write_text("\n".join(f"This is short sentence number {i}." for i in range(40)), encoding="utf-8")
    assert ex.build_source(entry_for(f, "t-short", "txt"))["status"] == "unsupported_text"


def test_scanned_pdf_is_unsupported_format(tmp_path):
    p = tmp_path / "scan.pdf"
    doc = fitz.open()
    for _ in range(8):
        doc.new_page()
    doc.save(p)
    res = ex.build_source(entry_for(p, "t-scan"))
    assert res["status"] == "unsupported_format" and "text layer" in res["notes"]["reason"]


def test_duplicate_is_skipped():
    e = {"source_id": "dup", "path": "x.pdf", "format": "pdf", "status_hint": "duplicate", "duplicate_of": "other"}
    assert ex.build_source(e)["status"] == "skipped_duplicate"


# --- outputs ----------------------------------------------------------------------------------------

def test_write_source_archives_before_overwrite(book, tmp_path):
    path, _ = book
    entry = entry_for(path)
    out, arch = tmp_path / "lib", tmp_path / "arch"
    res = ex.build_source(entry)
    ex.write_source(res, entry, out, "v3", arch)
    assert (out / "t-book" / "paragraphs_v3.jsonl").exists()
    assert (out / "t-book" / "headings.jsonl").exists()
    notes = json.loads((out / "t-book" / "extraction_notes.json").read_text())
    assert notes["status"] == "ok"
    ex.write_source(res, entry, out, "v3", arch)
    assert list((arch / "t-book").glob("paragraphs_v3_*.jsonl"))


def test_swallowed_fragment_heading_returns_to_body():
    items = [lp.Item("line", "The sailors were straining their eyes for the plumes that announce", 1, 72, 500, 700, 711, 11),
             lp.Item("heading", "The Nantucket whalemen are straining their eyes for the steamy plumes", 1),
             lp.Item("line", "their quarry. The captain spots a boat.", 2, 72, 500, 70, 81, 11)]
    assert ex.demote_fragment_headings(items) == 1 and items[1].kind == "line"
