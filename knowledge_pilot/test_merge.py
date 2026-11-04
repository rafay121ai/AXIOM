"""Tests for merge_library.merge_pass. Mocked OpenAI, temp dirs, no real API calls, no database."""
import json

import pytest

import enrich_library as E
import merge_library as M
from test_enrich import FakeClient, FakeState, item

SRC = "merge_src"


@pytest.fixture
def env(tmp_path, monkeypatch):
    monkeypatch.setattr(E, "LIBRARY_DIR", tmp_path / "library")
    monkeypatch.setattr(E, "ARCHIVE_DIR", tmp_path / "_archive")
    st = FakeState()
    monkeypatch.setattr(E, "STATE", st)
    monkeypatch.setattr(E, "_sleep", lambda s: None)
    return st


def mk(i, words=200, chapter="Ch1", boundary="complete", **kw):
    text = " ".join(f"w{i}x{k}" for k in range(words - 1)) + f" end{i}."
    d = {"id": f"c{i:03d}", "book": "B", "author": "A", "chapter": chapter, "section": None, "text": text,
         "word_count": words, "page_start": i, "page_end": i, "continues": False, "flags": [],
         "boundary": boundary, "summary": f"s{i}", "position": i + 1}
    d.update(kw)
    return d


def write(chunks):
    d = E.source_dir(SRC)
    d.mkdir(parents=True, exist_ok=True)
    (d / "chunks.jsonl").write_text("\n".join(json.dumps(c) for c in chunks) + "\n")


def read():
    return E.read_jsonl(E.source_dir(SRC) / "chunks.jsonl")


def groups(bounds, words=200, chapters=None):
    chunks = [mk(i, words, (chapters or {}).get(i, "Ch1"), b) for i, b in enumerate(bounds)]
    return M.plan_merges(chunks)


# ------------------------------------------------------------------ planning
def test_starts_mid_merges_into_previous_ends_early_with_next():
    assert groups(["complete", "starts_mid", "complete"]) == [[0, 1], [2]]
    assert groups(["complete", "ends_early", "complete"]) == [[0], [1, 2]]


def test_runs_resolve_left_to_right_up_to_the_cap():
    # 5 chunks of 200 words, all linked: cap 900 -> 4 fit (800), the fifth starts a new group
    assert groups(["complete", "starts_mid", "starts_mid", "starts_mid", "starts_mid"]) == [[0, 1, 2, 3], [4]]
    assert groups(["ends_early"] * 4 + ["complete"], words=300) == [[0, 1, 2], [3, 4]]


def test_never_merges_across_chapters_or_over_900():
    assert groups(["complete", "starts_mid"], chapters={1: "Ch2"}) == [[0], [1]]
    assert groups(["complete", "starts_mid"], words=500) == [[0], [1]]          # 1000 > 900
    assert groups(["complete", "starts_mid"], words=450) == [[0, 1]]            # exactly 900 is allowed


def test_complete_chunks_are_untouched():
    assert groups(["complete"] * 4) == [[0], [1], [2], [3]]


# ------------------------------------------------------------------ the pass
def run_pass(env, chunks, script=None, default=None):
    write(chunks)
    cl = FakeClient(script=script, default=default or (lambda ids, p: [item(i) for i in ids]))
    res = M.merge_pass(SRC, client=cl, log=lambda *_: None)
    return res, cl


def test_merge_pass_preserves_every_paragraph_once_and_relinks(env):
    chunks = [mk(0), mk(1, boundary="starts_mid"), mk(2), mk(3, boundary="ends_early"), mk(4), mk(5)]
    for i, c in enumerate(chunks):
        c["text"] = f"para a{i}\n\npara b{i}\n\npara c{i}"
        c["word_count"] = 200
    before = [p for c in chunks for p in c["text"].split("\n\n")]
    res, cl = run_pass(env, chunks)
    out = read()
    assert [p for c in out for p in c["text"].split("\n\n")] == before        # no loss, no duplication, same order
    assert [c["id"] for c in out] == ["c000", "c002", "c003", "c005"]        # first id kept, nothing renumbered
    assert out[0]["merged_from"] == ["c001"] and out[2]["merged_from"] == ["c004"]
    assert [c["position"] for c in out] == [1, 2, 3, 4]
    assert [c["prev_id"] for c in out] == [None, "c000", "c002", "c003"]
    assert [c["next_id"] for c in out] == ["c002", "c003", "c005", None]
    assert all(c["continues"] is False for c in out)                          # merging never sets continues
    assert out[0]["word_count"] == 12 and out[0]["page_start"] == 0 and out[0]["page_end"] == 1
    assert "merged_by_boundary" in out[0]["flags"]


