"""Tests for stages 3 to 6 (extraction, validation, dedupe, embedding) with a MOCKED OpenAI client.
No test here can reach the network: the only client is FakeClient."""

from __future__ import annotations

import hashlib
import json
import math
import random
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))

import library_lessons as ll  # noqa: E402
import library_paragraphs as lp  # noqa: E402
import library_state as state  # noqa: E402
import run_lessons as rl  # noqa: E402


# ----------------------------------------------------------------------------
# Fixtures and the fake client
# ----------------------------------------------------------------------------

SID = "book-one"


def good_lesson(ids, **over):
    base = dict(
        paragraph_ids=list(ids), title="Test a promising method at small scale first",
        author_argues="Jane Smith argues that a small test within days beats a long plan. She says the result, not the opinion, decides.",
        founder_action="Run the method once at small scale within 3 days, then judge it on the result.",
        applies_when="You have a promising idea and people are debating it.", caveat=None,
        evidence="She ran 3 tests in a week.", short_quote="Small bets teach faster", example_questions=[
            "Everyone has an opinion on my pricing idea. How do I settle it?",
            "I have an idea and no time. What is the cheapest way to test it?",
            "My cofounder wants a six month plan first. Is that right?"],
        lesson_type="principle", pillars=["think_sharper"])
    base.update(over)
    return ll.LessonOut(**base)


P_TEXT = ("Small bets teach faster than big plans. In one week she ran 3 tests with 20 customers. "
          "A founder who tests an idea within days learns what the plan cannot say.")


def make_window(n=0, sid=SID, text=P_TEXT, ctx_text="Earlier context paragraph, read for meaning only."):
    pid, cid = f"{sid}_p{n * 10 + 1:04d}", f"{sid}_p{n * 10:04d}"
    paras = [{"id": pid, "text": text, "section": None, "page": 5, "context_only": False},
             {"id": f"{sid}_p{n * 10 + 2:04d}", "text": "Another paragraph that also belongs to this window.",
              "section": None, "page": 5, "context_only": False}]
    ctx = [{"id": cid, "text": ctx_text, "section": None, "page": 4, "context_only": True}]
    h = hashlib.sha256(json.dumps([text, ctx_text, n]).encode()).hexdigest()[:16]
    return {"window_id": f"{sid}_w{n:04d}", "source_id": sid, "index": n, "chapter": "Chapter 1: Alpha", "sections": [],
            "page_start": 5, "page_end": 5, "word_count": 40, "context": ctx, "paragraphs": paras, "hash": h}


class FakeClient:
    """Mimics the two OpenAI calls the pipeline makes. Scripted per test; records every call."""

    def __init__(self, responder=None, usage=(1000, 300, 0)):
        self.responder = responder or (lambda messages, model, n: ll.WindowOut(lessons=[]))
        self.usage = usage
        self.parse_calls: list[dict] = []
        self.embed_calls: list[dict] = []
        self.vectors: dict[str, list[float]] = {}
        self.beta = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(parse=self._parse)))
        self.embeddings = SimpleNamespace(create=self._embed)

    def _parse(self, **kw):
        self.parse_calls.append(kw)
        out = self.responder(kw["messages"], kw["model"], len(self.parse_calls))
        if isinstance(out, Exception):
            raise out
        pt, ct, cached = self.usage
        usage = SimpleNamespace(prompt_tokens=pt, completion_tokens=ct,
                                prompt_tokens_details=SimpleNamespace(cached_tokens=cached))
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(parsed=out))], usage=usage)

    def _embed(self, model, input, dimensions, timeout):
        self.embed_calls.append({"model": model, "n": len(input), "dimensions": dimensions, "timeout": timeout})
        data = []
        for i, t in enumerate(input):
            vec = self.vectors.get(t)
            if vec is None:
                rng = random.Random(hashlib.sha256(t.encode()).hexdigest())
                vec = [rng.uniform(-1, 1) for _ in range(dimensions)]
            data.append(SimpleNamespace(index=i, embedding=vec))
        return SimpleNamespace(data=data, usage=SimpleNamespace(total_tokens=20 * len(input)))


@pytest.fixture
def st(tmp_path):
    path = tmp_path / "state.json"
    state.set_budget(5.0, path)
    return path


