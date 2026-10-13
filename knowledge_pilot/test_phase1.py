"""Tests for run_phase1. Everything mocked: no API calls, no database, temp dirs only."""
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))

import library_state as state
import run_library as rl
import run_phase1 as P


def src(sid, typ="book", size=100.0, **kw):
    d = {"source_id": sid, "path": f"sources/{sid}.txt", "pillar": "think_sharper", "type": typ,
         "format": "txt", "size_kb": size, "title": sid, "status_hint": "pending",
         "duplicate_of": None, "text_native_first5": None}
    d.update(kw)
    return d


def make_cfg(tmp_path, sources, **kw):
    m = tmp_path / "manifest.json"
    m.write_text(json.dumps({"sources": sources}))
    kw.setdefault("enrich_fn", lambda sid: {"failed": []})
    kw.setdefault("embed_fn", lambda sid: {})
    return P.Cfg(manifest=m, state_path=tmp_path / "state.json", library_root=tmp_path / "lib",
                 archive_root=tmp_path / "arch", tasks_dir=tmp_path, quiet=True, **kw)


def fake_pipeline(monkeypatch, cfg, words=5000, punct=True, gate_pass=True, chunks=20):
    """Replace run_library stages with fakes that write plausible files."""
    def process(entry, stages, opts):
        sid = entry["source_id"]
        out = opts.out_root / sid
        out.mkdir(parents=True, exist_ok=True)
        if "extract" in stages:
            txt = "A full sentence here." if punct else "no punctuation at all here"
            (out / "paragraphs.jsonl").write_text(json.dumps({"text": txt}) + "\n")
            state.set_status(sid, "extracted", opts.state_path, words=words)
            return {"status": "extracted"}
        if "chunk" in stages:
            (out / "chunks.jsonl").write_text("".join(
                json.dumps({"id": f"{sid}-{i}", "text": "word " * 300, "word_count": 300}) + "\n"
                for i in range(chunks)))
            state.set_status(sid, "chunked", opts.state_path, chunks=chunks)
        return {"status": "chunked"}
    qa = {"chunks": chunks, "flagged": 0, "flagged_pct": 0.0, "median_words": 300,
          "heuristic_counts": {"under_150_words": 2},
          "gate": {"passed": gate_pass, "flagged_ok": gate_pass, "median_ok": True, "rule": ""}}
    if not gate_pass:
        qa.update(flagged_pct=8.0, flagged=2)

    def run_qa(entry, opts):
        return {"status": "x", "qa": qa}
    monkeypatch.setattr(rl, "process_source", process)
    monkeypatch.setattr(rl, "run_qa", run_qa)
    return qa


def test_order_books_then_bios_then_rest_smallest_first():
    s = [src("t1", "other", 5), src("b2", "book", 30), src("bio1", "biography", 1),
         src("b1", "book", 10), src("t0", "other", 1)]
    assert [x["source_id"] for x in P.order_sources(s)] == ["b1", "b2", "bio1", "t0", "t1"]


def test_pending_skips_final_statuses_and_premarked(tmp_path):
    s = [src("a"), src("b"), src("c"), src("dup", status_hint="duplicate"),
         src("scan", text_native_first5=False), src("d")]
    cfg = make_cfg(tmp_path, s)
    state.set_status("a", "done", cfg.state_path)
    state.set_status("b", "needs_review", cfg.state_path)
    state.set_status("c", "extracted", cfg.state_path)  # unfinished, resumes
    ids = [e["source_id"] for e in P.pending_sources(cfg)]
    assert ids == ["c", "d"] or ids == ["d", "c"] or set(ids) == {"c", "d"}
    assert "dup" not in ids and "scan" not in ids and "a" not in ids and "b" not in ids


def test_happy_path_done_and_report(tmp_path, monkeypatch):
    cfg = make_cfg(tmp_path, [src("a")])
    fake_pipeline(monkeypatch, cfg)
    assert P.process_source(cfg, src("a")) == "done"
    assert state.get_status("a", cfg.state_path) == "done"
    assert (tmp_path / "LIBRARY_REPORT.md").exists()
    assert "OpenAI spend" in (tmp_path / "LIBRARY_REPORT.md").read_text()


def test_qa_fail_goes_to_queue_then_needs_review_after_retry(tmp_path, monkeypatch):
    called = []
    cfg = make_cfg(tmp_path, [src("a")], enrich_fn=lambda s: called.append(s) or {"failed": []})
    fake_pipeline(monkeypatch, cfg, gate_pass=False)
    assert P.process_source(cfg, src("a")) == "qa_failed_pending_fix"
    assert state.get_status("a", cfg.state_path) == "qa_failed_pending_fix"
    q = json.loads((tmp_path / "needs_fix_queue.json").read_text())
    assert q[0]["source_id"] == "a" and q[0]["reasons"] and "qa" in q[0]
    assert called == []  # no enrichment on failure
    assert P.process_source(cfg, src("a"), retry=True) == "needs_review"
    assert called == []
    assert json.loads((tmp_path / "needs_fix_queue.json").read_text()) == []
    notes = state.load(cfg.state_path)["sources"]["a"]["notes"]
    assert "failed again" in notes[-1]["note"]


def test_retry_after_fix_passes(tmp_path, monkeypatch):
    cfg = make_cfg(tmp_path, [src("a")])
    fake_pipeline(monkeypatch, cfg, gate_pass=False)
    P.process_source(cfg, src("a"))
    fake_pipeline(monkeypatch, cfg, gate_pass=True)
    assert P.process_source(cfg, src("a"), retry=True) == "done"
    assert json.loads((tmp_path / "needs_fix_queue.json").read_text()) == []


