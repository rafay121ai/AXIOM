"""Offline tests for editor.py. The only client is FakeClient; nothing reaches the network."""
import json
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
import editor as ed  # noqa: E402
import library_state as state  # noqa: E402

TEXT = "Jane Smith ran 3 tests in a week. Small bets teach faster than plans. She then dropped the plan."


def lesson(n=1, **over):
    d = {"lesson_id": f"s_w0_l{n:02d}", "source_id": "nosuch", "chapter": "C", "paragraph_ids": [f"s_p{n:04d}"],
         "title": "Old title", "author_argues": "Old.", "principle": "Old.", "evidence": None, "caveat": None,
         "short_quote": None, "applies_when": "w", "example_questions": ["a", "b", "c"], "lesson_type": "principle",
         "pillars": [], "evidence_paragraphs": [{"id": f"s_p{n:04d}", "text": TEXT + f" Number {n}."}]}
    d.update(over)
    return d


def out(**over):
    base = dict(work="w", stating_sentence="Small bets teach faster than plans.", same_in_any_book=False,
                anecdote_only=False, bundled=False, verdict="keep", drop_reason="", title="Small bets beat plans",
                author_argues="Smith ran 3 tests in a week and found small bets teach faster than plans.",
                principle="Run small bets, because they teach faster than plans.",
                example_questions=["How do I test an idea fast?", "Should I plan or test?", "How many tests?"])
    base.update(over)
    return ed.EditOut(**base)


class FakeClient:
    def __init__(self, outs):
        self.outs, self.calls = list(outs), 0
        self.beta = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(parse=self._parse)))

    def _parse(self, **kw):
        o = self.outs[min(self.calls, len(self.outs) - 1)]
        self.calls += 1
        usage = SimpleNamespace(prompt_tokens=1500, completion_tokens=300,
                                prompt_tokens_details=SimpleNamespace(cached_tokens=0))
        return SimpleNamespace(usage=usage, choices=[SimpleNamespace(message=SimpleNamespace(parsed=o))])


@pytest.fixture
def env(tmp_path):
    sp = tmp_path / "state.json"
    state.set_budget(5.0, sp)
    return SimpleNamespace(sp=sp, cache=tmp_path / "c.jsonl", tmp=tmp_path)


def mk(client, env, **kw):
    return ed.Editor(client, cache_path=env.cache, state_path=env.sp, sleep=lambda s: None, **kw)


def test_keep_rewrites_card_and_keeps_paragraphs(env):
    res = mk(FakeClient([out()]), env).edit(lesson())
    assert res["verdict"] == "keep" and res["fields"]["title"] == "Small bets beat plans"
    row = ed.apply_edit(lesson(), res)
    assert row["paragraph_ids"] == ["s_p0001"] and row["orig"]["title"] == "Old title" and row["applies_when"] == "w"


@pytest.mark.parametrize("flag", ["same_in_any_book", "anecdote_only", "bundled"])
def test_flags_drop(env, flag):
    res = mk(FakeClient([out(**{flag: True})]), env).edit(lesson())
    assert res["verdict"] == "drop" and flag in res["drop_reason"]


def test_stating_sentence_must_be_in_paragraphs(env):
    res = mk(FakeClient([out(stating_sentence="Plans are always worse than bets for every founder.")]), env).edit(lesson())
    assert res["verdict"] == "drop" and "no_verbatim_stating_sentence" in res["drop_reason"]


def test_ellipsis_fragments_and_quote_variants():
    assert ed.sentence_in_text("Jane Smith ran 3 tests in a week. ... She then dropped the plan.", [TEXT])
    assert ed.sentence_in_text("Small bets teach faster than plans", [TEXT.replace("Small", "“Small")])
    assert not ed.sentence_in_text("", [TEXT])


def test_invented_number_retries_once_then_drops(env):
    bad = out(principle="Run 9 small bets.")
    c = FakeClient([bad, bad])
    res = mk(c, env).edit(lesson())
    assert c.calls == 2 and res["verdict"] == "drop" and "rewrite_failed_validation" in res["drop_reason"]


def test_invented_number_fixed_on_retry(env):
    c = FakeClient([out(principle="Run 9 small bets."), out()])
    res = mk(c, env).edit(lesson())
    assert c.calls == 2 and res["verdict"] == "keep" and res["problems"]


def test_cache_costs_nothing_second_time_and_cost_recorded(env):
    c = FakeClient([out()])
    mk(c, env).edit(lesson())
    rows = state.load(env.sp)["sources"]["nosuch"]["costs"]
    assert rows[0]["purpose"] == "editor" and rows[0]["model"] == "gpt-4.1"
    e2 = mk(c, env)
    e2.edit(lesson())
    assert c.calls == 1 and e2.stats["cached"] == 1


def test_run_editor_outputs_and_counts(env):
    c = FakeClient([out(), out(verdict="drop", drop_reason="platitude"), out()])
    e = mk(c, env)
    cost = ed.run_editor([lesson(1), lesson(2), lesson(3)], e, env.tmp / "o", workers=1)
    assert cost["before"] == 3 and cost["after"] == 2 and cost["dropped"] == 1 and cost["unprocessed"] == 0
    assert len((env.tmp / "o" / "edited.jsonl").read_text().splitlines()) == 2
    assert json.loads((env.tmp / "o" / "editor_dropped.jsonl").read_text())["reason"] == "platitude"


def test_budget_cap_stops_before_calls(env):
    state.set_budget(0.0001, env.sp)
    c = FakeClient([out()])
    cost = ed.run_editor([lesson(1)], mk(c, env), env.tmp / "o", workers=1)
    assert c.calls == 0 and cost["unprocessed"] == 1