def no_sleep(_):
    return None


def extractor(tmp_path, st, client, model="gpt-4.1-mini", **kw):
    return ll.Extractor(SID, model, client, tmp_path / f"lessons_{model}", st, "Test Book", "Jane Smith",
                        sleep=no_sleep, **kw)


# ----------------------------------------------------------------------------
# Schema, prompt, context-only exclusion
# ----------------------------------------------------------------------------

def test_schema_fields_exactly_as_designed():
    assert list(ll.LessonOut.model_fields) == [
        "paragraph_ids", "title", "author_argues", "founder_action", "applies_when", "caveat", "evidence",
        "short_quote", "example_questions", "lesson_type", "pillars"]


def test_prompt_contains_quality_rules_and_the_spec_examples():
    p = ll.SYSTEM_PROMPT
    assert "Take action on new ideas." in p
    assert "run it once at small scale within days, before anyone talks you out of it, then judge it on the result" in p
    for needle in ("SPECIFIC", "ACTIONABLE", "GROUNDED", "zero lessons", "name", "CONTEXT ONLY"):
        assert needle.lower() in p.lower()


def test_context_paragraphs_are_rendered_as_context_only_and_not_citable():
    w = make_window(1)
    text = ll.render_window(w, "Test Book", "Jane Smith")
    ctx_pos, cite_pos = text.index("CONTEXT ONLY"), text.index("PARAGRAPHS YOU MAY CITE")
    assert ctx_pos < text.index(w["context"][0]["id"]) < cite_pos < text.index(w["paragraphs"][0]["id"])
    assert "AUTHOR: Jane Smith" in text and "BOOK: Test Book" in text


def test_validation_rejects_a_lesson_that_cites_a_context_paragraph():
    w = make_window()
    l = good_lesson([w["context"][0]["id"]]).model_dump()
    assert any(r.startswith("cites_context_only") for r in ll.validate_lesson(l, w, "Jane Smith"))


# ----------------------------------------------------------------------------
# Validation: each failure type
# ----------------------------------------------------------------------------

def reasons(**over):
    w = make_window()
    ids = over.pop("ids", [w["paragraphs"][0]["id"]])
    l = good_lesson(ids, **over).model_dump()
    return ll.validate_lesson(l, w, "Jane Smith")


def test_valid_lesson_passes():
    assert reasons() == []


def test_drop_unknown_paragraph_id():
    assert any(r.startswith("unknown_paragraph_id") for r in reasons(ids=["nope_p9999"]))


def test_drop_empty_paragraph_ids():
    assert "missing_field:paragraph_ids" in reasons(ids=[])


@pytest.mark.parametrize("field", ["title", "author_argues", "founder_action", "applies_when"])
def test_drop_missing_required_text_field(field):
    assert f"missing_field:{field}" in reasons(**{field: "   "})


def test_optional_fields_may_be_null():
    assert reasons(caveat=None, evidence=None, short_quote=None) == []


def test_drop_quote_not_exact_substring():
    assert "short_quote_not_exact" in reasons(short_quote="Small bets teach slower")


def test_quote_exact_after_normalising_curly_quotes_and_whitespace():
    w = make_window(text="She said “don’t wait”   to\nthe room. Then 3 tests ran. " + "word " * 5)
    l = good_lesson([w["paragraphs"][0]["id"]], short_quote='said "don\'t wait" to the room',
                    founder_action="Run it once.", author_argues="Jane Smith says go.", evidence=None).model_dump()
    assert ll.validate_lesson(l, w, "Jane Smith") == []


def test_drop_quote_over_15_words():
    long_text = " ".join(f"w{i}" for i in range(20)) + ". 3 tests."
    w = make_window(text=long_text)
    l = good_lesson([w["paragraphs"][0]["id"]], short_quote=" ".join(f"w{i}" for i in range(16)),
                    founder_action="Run it once.", author_argues="Jane Smith says go.", evidence=None).model_dump()
    assert "short_quote_too_long" in ll.validate_lesson(l, w, "Jane Smith")


def test_drop_number_not_in_cited_paragraphs():
    r = reasons(founder_action="Run the method for 45 days, then judge it on the result.")
    assert any(x.startswith("number_not_in_paragraphs:founder_action:45") for x in r)
    r = reasons(author_argues="Jane Smith found 99 percent of founders fail.")
    assert any(x.startswith("number_not_in_paragraphs:author_argues") for x in r)