def test_unpunctuated_transcript_needs_review(tmp_path, monkeypatch):
    cfg = make_cfg(tmp_path, [src("t", "other")])
    fake_pipeline(monkeypatch, cfg, punct=False)
    assert P.process_source(cfg, src("t", "other")) == "needs_review"
    note = state.load(cfg.state_path)["sources"]["t"]["notes"][-1]["note"]
    assert "punctuation" in note


def test_too_little_text_unsupported(tmp_path, monkeypatch):
    cfg = make_cfg(tmp_path, [src("a")])
    fake_pipeline(monkeypatch, cfg, words=300)
    assert P.process_source(cfg, src("a")) == "unsupported_format"


def test_scanned_marked_unsupported_without_extraction(tmp_path, monkeypatch):
    cfg = make_cfg(tmp_path, [src("s", text_native_first5=False)])
    monkeypatch.setattr(rl, "process_source", lambda *a, **k: pytest.fail("must not extract"))
    assert P.process_source(cfg, src("s", text_native_first5=False)) == "unsupported_format"


def test_exception_marks_needs_review_and_continues(tmp_path, monkeypatch):
    def boom(sid):
        raise RuntimeError("kaboom")
    cfg = make_cfg(tmp_path, [src("a", size=1), src("b", size=2)],
                   enrich_fn=lambda sid: boom(sid) if sid == "a" else {"failed": []})
    fake_pipeline(monkeypatch, cfg)
    res = P.run_loop(cfg, P.order_sources([src("a", size=1), src("b", size=2)]))
    assert res == {"a": "needs_review", "b": "done"}
    assert "kaboom" in state.load(cfg.state_path)["sources"]["a"]["notes"][-1]["note"]


def test_budget_refusal_stops_loop_cleanly(tmp_path, monkeypatch):
    cfg = make_cfg(tmp_path, [src("a", size=1), src("b", size=2)], budget=15.0)
    fake_pipeline(monkeypatch, cfg)
    state.add_cost("zzz", 14.99999, "prior", cfg.state_path)
    res = P.run_loop(cfg, P.order_sources([src("a", size=1), src("b", size=2)]))
    assert res == {"a": "budget_refused"}  # loop stopped before b
    assert state.get_status("a", cfg.state_path) == "pending"


def test_limit_and_stop_after_spend(tmp_path, monkeypatch):
    srcs = [src(f"s{i}", size=i + 1) for i in range(5)]
    cfg = make_cfg(tmp_path, srcs)
    fake_pipeline(monkeypatch, cfg)
    assert len(P.run_loop(cfg, srcs, limit=2)) == 2

    cfg2 = make_cfg(tmp_path / "x", srcs) if (tmp_path / "x").mkdir() is None else None

    def spend(sid):
        state.add_cost(sid, 1.0, "enrich", cfg2.state_path)
        return {"failed": []}
    cfg2.enrich_fn = spend
    fake_pipeline(monkeypatch, cfg2)
    assert len(P.run_loop(cfg2, srcs, stop_after_spend=2.0)) == 2


def test_spot_check_first3_every10th_and_flagged(tmp_path, monkeypatch):
    srcs = [src(f"s{i:02d}", size=i + 1) for i in range(12)]
    cfg = make_cfg(tmp_path, srcs)
    fake_pipeline(monkeypatch, cfg)
    P.run_loop(cfg, srcs)
    q = json.loads((tmp_path / "spot_check_queue.json").read_text())["queue"]
    assert [r["source_id"] for r in q] == ["s00", "s01", "s02", "s09"]
    assert state.load(cfg.state_path)["sources"]["s09"]["agent_check_pending"] is True
    assert P.register_spot_check(cfg, "s11", 2.5) is True
    assert P.register_spot_check(cfg, "s11", 2.5) is True  # idempotent


def test_report_contents(tmp_path, monkeypatch):
    srcs = [src("a"), src("dup", status_hint="duplicate", duplicate_of="a"),
            src("pilot", status_hint="excluded", is_pilot=True), src("scan", text_native_first5=False)]
    cfg = make_cfg(tmp_path, srcs)
    fake_pipeline(monkeypatch, cfg)
    (tmp_path / "agent_checks.json").write_text(json.dumps(
        {"a": {"agent": "chunk-auditor", "result": "pass", "date": "2026-10-13", "notes": "ok"}}))
    P.process_source(cfg, srcs[0])
    text = P.write_report(cfg).read_text()
    for needle in ("Last updated", "$15.00 budget", "Local storage", "Estimated upload size",
                   "chunk-auditor: pass", "## Duplicates", "## Unsupported formats",
                   "## Excluded pilot books", "## Needs review"):
        assert needle in text
    assert "scan" in text and "pilot" in text


def test_missing_key_refuses(monkeypatch, capsys):
    monkeypatch.setattr(P, "get_key", lambda cfg: None)
    assert P.main(["--limit", "1"]) == 2
    assert "OPENAI_API_KEY" in capsys.readouterr().err


def test_dry_run_estimates_no_api(tmp_path, capsys):
    cfg = make_cfg(tmp_path, [src("a", size=200), src("b", "biography", 50)])
    total = P.dry_run(cfg, P.pending_sources(cfg))
    assert total > 0 and "projected total cost" in capsys.readouterr().out
