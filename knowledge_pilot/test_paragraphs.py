"""Tests for stages 1 and 2 (paragraphs and windows). Offline: no API, synthetic PDFs built with PyMuPDF."""

from __future__ import annotations

import re
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))

import library_paragraphs as lp  # noqa: E402
from library_paragraphs import Item  # noqa: E402

fitz = pytest.importorskip("fitz")


# ----------------------------------------------------------------------------
# The general rule on line pairs
# ----------------------------------------------------------------------------

def line(text, page=1, x0=72, y0=100, size=11, block=0, signal=None, x1=500):
    return Item("line", text, page, x0, x1, y0, y0 + size, size, block, False, signal)


GEO = lp.Geometry(median_gap=3.0, blocks_informative=False, short_valid=False, right_margin=520.0, default_base_x=72.0)


def split(prev, cur):
    return lp.should_split(prev, cur, GEO)


def test_rule_requires_all_three_conditions():
    prev = line("He stopped.", y0=100)
    assert split(prev, line("The next day came.", x0=90, y0=114))                 # terminal + capital + indent
    assert not split(line("He stopped and", y0=100), line("The next day", x0=90, y0=114))     # no terminal
    assert not split(prev, line("and then he left.", x0=90, y0=114))              # lowercase start
    assert not split(prev, line("The next day came.", x0=72, y0=114))             # no layout signal


def test_rule_gap_and_block_and_short_line_signals():
    prev = line("He stopped.", y0=100)
    assert split(prev, line("Then it rained.", y0=100 + 11 + 12)) == "gap"
    geo_b = lp.Geometry(median_gap=3.0, blocks_informative=True, right_margin=520.0, default_base_x=72.0)
    assert lp.should_split(prev, line("Then it rained.", y0=114, block=1), geo_b) == "block"
    geo_s = lp.Geometry(median_gap=3.0, blocks_informative=False, short_valid=True, right_margin=520.0, default_base_x=72.0)
    assert lp.should_split(line("He stopped.", x1=300), line("Then it rained.", y0=114), geo_s) == "short_line"
    assert lp.should_split(line("He stopped.", x1=515), line("Then it rained.", y0=114), geo_s) is None


def test_rule_terminal_punctuation_variants():
    for t in ["Done.", "Really?", "Stop!", 'He said, "Go."', "He said “Go.”", "(See below.)", "Wait…"]:
        assert lp.ends_terminal(t), t
    for t in ["He said,", "Well,” she", "Mr.", "See Dr.", "by J.", "and so on;", "Consider this:"]:
        assert not lp.ends_terminal(t), t


def test_rule_start_conditions():
    for t in ["The end", "“Quoted", '"Quoted', "9 reasons", "(Note this", "• item"]:
        assert lp.starts_paragraph(t), t
    for t in ["and then", "...trailing", "of course"]:
        assert not lp.starts_paragraph(t), t


def test_rule_dialogue_each_turn_is_a_paragraph():
    items = [line("“Where is it?” I asked.", y0=100), line("“In the car,” he said.", x0=90, y0=114),
             line("“Show me.”", x0=90, y0=128)]
    paras = lp.assemble([Item("chapter", "C")] + items, GEO)
    assert [p.text for p in paras] == ["“Where is it?” I asked.", "“In the car,” he said.", "“Show me.”"]


def test_rule_colon_lead_in_and_list_items():
    items = [Item("chapter", "C"), line("Do these three things:", y0=100), line("• Call ten customers", x0=90, y0=114),
             line("• Write down what they say", x0=90, y0=128), line("Then you decide.", x0=72, y0=160)]
    paras = lp.assemble(items, GEO)
    assert [p.text for p in paras] == ["Do these three things:", "• Call ten customers", "• Write down what they say",
                                      "Then you decide."]


def test_hyphen_kept_and_joined_without_space():
    items = [Item("chapter", "C"), line("Practice builds self-", y0=100), line("control over time.", y0=114)]
    paras = lp.assemble(items, GEO)
    assert len(paras) == 1 and paras[0].text == "Practice builds self-control over time."
    assert "selfcontrol" not in paras[0].text


def test_heading_resets_paragraph_and_sets_section():
    items = [Item("chapter", "C"), line("First part ends.", y0=100), Item("heading", "A Heading", 1),
             line("Second part starts here", y0=140)]
    recs = lp.make_records(lp.assemble(items, GEO), "t", {})
    assert [r["section"] for r in recs] == [None, "A Heading"]