def test_numbers_in_text_are_allowed_including_commas_and_number_words():
    w = make_window(text="The firm raised 1,200 dollars from three friends in 20 days. It was enough.")
    l = good_lesson([w["paragraphs"][0]["id"]], founder_action="Raise 1200 dollars from 3 friends in 20 days.",
                    author_argues="Jane Smith says start small.", evidence=None, short_quote=None).model_dump()
    assert ll.validate_lesson(l, w, "Jane Smith") == []


def test_drop_when_example_questions_not_three():
    assert "example_questions_not_3" in reasons(example_questions=["a?", "b?"])
    assert "example_questions_not_3" in reasons(example_questions=["a?", "b?", "c?", "d?"])
    assert "example_questions_not_3" in reasons(example_questions=["a?", "", "c?"])


def test_drop_when_author_not_named():
    assert "author_not_named" in reasons(author_argues="The author argues small tests win.")


def test_validate_all_splits_valid_and_dropped_with_reasons():
    w = make_window()
    ok = good_lesson([w["paragraphs"][0]["id"]]).model_dump()
    bad = good_lesson(["ghost"]).model_dump()
    valid, dropped = ll.validate_all([{"window_id": w["window_id"], "lessons": [ok, bad]}], [w], "Jane Smith")
    assert len(valid) == 1 and len(dropped) == 1
    assert dropped[0]["reasons"][0].startswith("unknown_paragraph_id") and dropped[0]["window_id"] == w["window_id"]


# ----------------------------------------------------------------------------
# Extraction: calls, cost per model, retries, budget, resume, A/B
# ----------------------------------------------------------------------------

def one_lesson_responder(messages, model, n):
    w_ids = [l.split("]")[0][1:] for l in messages[1]["content"].splitlines() if l.startswith("[")]
    return ll.WindowOut(lessons=[good_lesson([w_ids[-2]])])


def test_one_call_per_window_with_structured_output_settings(tmp_path, st):
    c = FakeClient(one_lesson_responder)
    ex = extractor(tmp_path, st, c)
    rows = ex.run([make_window(0), make_window(1)])
    assert len(c.parse_calls) == 2 and len(rows) == 2
    kw = c.parse_calls[0]
    assert kw["model"] == "gpt-4.1-mini" and kw["response_format"] is ll.WindowOut and kw["timeout"] == 60
    assert kw["messages"][0]["role"] == "system" and "GROUNDED" in kw["messages"][0]["content"]


def test_zero_lessons_is_a_valid_answer(tmp_path, st):
    c = FakeClient()                                          # default responder: no lessons
    rows = extractor(tmp_path, st, c).run([make_window(0)])
    assert rows == [{"window_id": f"{SID}_w0000", "lessons": []}]


def test_cost_recorded_per_call_from_usage_per_source_and_per_model(tmp_path, st):
    c = FakeClient(usage=(10_000, 2_000, 0))
    extractor(tmp_path, st, c, "gpt-4.1-mini").run([make_window(0), make_window(1)])
    mini = 2 * (10_000 * 0.40 + 2_000 * 1.60) / 1e6
    assert state.cost_by_model(SID, st)["gpt-4.1-mini"] == pytest.approx(mini)
    extractor(tmp_path, st, c, "gpt-4.1").run([make_window(0)])
    big = (10_000 * 2.00 + 2_000 * 8.00) / 1e6
    by = state.cost_by_model(SID, st)
    assert by["gpt-4.1"] == pytest.approx(big) and by["gpt-4.1-mini"] == pytest.approx(mini)
    rows = state.load(st)["sources"][SID]["costs"]
    assert all(r["purpose"] == "lessons_extract" for r in rows) and {r["model"] for r in rows} == {"gpt-4.1-mini", "gpt-4.1"}
    assert rows[0]["usage"] == {"prompt_tokens": 10_000, "completion_tokens": 2_000, "cached_tokens": 0}
    assert state.load(st)["sources"][SID]["cost_usd"] == pytest.approx(mini + big)


