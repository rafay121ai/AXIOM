"""Regression tests for the library pipeline, part A. No API calls, no network, no database.

Run:  knowledge_pilot/.venv/bin/python -m unittest discover -s knowledge_pilot -p test_library.py -v
  or: knowledge_pilot/.venv/bin/python knowledge_pilot/run_library.py --test
"""

from __future__ import annotations

import json
import random
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
sys.path.insert(0, str(HERE))

import library_chunk as lc  # noqa: E402
import library_extract as le  # noqa: E402
import library_state as ls  # noqa: E402
import library_text as lt  # noqa: E402
import qa_check as qa  # noqa: E402
import run_library as rl  # noqa: E402

try:
    import fitz  # type: ignore
except Exception:  # pragma: no cover
    fitz = None


# ----------------------------------------------------------------------------
# Helpers
# ----------------------------------------------------------------------------

def filler(n: int, seed: str = "alpha") -> str:
    words = [f"{seed}{i % 7}" for i in range(n - 1)]
    words[0] = words[0].capitalize()
    return " ".join(words) + " end."


def para(text: str, chapter: str = "C1", section: str | None = None, **kw) -> le.Para:
    return le.Para(text=text, page_start=1, page_end=1, chapter=chapter, section=section, **kw)


def build(paras: list[le.Para]) -> tuple[list[dict], dict]:
    provider = lc.BoundaryProvider(Path(tempfile.mkdtemp()), offline=True)
    chunks, rows, stats = lc.build_chunks(paras, {"source_id": "t", "book": "T", "author": "A", "pillar": "p"}, provider)
    lc.verify_paragraphs_once(paras, chunks)
    return chunks, stats


# ----------------------------------------------------------------------------
# Text rules
# ----------------------------------------------------------------------------

class TextRules(unittest.TestCase):
    def test_hyphen_rejoin_keeps_hyphen(self):
        self.assertEqual(lt.join_lines(["He lacked self-", "control entirely."]), "He lacked self-control entirely.")
        self.assertEqual(lt.join_lines(["a sixth-", "grader"]), "a sixth-grader")
        self.assertNotIn("selfcontrol", lt.join_lines(["self-", "control"]))
        self.assertNotIn("self- control", lt.join_lines(["self-", "control"]))

    def test_dash_and_normal_joins(self):
        self.assertEqual(lt.join_lines(["Build-Measure-", "Learn"]), "Build-Measure-Learn")
        self.assertEqual(lt.join_lines(["forecasters tried—", "and failed"]), "forecasters tried—and failed")
        self.assertEqual(lt.join_lines(["one line", "two line"]), "one line two line")

    def test_soft_hyphen_is_not_a_hyphen(self):
        self.assertEqual(lt.join_lines(["momen­", "tum"]), "momentum")

    def test_footnote_markers_stripped(self):
        text, n = lt.strip_footnote_markers("into their budgeting.* ASAS was founded. Later, grant.* Then more.")
        self.assertEqual(text, "into their budgeting. ASAS was founded. Later, grant. Then more.")
        self.assertEqual(n, 2)
        self.assertEqual(lt.strip_footnote_markers("They called him A**hole.")[0], "They called him A**hole.")
        self.assertEqual(lt.strip_footnote_markers("over time.12 The next")[0], "over time. The next")

    def test_figure_caption_detection(self):
        for caption in ("Figure 5.3: Tiffany Stock Price", "Figure 9.6", "Figure 1.5: Netflix Stock Price vs. S&P 500 TR (8/2010 = 100%)"):
            self.assertTrue(lt.is_figure_caption(caption), caption)
        for body in ("Figure 1 shows the growth of the firm.", "Figure out what the customer wants."):
            self.assertFalse(lt.is_figure_caption(body), body)

    def test_dateline_and_attribution(self):
        self.assertTrue(lt.is_dateline("September 30, 1993"))
        self.assertFalse(lt.is_dateline("In September 1993 the bank was robbed."))
        self.assertTrue(lt.is_attribution("—Anton Chekhov"))
        self.assertFalse(lt.is_attribution("— and then he left the building. Nobody saw him again."))

    def test_continuation_openers(self):
        for text in ("But the deluge of spending", "And then Manber decided to leave.", "Which, ironically, is good.",
                     "Another thing mattered.", "Then he left.", "The second reason was cost.", "Or so they said.",
                     "He explained the outcome.", "This dynamic repeated.", "then it ended"):
            self.assertTrue(lt.opens_dependent(text), text)
        for text in ("It was a dark night.", "There was a man named Tim.", "Jeff Bezos founded Amazon.",
                     "Imagine you are a founder.", "iPhone sales rose.", "When I was twenty-six, I thought so."):
            self.assertFalse(lt.opens_dependent(text), text)

    def test_lead_ins(self):
        self.assertTrue(lt.ends_with_lead_in("Here are the four components:"))
        self.assertTrue(lt.ends_with_lead_in("Consider the following"))
        self.assertTrue(lt.ends_with_lead_in("Body.\n\nFor the Surplus Leader Margin (SLM) we assess:"))
        self.assertFalse(lt.ends_with_lead_in("Body.\n\nThe following year was quiet."))


# ----------------------------------------------------------------------------
# Extraction rules on a synthetic PDF (real PyMuPDF text layer, no pilot data)
# ----------------------------------------------------------------------------

