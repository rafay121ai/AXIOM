"""Offline tests for judge.py. The only client is FakeClient; nothing reaches the network."""
import json
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
import judge as j  # noqa: E402
import library_state as state  # noqa: E402


def passing(lid, **fail):
    kw = {"lesson_id": lid}
    for t in j.TESTS:
        kw[t] = j.TestVerdict(work="w", passed=t not in fail, reason=f"{t} reason")
    return j.LessonVerdict(**kw)


class FakeClient:
    def __init__(self, responder=None, usage=(3000, 600, 0)):
        self.calls = []
        self.responder = responder
        self.usage = usage
        self.beta = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(parse=self._parse)))

    def _parse(self, **kw):
        self.calls.append(kw)
        ids = [l.split("lesson_id: ")[1].split(" ")[0] for l in kw["messages"][1]["content"].splitlines()
                if l.startswith("=== lesson_id")]
        out = self.responder(ids, len(self.calls)) if self.responder else j.BatchOut(verdicts=[passing(i) for i in ids])
        if isinstance(out, Exception):
            raise out
        pt, ct, cached = self.usage
        usage = SimpleNamespace(prompt_tokens=pt, completion_tokens=ct,
                                prompt_tokens_details=SimpleNamespace(cached_tokens=cached))
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(parsed=out))], usage=usage)


def lesson(n, v2=False):
    d = {"paragraph_ids": [f"s_p{n:04d}", f"s_p{n+1:04d}"], "title": f"Lesson {n}", "author_argues": f"A argues {n}.",
         "evidence": None, "caveat": None, "short_quote": None, "applies_when": "when", "author": "A",
         "example_questions": ["q1", "q2", "q3"], "lesson_type": "principle", "pillars": [],
         "evidence_text": f"Paragraph text {n}."}
    d["founder_action" if v2 else "principle"] = f"Do thing {n}."
    return d


@pytest.fixture
def env(tmp_path):
    sp = tmp_path / "state.json"
    state.set_budget(5.0, sp)
    return SimpleNamespace(sp=sp, cache=tmp_path / "cache.jsonl", tmp=tmp_path)


def mk(client, env, **kw):
    return j.Judge(client, source_id="src", state_path=env.sp, cache_path=env.cache, sleep=lambda s: None, **kw)


def test_batches_of_eight(env):
    c = FakeClient()
    res = mk(c, env).judge([lesson(i) for i in range(0, 40, 2)][:19])
    assert len(c.calls) == 3 and len(res) == 19          # 8 + 8 + 3
    assert c.calls[0]["model"] == "gpt-4.1" and c.calls[0]["messages"][0]["content"] == j.SYSTEM_PROMPT
    assert c.calls[0]["response_format"] is j.BatchOut


def test_static_prompt_first_batch_last(env):
    c = FakeClient()
    mk(c, env).judge([lesson(1)])
    msgs = c.calls[0]["messages"]
    assert msgs[0]["role"] == "system" and "Paragraph text 1." in msgs[1]["content"]
    assert "Paragraph text" not in msgs[0]["content"].split("WORKED EXAMPLES")[0]


def test_cache_hit_on_rerun_costs_nothing(env):
    ls = [lesson(i) for i in range(5)]
    c1 = FakeClient()
    mk(c1, env).judge(ls)
    spent = state.total_cost(env.sp)
    c2 = FakeClient()
    jd = mk(c2, env)
    res = jd.judge(ls)
    assert c2.calls == [] and jd.cache_hits == 5 and state.total_cost(env.sp) == spent and len(res) == 5


def test_cache_key_changes_with_content_and_version(env, monkeypatch):
    a, b = lesson(1), lesson(1)
    b["principle"] = "different"
    assert j.cache_key(a) != j.cache_key(b)
    k = j.cache_key(a)
    monkeypatch.setattr(j, "JUDGE_PROMPT_VERSION", "judge-vtest")
    assert j.cache_key(a) != k
    assert j.cache_key(a, "gpt-4.1-mini") != j.cache_key(a)


def test_all_five_must_pass(env):
    for bad in j.TESTS:
        c = FakeClient(lambda ids, n, bad=bad: j.BatchOut(verdicts=[passing(i, **{bad: 1}) for i in ids]))
        env.cache.unlink(missing_ok=True)
        r = mk(c, env).judge([lesson(1)])[0]
        assert r["passed"] is False and r["tests"][bad]["pass"] is False
    env.cache.unlink(missing_ok=True)
    assert mk(FakeClient(), env).judge([lesson(1)])[0]["passed"] is True


def test_v2_founder_action_accepted(env):
    c = FakeClient()
    mk(c, env).judge([lesson(1, v2=True)])
    assert "Do thing 1." in c.calls[0]["messages"][1]["content"]


def test_malformed_output_retries_then_succeeds(env):
    seq = [None, j.BatchOut(verdicts=[]), "ok"]

    def resp(ids, n):
        r = seq[n - 1]
        return j.BatchOut(verdicts=[passing(i) for i in ids]) if r == "ok" else r
    c = FakeClient(resp)
    res = mk(c, env).judge([lesson(1), lesson(3)])
    assert len(c.calls) == 3 and all(r["passed"] for r in res)