def test_cached_tokens_are_priced_at_the_cached_rate():
    assert state.cost_from_usage("gpt-4.1", 1_000_000, 0, 1_000_000) == pytest.approx(0.50)
    assert state.cost_from_usage("gpt-4.1-mini", 1_000_000, 1_000_000, 0) == pytest.approx(0.40 + 1.60)
    assert state.PRICING["gpt-4.1"] == {"input": 2.00, "cached_input": 0.50, "output": 8.00}
    assert state.PRICING["gpt-4.1-mini"] == {"input": 0.40, "cached_input": 0.10, "output": 1.60}


def test_retries_up_to_three_attempts_then_succeeds_and_each_billed_call_is_recorded(tmp_path, st):
    seq = [RuntimeError("500"), RuntimeError("500"), ll.WindowOut(lessons=[])]
    c = FakeClient(lambda m, model, n: seq[n - 1])
    ex = extractor(tmp_path, st, c)
    rows = ex.run([make_window(0)])
    assert len(c.parse_calls) == 3 and rows[0]["lessons"] == []
    assert len(state.load(st)["sources"][SID]["costs"]) == 1       # only the call that returned usage is billed


def test_gives_up_after_three_attempts_and_marks_the_window_failed(tmp_path, st):
    c = FakeClient(lambda m, model, n: RuntimeError("boom"))
    ex = extractor(tmp_path, st, c)
    rows = ex.run([make_window(0)])
    assert rows == [] and len(c.parse_calls) == 3 and ex.stats["failed"] == 1


def test_timeout_records_a_conservative_uncertain_cost(tmp_path, st):
    class FakeTimeout(Exception):
        pass
    FakeTimeout.__name__ = "APITimeoutError"
    seq = [FakeTimeout("t"), ll.WindowOut(lessons=[])]
    c = FakeClient(lambda m, model, n: seq[n - 1])
    extractor(tmp_path, st, c).run([make_window(0)])
    purposes = [r["purpose"] for r in state.load(st)["sources"][SID]["costs"]]
    assert "lessons_extract_timeout_uncertain" in purposes and "lessons_extract" in purposes


def test_budget_refusal_before_any_call(tmp_path, st):
    state.set_budget(0.0000001, st)
    c = FakeClient(one_lesson_responder)
    ex = extractor(tmp_path, st, c)
    rows = ex.run([make_window(0), make_window(1)])
    assert c.parse_calls == [] and rows == [] and ex.stats["refused_budget"] >= 1


def test_budget_stops_midway_and_keeps_finished_work(tmp_path, st):
    c = FakeClient(one_lesson_responder, usage=(1_000_000, 100_000, 0))        # about $0.56 per call
    state.set_budget(0.80, st)
    ex = extractor(tmp_path, st, c)
    rows = ex.run([make_window(i) for i in range(4)])
    assert 1 <= len(c.parse_calls) < 4 and len(rows) == len(c.parse_calls)
    assert len(lp.read_jsonl(ex.cache_path)) == len(c.parse_calls)


def test_preflight_refuses_the_whole_source_when_the_estimate_exceeds_the_budget(tmp_path, st):
    lib = tmp_path / "library"
    paras = [{"id": f"{SID}_p{i:04d}", "source_id": SID, "index": i, "text": "word " * 199 + "end.", "chapter": "C",
              "section": None, "heading_path": ["C"], "page": 1, "page_start": 1, "page_end": 1, "word_count": 200,
              "kind": "body", "scene_break": False} for i in range(60)]
    lp.write_jsonl(lib / SID / "paragraphs_v2.jsonl", paras)
    manifest = {"sources": [{"source_id": SID, "title": "Test Book", "format": "pdf", "path": "x.pdf"}]}
    state.set_budget(0.001, st)
    c = FakeClient(one_lesson_responder)
    with pytest.raises(state.BudgetExhausted):
        rl.run_source(SID, "gpt-4.1-mini", ["windows", "extract"], c, c, lib, st, manifest=manifest, sleep=no_sleep)
    assert c.parse_calls == []


