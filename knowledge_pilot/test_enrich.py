"""Tests for enrich_library. Mocked OpenAI client; no real API calls."""
import json
from types import SimpleNamespace as NS

import pytest

import enrich_library as E

SRC = "test_src"


class FakeState:
    def __init__(self, budget=15.0):
        self.budget, self.costs, self.statuses = budget, [], {}

    def set_status(self, s, st):
        self.statuses[s] = st

    def add_cost(self, s, usd, purpose):
        self.costs.append((s, usd, purpose))

    def update_fields(self, s, **fields):
        self.fields = getattr(self, 'fields', {})
        self.fields.setdefault(s, {}).update(fields)

    def budget_remaining(self):
        return self.budget - sum(c[1] for c in self.costs)

    def can_start(self, est):
        return est <= self.budget_remaining()


def item(cid, **kw):
    d = dict(id=cid, context_line="Book, ch 1: how a firm priced early.",
             summary="Stone describes a pricing choice made under pressure.",
             key_takeaway="Test price changes on a small segment first.",
             example_questions=["How do I test a price rise?", "When should I change pricing?"],
             chunk_type="story", applies_when=["pricing", "early-revenue"],
             pillars=["money_game"], lesson_strength="strong", boundary="complete")
    d.update(kw)
    return E.ChunkEnrichment(**d)


def usage(p=1000, c=500, cached=0):
    return NS(prompt_tokens=p, completion_tokens=c, total_tokens=p + c,
              prompt_tokens_details=NS(cached_tokens=cached))


class FakeClient:
    """script: list of callables(messages) -> list of items, one per LLM call."""

    def __init__(self, script=None, default=None):
        self.calls, self.script, self.default = [], list(script or []), default
        self.beta = NS(chat=NS(completions=NS(parse=self._parse)))
        self.embed_calls = []
        self.embeddings = NS(create=self._embed)

    def _parse(self, **kw):
        self.calls.append(kw)
        payload = json.loads(kw["messages"][1]["content"].split("\n\nFix these")[0])
        ids = [p["id"] for p in payload]
        fn = self.script.pop(0) if self.script else self.default
        items = fn(ids, payload) if fn else [item(i) for i in ids]
        msg = NS(parsed=E.EnrichmentBatch(items=items))
        return NS(choices=[NS(message=msg)], usage=usage(), id="r")

    def _embed(self, **kw):
        self.embed_calls.append(kw)
        data = [NS(index=i, embedding=[0.1234567891] * kw["dimensions"])
                for i in range(len(kw["input"]))]
        return NS(data=data, usage=NS(prompt_tokens=100, total_tokens=100))


@pytest.fixture
def env(tmp_path, monkeypatch):
    monkeypatch.setattr(E, "LIBRARY_DIR", tmp_path / "library")
    monkeypatch.setattr(E, "ARCHIVE_DIR", tmp_path / "_archive")
    st = FakeState()
    monkeypatch.setattr(E, "STATE", st)
    monkeypatch.setattr(E, "_sleep", lambda s: None)
    return st


def make_chunks(n, text="Some plain passage text about a company and its pricing decisions."):
    return [{"id": f"c{i:03d}", "book": "B", "author": "A", "chapter": "Ch", "section": None,
             "text": f"{text} Number {i}.", "word_count": 12, "pillars": []} for i in range(n)]


def write_chunks(chunks):
    d = E.source_dir(SRC)
    d.mkdir(parents=True, exist_ok=True)
    (d / "chunks.jsonl").write_text("\n".join(json.dumps(c) for c in chunks) + "\n")


def test_batching_of_10(env):
    write_chunks(make_chunks(25))
    cl = FakeClient()
    r = E.enrich_source(SRC, client=cl, log=lambda *_: None)
    assert [len(json.loads(c["messages"][1]["content"])) for c in cl.calls] == [10, 10, 5]
    assert r["failed"] == [] and env.statuses[SRC] == "enriched"
    out = E.read_jsonl(E.source_dir(SRC) / "chunks.jsonl")
    assert all(c["summary"] and c["flags"] == [] for c in out)
    assert all(c["temperature"] == 0 for c in cl.calls)


