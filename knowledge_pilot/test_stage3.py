import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import knowledge_pilot_stage3 as stage
from knowledge_rechunk_pilot import Paragraph


class Stage3Tests(unittest.TestCase):
    def test_citations_removed_but_scientific_powers_retained(self):
        line = {"spans": [{"text": "Rambler.", "flags": 4}, {"text": "12", "flags": 5}]}
        self.assertEqual(stage.span_line(line, "seven_powers"), "Rambler.")
        line = {"spans": [{"text": "10", "flags": 4}, {"text": "3", "flags": 5}]}
        self.assertEqual(stage.span_line(line, "how_the_world_really_works"), "10^3")
        line["spans"][1]["text"] = "-7"
        self.assertEqual(stage.span_line(line, "how_the_world_really_works"), "10^-7")

    def test_missing_review_ids_are_requested_individually(self):
        batch = [{"id": "a"}, {"id": "b"}]
        responses = [{"result": {"decisions": [{"id": "a"}]}},
                     {"result": {"decisions": [{"id": "b"}]}}]
        with tempfile.TemporaryDirectory(dir=stage.OUTPUT_ROOT) as directory, patch.object(stage, "request", side_effect=responses) as mocked:
            decisions = stage.reviewed_decisions(Path(directory), "short", "prompt", "candidates", batch, stage.ShortReview)
        self.assertEqual([d["id"] for d in decisions], ["a", "b"])
        self.assertEqual(mocked.call_args.args[3], {"candidates": [{"id": "b"}]})

    def test_offline_fallback_never_calls_api(self):
        with tempfile.TemporaryDirectory(dir=stage.OUTPUT_ROOT) as directory, patch.object(stage, "OFFLINE_MODE", True), patch.object(stage, "OpenAI", side_effect=AssertionError("Network forbidden")):
            result = stage.request(Path(directory), "short", "prompt",
                                   {"candidates": [{"id": "1", "previous": "Context.", "next": None}]}, stage.ShortReview)
            self.assertFalse(result["result"]["decisions"][0]["self_contained"])
            with self.assertRaisesRegex(RuntimeError, "Offline cache miss"):
                stage.request(Path(directory), "audit", "prompt", {"boundaries": []}, stage.BoundaryAudit)

    def test_out_of_range_markers_do_not_lose_source(self):
        body = [Paragraph("A complete point.", 1, 1), Paragraph("Another complete point.", 1, 1)]
        marks = {"result": {"starts": [
            {"start": 1, "boundary_kind": "chapter_start", "reason": "Start"},
            {"start": 99, "boundary_kind": "real_boundary", "reason": "Invalid"}]}}
        groups = stage.groups_from_plan(body, marks)
        self.assertEqual([p.text for g in groups for p in g["paragraphs"]], [p.text for p in body])

    def test_model_starts_preserve_every_paragraph_in_order(self):
        paragraphs = [Paragraph("First complete point.", 1, 1),
                      Paragraph("More on the same point.", 1, 1),
                      Paragraph("A different completed story.", 2, 2)]
        result = {"result": {"starts": [
            {"start": 1, "boundary_kind": "chapter_start", "reason": "Opening"},
            {"start": 3, "boundary_kind": "real_boundary", "reason": "New event"},
        ]}}
        groups = stage.groups_from_plan(paragraphs, result)
        self.assertEqual([p.text for g in groups for p in g["paragraphs"]], [p.text for p in paragraphs])
        self.assertEqual([len(g["paragraphs"]) for g in groups], [2, 1])

    def test_dangling_pronouns_join_their_antecedent(self):
        paragraphs = [Paragraph("Jeff introduced the proposal.", 1, 1), Paragraph("He explained its outcome.", 1, 1)]
        result = {"result": {"starts": [
            {"start": 1, "boundary_kind": "chapter_start", "reason": "Start"},
            {"start": 2, "boundary_kind": "real_boundary", "reason": "Wrong proposal"},
        ]}}
        self.assertEqual(len(stage.groups_from_plan(paragraphs, result)), 1)

    def test_incomplete_short_response_merges_with_its_question(self):
        previous = Paragraph("Question and setup. " + "word " * 120 + ".", 1, 1, chapter="Chapter 1")
        response = Paragraph('Alex answered, "Yes."', 1, 1, chapter="Chapter 1")
        groups = [{"paragraphs": [previous], "boundary_kind": "chapter_start", "boundary_reason": "Start"},
                  {"paragraphs": [response], "boundary_kind": "real_boundary", "boundary_reason": "Reply"}]
        mock = {"result": {"decisions": [{"id": "1", "self_contained": False, "merge": "previous", "reason": "Reply needs its question"}]}}
        with tempfile.TemporaryDirectory(dir=stage.OUTPUT_ROOT) as directory, patch.object(stage, "request", return_value=mock):
            result, decisions = stage.short_review(groups, Path(directory))
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["paragraphs"], [previous, response])
        self.assertFalse(decisions[0]["self_contained"])

    def test_short_maxim_is_kept(self):
        point = Paragraph("Maintain enough reserves to survive a bad year.", 1, 1, chapter="Chapter 1")
        groups = [{"paragraphs": [point], "boundary_kind": "chapter_start", "boundary_reason": "Complete maxim"}]
        mock = {"result": {"decisions": [{"id": "0", "self_contained": True, "merge": "keep", "reason": "Complete advice"}]}}
        with tempfile.TemporaryDirectory(dir=stage.OUTPUT_ROOT) as directory, patch.object(stage, "request", return_value=mock):
            result, _ = stage.short_review(groups, Path(directory))
        self.assertEqual(result[0]["paragraphs"], [point])


if __name__ == "__main__":
    unittest.main()