def test_resume_skips_finished_windows(tmp_path, st):
    wins = [make_window(i) for i in range(3)]
    c = FakeClient(one_lesson_responder)
    extractor(tmp_path, st, c).run(wins[:2])
    assert len(c.parse_calls) == 2
    c2 = FakeClient(one_lesson_responder)
    ex2 = extractor(tmp_path, st, c2)                      # fresh process, same output dir
    rows = ex2.run(wins)
    assert len(c2.parse_calls) == 1 and ex2.stats["cached"] == 2 and len(rows) == 3
    assert [r["window_id"] for r in rows] == [w["window_id"] for w in wins]


def test_cache_key_includes_model_prompt_version_and_window_hash(tmp_path, st, monkeypatch):
    w = make_window(0)
    k_mini = extractor(tmp_path, st, FakeClient(), "gpt-4.1-mini").cache_key(w)
    k_big = extractor(tmp_path, st, FakeClient(), "gpt-4.1").cache_key(w)
    assert k_mini != k_big
    monkeypatch.setattr(ll, "PROMPT_VERSION", "other")
    assert extractor(tmp_path, st, FakeClient(), "gpt-4.1-mini").cache_key(w) != k_mini
    monkeypatch.undo()
    w2 = dict(w, hash="different")
    assert extractor(tmp_path, st, FakeClient(), "gpt-4.1-mini").cache_key(w2) != k_mini


def test_changed_window_text_is_extracted_again(tmp_path, st):
    c = FakeClient(one_lesson_responder)
    extractor(tmp_path, st, c).run([make_window(0)])
    extractor(tmp_path, st, c).run([make_window(0, text=P_TEXT + " One more sentence.")])
    assert len(c.parse_calls) == 2


def test_parallel_workers_produce_the_same_rows_in_window_order(tmp_path, st):
    wins = [make_window(i) for i in range(6)]
    c = FakeClient(one_lesson_responder)
    rows = extractor(tmp_path, st, c, workers=4).run(wins)
    assert [r["window_id"] for r in rows] == [w["window_id"] for w in wins]
    assert len(state.load(st)["sources"][SID]["costs"]) == 6


def test_ab_runs_write_to_separate_directories(tmp_path):
    a = ll.lessons_dir(SID, "gpt-4.1-mini", None, tmp_path)
    b = ll.lessons_dir(SID, "gpt-4.1", None, tmp_path)
    c = ll.lessons_dir(SID, "gpt-4.1", "ab_big", tmp_path)
    assert len({a, b, c}) == 3 and a.name == "lessons_gpt-4.1-mini" and b.name == "lessons_gpt-4.1" and c.name == "lessons_ab_big"
    assert a.parent == tmp_path / SID


# ----------------------------------------------------------------------------
# Dedupe
# ----------------------------------------------------------------------------

def unit(i, n=512):
    v = [0.0] * n
    v[i] = 1.0
    return v


def near(i, j, mix):
    v = [0.0] * 512
    v[i], v[j] = 1.0, mix
    return v


def cand(wid, ids, **over):
    return {"window_id": wid, "lesson": good_lesson(ids, **over).model_dump()}


def test_cosine_basics():
    assert ll.cosine(unit(0), unit(0)) == pytest.approx(1.0)
    assert ll.cosine(unit(0), unit(1)) == pytest.approx(0.0)


def test_dedupe_merges_above_threshold_keeps_more_specific_and_unions_paragraphs():
    vague = cand("w0", ["p1"], founder_action="Test your idea soon.")
    sharp = cand("w1", ["p7"], founder_action="Run the method once at 3 small customers within 3 days, then judge it on Friday's result.")
    other = cand("w2", ["p9"], title="Something else entirely")
    vecs = [near(0, 1, 0.05), near(0, 1, 0.1), unit(5)]            # cos(vague, sharp) ~ 0.997
    kept, merges = ll.dedupe([vague, sharp, other], vecs)
    assert len(kept) == 2 and len(merges) == 1
    survivor = next(k for k in kept if k["window_id"] == "w1")
    assert survivor["lesson"]["founder_action"].startswith("Run the method")
    assert survivor["lesson"]["paragraph_ids"] == ["p1", "p7"]
    assert merges[0]["similarity"] > 0.92 and merges[0]["dropped_founder_action"] == "Test your idea soon."
    assert [k["window_id"] for k in kept] == ["w1", "w2"]            # document order preserved