def test_missing_id_retried_individually(env):
    write_chunks(make_chunks(10))
    cl = FakeClient(script=[lambda ids, p: [item(i) for i in ids if i != "c003"]])
    r = E.enrich_source(SRC, client=cl, log=lambda *_: None)
    assert r["failed"] == []
    assert len(cl.calls) == 2
    assert [x["id"] for x in json.loads(cl.calls[1]["messages"][1]["content"].split("\n\nFix")[0])] == ["c003"]


def test_missing_id_gives_up_and_flags(env):
    write_chunks(make_chunks(3))
    cl = FakeClient(default=lambda ids, p: [item(i) for i in ids if i != "c001"])
    r = E.enrich_source(SRC, client=cl, log=lambda *_: None)
    assert r["failed"] == ["c001"]
    out = {c["id"]: c for c in E.read_jsonl(E.source_dir(SRC) / "chunks.jsonl")}
    assert "enrichment_failed" in out["c001"]["flags"]
    assert SRC not in env.statuses  # not marked enriched


def test_duplicate_ids_counted_once(env):
    write_chunks(make_chunks(2))
    cl = FakeClient(script=[lambda ids, p: [item(i) for i in ids] + [item(ids[0])]])
    r = E.enrich_source(SRC, client=cl, log=lambda *_: None)
    assert r["failed"] == [] and len(cl.calls) == 1


def test_long_verbatim_detection():
    src = "one two three four five six seven eight nine ten eleven twelve thirteen fourteen"
    assert E.longest_verbatim_run("He said one two three four five six seven eight nine ten eleven.", src) == 11
    assert E.longest_verbatim_run("one two three four five six seven eight nine ten, then other", src) == 10
    assert E.validate_item(item("x", summary="Stone: one two three four five six seven eight nine ten eleven."), src) == ["verbatim"]
    assert E.validate_item(item("x", summary="Stone: one two three four five six seven eight nine ten."), src) == []


def test_verbatim_rerequested_once_then_truncated(env):
    chunks = make_chunks(1, "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi")
    write_chunks(chunks)
    bad = "Stone fine. alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu."
    cl = FakeClient(default=lambda ids, p: [item(i, summary=bad) for i in ids])
    r = E.enrich_source(SRC, client=cl, log=lambda *_: None)
    assert len(cl.calls) == 2  # original + exactly one re-request
    assert r["failed"] == []
    out = E.read_jsonl(E.source_dir(SRC) / "chunks.jsonl")[0]
    assert out["summary"] == "Stone fine."
    assert "summary_truncated_verbatim" in out["flags"]


def test_null_takeaway_rule():
    assert E.validate_item(item("x", lesson_strength="none", key_takeaway="Do x."), "t") == ["takeaway_rule"]
    assert E.validate_item(item("x", lesson_strength="strong", key_takeaway=None), "t") == ["takeaway_rule"]
    assert E.validate_item(item("x", lesson_strength="none", key_takeaway=None), "t") == []


def test_null_takeaway_corrected_via_retry(env):
    write_chunks(make_chunks(1))
    cl = FakeClient(script=[lambda ids, p: [item(i, lesson_strength="weak", key_takeaway=None) for i in ids]])
    E.enrich_source(SRC, client=cl, log=lambda *_: None)
    assert "takeaway_rule" in cl.calls[1]["messages"][1]["content"]


@pytest.mark.parametrize("word", ["great", "Certainly", "absolutely", "Of course", "I understand"])
def test_forbidden_phrase(word):
    p = E.validate_item(item("x", summary=f"Stone says {word} the plan works."), "t")
    assert any(x.startswith("forbidden") for x in p)
    assert E.validate_item(item("x", summary="Stone says the plan works."), "t") == []
    assert E.validate_item(item("x", summary="Stone mentions greatness."), "t") == []


def test_two_example_questions():
    assert E.validate_item(item("x", example_questions=["only one?"]), "t") == ["example_questions"]


def test_cost_recording_from_usage(env):
    write_chunks(make_chunks(3))
    E.enrich_source(SRC, client=FakeClient(), log=lambda *_: None)
    assert len(env.costs) == 1
    expected = (1000 * 0.40 + 500 * 1.60) / 1e6
    assert env.costs[0][1] == pytest.approx(expected) and env.costs[0][2] == "enrich"
    assert E.llm_cost(usage(1000, 500, cached=400)) == pytest.approx((600 * 0.4 + 400 * 0.1 + 500 * 1.6) / 1e6)
    assert E.embed_cost(NS(total_tokens=1_000_000)) == pytest.approx(0.02)