@unittest.skipIf(fitz is None, "PyMuPDF not installed")
class SyntheticPdfExtraction(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dir = tempfile.TemporaryDirectory()
        cls.path = Path(cls.dir.name) / "book.pdf"
        doc = fitz.open()

        def page(lines):
            p = doc.new_page(width=612, height=792)
            y = 100
            for text, size, font in lines:
                if text is None:
                    y += 14
                    continue
                p.insert_text((72, y), text, fontsize=size, fontname=font)
                y += size + 5
            return p

        body = 11
        page([("Front matter that belongs to no chapter " * 1, body, "helv")])
        # Chapter 1, page 2
        page([("Chapter 1: Alpha", 24, "hebo"), (None, 0, ""),
              ("September 30, 1993", body, "hebo"),
              ("A brisk autumn morning began with a long walk. He lacked self-", body, "helv"),
              ("control entirely and the walk showed it to everyone nearby.", body, "helv"),
              (None, 0, ""),
              ("HOW NOT TO GET PAID", body, "hebo"),
              ("Let us pause here because one thing matters a great deal in practice today.", body, "helv"),
              ("It holds true across every deal we have ever looked at together.", body, "helv"),
              (None, 0, ""),
              ("The result was a plan that rested on one small idea about money.* It worked well for them.", body, "helv"),
              ("Figure 2.1: Revenue by year", body, "helv"),
              (None, 0, ""),
              ("Another full paragraph follows here with plenty of ordinary words to read through.", body, "helv"),
              ("It keeps going for a second line so that it counts as real prose for the reader.", body, "helv")])
        doc[-1].insert_text((72, 740), "* Footnote: this note text must leave the body of the book entirely.", fontsize=8, fontname="helv")
        # Chapter 1 last page: quotation + attribution that belongs to chapter 2
        page([("Closing paragraph of chapter one that wraps up the argument with a full stop.", body, "helv"),
              ("Second sentence of the closing paragraph keeps the page honest and ordinary.", body, "helv"),
              (None, 0, ""),
              ("The only way out is through.", body, "helv"),
              ("--Robert Frost", body, "helv")])
        # Chapter 2
        page([("Chapter 2: Beta", 24, "hebo"), (None, 0, ""),
              ("The first real paragraph of chapter two starts here and runs for a few words more.", body, "helv"),
              ("It continues with a second line of plain prose to be safe for the extractor today.", body, "helv")])
        doc.set_toc([[1, "Chapter 1: Alpha", 2], [1, "Chapter 2: Beta", 4]])
        doc.save(cls.path)
        doc.close()
        cls.paras, cls.report = le.extract_pdf(cls.path)

    @classmethod
    def tearDownClass(cls):
        cls.dir.cleanup()

    def text(self):
        return "\n".join(p.text for p in self.paras)

    def test_hyphen_rejoin_keeps_self_control(self):
        self.assertIn("self-control", self.text())
        self.assertNotIn("selfcontrol", self.text())

    def test_footnote_marker_stripped(self):
        self.assertNotIn("*", self.text())
        self.assertIn("about money. It worked", self.text())
        self.assertGreaterEqual(self.report["footnote_markers_stripped"], 1)

    def test_footnote_text_moved_out_of_body(self):
        self.assertNotIn("Footnote: this note text", self.text())
        self.assertEqual(len(self.report["footnotes"]), 1)
        self.assertIn("this note text", self.report["footnotes"][0]["text"])

    def test_figure_caption_dropped(self):
        self.assertNotIn("Figure 2.1", self.text())
        self.assertEqual(len(self.report["figure_captions_dropped"]), 1)

    def test_dateline_and_runin_heading_removed_from_body(self):
        self.assertNotIn("September 30, 1993", self.text())
        self.assertNotIn("HOW NOT TO GET PAID", self.text())
        self.assertEqual(self.report["datelines_removed"][0]["text"], "September 30, 1993")
        heading = next(p for p in self.paras if p.text.startswith("Let us pause"))
        self.assertEqual(heading.section, "HOW NOT TO GET PAID")

    def test_epigraph_attaches_to_its_own_chapter(self):
        chapters = list(dict.fromkeys(p.chapter for p in self.paras))
        self.assertEqual(len(chapters), 2)
        ch1 = [p for p in self.paras if p.chapter == chapters[0]]
        ch2 = [p for p in self.paras if p.chapter == chapters[1]]
        self.assertNotIn("Robert Frost", "\n".join(p.text for p in ch1))
        self.assertEqual([p.text for p in ch2[:2]], ["The only way out is through.", "--Robert Frost"])
        self.assertTrue(all(p.kind == "epigraph" for p in ch2[:2]))

    def test_chapter_titles_are_not_body(self):
        self.assertNotIn("Chapter 1: Alpha", self.text())
        self.assertNotIn("Chapter 2: Beta", self.text())

    def test_scanned_pdf_is_unsupported(self):
        blank = Path(self.dir.name) / "scan.pdf"
        doc = fitz.open()
        for _ in range(6):
            doc.new_page()
        doc.save(blank)
        doc.close()
        with self.assertRaises(le.UnsupportedFormat):
            le.extract_pdf(blank)


@unittest.skipIf(fitz is None, "PyMuPDF not installed")
class ChapterFallbacks(unittest.TestCase):
    def make(self, openers: list[int], pages: int) -> Path:
        d = Path(tempfile.mkdtemp())
        path = d / "x.pdf"
        doc = fitz.open()
        paragraph = ("The quick brown fox jumps over the lazy dog while the market moves and founders keep building. " * 4).strip()
        for n in range(1, pages + 1):
            page = doc.new_page(width=612, height=792)
            top = 80
            if n in openers:
                page.insert_text((72, 100), f"THE CHAPTER NUMBER {openers.index(n) + 1}", fontsize=28, fontname="hebo")
                top = 150
            page.insert_textbox(fitz.Rect(72, top, 540, 700), (paragraph + "\n\n") * 3, fontsize=11, fontname="helv")
        doc.save(path)
        doc.close()
        return path

    def test_heading_font_fallback_when_no_outline(self):
        paras, report = le.extract_pdf(self.make([1, 4, 7], 9))
        self.assertEqual(report["chapter_detection"], "font")
        self.assertEqual(len(dict.fromkeys(p.chapter for p in paras)), 3)

    def test_fixed_sections_when_nothing_else(self):
        paras, report = le.extract_pdf(self.make([], 60))
        self.assertEqual(report["chapter_detection"], "fixed")
        names = list(dict.fromkeys(p.chapter for p in paras))
        self.assertGreater(len(names), 2)
        self.assertEqual(names[0], "Section 1")


class TextFileExtraction(unittest.TestCase):
    def test_txt_splits_on_blank_lines_and_rejoins_hyphens(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / "a.txt"
            path.write_text("First para line one\nline two self-\ncontrol done.\n\nSecond paragraph.\n\n\n* * *\n\nThird.\n")
            paras, report = le.extract_text_file(path)
        self.assertEqual([p.text for p in paras], ["First para line one line two self-control done.", "Second paragraph.", "Third."])
        self.assertTrue(paras[2].scene_break)


# ----------------------------------------------------------------------------
# Chunking rules
# ----------------------------------------------------------------------------

class ChunkRules(unittest.TestCase):
    def test_paragraphs_preserved_exactly_once_property(self):
        rng = random.Random(7)
        openers = ["But the cost rose.", "Another thing happened.", "He left.", "Here are the steps:", "Plain start."]
        for trial in range(40):
            paras = []
            for i in range(rng.randint(5, 60)):
                body = filler(rng.choice([10, 40, 90, 180, 320, 800]), f"w{trial}x{i}")
                paras.append(para(rng.choice(openers) + " " + body, chapter=f"C{i // 25}",
                                  section=rng.choice([None, "S1", "S2"]) if rng.random() < 0.2 else None))
            chunks, _ = build(paras)
            flat = [t for c in chunks for t in c["text"].split("\n\n")]
            self.assertEqual(flat, [p.text for p in paras])

    def test_size_pass_splits_over_500_at_safe_boundary(self):
        paras = [para(filler(w, f"p{i}")) for i, w in enumerate([200, 180, 160, 120])]  # 660 words
        chunks, stats = build(paras)
        self.assertEqual(len(chunks), 2)
        self.assertGreaterEqual(stats.get("size_splits", 0), 1)
        self.assertTrue(chunks[0]["continues"])
        self.assertTrue(chunks[1]["continues"])
        self.assertEqual(chunks[0]["next_id"], chunks[1]["id"])
        self.assertEqual(chunks[1]["prev_id"], chunks[0]["id"])
        self.assertTrue(all(c["word_count"] >= 150 for c in chunks))

    def test_size_pass_respects_continuation_and_small_halves(self):
        # Only boundary that balances halves opens on "But": must not split there.
        paras = [para(filler(300, "a")), para("But " + filler(300, "b"))]
        chunks, _ = build(paras)
        self.assertEqual(len(chunks), 1)
        # Halves under 150 words are never created.
        chunks, _ = build([para(filler(480, "a")), para(filler(100, "b"))])
        self.assertEqual(len(chunks), 1)

    def test_size_pass_keeps_lead_in_with_list(self):
        paras = [para(filler(300, "a")), para("Here are the steps:"), para("1. " + filler(120, "s")),
                 para(filler(200, "z"))]
        chunks, _ = build(paras)
        for c in chunks:
            self.assertFalse(lt.ends_with_lead_in(c["text"]))

    def test_continuation_opener_merges_with_previous(self):
        a, b, c = para("Setup. " + filler(300, "a")), para("But the outcome surprised everyone. " + filler(300, "b")), para("Fresh topic here. " + filler(300, "c"))
        chunks, stats = build([a, b, c])
        self.assertEqual(len(chunks), 2)
        self.assertTrue(chunks[0]["text"].startswith("Setup."))
        self.assertIn("But the outcome", chunks[0]["text"])
        self.assertTrue(chunks[1]["text"].startswith("Fresh topic"))

    def test_chunks_never_open_on_continuations_or_end_on_lead_ins(self):
        paras = [para("Intro. " + filler(400, "i")),
                 para("Consider the following scenario:"),
                 para("(a) Option one is cheap. (b) Option two is not."),
                 para("Which would you choose? " + filler(500, "w")),
                 para("And then everything changed. " + filler(400, "z"))]
        chunks, _ = build(paras)
        for chunk in chunks[1:]:
            self.assertFalse(lt.opens_dependent(chunk["text"]), chunk["text"][:40])
        for chunk in chunks:
            self.assertFalse(lt.ends_with_lead_in(chunk["text"]))

    def test_lead_in_stays_with_its_list(self):
        paras = [para("Opening. " + filler(300, "o")), para("Here are the three rules:"),
                 para("1. Know your numbers."), para("2. Ask for less."), para("3. Report the same day."),
                 para("Closing thought. " + filler(300, "c"))]
        chunks, _ = build(paras)
        holder = next(c for c in chunks if "Here are the three rules:" in c["text"])
        self.assertIn("1. Know your numbers.", holder["text"])
        self.assertIn("3. Report the same day.", holder["text"])

    def test_question_stays_with_options(self):
        paras = [para("Scenario. " + filler(300, "s")), para("Which do you prefer?"),
                 para("(a) A sure gain of 100."), para("(b) A coin flip for 200."), para("Next idea. " + filler(300, "n"))]
        chunks, _ = build(paras)
        holder = next(c for c in chunks if "Which do you prefer?" in c["text"])
        self.assertIn("(a) A sure gain of 100.", holder["text"])
        self.assertIn("(b) A coin flip for 200.", holder["text"])

    def test_epigraph_attaches_to_following_paragraph(self):
        paras = [para("Quote of a famous person.", chapter="C2", kind="epigraph"),
                 para("—Famous Person", chapter="C2", kind="epigraph"),
                 para("The chapter begins. " + filler(300, "k"), chapter="C2")]
        chunks, _ = build(paras)
        self.assertEqual(len(chunks), 1)
        self.assertTrue(chunks[0]["text"].startswith("Quote of a famous person."))

    def test_short_unit_merges_forward_by_default(self):
        paras = [para("Alpha opening. " + filler(300, "a")), para("Short beta. " + filler(60, "b"), section="S1"),
                 para("Gamma follows. " + filler(300, "g"), section="S1")]
        chunks, _ = build(paras)
        merged = next(c for c in chunks if "Short beta." in c["text"])
        self.assertIn("Gamma follows.", merged["text"])
        self.assertNotIn("Alpha opening.", merged["text"])

    def test_short_section_ending_merges_backward(self):
        paras = [para("Alpha opening. " + filler(300, "a"), section="S1"),
                 para("A short closing remark. " + filler(40, "r"), section="S1"),
                 para("New section starts. " + filler(300, "n"), section="S2")]
        chunks, _ = build(paras)
        first = chunks[0]
        self.assertIn("A short closing remark.", first["text"])
        self.assertEqual(first["section"], "S1")
        self.assertEqual(chunks[1]["section"], "S2")

    def test_over_700_splits_near_middle_at_paragraph_boundary(self):
        paras = [para(f"Topic number {i} begins here. " + filler(190, f"t{i}")) for i in range(6)]  # ~1200 words
        chunks, stats = build(paras)
        self.assertGreater(len(chunks), 1)
        for c in chunks:
            self.assertLessEqual(c["word_count"], 700)
            self.assertGreaterEqual(c["word_count"], 150)
            self.assertTrue(c["continues"])
        # Never inside a paragraph: every chunk is made of whole source paragraphs.
        sources = {p.text for p in paras}
        for c in chunks:
            for piece in c["text"].split("\n\n"):
                self.assertIn(piece, sources)
        # Closest to the middle first (3 + 3); the 500-word size pass may then halve each side again,
        # but no chunk may straddle the middle boundary.
        counts = [len(c["text"].split("\n\n")) for c in chunks]
        self.assertEqual(sum(counts), 6)
        self.assertIn(3, [sum(counts[:k]) for k in range(1, len(counts))])

    def test_repeated_split_until_700_or_less(self):
        paras = [para(f"Section idea {i}. " + filler(180, f"u{i}")) for i in range(14)]  # ~2600 words
        chunks, _ = build(paras)
        self.assertTrue(all(c["word_count"] <= 700 for c in chunks))
        self.assertGreaterEqual(len(chunks), 4)

    def test_genuine_story_up_to_900_stays_whole_and_flagged(self):
        paras = [para("The story begins. " + filler(300, "s")), para("Then it gets worse. " + filler(300, "t")),
                 para("And so it ended. " + filler(250, "u"))]  # 850 words, every later paragraph is a continuation
        chunks, _ = build(paras)
        self.assertEqual(len(chunks), 1)
        self.assertIn("oversized_story", chunks[0]["flags"])

    def test_single_paragraph_over_900_stays_whole_and_flagged(self):
        chunks, _ = build([para(filler(1200, "big"))])
        self.assertEqual(len(chunks), 1)
        self.assertIn("oversized_paragraph", chunks[0]["flags"])

    def test_prev_next_and_continues_fields(self):
        paras = [para(f"Idea {i}. " + filler(400, f"p{i}"), chapter=f"C{i}") for i in range(6)]
        chunks, _ = build(paras)
        self.assertIsNone(chunks[0]["prev_id"])
        self.assertIsNone(chunks[-1]["next_id"])
        for a, b in zip(chunks, chunks[1:]):
            self.assertEqual(a["next_id"], b["id"])
            self.assertEqual(b["prev_id"], a["id"])
        for key in ("id", "source_id", "book", "author", "pillar", "chapter", "section", "page_start", "page_end",
                    "prev_id", "next_id", "continues", "word_count", "flags", "text", "pipeline_version"):
            self.assertIn(key, chunks[0])
        self.assertFalse(any(c["continues"] for c in chunks))

    def test_section_is_null_without_a_real_heading(self):
        chunks, _ = build([para(filler(300, "x")), para(filler(300, "y"))])
        self.assertTrue(all(c["section"] is None for c in chunks))


class BoundaryProviderOffline(unittest.TestCase):
    def test_offline_never_calls_the_api(self):
        paras = [para(f"Idea {i}. " + filler(300, f"o{i}")) for i in range(8)]
        provider = lc.BoundaryProvider(Path(tempfile.mkdtemp()), offline=True)
        with patch.object(lc.BoundaryProvider, "_call_openai", side_effect=AssertionError("network!")) as call:
            chunks, rows, stats = lc.build_chunks(paras, {"source_id": "t"}, provider)
        call.assert_not_called()
        self.assertEqual(provider.stats["llm_calls"], 0)
        self.assertEqual(provider.stats["rule_fallback_segments"], 1)  # the cache miss is counted
        self.assertTrue(all(c["word_count"] <= 700 for c in chunks))

    def test_cache_key_matches_the_pilot_format(self):
        # Rebuild a pilot chapter payload and confirm the fingerprint names a real pilot cache file.
        pilot = HERE / "thinking_in_bets"
        if not (pilot / "paragraphs.jsonl").exists():
            self.skipTest("pilot data not present")
        rows = [json.loads(l) for l in (pilot / "paragraphs.jsonl").read_text().splitlines()]
        found = 0
        chapters = list(dict.fromkeys(r["chapter"] for r in rows))
        for chapter in chapters:
            body = [le.Para(r["text"], r["page_start"], r["page_end"], r["chapter"], r["section"]) for r in rows if r["chapter"] == chapter]
            serialized = json.dumps(lc.source_payload(chapter, body), ensure_ascii=False, sort_keys=True)
            fp = lc.fingerprint(lc.BOUNDARY_INSTRUCTIONS, serialized)
            if (pilot / "stage3_cache" / f"boundaries_{fp}.json").exists():
                found += 1
        self.assertGreaterEqual(found, 1, "no pilot cache file matched the reproduced fingerprint")

    def test_exact_cache_hit_is_used_offline(self):
        paras = [para(f"Idea {i}. " + filler(300, f"c{i}")) for i in range(6)]
        cache = Path(tempfile.mkdtemp())
        serialized = json.dumps(lc.source_payload("C1", paras), ensure_ascii=False, sort_keys=True)
        fp = lc.fingerprint(lc.BOUNDARY_INSTRUCTIONS, serialized)
        starts = [{"start": s, "boundary_kind": "real_boundary", "reason": "t"} for s in (1, 3, 5)]
        (cache / f"boundaries_{fp}.json").write_text(json.dumps({"result": {"starts": starts}}))
        provider = lc.BoundaryProvider(cache, offline=True)
        chunks, rows, stats = lc.build_chunks(paras, {"source_id": "t"}, provider)
        self.assertEqual(provider.stats["cache_hits"], 1)
        self.assertEqual(provider.stats["rule_fallback_segments"], 0)
        self.assertEqual([r["paragraphs"] for r in rows], [2, 2, 2])


# ----------------------------------------------------------------------------
# State
# ----------------------------------------------------------------------------

class StateTests(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.path = Path(self.dir.name) / "state.json"

    def tearDown(self):
        self.dir.cleanup()

    def test_set_status_and_resume(self):
        ls.set_status("a", "extracted", self.path)
        ls.set_status("a", "chunked", self.path)
        self.assertEqual(ls.get_status("a", self.path), "chunked")
        self.assertTrue(ls.at_least("a", "extracted", self.path))
        self.assertFalse(ls.at_least("a", "qa_passed", self.path))
        again = ls.load(self.path)
        self.assertEqual(again["sources"]["a"]["status"], "chunked")
        with self.assertRaises(ls.UnknownStatus):
            ls.set_status("a", "bogus", self.path)

    def test_costs_totals_and_budget(self):
        self.assertEqual(ls.budget_remaining(self.path), 15.0)
        ls.add_cost("a", 1.25, "boundaries", self.path)
        ls.add_cost("b", 0.75, "embedding", self.path)
        ls.add_cost("a", 0.5, "boundaries", self.path)
        self.assertAlmostEqual(ls.total_cost(self.path), 2.5)
        self.assertAlmostEqual(ls.budget_remaining(self.path), 12.5)
        self.assertAlmostEqual(ls.load(self.path)["sources"]["a"]["cost_usd"], 1.75)
        self.assertAlmostEqual(ls.load(self.path)["cost_usd_total"], 2.5)

    def test_budget_refusal(self):
        ls.set_budget(1.0, self.path)
        ls.refuse_to_start(0.5, self.path)  # fine
        ls.add_cost("a", 1.0, "x", self.path)
        with self.assertRaises(ls.BudgetExhausted):
            ls.refuse_to_start(0.0, self.path)
        ls.set_budget(5.0, self.path)
        with self.assertRaises(ls.BudgetExhausted):
            ls.refuse_to_start(4.5, self.path)

    def test_pricing_from_usage(self):
        # 1M uncached in, 1M cached in, 1M out at gpt-4.1-mini = 0.40 + 0.10 + 1.60
        cost = ls.cost_from_usage("gpt-4.1-mini", prompt_tokens=2_000_000, completion_tokens=1_000_000, cached_tokens=1_000_000)
        self.assertAlmostEqual(cost, 2.10)
        self.assertAlmostEqual(ls.cost_from_usage("text-embedding-3-small", prompt_tokens=1_000_000), 0.02)

    def test_write_is_atomic_and_leaves_no_temp_files(self):
        ls.set_status("a", "pending", self.path)
        leftovers = [p.name for p in self.path.parent.iterdir() if p.name.endswith(".tmp")]
        self.assertEqual(leftovers, [])
        json.loads(self.path.read_text())


class OrchestrationTests(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        root = Path(self.dir.name)
        (root / "src").mkdir()
        text = "\n\n".join(f"Paragraph {i} starts. " + filler(120, f"q{i}") for i in range(12))
        (root / "src" / "doc.txt").write_text(text)
        self.entry = {"source_id": "doc", "path": "src/doc.txt", "pillar": "p", "type": "article", "format": "txt",
                      "title": "Doc", "is_pilot": False, "status_hint": None, "duplicate_of": None, "text_native": True}
        self.opts = rl.Options(offline=True, out_root=root / "library", archive_root=root / "_archive",
                               state_path=root / "state.json", legacy_root=None, repo_root=root, quiet=True)
        self.root = root

    def tearDown(self):
        self.dir.cleanup()

    def test_pipeline_runs_and_is_resumable(self):
        rl.process_source(self.entry, ("extract", "chunk", "qa"), self.opts)
        status = ls.get_status("doc", self.opts.state_path)
        self.assertIn(status, ("qa_passed", "needs_review"))
        chunks_path = self.opts.out_root / "doc" / "chunks.jsonl"
        stamp = chunks_path.stat().st_mtime_ns
        # Second run: every stage already done, nothing rewritten, nothing archived.
        rl.process_source(self.entry, ("extract", "chunk", "qa"), self.opts)
        self.assertEqual(chunks_path.stat().st_mtime_ns, stamp)
        self.assertFalse((self.opts.archive_root / "doc").exists())

    def test_force_archives_previous_chunks_before_overwrite(self):
        rl.process_source(self.entry, ("extract", "chunk", "qa"), self.opts)
        before = (self.opts.out_root / "doc" / "chunks.jsonl").read_text()
        self.opts.force = True
        rl.process_source(self.entry, ("extract", "chunk", "qa"), self.opts)
        archived = list((self.opts.archive_root / "doc").glob("chunks_*.jsonl"))
        self.assertEqual(len(archived), 1)
        self.assertEqual(archived[0].read_text(), before)
        rl.process_source(self.entry, ("chunk",), self.opts)  # same minute again: second archive, first untouched
        archived = list((self.opts.archive_root / "doc").glob("chunks_*.jsonl"))
        self.assertEqual(len(archived), 2)

    def test_enriched_sources_are_not_overwritten_without_force(self):
        rl.process_source(self.entry, ("extract", "chunk", "qa"), self.opts)
        ls.set_status("doc", "enriched", self.opts.state_path)
        path = self.opts.out_root / "doc" / "chunks.jsonl"
        marker = path.read_text() + json.dumps({"id": "x", "embedding": [0.0] * 512}) + "\n"
        path.write_text(marker)
        self.opts.force = False
        rl.process_source(self.entry, ("chunk",), self.opts)
        self.assertEqual(path.read_text(), marker)

    def test_terminal_statuses_from_manifest(self):
        dup = dict(self.entry, source_id="dup", duplicate_of="doc")
        pdf = dict(self.entry, source_id="img", format="epub")
        scanned = dict(self.entry, source_id="scan", text_native=False)
        for entry, expected in ((dup, "duplicate"), (pdf, "unsupported_format"), (scanned, "unsupported_format")):
            rl.process_source(entry, ("extract", "chunk", "qa"), self.opts)
            self.assertEqual(ls.get_status(entry["source_id"], self.opts.state_path), expected)
            self.assertFalse((self.opts.out_root / entry["source_id"]).exists())

    def test_online_run_refuses_when_budget_is_gone(self):
        ls.set_budget(0.5, self.opts.state_path)
        ls.add_cost("other", 0.5, "x", self.opts.state_path)
        manifest = self.root / "m.json"
        manifest.write_text(json.dumps({"sources": [self.entry]}))
        with patch.object(lc.BoundaryProvider, "_call_openai", side_effect=AssertionError("network!")) as call:
            code = rl.main(["--manifest", str(manifest), "--all", "--state", str(self.opts.state_path),
                            "--out-root", str(self.opts.out_root), "--no-legacy"])
        self.assertEqual(code, 2)
        call.assert_not_called()
        self.assertFalse((self.opts.out_root / "doc" / "chunks.jsonl").exists())

    def test_budget_skips_llm_when_estimate_does_not_fit(self):
        paras = [para(f"Idea {i}. " + filler(300, f"b{i}")) for i in range(6)]
        provider = lc.BoundaryProvider(Path(tempfile.mkdtemp()), offline=False, budget_ok=lambda est: False,
                                       api_key_loader=lambda: "sk-test-not-used")
        with patch.object(lc.BoundaryProvider, "_call_openai", side_effect=AssertionError("network!")) as call:
            chunks, rows, stats = lc.build_chunks(paras, {"source_id": "t"}, provider)
        call.assert_not_called()
        self.assertEqual(provider.stats["budget_skips"], 1)
        self.assertEqual(provider.stats["rule_fallback_segments"], 1)

    def test_cost_recorded_only_from_returned_usage(self):
        paras = [para(f"Idea {i}. " + filler(300, f"m{i}")) for i in range(6)]
        recorded = []
        provider = lc.BoundaryProvider(Path(tempfile.mkdtemp()), offline=False, api_key_loader=lambda: "sk-test",
                                       record_cost=lambda usd, purpose, usage: recorded.append((usd, purpose, usage)))
        fake = ({"starts": [{"start": 1, "boundary_kind": "chapter_start", "reason": "r"},
                            {"start": 4, "boundary_kind": "real_boundary", "reason": "r"}]},
                {"prompt_tokens": 10_000, "completion_tokens": 500, "cached_tokens": 2_000}, "resp_1")
        with patch.object(lc.BoundaryProvider, "_call_openai", return_value=fake):
            chunks, rows, stats = lc.build_chunks(paras, {"source_id": "t"}, provider)
        self.assertEqual(len(recorded), 1)
        expected = ls.cost_from_usage("gpt-4.1-mini", 10_000, 500, 2_000)
        self.assertAlmostEqual(recorded[0][0], expected)
        self.assertEqual(provider.stats["llm_calls"], 1)


# ----------------------------------------------------------------------------
# QA
# ----------------------------------------------------------------------------

class QaTests(unittest.TestCase):
    def chunk(self, cid, text, **kw):
        return {"id": cid, "text": text, "chapter": kw.pop("chapter", "C1"), **kw}

    def test_each_heuristic_fires(self):
        body = filler(300, "ok")
        chunks = [
            self.chunk("a1", body),
            self.chunk("a2", "But it did not stop. " + body),
            self.chunk("a3", body + " and then without a stop"),
            self.chunk("a4", body + "\n\nHere are the steps:"),
            self.chunk("a5", "Tiny chunk."),
            self.chunk("a6", filler(800, "huge")),
            self.chunk("a7", "Tim was a sixthgrader with selfcontrol. " + body),
            self.chunk("a8", "A claim.* " + body),
            self.chunk("a9", "Figure 5.3: Tiffany Stock Price\n\n" + body),
            self.chunk("b1", body + "\n\nQuote.\n\n—Walt Whitman"),
            self.chunk("b2", "HOW NOT TO GET PAID Let us pause here. " + body, chapter="C2"),
        ]
        result = qa.qa_chunks(chunks)
        counts = result["heuristic_counts"]
        self.assertEqual(counts["continuation_opener"], 1)
        self.assertIn("a3", result["heuristic_examples"]["no_terminal_punctuation"])
        self.assertEqual(counts["lead_in_at_end"], 1)
        self.assertGreaterEqual(counts["under_150_words"], 1)
        self.assertEqual(counts["over_700_unflagged"], 1)
        self.assertEqual(counts["lost_hyphen"], 1)
        self.assertEqual(counts["footnote_marker"], 1)
        self.assertEqual(counts["figure_caption"], 1)
        self.assertEqual(counts["epigraph_at_chapter_end"], 1)
        self.assertEqual(counts["runin_heading_or_dateline"], 1)
        self.assertFalse(result["gate"]["passed"])

    def test_flagged_oversize_is_accepted(self):
        chunk = self.chunk("a", filler(800, "story"), flags=["oversized_story"])
        self.assertEqual(qa.qa_chunks([chunk])["heuristic_counts"]["over_700_unflagged"], 0)

    def test_gate_requires_low_flag_rate_and_median_in_range(self):
        good = [self.chunk(f"g{i}", filler(300, f"g{i}")) for i in range(100)]
        self.assertTrue(qa.qa_chunks(good)["gate"]["passed"])
        small = [self.chunk(f"s{i}", filler(160, f"s{i}")) for i in range(100)]
        r = qa.qa_chunks(small)
        self.assertFalse(r["gate"]["median_ok"])
        self.assertFalse(r["gate"]["passed"])
        flagged = good[:96] + [self.chunk(f"f{i}", "But no. " + filler(300, "f")) for i in range(4)]
        self.assertFalse(qa.qa_chunks(flagged)["gate"]["flagged_ok"])

    def test_tolerates_pilot_format_missing_fields(self):
        old = [{"id": "old_1", "text": filler(250, "o") + "\n\nSecond."}, {"text": filler(260, "p")}]
        result = qa.qa_chunks(old)
        self.assertEqual(result["chunks"], 2)

    def test_lost_hyphen_uses_source_evidence(self):
        chunks = [self.chunk("a", "She showed self-control in the end. " + filler(200, "a")),
                  self.chunk("b", "He lacked selfcontrol at the time. " + filler(200, "b"))]
        suspects = qa.lost_hyphen_tokens(chunks)
        self.assertEqual(list(suspects), ["b"])

    def test_epigraph_only_chunk_is_flagged_at_chapter_end(self):
        chunks = [self.chunk("a", filler(300, "z"), chapter="C1"),
                  self.chunk("b", "Man will only become better.\n\n—Anton Chekhov", chapter="C1"),
                  self.chunk("c", filler(300, "y"), chapter="C2")]
        self.assertEqual(qa.qa_chunks(chunks)["heuristic_counts"]["epigraph_at_chapter_end"], 1)


# ----------------------------------------------------------------------------
# Offline fixture run on the pilot books (cached boundaries, no API)
# ----------------------------------------------------------------------------

class OfflineFixtureRegression(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import regression
        needed = [REPO / f["path"] for f in regression.FIXTURES] + [HERE / f["source_id"] / "chunks.jsonl" for f in regression.FIXTURES]
        if not all(p.exists() for p in needed) or fitz is None:
            raise unittest.SkipTest("pilot sources not available")
        cls.dir = tempfile.TemporaryDirectory()
        cls.out = Path(cls.dir.name)
        with patch.object(lc.BoundaryProvider, "_call_openai", side_effect=AssertionError("network!")):
            cls.results = regression.run_regression(out_root=cls.out, write_report=False, quiet=True)

    @classmethod
    def tearDownClass(cls):
        cls.dir.cleanup()

    def test_every_paragraph_preserved_exactly_once(self):
        for sid in self.results["books"]:
            paras = rl.load_paragraphs(self.out / sid)
            chunks = qa.load_chunks(self.out / sid / "chunks.jsonl")
            lc.verify_paragraphs_once(paras, chunks)

    def test_after_passes_the_gate_and_improves_on_before(self):
        for sid, data in self.results["books"].items():
            self.assertTrue(data["after"]["gate"]["passed"], sid)
            self.assertLess(data["after"]["flagged_pct"], data["before"]["flagged_pct"])
            self.assertEqual(data["stats"]["provider"]["llm_calls"], 0)

    def test_audit_defects_are_gone(self):
        texts = {sid: "\n".join(c["text"] for c in qa.load_chunks(self.out / sid / "chunks.jsonl")) for sid in self.results["books"]}
        for word in ("sixthgrader", "businessdevelopment", "holidayseason"):
            self.assertNotIn(word, texts["everything_store"])
        self.assertIn("sixth-grader", texts["everything_store"])
        self.assertNotIn("shortyardage", texts["thinking_in_bets"])
        self.assertIn("short-yardage", texts["thinking_in_bets"])
        self.assertNotRegex(texts["thinking_in_bets"], r"budgeting\.\*")
        for case in self.results["audit_cases"]:
            self.assertTrue(case["found"], case["old_id"])
            self.assertFalse(case.get("opens_on_pattern"), case["old_id"])

    def test_no_chunk_opens_on_a_continuation(self):
        for sid in self.results["books"]:
            chunks = qa.load_chunks(self.out / sid / "chunks.jsonl")
            for prev, chunk in zip(chunks, chunks[1:]):
                if chunk["chapter"] == prev["chapter"] and chunk["section"] == prev["section"]:
                    self.assertFalse(lt.opens_dependent(chunk["text"]), chunk["id"])


if __name__ == "__main__":
    unittest.main()


class RichDadRegressionTests(unittest.TestCase):
    """Defects found on the first real source; each real defect must still flag."""
    def chunk(self, cid, text, **kw):
        return {"id": cid, "text": text, "chapter": "C1", **kw}

    def test_runin_caps_heading_split_off(self):
        import library_text as lt
        head, rest = lt.split_runin_heading("INVEST FIRST IN EDUCATION: In reality, the only real asset you have is your mind.")
        self.assertEqual(head, "INVEST FIRST IN EDUCATION")
        self.assertTrue(rest.startswith("In reality"))
        self.assertIsNone(lt.split_runin_heading("ON THE CONCORDE BACK TO NEW YORK, Brad tells me it is destiny."))

    def test_trailing_page_number_stripped(self):
        import library_text as lt
        self.assertEqual(lt.strip_footnote_markers("I could do it.” 69")[0], "I could do it.”")

    def test_heading_like_line_is_glued_to_what_it_introduces(self):
        from library_extract import Para
        paras = [Para("Body text ends here.", 1, 1, "C", None), Para("Market Timing", 1, 1, "C", None),
                 Para("Timing the market is hard.", 1, 1, "C", None)]
        self.assertTrue(lc._glued(paras, 1, 2))
        self.assertFalse(lc._glued(paras, 0, 1))

    def test_open_ended_paragraph_merges_across_blocks_on_same_page(self):
        from library_extract import Para, _append_paragraph
        paras = [Para("word " * 14 + "in or near", 5, 5, "C", None)]
        _append_paragraph(paras, Para("Chicago.”", 5, 5, "C", None))
        self.assertEqual(len(paras), 1)
        paras = [Para("word " * 14 + "Done.", 5, 5, "C", None)]
        _append_paragraph(paras, Para("Next.", 5, 5, "C", None))
        self.assertEqual(len(paras), 2)


class SweepFixTests(unittest.TestCase):
    def test_continuation_crosses_chapter_boundary_on_lowercase_opener(self):
        from library_extract import Para, _append_paragraph
        paras = [Para("It reduces " + "word " * 14 + "which the reorganisation", 788, 788, "Chapter 08", None)]
        _append_paragraph(paras, Para("reduces to a figure that was covered.", 789, 789, "Chapter 09", None))
        self.assertEqual(len(paras), 1)
        self.assertEqual(paras[0].chapter, "Chapter 08")

    def test_caption_dump_period_moves_back_and_sentences_pack(self):
        lines = ["he was on the board", ". and once Warren was there he helped", ". so it went"]
        packed = le._pack_caption_dump(lines, target=5)
        self.assertEqual(" ".join(packed), "he was on the board. and once Warren was there he helped. so it went.")
        self.assertTrue(all(p.endswith(".") for p in packed))

    def test_trailing_heading_debris_dropped_but_prose_kept(self):
        from library_extract import Para, _drop_trailing_heading_debris
        prose = "This is a complete paragraph of prose that clearly ends. " * 2
        paras = [Para(prose, 1, 1, "C1", "S1"), Para("Market Timing", 1, 1, "C1", "S1"),
                 Para("Next section begins here with real prose.", 2, 2, "C1", "S2")]
        report = {"removed": {}}
        out = _drop_trailing_heading_debris(paras, report)
        self.assertEqual([p.text for p in out], [prose, "Next section begins here with real prose."])
        self.assertEqual(report["trailing_heading_debris"][0]["text"], "Market Timing")
        keep = [Para(prose, 1, 1, "C1", "S1"), Para("Yes, it ended there.", 1, 1, "C1", "S1"),
                Para("Next.", 2, 2, "C1", "S2")]
        self.assertEqual(len(_drop_trailing_heading_debris(keep, {"removed": {}})), 3)

    def test_quotation_stays_with_attribution_and_opens_what_follows(self):
        from library_extract import Para
        paras = [Para("Earlier prose ends here.", 1, 1, "C", "S"),
                 Para("“Hang on to it for a short while.”", 1, 1, "C", "S"),
                 Para("—EARL CONRAD, A MEMOIR", 1, 1, "C", "S"),
                 Para("In the first few days she missed her village.", 1, 1, "C", "S")]
        self.assertFalse(lc._glued(paras, 0, 1) and not lc._glued(paras, 1, 2))
        self.assertTrue(lc._glued(paras, 1, 2))
        self.assertTrue(lc._glued(paras, 2, 3))
        self.assertFalse(lc._glued(paras, 0, 1))

    def test_toc_without_numbered_chapters_does_not_crash(self):
        toc = [[1, "Prologue", 5], [1, "Why Things Break", 20], [1, "The Fix", 60], [1, "Epilogue", 100]]
        plans = le.plan_chapters_from_toc(toc, 120)
        self.assertGreaterEqual(len(plans), 2)


class GluedAndDiagramTests(unittest.TestCase):
    def test_glued_words_repaired_with_evidence_only(self):
        texts = ["He steppedacross the floor.", "The gap between the haves and havenots grew, the have-nots said.",
                 "Over a threemonth period.", "A mindset shaped him; that mindset stayed; the mindset won; mind-set once."]
        out, fixes = lt.repair_glued_words(texts)
        self.assertEqual(out[0], "He stepped across the floor.")
        self.assertIn("have-nots", out[1])
        self.assertIn("three-month", out[2])
        self.assertEqual(out[3], texts[3])   # majority solid spelling is left alone

    def test_ascii_diagram_stripped_prose_kept_labels_dropped(self):
        text, art = lt.strip_ascii_diagram("The bottom diagram is the Balance Sheet. +----------+ | Assets | -------> It is called that because it balances.")
        self.assertIn("The bottom diagram is the Balance Sheet.", text)
        self.assertNotIn("+---", text)
        self.assertEqual(lt.strip_ascii_diagram("How the Rich Play the Game ------------ ---------> Income")[0], "")

    def test_lesson_list_lines_are_list_items(self):
        self.assertTrue(lt.is_list_item("Lesson #2 Why Teach Financial Literacy?"))
