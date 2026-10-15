"""Tests for golden_windows.py and library_lessons_v3.py. Mocked client only: nothing here touches the network."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))

import golden_windows as gw  # noqa: E402
import library_lessons_v3 as l3  # noqa: E402
import library_state as state  # noqa: E402


def para(i, text, chapter="C1", section=None, page=1):
    return {"id": f"s_p{i:04d}", "source_id": "s", "index": i, "text": text, "chapter": chapter, "section": section,
            "page": page, "page_start": page, "page_end": page, "word_count": len(text.split()), "kind": "body"}


def window(paras, ctx=()):
    return {"window_id": "w1", "source_id": "s", "chapter": "C1", "sections": [], "word_count": 0,
            "paragraphs": paras, "context": list(ctx)}


P1 = para(1, "Jane Smith ran 3 tests in a week. Small bets teach faster than plans. This only holds when tests are cheap.")
P2 = para(2, "She then dropped the plan.")
CTX = para(0, "Earlier text about nothing.")


def lesson(**over):
    base = dict(paragraph_ids=["s_p0001"], title="Run cheap tests before you commit to plans",
                author_argues="Smith ran 3 tests in a week. She argues the result beats opinion.",
                principle="Cheap tests give evidence faster than planning does.",
                evidence="Jane Smith ran 3 tests in a week.", caveat="This only holds when tests are cheap.",
                short_quote="Small bets teach faster than plans", applies_when="You are debating an idea.",
                example_questions=["a?", "b?", "c?"], lesson_type="principle", pillars=["think_sharper"])
    base.update(over)
    return base


# --- validation ---------------------------------------------------------

def test_valid_lesson_kept():
    clean, reasons, nulled = l3.validate_lesson(lesson(), window([P1, P2]))
    assert clean and not reasons and not nulled


@pytest.mark.parametrize("ids", [[], ["s_p0001", "s_p0002", "s_p0003", "s_p0004"], ["s_p0009"], ["s_p0000"]])
def test_bad_paragraph_ids_dropped(ids):
    clean, reasons, _ = l3.validate_lesson(lesson(paragraph_ids=ids), window([P1, P2], [CTX]))
    assert clean is None and reasons


def test_context_paragraph_cannot_be_cited():
    clean, reasons, _ = l3.validate_lesson(lesson(paragraph_ids=["s_p0000"]), window([P1], [CTX]))
    assert clean is None and any("unknown_paragraph_id" in r for r in reasons)


def test_ungrounded_number_dropped_in_argues_and_principle():
    c, r, _ = l3.validate_lesson(lesson(author_argues="Smith ran 7 tests."), window([P1]))
    assert c is None and any("author_argues" in x for x in r)
    c, r, _ = l3.validate_lesson(lesson(principle="Do it within 10 days."), window([P1]))
    assert c is None and any("principle" in x for x in r)


def test_number_words_ground_digits():
    p = para(1, "She ran three tests. Small bets teach.")
    c, _, _ = l3.validate_lesson(lesson(author_argues="She ran 3 tests."), window([p]))
    assert c


def test_non_verbatim_fields_nulled_but_lesson_kept():
    c, r, nulled = l3.validate_lesson(
        lesson(evidence="Jane ran many tests.", caveat="It might fail sometimes.", short_quote="Bets teach quickly"),
        window([P1]))
    assert c and not r
    assert c["evidence"] is None and c["caveat"] is None and c["short_quote"] is None
    assert len(nulled) == 3


def test_long_quote_nulled():
    long_p = para(1, " ".join(f"w{i}" for i in range(20)) + ".")
    q = " ".join(f"w{i}" for i in range(18))
    c, _, nulled = l3.validate_lesson(lesson(short_quote=q, author_argues="x.", principle="y.", evidence=None, caveat=None),
                                      window([long_p]))
    assert c and c["short_quote"] is None and "short_quote_too_long" in nulled


def test_curly_quotes_match():
    p = para(1, "He said “don’t wait” to everyone.")
    c, _, nulled = l3.validate_lesson(lesson(short_quote="\"don't wait\"", evidence=None, caveat=None,
                                             author_argues="x.", principle="y."), window([p]))
    assert c["short_quote"] and not nulled


def test_required_fields_and_questions():
    for over in ({"title": ""}, {"principle": " "}, {"example_questions": ["a?"]}, {"lesson_type": "slogan"}):
        c, r, _ = l3.validate_lesson(lesson(**over), window([P1]))
        assert c is None and r


def test_validate_all_logs_drops_with_reason():
    kept, dropped = l3.validate_all([lesson(), lesson(paragraph_ids=["nope"])], window([P1]))
    assert len(kept) == 1 and dropped[0]["reasons"] and dropped[0]["window_id"] == "w1"


# --- prompt ---------------------------------------------------------------

def examples():
    return l3.load_examples()


def test_examples_file_read_and_shape():
    ex = examples()
    assert len(ex["good"]) == 3 and len(ex["bad"]) == 3


def test_examples_wrong_count_rejected(tmp_path):
    p = tmp_path / "e.json"
    p.write_text(json.dumps({"good": [], "bad": []}))
    with pytest.raises(ValueError):
        l3.load_examples(p)


def test_prompt_order_window_last_and_examples_before():
    ex = examples()
    sys_p = l3.system_prompt(ex)
    assert sys_p.index("NOT lessons") < sys_p.index("GOOD EXAMPLE 1") < sys_p.index("BAD EXAMPLE 3")
    user = l3.render_user(window([P1]), "Book", "Smith")
    assert "PARAGRAPHS YOU MAY CITE" in user and "[s_p0001]" in user


def test_schema_has_exact_fields_and_is_strict_capable():
    assert list(l3.LessonV3.model_fields) == [
        "paragraph_ids", "title", "author_argues", "principle", "evidence", "caveat", "short_quote",
        "applies_when", "example_questions", "lesson_type", "pillars"]


# --- extractor with a mocked client ------------------------------------------

class FakeClient:
    def __init__(self, lessons):
        self.lessons, self.calls = lessons, 0
        self.beta = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(parse=self._parse)))

    def _parse(self, **kw):
        self.calls += 1
        assert kw["messages"][-1]["role"] == "user"
        assert kw["response_format"] is l3.WindowOutV3
        parsed = l3.WindowOutV3(lessons=[l3.LessonV3(**l) for l in self.lessons])
        usage = SimpleNamespace(prompt_tokens=4000, completion_tokens=500,
                                prompt_tokens_details=SimpleNamespace(cached_tokens=0))
        return SimpleNamespace(usage=usage, choices=[SimpleNamespace(message=SimpleNamespace(parsed=parsed))])


@pytest.fixture
def env(tmp_path):
    sp = tmp_path / "state.json"
    state.set_budget(6.90, sp)
    return SimpleNamespace(state=sp, cache=tmp_path / "cache.jsonl", out=tmp_path / "round")


def test_extract_cache_cost_and_outputs(env):
    client = FakeClient([lesson(), lesson(paragraph_ids=["zzz"])])
    ex = l3.ExtractorV3(client, examples=examples(), cache_path=env.cache, state_path=env.state)
    w = window([P1, P2])
    cost = l3.run_round([w], ex, env.out)
    assert client.calls == 1 and cost["lessons_kept"] == 1 and cost["lessons_dropped"] == 1
    assert cost["cost_usd"] == pytest.approx(state.cost_from_usage("gpt-4.1-mini", 4000, 500))
    assert state.total_cost(env.state) == pytest.approx(cost["cost_usd"])
    rows = [json.loads(l) for l in (env.out / "lessons.jsonl").read_text().splitlines()]
    assert rows[0]["evidence_paragraphs"][0]["id"] == "s_p0001" and rows[0]["prompt_version"] == "lessons-v3.0"
    assert (env.out / "dropped.jsonl").read_text().strip()
    # second run: served from cache, no call, no cost
    ex2 = l3.ExtractorV3(client, examples=examples(), cache_path=env.cache, state_path=env.state)
    l3.run_round([w], ex2, env.out)
    assert client.calls == 1 and ex2.stats["cached"] == 1
    assert state.total_cost(env.state) == pytest.approx(cost["cost_usd"])


def test_cache_key_changes_with_prompt_model_and_text():
    a = l3.cache_key("gpt-4.1-mini", "sys", "user")
    assert a != l3.cache_key("gpt-4.1", "sys", "user")
    assert a != l3.cache_key("gpt-4.1-mini", "sys2", "user")
    assert a != l3.cache_key("gpt-4.1-mini", "sys", "user2")


def test_cap_refuses_before_any_call(env):
    state.add_cost("s", 6.899, "x", env.state)
    client = FakeClient([])
    ex = l3.ExtractorV3(client, examples=examples(), cache_path=env.cache, state_path=env.state)
    with pytest.raises(state.BudgetExhausted):
        ex.extract(window([P1]))
    assert client.calls == 0


def test_retry_then_fail(env):
    class Boom(FakeClient):
        def _parse(self, **kw):
            self.calls += 1
            raise ValueError("bad")
    c = Boom([])
    ex = l3.ExtractorV3(c, examples=examples(), cache_path=env.cache, state_path=env.state, sleep=lambda s: None)
    with pytest.raises(RuntimeError):
        ex.extract(window([P1]))
    assert c.calls == l3.MAX_ATTEMPTS


def test_dry_run_makes_no_api_call_and_prints_prompt():
    out = []
    r = l3.dry_run([window([P1])], "gpt-4.1-mini", examples(), out=out.append)
    assert r["usd"] >= 0 and "=== SYSTEM ===" in out[0] and out[0].rstrip().endswith("=== END ===")


def test_cli_refuses_paid_run_with_placeholder_examples(capsys):
    ex = l3.load_examples()
    if not ex.get("_placeholder"):
        pytest.skip("examples already filled")
    assert l3.main(["--round", "9"]) == 2


# --- dedupe -----------------------------------------------------------------

def test_dedupe_keeps_more_specific():
    a = {"window_id": "a", "lesson": lesson(paragraph_ids=["x1"], title="A", principle="Test cheap.")}
    b = {"window_id": "b", "lesson": lesson(paragraph_ids=["x2"], title="B",
                                            principle="Test cheap with 3 Stripe pilots in 10 days.")}
    c = {"window_id": "c", "lesson": lesson(title="C", principle="Other.")}
    kept, merges = l3.dedupe([a, b, c], [[1, 0], [0.99, 0.1], [0, 1]])
    assert [k["window_id"] for k in kept] == ["b", "c"] and len(merges) == 1


# --- golden windows (synthetic) -------------------------------------------------

def synth(n_chapters=2, per=60, words=40):
    paras, i = [], 0
    for c in range(n_chapters):
        for k in range(per):
            paras.append(para(i, " ".join(f"w{i}x{j}" for j in range(words)) + ".", chapter=f"Ch{c}",
                              section=f"S{k // 20}", page=i // 5 + 1))
            i += 1
    return paras


def test_build_windows_paragraph_boundaries_within_chapter():
    paras = synth()
    wins = gw.build_windows(paras, set())
    assert [p["id"] for w in wins for p in w] == [p["id"] for p in paras]      # every paragraph once, in order
    for w in wins:
        assert len({p["chapter"] for p in w}) == 1
        assert sum(p["word_count"] for p in w) <= gw.HI + 300


def test_build_windows_prefers_heading_break():
    paras = synth(1, 80, 40)
    # target 2000 words = 50 paras; heading before para 45 should win over 50
    wins = gw.build_windows(paras, {paras[45]["id"]})
    assert len(wins[0]) == 45


def test_flags_equation_figure_and_matter():
    paras = [para(0, "Normal text here.", page=19), para(1, "See Figure 3 for more.", page=20)]
    assert "equation_or_diagram_page" in gw.window_flags(paras[:1], {"equation_or_diagram": [19]})
    assert "figure_or_table_reference" in gw.window_flags(paras, {})
    back = [para(0, "x.", chapter="Acknowledgments")]
    assert "front_or_back_matter_chapter" in gw.window_flags(back, {})


def test_pick_is_seeded_and_has_context(tmp_path):
    d = tmp_path / "s"
    d.mkdir()
    (d / "paragraphs_v3.2.jsonl").write_text("".join(json.dumps(p) + "\n" for p in synth(4, 60, 40)))
    (d / "headings_v3.2.jsonl").write_text("")
    a = gw.pick("s", "x", 2, 7, tmp_path)
    b = gw.pick("s", "x", 2, 7, tmp_path)
    assert [w["window_id"] for w in a] == [w["window_id"] for w in b]
    assert all(len(w["context_ids"]) in (0, 2) for w in a)
    for w in a:
        assert not set(w["context_ids"]) & set(w["paragraph_ids"])


def test_committed_golden_set_is_consistent():
    p = Path(__file__).resolve().parent / "golden" / "windows.json"
    if not p.exists():
        pytest.skip("golden/windows.json not generated")
    doc = json.loads(p.read_text())
    assert len(doc["windows"]) == 12 and "paper" in doc["note"]
    for w in doc["windows"]:
        assert (p.parent / "windows_text" / f"{w['window_id']}.txt").exists()
        assert not set(w["context_ids"]) & set(w["paragraph_ids"])