def test_partial_output_only_retries_missing(env):
    def resp(ids, n):
        return j.BatchOut(verdicts=[passing(ids[0])]) if n == 1 else j.BatchOut(verdicts=[passing(i) for i in ids])
    c = FakeClient(resp)
    mk(c, env).judge([lesson(1), lesson(3)])
    assert len(c.calls) == 2
    assert c.calls[1]["messages"][1]["content"].count("=== lesson_id") == 1


def test_gives_up_after_max_attempts(env):
    c = FakeClient(lambda ids, n: ValueError("bad json"))
    with pytest.raises(RuntimeError):
        mk(c, env).judge([lesson(1)])
    assert len(c.calls) == j.MAX_ATTEMPTS


def test_cost_recorded_per_call_with_purpose_judge(env):
    c = FakeClient(usage=(10_000, 1_000, 2_000))
    mk(c, env).judge([lesson(i) for i in range(9)])        # 2 calls
    rows = state.load(env.sp)["sources"]["src"]["costs"]
    assert [r["purpose"] for r in rows] == ["judge", "judge"] and rows[0]["model"] == "gpt-4.1"
    one = state.cost_from_usage("gpt-4.1", 10_000, 1_000, 2_000)
    assert rows[0]["usd"] == pytest.approx(one) and state.total_cost(env.sp) == pytest.approx(2 * one)


def test_budget_refusal_before_any_call(env):
    state.set_budget(0.0001, env.sp)
    c = FakeClient()
    with pytest.raises(state.BudgetExhausted):
        mk(c, env).judge([lesson(1)])
    assert c.calls == []


def test_report_shape_and_cli(env):
    lp = env.tmp / "src" / "lessons.jsonl"
    lp.parent.mkdir()
    lp.write_text("\n".join(json.dumps(lesson(i)) for i in range(0, 20, 2)) + "\n")
    c = FakeClient(lambda ids, n: j.BatchOut(verdicts=[passing(i, specific=1) if i == "L0" else passing(i) for i in ids]))
    out = env.tmp / "rep.json"
    j.main(["--lessons", str(lp), "--sample", "4", "--seed", "1", "--out", str(out), "--state", str(env.sp),
            "--cache", str(env.cache)], client=c)
    rep = json.loads(out.read_text())
    assert rep["lessons_judged"] == 4 and set(rep["pass_rates"]) == set(j.TESTS)
    assert rep["overall_pass_rate"] == 0.75 and rep["pass_rates"]["specific"] == 0.75
    assert rep["cost"]["api_calls"] == 1 and rep["cost"]["usd"] > 0 and len(rep["results"]) == 4


def refs():
    return [{"paragraph_ids": ["a1", "a2"], "tier": "core"},
            {"paragraph_ids": ["b1", "b2", "b3", "b4"], "tier": "core"},
            {"paragraph_ids": ["c1"], "tier": "core"},
            {"paragraph_ids": ["d1", "d2"], "tier": "minor"},
            {"paragraph_ids": ["e1", "e2"], "tier": "minor"}]


def test_recall():
    produced = [{"paragraph_ids": ["a1", "a2", "a3"]},      # covers a (100%)
                {"paragraph_ids": ["b1", "x"]},             # 25% of b: loose only
                {"paragraph_ids": ["d1", "d9"]}]            # 50% of d: covered
    r = j.recall_report(refs(), produced)
    assert r["core_total"] == 3 and r["core_covered"] == 1 and r["core_recall"] == pytest.approx(1 / 3, abs=1e-3)
    assert r["core_covered_loose"] == 2 and r["core_recall_loose"] == pytest.approx(2 / 3, abs=1e-3)
    assert [m["paragraph_ids"] for m in r["missed_core"]] == [["b1", "b2", "b3", "b4"], ["c1"]]
    assert [m["paragraph_ids"] for m in r["missed_core_loose"]] == [["c1"]]
    assert r["minor_recall"] == 0.5 and r["minor_covered_loose"] == 1


def test_recall_union_not_assumed_across_lessons():
    r = j.recall_report([{"paragraph_ids": ["a", "b"], "tier": "core"}],
                        [{"paragraph_ids": ["a"]}, {"paragraph_ids": ["b"]}])
    assert r["core_covered"] == 1          # each produced lesson has 50%
    r = j.recall_report([{"paragraph_ids": ["a", "b", "c"], "tier": "core"}],
                        [{"paragraph_ids": ["a"]}, {"paragraph_ids": ["b"]}])
    assert r["core_covered"] == 0 and r["core_covered_loose"] == 1


def test_recall_empty_tier():
    r = j.recall_report([], [])
    assert r["core_recall"] is None and r["minor_recall"] is None


def test_evidence_paragraphs_accepts_v3_key():
    import judge
    got = judge.evidence_paragraphs({"evidence_paragraphs": [{"text": "A."}, "B."]})
    assert "A." in got and "B." in got