def test_timeout_records_uncertain_cost(env):
    class Timeout(Exception):
        pass
    Timeout.__name__ = "APITimeoutError"
    calls = []

    def fn():
        calls.append(1)
        raise Timeout()

    with pytest.raises(Timeout):
        E._call_with_retries(SRC, "enrich", fn, 0.01, sleep=lambda s: None)
    assert len(calls) == 3
    assert [c[2] for c in env.costs] == ["enrich_timeout_uncertain"] * 3


def test_budget_refusal(env):
    write_chunks(make_chunks(30))
    env.budget = 0.0001
    cl = FakeClient()
    with pytest.raises(E.BudgetRefused):
        E.enrich_source(SRC, client=cl, log=lambda *_: None)
    assert cl.calls == []
    assert E.estimate_source_cost(make_chunks(30)) > 0.0001
    assert E.estimate_source_cost([]) == 0


def test_cache_reuse_on_rerun(env):
    write_chunks(make_chunks(12))
    c1 = FakeClient()
    E.enrich_source(SRC, client=c1, log=lambda *_: None)
    c2 = FakeClient()
    r = E.enrich_source(SRC, client=c2, log=lambda *_: None)
    assert c2.calls == [] and r["cached"] == 12
    # changed text invalidates only that chunk
    chunks = E.read_jsonl(E.source_dir(SRC) / "chunks.jsonl")
    chunks[0]["text"] += " Edited."
    write_chunks(chunks)
    c3 = FakeClient()
    E.enrich_source(SRC, client=c3, log=lambda *_: None)
    assert len(c3.calls) == 1 and len(json.loads(c3.calls[0]["messages"][1]["content"])) == 1


def test_archive_before_overwrite(env):
    write_chunks(make_chunks(2))
    original = (E.source_dir(SRC) / "chunks.jsonl").read_text()
    E.enrich_source(SRC, client=FakeClient(), log=lambda *_: None)
    arch = list((E.ARCHIVE_DIR / SRC).glob("chunks_*.jsonl"))
    assert len(arch) == 1 and arch[0].read_text() == original


def test_embedding_text_composition():
    c = {"context_line": "CTX.", "summary": "SUM.", "key_takeaway": "KEY.",
         "example_questions": ["Q1?", "Q2?"]}
    assert E.embed_text(c) == "CTX.\nSUM.\nKEY.\nQ1?\nQ2?"
    c["key_takeaway"] = None
    assert E.embed_text(c) == "CTX.\nSUM.\nQ1?\nQ2?"


def test_embedding_512_and_batching(env):
    write_chunks(make_chunks(130))
    E.enrich_source(SRC, client=FakeClient(), log=lambda *_: None)
    cl = FakeClient()
    r = E.embed_source(SRC, client=cl, log=lambda *_: None)
    assert [len(c["input"]) for c in cl.embed_calls] == [100, 30]
    assert all(c["dimensions"] == 512 and c["model"] == "text-embedding-3-small" for c in cl.embed_calls)
    out = E.read_jsonl(E.source_dir(SRC) / "chunks.jsonl")
    assert all(len(c["embedding"]) == 512 and c["embedding"][0] == 0.123457 for c in out)
    assert env.statuses[SRC] == "embedded"
    assert any(c[2] == "embed" for c in env.costs)
    # rerun pays nothing
    cl2 = FakeClient()
    E.embed_source(SRC, client=cl2, log=lambda *_: None)
    assert cl2.embed_calls == []


def test_wrong_dimension_rejected(env):
    write_chunks(make_chunks(1))
    E.enrich_source(SRC, client=FakeClient(), log=lambda *_: None)
    cl = FakeClient()
    cl.embeddings = NS(create=lambda **kw: NS(data=[NS(index=0, embedding=[0.1] * 100)],
                                              usage=NS(total_tokens=5)))
    with pytest.raises(RuntimeError):
        E.embed_source(SRC, client=cl, log=lambda *_: None)


