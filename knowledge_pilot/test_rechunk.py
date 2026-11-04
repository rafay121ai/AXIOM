import unittest
from types import SimpleNamespace

from scripts.knowledge_rechunk_pilot import (
    BOOKS, Paragraph, block_texts, is_sentence_complete, make_chunk,
    canonical_plan, dependent_start, plan_problems, validate_plan,
)


class RechunkTests(unittest.TestCase):
    def test_note_references_removed_and_financial_numbers_kept(self):
        page = SimpleNamespace(get_text=lambda mode: {"blocks": [{"lines": [{"spans": [
            {"text": "Rambler.", "flags": 4},
            {"text": "12", "flags": 5},
            {"text": " A $9.99 book in 2006.", "flags": 4},
        ]}]}]})
        self.assertEqual(block_texts(page), ["Rambler. A $9.99 book in 2006."])

    def test_curly_quotes_do_not_merge_distinct_paragraphs(self):
        self.assertTrue(is_sentence_complete('The outcome was clear.\u201d'))
        self.assertFalse(is_sentence_complete('The story continues'))

    def test_missing_or_overlapping_paragraphs_rejected(self):
        body = [Paragraph("A complete story.", 1, 1), Paragraph("Another story.", 2, 2)]
        for plan in ([{"start": 1, "end": 1}],
                     [{"start": 1, "end": 2}, {"start": 2, "end": 2}]):
            with self.assertRaises(ValueError):
                validate_plan(plan, body)

    def test_topic_starts_define_complete_contiguous_ranges(self):
        body = [Paragraph("Complete paragraph.", 1, 1) for _ in range(5)]
        plan = canonical_plan([{"start": 1, "end": 1}, {"start": 4, "end": 4}], body)
        self.assertEqual(plan, [{"start": 1, "end": 3}, {"start": 4, "end": 5}])
        validate_plan(plan, body)

    def test_dependent_chunk_start_flagged(self):
        body = [Paragraph("Jeff Wilke introduced metrics.", 1, 1),
                Paragraph("That holiday, he held daily calls.", 2, 2)]
        self.assertTrue(plan_problems([{"start": 1, "end": 1}, {"start": 2, "end": 2}], body))

    def test_impersonal_it_is_not_a_dangling_pronoun(self):
        self.assertFalse(dependent_start("It later became fashionable to say that the Rocketbook was early."))
        self.assertTrue(dependent_start("It was a terrible move."))

    def test_metadata_and_page_range(self):
        body = [Paragraph("First paragraph.", 1, 2, chapter="Chapter 1"),
                Paragraph("Second paragraph.", 2, 3, chapter="Chapter 1")]
        row = make_chunk(BOOKS["everything_store"], 1, 1, 1, body)
        self.assertEqual(row["text"], "First paragraph.\n\nSecond paragraph.")
        self.assertEqual(row["page_range"], [1, 3])
        self.assertIsNone(row["section"])
        self.assertEqual(row["book_pillar"], "money_game")
        self.assertEqual(row["pillars"], [])
        self.assertNotIn("pillar", row)


if __name__ == "__main__":
    unittest.main()
