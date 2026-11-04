"""Tests for the v3.2 general layout rules: page-top paragraphs after an initial, ragged vs justified line
ends, displayed blocks, label runs, sidebar vs chapter-opening epigraphs, note-marker separators, copyright
pages, small caps, typographic subheads, dash punctuation, equations. Synthetic input only; no source names."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))

import extract  # noqa: E402
import library_extract as lx  # noqa: E402
import library_paragraphs as lp  # noqa: E402
import library_text as lt  # noqa: E402
from library_paragraphs import Item  # noqa: E402


def ln(text, x0=72, y0=100, page=1, size=15, block=0, x1=500, bullet=False, italic=False, bold=False, **kw):
    return Item("line", text, page, x0, x1, y0, y0 + size, size, block, italic, bold=bold, bullet=bullet, **kw)


JUSTIFIED = lp.Geometry(median_gap=3.0, blocks_informative=True, short_valid=True, right_margin=500.0,
                        default_base_x=72.0)
RAGGED = lp.Geometry(median_gap=3.0, blocks_informative=True, short_valid=False, right_margin=500.0,
                     default_base_x=72.0)


def texts(items, geo=JUSTIFIED):
    report: dict = {}
    return [r["text"] for r in lp.make_records(lp.assemble(items, geo), "s", report)]


# (1) page-top paragraph with its own first-line indent -----------------------------------------------

def test_page_top_indented_paragraph_after_sentence_ending_in_a_lone_capital_is_not_glued():
    items = [ln("We combined the four choices, and most people prefer the combination of B and C.", y0=700, page=1),
             ln("You were asked to examine both options before making your first choice.", x0=87, y0=72, page=2),
             ln("and you probably did so. Then you moved on to the rest.", y0=90, page=2)]
    out = texts(items)
    assert len(out) == 2 and out[1].startswith("You were asked")


def test_lone_initial_without_indent_or_gap_stays_joined():
    items = [ln("It was signed by President Harry S.", y0=100), ln("Truman and then it was sent.", y0=118)]
    assert len(texts(items)) == 1


# (2) ragged-right text has no usable short-line signal -------------------------------------------------

def _body(x1s, indent=None):
    items = []
    for k, x1 in enumerate(x1s):
        items.append(ln(f"line {k} of text that goes on", x0=72, y0=100 + 18 * k, x1=x1))
    return items


def test_ragged_body_does_not_trust_short_lines_but_justified_body_does():
    ragged = _body([380, 450, 500, 410, 360, 480, 430, 500, 395, 470])
    justified = _body([500, 500, 499, 500, 500, 500, 440, 500, 500, 500])
    assert lp.compute_geometry(ragged).short_valid is False
    assert lp.compute_geometry(justified).short_valid is True


def test_short_line_before_capital_in_ragged_text_is_not_a_paragraph_end():
    items = [ln("The first sentence ends here and is short.", y0=100, x1=300),
             ln("Baruch started the second sentence on a new line.", y0=118, x1=480)]
    assert len(texts(items, RAGGED)) == 1


# (3) displayed blocks close as their own paragraph ---------------------------------------------------

def test_small_type_option_lines_are_their_own_paragraph_joined_with_slash():
    items = [ln("Now consider the following choice problem:", y0=100, x1=330),
             ln("AD. 25% chance to win $240 and 75% chance to lose $760", x0=100, y0=125, size=11, block=1, x1=370),
             ln("BC. 25% chance to win $250 and 75% chance to lose $750", x0=100, y0=138, size=11, block=1, x1=368),
             ln("This choice is easy! Option BC actually dominates option AD.", y0=160, block=2, x1=400)]
    out = texts(items)
    assert out == ["Now consider the following choice problem:",
                   "AD. 25% chance to win $240 and 75% chance to lose $760 / BC. 25% chance to win $250 and 75% chance to lose $750",
                   "This choice is easy! Option BC actually dominates option AD."]


def test_deep_indented_block_quote_is_closed_and_not_glued_to_next_body_paragraph():
    items = [ln("He set up a test jig that aimed a laser beam into the fiber to help him", x0=190, y0=100, x1=500, block=1),
             ln("align it. He had before him the clearest glass ever made.", x0=190, y0=118, x1=500, block=1),
             ln("Although not the final act of the story, this was the breakthrough.", x0=87, y0=150, block=2),
             ln("Optical transmission reduced the price of a vital human need.", x0=72, y0=168, block=2)]
    out = texts(items)
    assert len(out) == 2 and out[0].endswith("ever made.") and out[1].startswith("Although")


def test_first_line_indent_alone_is_not_a_display_block():
    items = [ln("An ordinary paragraph that begins with a first line indent and wraps", x0=87, y0=100, x1=500),
             ln("onto the second line without any indent at all.", x0=72, y0=118, x1=300)]
    assert len(texts(items)) == 1


def test_label_run_of_short_unpunctuated_lines_is_one_paragraph_with_slashes():
    items = [ln("Here is a diagram of the statement:", y0=100, x1=330),
             ln("Most people", x0=90, y0=118, x1=170), ln("Your Profession -> Your Income", x0=90, y0=136, x1=330),
             ln("The Rich", x0=90, y0=154, x1=150), ln("Your Assets -> Your Income", x0=90, y0=172, x1=300),
             ln("Our current educational system focuses on preparing the youth for jobs.", x0=87, y0=190, x1=500)]
    out = texts(items)
    assert out[1] == "Most people / Your Profession -> Your Income / The Rich / Your Assets -> Your Income"
    assert out[2].startswith("Our current") and len(out) == 3


def test_flowing_justified_lines_ending_short_without_period_are_not_labels():
    items = [ln("A paragraph that runs", y0=100, x1=500), ln("on across lines and then ends short", y0=118, x1=330),
             ln("Then the next line.", y0=136, x1=200)]
    assert all(" / " not in t for t in texts(items))


# (4) epigraphs only open a chapter or section ---------------------------------------------------------

def _epi(text, y0):
    return ln(text, x0=250, y0=y0, italic=True, epi=True, x1=450)


def test_epigraph_after_chapter_marker_stays_an_epigraph_and_one_before_the_heading_too():
    items = [Item("chapter", "One"), _epi("A quotation opening the chapter.", 100),
             Item("heading", "Section"), ln("Body text of the section.", y0=200)]
    assert lp.demote_sidebar_epigraphs(items) == 0 and items[1].epi
    items = [ln("Body of the previous section ends here.", y0=50), _epi("An epigraph above its title.", 100),
             Item("heading", "Next section"), ln("Body text.", y0=200)]
    assert lp.demote_sidebar_epigraphs(items) == 0 and items[1].epi


def test_indented_italic_sidebar_in_the_middle_of_body_text_stays_body():
    items = [Item("chapter", "One"), Item("heading", "Section"), ln("Body text of the section.", y0=100),
             _epi("A pull quote in the middle of the page that is long enough to be real prose and not debris.", 150), ln("More body text after it.", y0=200)]
    assert lp.demote_sidebar_epigraphs(items) == 1 and not items[3].epi
    out = [r.text for r in lp.assemble(items, JUSTIFIED)]
    assert "A pull quote in the middle of the page that is long enough to be real prose and not debris." in " ".join(out)


# (5) note markers and their separators ----------------------------------------------------------------

def _sp(text, flags=4):
    return {"text": text, "flags": flags, "font": "Serif", "size": 11}


def test_note_marker_run_leaves_no_separator():
    spans = [_sp("He had the clearest glass ever made.”"), _sp(" "), _sp("95", 5), _sp(" , "), _sp("96", 5)]
    assert lx._span_text(spans).strip() == "He had the clearest glass ever made.”"


def test_single_marker_followed_by_stray_comma_is_tidied():
    assert lt.tidy_spacing("ever made.”, Although not the final act") == "ever made.” Although not the final act"
    assert lt.tidy_spacing("he said, “Yes,” and left") == "he said, “Yes,” and left"


# (6) copyright / publishing details --------------------------------------------------------------------

def test_copyright_page_is_recognised_and_ordinary_prose_is_not():
    page = ("First published in 2020. Copyright © Jane Author. Paperback ISBN: 978-0-85719-768-9. "
            "British Library Cataloguing in Publication Data. All rights reserved; no part of this publication "
            "may be reproduced.")
    assert lp.is_copyright_page(page)
    assert not lp.is_copyright_page("The author argues that a founder should publish early. The ISBN of a book "
                                    "is a number.")


def test_copyright_pages_are_left_out_of_a_pdf_and_noted(tmp_path):
    fitz = pytest.importorskip("fitz")
    doc = fitz.open()
    for n in range(7):
        page = doc.new_page(width=595, height=842)
        y = 130
        if n == 5:
            for t in ("First published in 2020.", "Copyright (c) 2020 Jane Author", "Paperback ISBN: 978-0-85719-768-9",
                      "All rights reserved; no part of this publication may be reproduced.",
                      "A CIP catalogue record for this book is available from the British Library."):
                page.insert_text((72, y), t, fontsize=11)
                y += 14
            continue
        for r in range(12):
            page.insert_text((72, y), f"Ordinary body sentence number {n}{r} of the chapter goes on and on here.", fontsize=11)
            y += 14
    doc.save(tmp_path / "t.pdf")
    rep: dict = {}
    items = lp.pdf_items(tmp_path / "t.pdf", rep, "T")
    assert [c["page"] for c in rep["copyright_pages"]] == [6]
    assert not any("ISBN" in i.text for i in items)


# (7) small caps keep their case --------------------------------------------------------------------------

def test_small_caps_run_keeps_its_case():
    spans = [_sp("HARRIMAN HOUSE LTD", 4), _sp(" 3 Viceroy Court", 4)]
    assert lx._span_text(spans) == "HARRIMAN HOUSE LTD 3 Viceroy Court"
    assert lp.finish_text("THE first words of a Chapter in SMALL CAPS", {}) == "THE first words of a Chapter in SMALL CAPS"


# (8) typographic subheads -----------------------------------------------------------------------------------

def L(text, x0, x1, y0, bold=True, font="Sans-Bold", block=0, size=15):
    return lx.Line(text=text, x0=x0, y0=y0, x1=x1, y1=y0 + size, size=size, bold=bold, italic=False, block=block,
                   font=font)


BODY_LINE = L("That isn't true of, say, weather. A hurricane barreling down on Florida", 77, 535, 400, bold=False,
              font="Serif", block=9)


def test_centered_bold_sentence_subhead_over_several_blocks_is_a_heading():
    flat = [L("One is that money is ubiquitous, so something bad", 124, 488, 300, block=7),
            L("happening tends to affect everyone and captures everyone's", 90, 522, 318, block=7),
            L("attention.", 272, 340, 336, block=8), BODY_LINE]
    runs = lp.find_subhead_runs(flat, {}, 15, 0.05, "Serif", 77, 535)
    assert list(runs.values()) == [flat[:3]]


def test_bold_lead_in_inside_a_body_line_stays_body():
    lead = L("Rule one. The first rule is to start small and keep going", 77, 535, 300, bold=False, font="Serif")
    assert lp.find_subhead_runs([lead, BODY_LINE], {}, 15, 0.05, "Serif", 77, 535) == {}


def test_left_aligned_bold_in_the_body_typeface_is_not_a_subhead_here():
    flat = [L("A bold left aligned line in the body face", 77, 400, 300, font="Serif-Bold"), BODY_LINE]
    assert lp.find_subhead_runs(flat, {}, 15, 0.05, "Serif-Bold", 77, 535) == {}


def test_bold_heavy_book_has_no_subhead_rule():
    flat = [L("One is that money is ubiquitous", 124, 488, 300), BODY_LINE]
    assert lp.find_subhead_runs(flat, {}, 15, 0.6, "Serif", 77, 535) == {}


# (9) dash punctuation ----------------------------------------------------------------------------------------

def test_terminal_punctuation_after_a_dash_is_collapsed():
    assert lt.tidy_spacing("It was the—. Then we left.") == "It was the— Then we left."
    assert lt.tidy_spacing("I mean—, well.") == "I mean— well."
    assert lt.tidy_spacing("He left—and so did I.") == "He left—and so did I."
    assert lt.tidy_spacing("Wait—...") == "Wait—..."


def test_transcript_dash_artifact_counted(tmp_path):
    rep: dict = {}
    lp.text_items("We were going to—.\n\nThen the show ended. It was fine.\n", rep)
    assert rep["punct_artifacts_collapsed"] >= 1


# (10) figures and equations ---------------------------------------------------------------------------------

def test_equation_superscript_is_detected_but_text_is_left_as_is():
    spans = [_sp("D", 4), _sp("O", 5), _sp(" Q than ", 4)]
    assert lx.has_equation_sup(spans)
    assert lx._span_text(spans) == "DO Q than "
    assert not lx.has_equation_sup([_sp("note", 4), _sp("12", 5), _sp("th", 5), _sp("st", 5)])


def test_version_is_v32():
    assert extract.EXTRACT_VERSION == "v3.2" and extract.DEFAULT_VERSION == "v3.2"


# (11) a display block must be a block: it follows a finished sentence and is followed by a new paragraph -----

def test_indented_running_head_inside_a_sentence_does_not_cut_the_sentence():
    items = [ln("The firm kept growing through the years and the market for", y0=100, x1=500),
             ln("Some Book Title", x0=190, y0=118, x1=300),
             ln("its products grew with it until the end of the decade.", y0=136, x1=500)]
    out = texts(items)
    assert len(out) == 1 and out[0].endswith("end of the decade.")


def test_single_small_line_from_size_jitter_is_not_a_display_block():
    items = [ln("An ordinary line of body text that goes on and on and", y0=100, x1=500),
             ln("with one line set smaller by OCR jitter in the middle", y0=118, size=11, x1=500),
             ln("and then the sentence finishes here with a full stop.", y0=136, x1=330)]
    assert len(texts(items)) == 1


def test_label_line_followed_by_lowercase_text_is_not_a_label_run():
    items = [ln("A narrow ragged sidebar line that stops short", y0=100, x1=300),
             ln("Sky. There can be only", y0=118, x1=280),
             ln("one sun at a time and it never shares.", y0=136, x1=330)]
    assert all(" / " not in t for t in texts(items))


def test_demoted_sidebar_keeps_its_text_but_not_its_credit_line():
    quote = "A long enough quotation set in italics in the middle of a chapter, which is prose and not debris."
    items = [Item("chapter", "One"), Item("heading", "Section"), ln("Body text of the section.", y0=100),
             _epi(quote, 150), ln("-NAME OF THE AUTHOR, A BOOK", x0=300, y0=168, italic=True, epi=True, attr=True),
             ln("More body text after it.", y0=200)]
    assert lp.demote_sidebar_epigraphs(items) == 1
    assert not items[3].epi and items[4].epi and items[4].attr