def test_embed_requires_enrichment(env):
    write_chunks(make_chunks(1))
    with pytest.raises(RuntimeError):
        E.embed_source(SRC, client=FakeClient(), log=lambda *_: None)


# ------------------------------------------------------------- boundary judgement
def test_prompt_defines_boundary_and_neighbour_fields():
    p = E.SYSTEM_PROMPT
    assert "prev_tail" in p and "next_head" in p
    assert '"starts_mid" if the passage opens in the middle of an argument, story, list or dialogue' in p
    assert '"ends_early" if the passage stops before the payoff, outcome, answer or explanation' in p
    assert "read-only context" in p and "ONLY to judge boundary" in p


def test_boundary_must_be_one_of_three():
    with pytest.raises(Exception):
        item("x", boundary="whatever")
    assert E.BOUNDARIES == ["complete", "starts_mid", "ends_early"]


def test_neighbour_context_is_60_words_and_stays_in_chapter(env):
    chunks = make_chunks(3, text="alpha " * 100)
    chunks[2]["chapter"] = "Other"
    ctx = E.neighbour_context(chunks)
    assert ctx["c000"][0] is None and len(ctx["c000"][1].split()) == 60
    assert len(ctx["c001"][0].split()) == 60 and ctx["c001"][1] is None   # next chunk is another chapter
    assert ctx["c002"] == (None, None)


def test_payload_carries_neighbours_and_batch_keeps_10(env):
    write_chunks(make_chunks(12))
    cl = FakeClient()
    E.enrich_source(SRC, client=cl, log=lambda *_: None)
    first = json.loads(cl.calls[0]["messages"][1]["content"])
    assert len(first) == 10
    assert first[0]["prev_tail"] is None and first[0]["next_head"].startswith("Some plain passage")
    assert first[1]["prev_tail"].startswith("Some plain passage")
    assert "boundary" in E.read_jsonl(E.source_dir(SRC) / "chunks.jsonl")[0]


def test_cache_rows_carry_version_and_old_versions_are_ignored(env):
    write_chunks(make_chunks(2))
    cache_file = E.source_dir(SRC) / "enrichment_cache.jsonl"
    old_rows = [{"id": c["id"], "hash": E.text_hash(c["text"]), "fields": {"summary": "stale"}, "flags": []}
                for c in make_chunks(2)]          # a row written before enrichment_version existed
    cache_file.write_text("".join(json.dumps(r) + "\n" for r in old_rows))
    cl = FakeClient()
    E.enrich_source(SRC, client=cl, log=lambda *_: None)
    assert len(cl.calls) == 1                      # the stale cache was not reused
    rows = E.read_jsonl(cache_file)
    assert rows[:2] == old_rows                    # ... and not deleted either
    assert all(r["version"] == E.ENRICHMENT_VERSION for r in rows[2:]) and len(rows) == 4
    cl2 = FakeClient()
    E.enrich_source(SRC, client=cl2, log=lambda *_: None)
    assert cl2.calls == []                         # same version: cached


def test_estimate_includes_context_and_merge_margin():
    chunks = [{"word_count": 300, "text": "x"}] * 40
    base = E.estimate_source_cost(chunks, ("enrich",))
    assert base > 0
    no_margin = E.MERGE_REENRICH_MARGIN
    assert no_margin == 1.15
    assert E.estimate_source_cost(chunks, ("enrich", "embed")) > base


def test_embed_drops_vectors_of_changed_chunks(env):
    chunks = make_chunks(2)
    for c in chunks:
        c.update(item(c["id"]).model_dump(exclude={"id"}))
    write_chunks(chunks)
    cl = FakeClient()
    E.embed_source(SRC, client=cl, log=lambda *_: None)
    out = E.read_jsonl(E.source_dir(SRC) / "chunks.jsonl")
    assert all(len(c["embedding"]) == 512 and c["embedding_hash"] for c in out)
    out[0]["summary"] = "A different summary after a merge re-enrichment."
    write_chunks(out)
    cl2 = FakeClient()
    E.embed_source(SRC, client=cl2, log=lambda *_: None)
    assert len(cl2.embed_calls) == 1 and len(cl2.embed_calls[0]["input"]) == 1   # only the changed chunk