def test_footnote_markers_stripped_in_records():
    items = [Item("chapter", "C"), line("Growth is slow.* It is also steady.¹", y0=100)]
    recs = lp.make_records(lp.assemble(items, GEO), "t", {})
    assert recs[0]["text"] == "Growth is slow. It is also steady."


def test_title_case_line_is_heading_not_paragraph():
    items = [Item("chapter", "C"), line("Lesson One: The Rich Don't Work For Money", y0=100),
             line("They work for assets and the assets pay them.", y0=130)]
    recs = lp.make_records(lp.assemble(items, GEO), "t", {})
    assert len(recs) == 1 and recs[0]["section"].startswith("Lesson One")
    assert recs[0]["text"] == "They work for assets and the assets pay them."


# ----------------------------------------------------------------------------
# Plain text
# ----------------------------------------------------------------------------

def test_text_blank_line_is_the_layout_signal():
    raw = "First paragraph wraps over\ntwo lines and ends here.\n\nSecond paragraph. It has two sentences.\n"
    rep: dict = {}
    paras = lp.assemble([Item("chapter", "T")] + lp.text_items(raw, rep))
    assert [p.text for p in paras] == ["First paragraph wraps over two lines and ends here.",
                                      "Second paragraph. It has two sentences."]


def test_text_hyphen_join_keeps_hyphen():
    raw = "A habit of self-\ncontrol matters.\n"
    paras = lp.assemble([Item("chapter", "T")] + lp.text_items(raw, {}))
    assert paras[0].text == "A habit of self-control matters."


def test_text_block_without_sentence_end_joins_lowercase_continuation():
    raw = "This sentence is cut by a page break and\n\ncontinues in the next block.\n"
    raws = lp._merge_text_continuations(lp.assemble([Item("chapter", "T")] + lp.text_items(raw, {})))
    assert len(raws) == 1 and raws[0].text.endswith("next block.")


def test_text_unpunctuated_reported_as_unsupported_not_guessed():
    dump = " ".join(["so", "and", "uh", "we", "went", "there", "like"] * 40)       # 280 words, no punctuation
    good = " ".join(["This is a plain punctuated sentence about one thing."] * 30)      # 300 words
    raw = good + "\n\n" + dump + "\n\nAnother good paragraph here.\n"
    rep: dict = {}
    items = lp.text_items(raw, rep)
    assert rep["unsupported_blocks"] and rep["unsupported_blocks"][0]["words"] == 280
    assert rep["unsupported_words"] == 280 and any("This is a plain" in it.text for it in items)
    assert not any(dump[:30] in it.text for it in items)
    only = dump + "\n\n" + dump
    with pytest.raises(lp.UnsupportedSource):
        lp.text_items(only, {})


def test_text_speaker_turns_and_markdown_emphasis():
    raw = "**Ann Lee:** I read *Good Book* last year.  **Bo Kim:** Did you like it?\n"
    paras = lp.assemble([Item("chapter", "T")] + lp.text_items(raw, {}))
    assert [p.text for p in paras] == ["Ann Lee: I read Good Book last year.", "Bo Kim: Did you like it?"]


def test_text_short_title_line_is_a_heading():
    raw = "Market Timing\n\nThe market moved early. Nobody noticed.\n"
    rep: dict = {}
    items = lp.text_items(raw, rep)
    assert items[0].kind == "heading" and rep["headings"][0]["text"] == "Market Timing"


# ----------------------------------------------------------------------------
# End to end on a synthetic PDF
# ----------------------------------------------------------------------------

BODY = [  # (chapter, kind, text lines) -- the ground truth the PDF is built from
]


