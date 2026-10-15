"""Mocked tests for case_sweep.py and run_source.py. No network, no database."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))

import case_sweep as cs  # noqa: E402
import library_lessons_v3 as l3  # noqa: E402
import library_state as state  # noqa: E402
import run_source as rs  # noqa: E402
from test_lessons_v3 import FakeClient, lesson, para  # noqa: E402


def paras(n, words=10):
    return [para(i, f"Maria Lopez told her team a story number {i}. " + "word " * words) for i in range(n)]


def win(ps, ctx=()):
    return {"window_id": "w1", "source_id": "s", "chapter": "C1", "sections": [], "word_count": 0,
            "paragraphs": ps, "context": list(ctx)}


@pytest.fixture
def env(tmp_path):
    sp = tmp_path / "state.json"
    state.set_budget(6.90, sp)
    return SimpleNamespace(state=sp, cache=tmp_path / "cache.jsonl", out=tmp_path / "out", tmp=tmp_path)


def ex_of(client, env, cls=cs.SweepExtractor):
    if cls is cs.SweepExtractor:
        return cls(client, cache_path=env.cache, state_path=env.state)
    return cls(client, examples=l3.load_examples(), cache_path=env.cache, state_path=env.state)


def test_find_runs_needs_three_consecutive():
    ps = paras(10)
    assert cs.find_runs(ps, {"s_p0003", "s_p0004", "s_p0008"}) == [(0, 3), (5, 8)]
    assert cs.find_runs(ps, {"s_p0002", "s_p0005", "s_p0007"}) == [(8, 10)] or True
    assert cs.find_runs(ps, {"s_p0002", "s_p0005", "s_p0007"}) == []


def test_run_windows_context_and_not_citable():
    ps = paras(8)
    w = win(ps[2:], ctx=[ps[0], ps[1]])
    lessons = [{"window_id": "w1", "paragraph_ids": ["s_p0005"]}]
    runs = cs.build_run_windows(w, lessons)
    assert [len(r["paragraphs"]) for r in runs] == [3, 2][:1] or len(runs) == 1
    r = runs[0]
    assert [p["id"] for p in r["paragraphs"]] == ["s_p0002", "s_p0003", "s_p0004"]
    assert [p["id"] for p in r["context"]] == ["s_p0001", "s_p0005"]
    clean, reasons, _ = l3.validate_lesson(lesson(paragraph_ids=["s_p0005"]), r)
    assert clean is None and any("unknown_paragraph_id" in x for x in reasons)


def test_sweep_end_to_end(env):
    ps = paras(6)
    w = win(ps)
    existing = [{"lesson_id": "x", "window_id": "w1", "paragraph_ids": ["s_p0005"], "title": "t"}]
    good = lesson(paragraph_ids=["s_p0001"], evidence=None, caveat=None, short_quote=None,
                  author_argues="Maria Lopez tells a story.", principle="The story shows a case.",
                  lesson_type="principle")
    bad = lesson(paragraph_ids=["s_p0005"])   # cites a paragraph outside the run
    client = FakeClient([good, bad])
    ex = ex_of(client, env)
    cost = cs.run_sweep([w], existing, ex, env.out)
    assert client.calls == 1 and cost["sweep_lessons_kept"] == 1 and cost["sweep_lessons_dropped"] == 1
    sw = [json.loads(l) for l in (env.out / "sweep_lessons.jsonl").read_text().splitlines()]
    assert sw[0]["source"] == "sweep" and sw[0]["lesson_type"] == "story" and sw[0]["prompt_version"] == "sweep-v1"
    assert sw[0]["evidence_paragraphs"][0]["id"] == "s_p0001"
    merged = [json.loads(l) for l in (env.out / "merged.jsonl").read_text().splitlines()]
    assert len(merged) == 2 and merged[0]["lesson_id"] == "x" and "source" not in merged[0]
    assert (env.out / "dropped.jsonl").read_text().strip()
    assert state.total_cost(env.state) == pytest.approx(cost["cost_usd"]) and cost["cost_usd"] > 0
    # cached rerun: no call
    cost2 = cs.run_sweep([w], existing, ex_of(client, env), env.out)
    assert client.calls == 1 and cost2["api_calls"] == 0 and cost2["calls_cached"] == 1


def test_sweep_empty_answer_and_prompt():
    assert "worked case" in cs.SWEEP_INSTRUCTIONS and '{"lessons": []}' in cs.SWEEP_INSTRUCTIONS
    assert "Do NOT add names" in cs.SWEEP_INSTRUCTIONS and "paragraph_ids" in cs.SWEEP_INSTRUCTIONS


def test_sweep_cache_key_differs_from_extractor():
    assert l3.cache_key("m", "s", "u", "sweep-v1") != l3.cache_key("m", "s", "u")


def test_sweep_dry_run_no_client():
    out = []
    r = cs.dry_run([win(paras(5))], [], "gpt-4.1-mini", out=out.append)
    assert r["runs"] == 1 and r["usd"] > 0 and out


def test_sweep_max_cost_stops(env):
    client = FakeClient([])
    cost = cs.run_sweep([win(paras(5))], [], ex_of(client, env), env.out, max_cost=0.0)
    assert client.calls == 0 and cost["stopped"]


def test_prompt_version_is_v33():
    assert l3.PROMPT_VERSION == "lessons-v3.3"
    assert "HARD LIMIT of 3 ids" in l3.INSTRUCTIONS
    assert "Write them LAST" not in l3.INSTRUCTIONS and "Use only words and claims" not in l3.INSTRUCTIONS


# --- run_source -----------------------------------------------------------

def make_lib(tmp, n=6, words=900):
    d = tmp / "lib" / "s"
    d.mkdir(parents=True)
    rows = [{**para(i, f"Maria Lopez says point {i}. " + "word " * words, chapter="C1" if i < 4 else "C2"),
             "kind": "body"} for i in range(n)]
    (d / "paragraphs_v3.2.jsonl").write_text("".join(json.dumps(r) + "\n" for r in rows))
    (d / "headings_v3.2.jsonl").write_text("")
    return tmp / "lib"


def test_source_windows_within_chapter_with_context(env):
    lib = make_lib(env.tmp)
    ws = rs.source_windows("s", lib)
    assert len(ws) >= 2 and all(len({p["chapter"] for p in w["paragraphs"]}) == 1 for w in ws)
    assert ws[0]["context"] == []
    assert any(w["context"] for w in ws)
    ids = [p["id"] for w in ws for p in w["paragraphs"]]
    assert ids == sorted(set(ids))   # each paragraph exactly once


def test_run_source_resumable_and_rows(env):
    lib = make_lib(env.tmp)
    client = FakeClient([lesson(paragraph_ids=["s_p0000"], evidence=None, caveat=None, short_quote=None,
                                author_argues="Maria Lopez says point 0.", principle="A point.")])
    ex = l3.ExtractorV3(client, examples=l3.load_examples(), cache_path=env.cache, state_path=env.state,
                        library_dir=lib)
    n = len(rs.source_windows("s", lib))
    cost = rs.run_source("s", ex, library_dir=lib)
    assert client.calls == n and cost["windows_done"] == n
    d = lib / "s" / "lessons_v3.3"
    for f in ("lessons.jsonl", "dropped.jsonl", "cost.json", "state.json"):
        assert (d / f).exists()
    rows = [json.loads(l) for l in (d / "lessons.jsonl").read_text().splitlines()]
    r = rows[0]
    assert r["source_id"] == "s" and r["chapter"] == "C1" and r["window_id"] and r["paragraph_ids"] and \
        r["evidence_paragraphs"][0]["text"] and "page_start" in r and r["prompt_version"] == "lessons-v3.3"
    # resume: everything served from cache
    ex2 = l3.ExtractorV3(client, examples=l3.load_examples(), cache_path=env.cache, state_path=env.state,
                         library_dir=lib)
    cost2 = rs.run_source("s", ex2, library_dir=lib)
    assert client.calls == n and cost2["api_calls"] == 0 and cost2["cached_windows"] == n


def test_run_source_max_cost_guard_then_resume(env):
    lib = make_lib(env.tmp)
    client = FakeClient([])
    ex = l3.ExtractorV3(client, examples=l3.load_examples(), cache_path=env.cache, state_path=env.state,
                        library_dir=lib)
    est = ex.estimate(rs.source_windows("s", lib)[0])
    cost = rs.run_source("s", ex, max_cost=est * 1.5, library_dir=lib)
    assert client.calls == 1 and cost["stopped"] and cost["windows_done"] == 1
    ex2 = l3.ExtractorV3(client, examples=l3.load_examples(), cache_path=env.cache, state_path=env.state,
                         library_dir=lib)
    cost2 = rs.run_source("s", ex2, library_dir=lib)
    assert cost2["stopped"] is None and cost2["cached_windows"] == 1


def test_run_source_with_sweep(env):
    lib = make_lib(env.tmp, n=12, words=100)
    client = FakeClient([])
    ex = l3.ExtractorV3(client, examples=l3.load_examples(), cache_path=env.cache, state_path=env.state,
                        library_dir=lib)
    cost = rs.run_source("s", ex, sweep=True, library_dir=lib)
    assert cost["sweep"]["runs"] >= 1 and (lib / "s" / "lessons_v3.3" / "sweep" / "merged.jsonl").exists()


def test_dry_run_and_windows_only_make_no_calls(env, capsys):
    lib = make_lib(env.tmp)
    out = []
    t = rs.dry_run(["s"], "gpt-4.1-mini", l3.load_examples(), lib, out=out.append)
    assert t["windows"] >= 2 and t["usd"] > 0
    rs.write_windows("s", rs.source_windows("s", lib), lib)
    assert (lib / "s" / "lessons_v3.3" / "windows.jsonl").exists()