def test_only_merged_chunks_are_reenriched_under_enrich_merge_cost(env):
    chunks = [mk(0), mk(1, boundary="starts_mid"), mk(2), mk(3)]
    write(chunks)
    # first enrichment already happened: put cache rows for the unmerged chunks so only merged ones are new
    for c in chunks:
        E.append_cache(SRC, c, {"summary": c["summary"], "boundary": c["boundary"]}, [])
    cl = FakeClient(default=lambda ids, p: [item(i) for i in ids])
    res = M.merge_pass(SRC, client=cl, log=lambda *_: None)
    sent = [json.loads(c["messages"][1]["content"]) for c in cl.calls]
    assert [[x["id"] for x in batch] for batch in sent] == [["c000"]]         # just the merged chunk
    assert sent[0][0]["text"].count("end0.") == 1 and "end1." in sent[0][0]["text"]
    assert {p for _, _, p in env.costs} == {"enrich_merge"} and res["cost_usd"] > 0
    assert res["merged_per_pass"] == [1, 0]
    assert env.fields[SRC]["merge_cost_usd"] == res["cost_usd"]
    assert env.fields[SRC]["boundary_flagged"] == {"starts_mid": 1, "ends_early": 0}
    assert env.fields[SRC]["boundary_merged_per_pass"] == [1, 0]
    assert env.fields[SRC]["boundary_unmerged"] == {"starts_mid": 0, "ends_early": 0}


def test_second_pass_merges_new_flags_then_stops_at_two_passes(env):
    chunks = [mk(0), mk(1, boundary="starts_mid"), mk(2), mk(3)]
    write(chunks)
    for c in chunks:
        E.append_cache(SRC, c, {"summary": c["summary"], "boundary": c["boundary"]}, [])
    # re-enrichment of merged c000 says it still ends early -> pass 2 merges it with c002;
    # the second re-enrichment says starts_mid again, but there is no pass 3
    answers = iter(["ends_early", "starts_mid"])
    cl = FakeClient(default=lambda ids, p: [item(i, boundary=next(answers)) for i in ids])
    res = M.merge_pass(SRC, client=cl, log=lambda *_: None)
    assert res["merged_per_pass"] == [1, 1] and len(cl.calls) == 2
    out = read()
    assert [c["id"] for c in out] == ["c000", "c003"] and out[0]["word_count"] == 600
    assert "boundary_unmerged_starts_mid" in out[0]["flags"]                  # left over after pass 2
    assert res["unmerged"] == {"starts_mid": 1, "ends_early": 0}


def test_unmerged_when_cap_or_chapter_blocks(env):
    chunks = [mk(0, 500), mk(1, 500, boundary="starts_mid"), mk(2, 200, chapter="Ch2", boundary="starts_mid"),
              mk(3, 200, chapter="Ch2", boundary="ends_early")]
    write(chunks)
    res = M.merge_pass(SRC, client=FakeClient(), log=lambda *_: None)
    out = read()
    by = {c["id"]: c for c in out}
    # c001 (cap), c002 (chapter start) cannot merge back; c003 ends_early but c004 does not exist
    assert "boundary_unmerged_starts_mid" in by["c001"]["flags"] and "boundary_unmerged_starts_mid" in by["c002"]["flags"]
    assert "boundary_unmerged_ends_early" in by["c003"]["flags"]
    assert res["merged_per_pass"] == [0] and res["unmerged"] == {"starts_mid": 2, "ends_early": 1}
    assert FakeClient().calls == []                                            # nothing to re-enrich


def test_archive_before_each_rewrite_and_cache_stays_on_disk(env):
    chunks = [mk(0), mk(1, boundary="starts_mid"), mk(2)]
    write(chunks)
    for c in chunks:
        E.append_cache(SRC, c, {"summary": "x", "boundary": c["boundary"]}, [])
    cache_before = (E.source_dir(SRC) / "enrichment_cache.jsonl").read_text()
    M.merge_pass(SRC, client=FakeClient(), log=lambda *_: None)
    archived = list((E.ARCHIVE_DIR / SRC).glob("chunks_*.jsonl"))
    assert len(archived) >= 2                                                  # merge write + re-enrich write + final
    assert (E.source_dir(SRC) / "enrichment_cache.jsonl").read_text().startswith(cache_before)


def test_requires_boundary_judgement(env):
    c = mk(0)
    del c["boundary"]
    write([c])
    with pytest.raises(RuntimeError):
        M.merge_pass(SRC, client=FakeClient(), log=lambda *_: None)


def test_failed_reenrichment_is_reported_not_hidden(env):
    chunks = [mk(0), mk(1, boundary="starts_mid")]
    write(chunks)
    for c in chunks:
        E.append_cache(SRC, c, {"summary": "x", "boundary": c["boundary"]}, [])
    cl = FakeClient(default=lambda ids, p: [])
    res = M.merge_pass(SRC, client=cl, log=lambda *_: None)
    assert res["failed"] == ["c000"]
    assert env.fields[SRC]["merge_done"] is False