def make_pdf(path: Path) -> dict:
    """6 pages, 2 chapters (outline), running head, page numbers, a footnote, a hyphenated line end,
    a paragraph that continues over a page break, dialogue and an Acknowledgments back matter page."""
    doc = fitz.open()
    expected: list[str] = []

    def page_with(lines_spec, number, chapter_title=None, heading=None, footnote=None):
        page = doc.new_page(width=595, height=842)
        page.insert_text((72, 40), "THE ALPHA BOOK", fontsize=9)                      # running head
        page.insert_text((290, 800), str(number), fontsize=9)                          # page number
        y = 90
        if chapter_title:
            page.insert_text((72, y), chapter_title, fontsize=22, fontname="hebo")
            y += 50
        if heading:
            page.insert_text((72, y), heading, fontsize=15, fontname="hebo")
            y += 30
        for x, text in lines_spec:
            page.insert_text((x, y), text, fontsize=11)
            y += 14
        if footnote:
            page.insert_text((72, 760), footnote, fontsize=8)
        return page

    long_line = "word " * 13
    p1 = [(90, "Small bets teach faster than big plans. A founder who tests"), (72, "an idea within days learns what the plan cannot say."),
          (72, "Practice builds self-"), (72, "control over a long stretch of weeks."),
          (90, "The second paragraph starts with an indent. It has two sentences."),
          (90, "\"Where is the money?\" she asked."), (90, "\"In the bank,\" he said."),
          (90, "A third long paragraph begins here and it keeps going " + "across"), (72, "the end of this page without stopping " + long_line.strip())]
    page_with(p1, 1, chapter_title="Chapter 1: Alpha", heading="Why Start Small",
              footnote="1 Smith, Small Bets, 2001.")
    expected += ["Small bets teach faster than big plans. A founder who tests an idea within days learns what the plan cannot say. "
                 "Practice builds self-control over a long stretch of weeks.",
                 "The second paragraph starts with an indent. It has two sentences.",
                 "\"Where is the money?\" she asked.", "\"In the bank,\" he said.",
                 "A third long paragraph begins here and it keeps going across the end of this page without stopping " + long_line.strip()
                 + " and ends on the next page."]
    # page 2 continues the third paragraph without an indent, then a new indented paragraph
    page_with([(72, "and ends on the next page."), (90, "A fourth paragraph opens on page two. It is short.")], 2)
    expected.append("A fourth paragraph opens on page two. It is short.")
    page_with([(90, "Filler paragraph on page three, for furniture counts."), (90, "Another filler paragraph on this page too.")], 3)
    expected += ["Filler paragraph on page three, for furniture counts.", "Another filler paragraph on this page too."]
    page_with([(90, "Chapter two begins with its own first paragraph. It teaches one thing.")], 4,
              chapter_title="Chapter 2: Beta")
    expected.append("Chapter two begins with its own first paragraph. It teaches one thing.")
    page_with([(90, "Growth is slow.* It is also steady when you keep shipping."), (90, "Last body paragraph of the book is here.")], 5)
    expected += ["Growth is slow. It is also steady when you keep shipping.", "Last body paragraph of the book is here."]
    page_with([(90, "Thank you to my editor and my family for everything.")], 6, chapter_title="Acknowledgments")
    doc.set_toc([[1, "Chapter 1: Alpha", 1], [1, "Chapter 2: Beta", 4], [1, "Acknowledgments", 6]])
    doc.set_metadata({"author": "Smith, Jane", "title": "The Alpha Book"})
    doc.save(path)
    doc.close()
    return {"expected": expected}


@pytest.fixture(scope="module")
def pdf_result(tmp_path_factory):
    d = tmp_path_factory.mktemp("pdf")
    path = d / "alpha.pdf"
    truth = make_pdf(path)
    manifest = {"sources": [{"source_id": "alpha", "title": "The Alpha Book", "format": "pdf", "path": str(path),
                             "pillar": "money_game"}]}
    paras, report = lp.build_paragraphs("alpha", manifest, path)
    return {"paras": paras, "report": report, "truth": truth, "path": path, "manifest": manifest}


def norm(t):
    return re.sub(r"\s+", " ", t).strip()


def test_pdf_every_paragraph_exactly_once_in_order(pdf_result):
    got = [norm(p["text"]) for p in pdf_result["paras"]]
    assert got == [norm(t) for t in pdf_result["truth"]["expected"]]
    assert len(got) == len(set(got))


def test_pdf_hyphen_join_keeps_hyphen(pdf_result):
    text = " ".join(p["text"] for p in pdf_result["paras"])
    assert "self-control" in text and "selfcontrol" not in text and "self- control" not in text


def test_pdf_no_sentence_split_across_paragraphs(pdf_result):
    ps = pdf_result["paras"]
    for p in ps:
        assert lp.ends_terminal(p["text"]), p["text"]
        assert not p["text"][0].islower(), p["text"]