def test_dedupe_does_not_merge_at_or_below_threshold():
    a, b = cand("w0", ["p1"]), cand("w1", ["p2"])
    mix = 0.4                                                       # cos = 1/sqrt(1+mix^2)... chosen below 0.92
    v1, v2 = unit(0), near(0, 1, 1.0)                               # cos ~ 0.707
    kept, merges = ll.dedupe([a, b], [v1, v2])
    assert len(kept) == 2 and merges == []
    exact = [0.0] * 512
    exact[0] = 1.0
    # a pair at exactly 0.92 similarity is NOT merged (strictly greater than)
    t = 0.92
    v3 = [0.0] * 512
    v3[0], v3[1] = t, math.sqrt(1 - t * t)
    kept, merges = ll.dedupe([a, b], [exact, v3], threshold=0.92)
    assert merges == [] and len(kept) == 2


def test_dedupe_chain_collapses_onto_the_most_specific():
    a = cand("w0", ["p1"], founder_action="Do the thing.")
    b = cand("w1", ["p2"], founder_action="Do the thing in 3 days with 5 customers named in your CRM.")
    c = cand("w2", ["p3"], founder_action="Do the thing in a week.")
    kept, merges = ll.dedupe([a, b, c], [near(0, 1, 0.01), near(0, 1, 0.02), near(0, 1, 0.03)])
    assert len(kept) == 1 and kept[0]["window_id"] == "w1" and len(merges) == 2
    assert kept[0]["lesson"]["paragraph_ids"] == ["p1", "p2", "p3"]


def test_specificity_prefers_concrete_tokens_then_length():
    vague = {"founder_action": "Make sure you think about what to do next with your team.", "applies_when": "x"}
    sharp = {"founder_action": "Call 5 customers on Monday and ask what they paid for.", "applies_when": "x"}
    assert ll.specificity(sharp) > ll.specificity(vague)
    assert "more specific" in ll.DEDUPE_RULE and "0.92" in ll.DEDUPE_RULE


# ----------------------------------------------------------------------------
# Embedding and the final rows
# ----------------------------------------------------------------------------

def test_embedding_text_is_title_argues_action_applies_questions():
    l = good_lesson(["p1"]).model_dump()
    t = ll.embedding_text(l)
    parts = [l["title"], l["author_argues"], l["founder_action"], l["applies_when"], *l["example_questions"]]
    assert t == "\n".join(parts)
    assert l["evidence"] not in t and l["caveat"] is None


def test_embedder_requests_512_dims_batches_caches_and_records_cost(tmp_path, st):
    c = FakeClient()
    e = ll.Embedder(SID, c, tmp_path / "emb.jsonl", st, no_sleep)
    out = e.embed(["alpha", "beta", "alpha"])
    assert len(out) == 3 and all(len(v) == 512 for v in out) and out[0] == out[2]
    assert c.embed_calls == [{"model": "text-embedding-3-small", "n": 2, "dimensions": 512, "timeout": 60}]
    assert all(round(x, 6) == x for x in out[0])
    e2 = ll.Embedder(SID, c, tmp_path / "emb.jsonl", st, no_sleep)
    e2.embed(["alpha", "beta"])
    assert len(c.embed_calls) == 1                                   # persisted cache, no second call
    rows = state.load(st)["sources"][SID]["costs"]
    assert rows[0]["purpose"] == "lessons_embed" and rows[0]["model"] == "text-embedding-3-small"
    assert rows[0]["usd"] == pytest.approx(40 * 0.02 / 1e6)


def test_build_rows_has_every_field_with_pipeline_version_and_6dp_embedding():
    paras = [{"id": f"{SID}_p{i:04d}", "index": i, "text": f"Paragraph {i} text.", "chapter": "Chapter 1: Alpha",
              "page_start": 10 + i, "page_end": 10 + i} for i in range(4)]
    kept = [{"window_id": "w", "lesson": good_lesson([f"{SID}_p0003", f"{SID}_p0001"]).model_dump(),
             "embedding": [0.123456789] * 512}]
    rows = ll.build_rows(SID, kept, paras, "gpt-4.1-mini", {"book": "Test Book", "author": "Jane Smith"})
    r = rows[0]
    assert r["id"] == f"{SID}_L0000" and r["source_id"] == SID and r["book"] == "Test Book" and r["author"] == "Jane Smith"
    assert r["paragraph_ids"] == [f"{SID}_p0001", f"{SID}_p0003"]
    assert r["evidence_text"] == "Paragraph 1 text.\n\nParagraph 3 text."
    assert (r["page_start"], r["page_end"]) == (11, 13) and r["chapter"] == "Chapter 1: Alpha"
    assert len(r["embedding"]) == 512 and r["embedding"][0] == 0.123457
    assert r["model"] == "gpt-4.1-mini" and r["pipeline_version"] == "lessons-2026.10.a1"
    for f in ("title", "author_argues", "founder_action", "applies_when", "caveat", "evidence", "short_quote",
              "example_questions", "lesson_type", "pillars"):
        assert f in r


