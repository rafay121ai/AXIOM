"""Tests for the v3.1 general layout rules (lists, tables, captions, ornaments, spacing, epigraphs, OCR noise,
transcripts, page-top text). Synthetic input only; no source names."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))

import library_paragraphs as lp  # noqa: E402
import library_text as lt  # noqa: E402
from library_paragraphs import Item  # noqa: E402

fitz = pytest.importorskip("fitz")


def ln(text, x0=72, y0=100, page=1, size=11, block=0, x1=500, bullet=False, italic=False, bold=False, **kw):
    return Item("line", text, page, x0, x1, y0, y0 + size, size, block, italic, bold=bold, bullet=bullet, **kw)


GEO = lp.Geometry(median_gap=3.0, blocks_informative=True, short_valid=False, right_margin=520.0, default_base_x=72.0)


def paras(items):
    return [r.text for r in lp.assemble(items, GEO)]


def recs(items):
    report: dict = {}
    return lp.make_records(lp.assemble(items, GEO), "s", report), report


# (1) LISTS ----------------------------------------------------------------------------------------

def test_list_after_colon_starts_new_paragraph_and_items_are_separate():
    items = [ln("There are three rules:", y0=100), ln("1. Start small and test it today.", y0=114),
             ln("2. Ask ten customers.", y0=128), ln("3. Write down what happened.", y0=142)]
    assert paras(items) == ["There are three rules:", "1. Start small and test it today.", "2. Ask ten customers.",
                            "3. Write down what happened."]


def test_long_bullet_is_never_split_mid_item():
    items = [ln("Consider the following:", y0=100),
             ln("• First item has a long sentence that wraps. It then", x0=72, y0=114, bullet=False),
             ln("continues here. And Another sentence starts after a stop.", x0=90, y0=128, x1=520),
             ln("• Second item.", y0=142)]
    out = paras(items)
    assert len(out) == 3 and out[1].endswith("starts after a stop.") and out[2] == "• Second item."


def test_drawn_bullets_and_sub_bullets_are_own_paragraphs():
    items = [ln("Points:", y0=100), ln("Parent item that wraps onto", y0=114, bullet=True),
             ln("a second line.", x0=90, y0=128), ln("Child item.", x0=90, y0=142, bullet=True),
             ln("Next parent.", x0=72, y0=156, bullet=True)]
    assert paras(items) == ["Points:", "Parent item that wraps onto a second line.", "Child item.", "Next parent."]


def test_indented_paragraph_after_colon_line_splits():
    items = [ln("He wrote this:", y0=100), ln("The first sentence of the quote runs on", x0=90, y0=114)]
    assert len(paras(items)) == 2


def test_colon_followed_by_plain_continuation_stays_joined():
    items = [ln("He wrote this:", y0=100), ln("and then continued in lower case.", y0=114)]
    assert len(paras(items)) == 1


# (2) TABLES ---------------------------------------------------------------------------------------

def _table_page_lines(cell_text):
    out = []
    for r in range(5):
        for c in range(3):
            out.append(Item("line", f"{cell_text} {r}{c}", 1, 72 + c * 150, 72 + c * 150 + 60, 200 + r * 20, 210 + r * 20,
                            11, r * 3 + c, False))
    return out


def test_table_regions_are_detected_and_not_prose(tmp_path):
    doc = fitz.open()
    page = doc.new_page(width=595, height=842)
    page.insert_text((72, 100), "Plain prose line of the chapter that goes on for a while here.", fontsize=11)
    for r in range(5):
        for c in range(3):
            page.insert_text((72 + c * 150, 200 + r * 20), f"Cell {r}{c}", fontsize=11)
    import library_extract as lx
    blocks = lx.read_page_blocks(page)
    idx, words = lp.detect_table_blocks(blocks, 11.0)
    assert idx and words >= 10
    kept = [b for i, b in enumerate(blocks) if i not in idx]
    assert any("Plain prose" in l.text for b in kept for l in b)


def test_prose_page_is_not_a_table():
    doc = fitz.open()
    page = doc.new_page(width=595, height=842)
    for r in range(8):
        page.insert_text((72, 100 + r * 14), "A normal line of running prose that fills the page width ok.", fontsize=11)
    import library_extract as lx
    assert lp.detect_table_blocks(lx.read_page_blocks(page), 11.0)[0] == set()


# (3) FIGURES / CAPTIONS ---------------------------------------------------------------------------

def test_glued_figure_label_is_stripped_from_paragraph_start():
    assert lt.strip_leading_label("Figure 9.5 This then fully explains the point.") == ("This then fully explains the point.", True)
    assert lt.strip_leading_label("Table 3 shows the results.") == ("Table 3 shows the results.", False)
    assert lt.strip_leading_label("Exhibit 4 The market in 2010.")[1] is True


def test_lone_caption_line_is_dropped_and_never_a_heading():
    items = [ln("Body text before the figure ends here.", y0=100),
             ln("Figure 2.1 Revenue by quarter", y0=140, block=1, size=11, italic=True),
             ln("Body continues in a new sentence.", y0=170, block=2)]
    out, rep = recs(items)
    assert not any("Figure" in r["text"] for r in out)
    assert not any("Figure" in str(r["section"]) for r in out)
    assert lt.is_caption_line("Exhibit 7: Market share", False, True)
    assert not lt.is_caption_line("Table 3 shows that sales grew sharply last year.")


# (4) SCENE BREAKS / ORNAMENTS ---------------------------------------------------------------------

def test_ornament_and_dash_blocks_are_scene_breaks():
    for t in ["* * *", "***", "— — —", "-----", "•", "◆ ◆ ◆", "~"]:
        assert lt.is_scene_break(t), t
    assert not lt.is_scene_break("A real line.")


def test_bullet_separator_between_blocks_splits():
    out, _ = recs([ln("He left the room. • She stayed behind and thought.")])
    assert [r["text"] for r in out] == ["He left the room.", "She stayed behind and thought."]


def test_break_item_is_hard_boundary():
    items = [ln("The scene ends.", y0=100), Item("break"), ln("A new scene starts.", y0=114)]
    assert paras(items) == ["The scene ends.", "A new scene starts."]


# (5) SPACING --------------------------------------------------------------------------------------

def test_spacing_dash_and_punctuation():
    assert lt.tidy_spacing("humility —humility") == "humility—humility"
    assert lt.tidy_spacing("Complexity . It grew , and then : stop") == "Complexity. It grew, and then: stop"
    assert lt.tidy_spacing("Wait . . . what") == "Wait . . . what"


# (6) EPIGRAPHS ------------------------------------------------------------------------------------

def test_attribution_and_credit_lines():
    assert lt.is_attribution_line("—JOHANN WOLFGANG GOETHE")
    assert lt.is_attribution_line("TRANSLATED BY A. TRANSLATOR")
    assert not lt.is_attribution_line("—and then he said no.")


def test_epigraphs_are_kind_epigraph_and_never_merge():
    items = [ln("Quote one, set apart and italic.", x0=150, y0=100, italic=True, epi=True, block=0, x1=400),
             ln("—SOME AUTHOR", x0=250, y0=114, epi=True, attr=True, block=0, x1=400),
             ln("Quote two follows and is also set apart.", x0=150, y0=140, italic=True, epi=True, block=1, x1=400),
             ln("Body text begins here and is normal.", y0=170, block=2)]
    raws = lp.assemble(items, GEO)
    assert len(raws) == 3
    out, _ = recs(items)
    assert [r["kind"] for r in out] == ["epigraph", "epigraph", "body"]


def test_epigraph_block_detection_on_geometry():
    class L:  # minimal stand-in for library_extract.Line
        def __init__(s, t, x0, x1, y0, italic):
            s.text, s.x0, s.x1, s.y0, s.y1, s.size, s.italic, s.bold, s.block = t, x0, x1, y0, y0 + 11, 11, italic, False, 0
    quote = [L("A line of wise words set far in", 160, 380, 100, True), L("from the margin and in italics.", 160, 380, 114, True)]
    attr = [L("—SOME AUTHOR", 260, 380, 140, False)]
    body = [L("Body text runs the full width of the page and ends.", 72, 520, 180, False)]
    flags = lp.epigraph_flags([quote, attr, body], 11.0, 72.0, 520.0)
    assert all(flags.get(id(l)) == "epi" for l in quote)
    assert flags.get(id(attr[0])) == "attr"
    assert id(body[0]) not in flags


def test_section_needs_typographic_signal():
    # An ordinary Title Case body line with body font size, not first after a chapter break, is not a heading.
    items = [Item("chapter", "Chapter 1"), ln("First body paragraph ends here.", y0=100),
             ln("Seven Rules Of Good Money", y0=150, size=11, block=3)]
    out, _ = recs(items)
    assert all(r["section"] is None for r in out)


# (7) OCR NOISE ------------------------------------------------------------------------------------

def test_ocr_noise_removed_but_real_letters_kept():
    t, n = lt.strip_ocr_noise("He went home ; and then slept , it was a day . she knew I was right")
    assert " ; " not in t and n >= 1
    assert "a day" in t and "I was" in t
    t2, n2 = lt.strip_ocr_noise("He asked ? and left.")
    assert " ? " not in t2 and n2 == 1
    t3, n3 = lt.strip_ocr_noise("Plan A or plan B and I agree.")
    assert t3 == "Plan A or plan B and I agree." and n3 == 0


# (8) TRANSCRIPTS ----------------------------------------------------------------------------------

def test_transcript_artifacts_sponsors_and_duplicates():
    report: dict = {}
    body = ("Intro sentence about the economy that is long enough to matter here. " * 1).strip()
    dup = " ".join(f"word{i}" for i in range(120)) + "."
    raw = (f"{body}\n\nIs that right?. Yes it is!. Fine.\n\nThis episode is brought to you by Acme Co. "
           "They make great tools. Learn more at acme.com/podcast. Back to the show now.\n\n" + dup + "\n\n" + dup)
    items = lp.text_items(raw, report)
    texts = " ".join(i.text for i in items if i.kind == "line")
    assert "?." not in texts and "!." not in texts
    assert "brought to you by" not in texts and "acme.com" not in texts
    assert "Back to the show now." in texts
    assert texts.count("word5 ") == 1
    assert report["duplicate_blocks"]


def test_sponsor_strip_promo_code():
    t, removed = lt.strip_sponsor_reads("Thanks for listening. Today's show is presented by Widgets. Use code PODCAST for ten percent off. Now the topic.")
    assert "Widgets" not in t and "PODCAST" not in t and "Now the topic." in t and removed > 0


# (9) PAGE-TOP TEXT --------------------------------------------------------------------------------

def test_page_top_indented_note_is_kept(tmp_path):
    """An indented body block inside the top 11% of the page (and not repeated) is text, not a running head."""
    doc = fitz.open()
    for n in range(8):
        page = doc.new_page(width=595, height=842)
        if n == 4:
            page.insert_text((120, 70), "Note that this will drop the old notation here since it only", fontsize=11)
            page.insert_text((120, 84), "refers to the second case.", fontsize=11)
        y = 130
        for r in range(10):
            page.insert_text((72, y), f"Ordinary body line {n}{r} of the chapter that runs on and on.", fontsize=11)
            y += 14
        if n == 5:
            page.insert_text((72, 100), "Short line after a colon:", fontsize=11)
    doc.save(tmp_path / "t.pdf")
    manifest = {"sources": [{"source_id": "t", "title": "T", "format": "pdf", "path": str(tmp_path / "t.pdf"),
                             "pillar": "x"}]}
    ps, _ = lp.build_paragraphs("t", manifest, tmp_path / "t.pdf")
    alltext = " ".join(p["text"] for p in ps)
    assert "Note that this will drop the old notation" in alltext