def test_pdf_paragraph_across_page_break_is_one_paragraph(pdf_result):
    p = next(p for p in pdf_result["paras"] if p["text"].startswith("A third long"))
    assert p["page_start"] == 1 and p["page_end"] == 2 and p["text"].endswith("on the next page.")


def test_pdf_no_heading_inside_body_text(pdf_result):
    body = " ".join(p["text"] for p in pdf_result["paras"])
    for h in ("Why Start Small", "Chapter 1: Alpha", "Chapter 2: Beta", "Acknowledgments"):
        assert h not in body
    sections = {p["section"] for p in pdf_result["paras"]}
    assert "Why Start Small" in sections
    assert pdf_result["paras"][0]["section"] == "Why Start Small"
    assert pdf_result["paras"][0]["heading_path"][-1] == "Why Start Small"


def test_pdf_page_furniture_stripped(pdf_result):
    body = " ".join(p["text"] for p in pdf_result["paras"])
    assert "THE ALPHA BOOK" not in body
    assert not re.search(r"(?<![\w.])[1-6](?![\w.])\s*$", pdf_result["paras"][0]["text"])
    for p in pdf_result["paras"]:
        assert not re.fullmatch(r"\d+", p["text"].strip())
    assert pdf_result["report"]["removed"].get("page_furniture", 0) >= 5


def test_pdf_footnote_text_and_markers_moved_out(pdf_result):
    body = " ".join(p["text"] for p in pdf_result["paras"])
    assert "Smith, Small Bets" not in body and "*" not in body
    assert any("Smith, Small Bets" in f["text"] for f in pdf_result["report"]["footnotes"])
    assert pdf_result["report"]["footnote_markers_stripped"] >= 1


def test_pdf_back_matter_stripped_and_reported(pdf_result):
    body = " ".join(p["text"] for p in pdf_result["paras"])
    assert "Thank you to my editor" not in body
    bm = pdf_result["report"]["back_matter"]
    assert bm and bm[0]["pages"][0] == 6 and "Thank you" in bm[0]["starts"]


def test_pdf_chapters_and_ids(pdf_result):
    ps = pdf_result["paras"]
    assert [p["id"] for p in ps] == [f"alpha_p{i:04d}" for i in range(len(ps))]
    assert ps[0]["chapter"].startswith("Chapter 1") and ps[-1]["chapter"].startswith("Chapter 2")
    assert next(p for p in ps if p["text"].startswith("Chapter two begins"))["chapter"].startswith("Chapter 2")
    assert all(p["word_count"] == len(re.findall(r"\b[\w’'-]+\b", p["text"])) for p in ps)
    assert pdf_result["report"]["author"] == "Jane Smith"


def test_run_stage_writes_v2_files_and_archives_before_overwrite(pdf_result, tmp_path):
    lib, arch = tmp_path / "library", tmp_path / "_archive"
    lp.run_stage_paragraphs("alpha", lib, pdf_result["manifest"], arch)
    f = lib / "alpha" / "paragraphs_v2.jsonl"
    first = f.read_text()
    assert len(lp.read_jsonl(f)) == len(pdf_result["paras"]) and not list(arch.glob("**/*.jsonl"))
    lp.run_stage_paragraphs("alpha", lib, pdf_result["manifest"], arch)
    saved = list((arch / "alpha").glob("paragraphs_v2_*.jsonl"))
    assert len(saved) == 1 and saved[0].read_text() == first


def test_clean_author():
    assert lp.clean_author("Kiyosaki, Robert") == "Robert Kiyosaki"
    assert lp.clean_author("Geoffrey A. Moore") == "Geoffrey A. Moore"
    assert lp.clean_author("Kahneman, Daniel; Tversky, Amos") == "Daniel Kahneman and Amos Tversky"
    assert lp.clean_author("unknown") is None and lp.clean_author("") is None and lp.clean_author(None) is None


# ----------------------------------------------------------------------------
# Windows
# ----------------------------------------------------------------------------