# ----------------------------------------------------------------------------
# End to end with the mock, estimate, archive
# ----------------------------------------------------------------------------

def seed_library(tmp_path, n_windows=3):
    lib = tmp_path / "library"
    paras = []
    for i in range(n_windows * 2):
        paras.append({"id": f"{SID}_p{i:04d}", "source_id": SID, "index": i,
                      "text": P_TEXT if i % 2 == 0 else "Filler paragraph for the window. " * 3,
                      "chapter": f"Chapter {i // 2}", "section": None, "heading_path": [f"Chapter {i // 2}"],
                      "page": i + 1, "page_start": i + 1, "page_end": i + 1, "word_count": 40, "kind": "body",
                      "scene_break": False})
    lp.write_jsonl(lib / SID / "paragraphs_v2.jsonl", paras)
    (lib / SID / "paragraphs_v2_report.json").write_text(json.dumps({"author": "Jane Smith"}))
    lp.write_jsonl(lib / SID / "windows_v2.jsonl", lp.build_windows(paras))
    manifest = {"sources": [{"source_id": SID, "title": "Test Book", "format": "pdf", "path": "x.pdf", "pillar": "think_sharper"}]}
    return lib, manifest


def cites_first_paragraph(messages, model, n):
    ids = [l.split("]")[0][1:] for l in messages[1]["content"].split("PARAGRAPHS YOU MAY CITE")[1].splitlines() if l.startswith("[")]
    return ll.WindowOut(lessons=[good_lesson([ids[0]], title=f"Lesson number {n} about small tests")])


def test_end_to_end_mocked_pipeline_and_ab_isolation(tmp_path, st):
    lib, manifest = seed_library(tmp_path)
    arch = tmp_path / "_archive"
    c = FakeClient(cites_first_paragraph)
    mini = rl.run_source(SID, "gpt-4.1-mini", ["extract", "validate", "dedupe", "embed"], c, c, lib, st,
                         manifest=manifest, archive_root=arch, sleep=no_sleep)
    big = rl.run_source(SID, "gpt-4.1", ["extract", "validate", "dedupe", "embed"], c, c, lib, st,
                        manifest=manifest, archive_root=arch, sleep=no_sleep)
    d_mini, d_big = lib / SID / "lessons_gpt-4.1-mini", lib / SID / "lessons_gpt-4.1"
    r_mini, r_big = lp.read_jsonl(d_mini / "lessons.jsonl"), lp.read_jsonl(d_big / "lessons.jsonl")
    assert r_mini and r_big and {r["model"] for r in r_mini} == {"gpt-4.1-mini"} and {r["model"] for r in r_big} == {"gpt-4.1"}
    assert (d_mini / "dropped.jsonl").exists() and (d_big / "window_cache.jsonl").exists()
    assert not (lib / SID / "lessons.jsonl").exists()                    # A/B never touches a shared file
    assert set(mini["cost_by_model_usd"]) >= {"gpt-4.1-mini"} and "gpt-4.1" in big["cost_by_model_usd"]
    assert all(len(r["embedding"]) == 512 and r["pipeline_version"] == ll.PIPELINE_VERSION for r in r_mini)
    assert mini["validate"]["dropped"] == 0 and mini["extract"]["called"] == 3
    # rerun: nothing is called again (resume), and the old lessons.jsonl is archived before it is rewritten
    calls = len(c.parse_calls)
    rl.run_source(SID, "gpt-4.1-mini", ["extract", "validate", "dedupe", "embed"], c, c, lib, st,
                  manifest=manifest, archive_root=arch, sleep=no_sleep)
    assert len(c.parse_calls) == calls
    saved = list((arch / SID).glob("lessons_lessons_gpt-4.1-mini_*.jsonl"))
    assert len(saved) == 1 and len(lp.read_jsonl(saved[0])) == len(r_mini)