def mk_paras(spec, sid="s"):
    """spec: list of (chapter, section, words, kind) -> paragraph dicts."""
    out = []
    for i, (chap, sec, words, *kind) in enumerate(spec):
        text = " ".join(["w"] * (words - 1)) + "."
        out.append({"id": f"{sid}_p{i:04d}", "source_id": sid, "index": i, "text": text, "chapter": chap,
                    "section": sec, "heading_path": [chap] + ([sec] if sec else []), "page": i // 3 + 1,
                    "page_start": i // 3 + 1, "page_end": i // 3 + 1, "word_count": words,
                    "kind": kind[0] if kind else "body", "scene_break": False})
    return out


def test_windows_cover_every_paragraph_exactly_once_in_order():
    paras = mk_paras([("c1", None, 180)] * 30 + [("c2", None, 150)] * 20)
    wins = lp.build_windows(paras)
    ids = [p["id"] for w in wins for p in w["paragraphs"]]
    assert ids == [p["id"] for p in paras]
    for w in wins:
        assert w["chapter"] in ("c1", "c2")
        assert len({p["id"] for p in w["paragraphs"]} & {p["id"] for p in w["context"]}) == 0


def test_windows_about_2000_words_and_never_mid_paragraph():
    paras = mk_paras([("c1", None, 170)] * 60)           # 10,200 words
    wins = lp.build_windows(paras)
    assert 4 <= len(wins) <= 6
    for w in wins[:-1]:
        assert 1500 <= w["word_count"] <= 2600
    # a window's text is whole paragraphs only
    texts = {p["text"] for p in paras}
    assert all(p["text"] in texts for w in wins for p in w["paragraphs"])


def test_windows_never_cross_chapters():
    paras = mk_paras([("c1", None, 300)] * 3 + [("c2", None, 300)] * 3)
    wins = lp.build_windows(paras)
    assert len(wins) == 2
    assert {p["id"] for p in wins[0]["paragraphs"]}.isdisjoint({p["id"] for p in wins[1]["paragraphs"]})
    assert wins[1]["context"] == []                     # context never crosses a chapter


def test_windows_prefer_section_heading_boundary():
    spec = [("c1", "A", 200)] * 9 + [("c1", "B", 200)] * 9          # 1800 words in A, then B
    wins = lp.build_windows(mk_paras(spec))
    assert wins[0]["sections"] == ["A"], wins[0]["sections"]
    assert wins[0]["word_count"] == 1800


def test_windows_context_is_last_two_paragraphs_marked_context_only():
    paras = mk_paras([("c1", None, 250)] * 20)
    wins = lp.build_windows(paras)
    assert wins[0]["context"] == []
    ctx = wins[1]["context"]
    assert [c["id"] for c in ctx] == [p["id"] for p in wins[0]["paragraphs"][-2:]]
    assert all(c["context_only"] is True for c in ctx)
    assert all(p["context_only"] is False for p in wins[1]["paragraphs"])


def test_windows_keep_lead_in_with_its_list():
    spec = [("c1", None, 400)] * 4 + [("c1", None, 100)]
    paras = mk_paras(spec)
    paras[4]["text"] = "Consider the following steps:"           # ends with a colon: lead-in at the natural cut
    paras += mk_paras([("c1", None, 50, "list_item")] * 3, "s")
    for i, p in enumerate(paras):
        p["id"] = f"s_p{i:04d}"
        p["index"] = i
    wins = lp.build_windows(paras)
    for a, b in zip(wins, wins[1:]):
        assert not a["paragraphs"][-1]["text"].rstrip().endswith(":")
        assert b["paragraphs"][0]["text"] != "" and not b["paragraphs"][0]["id"].endswith("p0005")


def test_windows_epigraphs_are_not_teachable_text():
    paras = mk_paras([("c1", None, 30, "epigraph"), ("c1", None, 300)])
    wins = lp.build_windows(paras)
    assert [p["id"] for w in wins for p in w["paragraphs"]] == ["s_p0001"]


def test_windows_hash_changes_when_text_changes_and_is_stable_otherwise():
    paras = mk_paras([("c1", None, 300)] * 3)
    h1 = lp.build_windows(paras)[0]["hash"]
    assert lp.build_windows(paras)[0]["hash"] == h1
    paras[0]["text"] = paras[0]["text"] + " extra"
    assert lp.build_windows(paras)[0]["hash"] != h1


def test_tiny_remainder_is_folded_into_the_previous_window():
    paras = mk_paras([("c1", None, 400)] * 6 + [("c1", None, 60)])         # 2460 words -> one window
    assert len(lp.build_windows(paras)) == 1