def test_end_to_end_logs_drops_and_merges(tmp_path, st):
    lib, manifest = seed_library(tmp_path)

    def responder(messages, model, n):
        ids = [l.split("]")[0][1:] for l in messages[1]["content"].split("PARAGRAPHS YOU MAY CITE")[1].splitlines() if l.startswith("[")]
        if n == 1:
            return ll.WindowOut(lessons=[good_lesson(["ghost"])])           # dropped
        return ll.WindowOut(lessons=[good_lesson([ids[0]])])                 # identical lessons -> merged
    c = FakeClient(responder)
    rep = rl.run_source(SID, "gpt-4.1-mini", ["extract", "validate", "dedupe", "embed"], c, c, lib, st,
                        manifest=manifest, sleep=no_sleep)
    d = lib / SID / "lessons_gpt-4.1-mini"
    dropped, merges = lp.read_jsonl(d / "dropped.jsonl"), lp.read_jsonl(d / "merges.jsonl")
    assert len(dropped) == 1 and dropped[0]["reasons"][0].startswith("unknown_paragraph_id")
    assert len(merges) == 1 and rep["dedupe"] == {"before": 2, "after": 1, "merges": 1, "rule": ll.DEDUPE_RULE}
    assert len(lp.read_jsonl(d / "lessons.jsonl")) == 1


def test_out_suffix_changes_the_directory(tmp_path, st):
    lib, manifest = seed_library(tmp_path, 1)
    c = FakeClient(cites_first_paragraph)
    rl.run_source(SID, "gpt-4.1", ["extract", "validate"], c, c, lib, st, suffix="ab_run2", manifest=manifest, sleep=no_sleep)
    assert (lib / SID / "lessons_ab_run2" / "candidates.jsonl").exists()
    assert not (lib / SID / "lessons_gpt-4.1").exists()


def test_estimate_uses_real_paragraph_counts_and_never_needs_a_client(tmp_path):
    lib, manifest = seed_library(tmp_path, 4)
    mini = ll.estimate_source(SID, "gpt-4.1-mini", lib)
    big = ll.estimate_source(SID, "gpt-4.1", lib)
    assert mini["paragraphs"] == 8 and mini["windows"] == 4 and mini["basis"] == "paragraphs_v2"
    assert big["est_usd"] > mini["est_usd"] * 3
    assert mini["est_usd"] > 0
    lib_est = ll.estimate_library("gpt-4.1-mini", lib, manifest)
    assert lib_est["est_usd"] == mini["est_usd"] and lib_est["sources_estimated"] == 1
    none = ll.estimate_source("missing", "gpt-4.1-mini", lib)
    assert none["est_usd"] is None and none["basis"] == "none"


def test_dry_run_cli_makes_no_client(tmp_path, capsys, monkeypatch):
    lib, manifest = seed_library(tmp_path, 2)
    monkeypatch.setattr(lp, "load_manifest", lambda path=None: manifest)
    monkeypatch.setattr(ll, "get_client", lambda: (_ for _ in ()).throw(AssertionError("client created")))
    assert rl.main(["--source", SID, "--dry-run-estimate", "--library-dir", str(lib)]) == 0
    out = capsys.readouterr().out
    assert "gpt-4.1-mini" in out and "gpt-4.1 " in out and "windows=" in out


def test_cli_offline_stages_do_not_create_a_client(tmp_path, monkeypatch):
    lib, manifest = seed_library(tmp_path, 2)
    monkeypatch.setattr(lp, "load_manifest", lambda path=None: manifest)
    monkeypatch.setattr(ll, "get_client", lambda: (_ for _ in ()).throw(AssertionError("client created")))
    assert rl.main(["--source", SID, "--stages", "windows", "--library-dir", str(lib),
                    "--state", str(tmp_path / "s.json")]) == 0


def test_model_must_be_one_of_the_two_pilot_models(tmp_path, st):
    with pytest.raises(ValueError):
        ll.Extractor(SID, "gpt-5", FakeClient(), tmp_path, st)
