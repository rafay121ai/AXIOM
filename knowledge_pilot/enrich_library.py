"""Part B of the Axiom library pipeline: batched enrichment and embedding.

Reads  knowledge_pilot/library/<source_id>/chunks.jsonl
Writes enrichment_cache.jsonl (incremental) and rewrites chunks.jsonl
(archiving the previous file first). No database access.

CLI: python enrich_library.py --source X --stages enrich,embed [--dry-run-estimate]
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import List, Literal, Optional

from pydantic import BaseModel

PILOT_DIR = Path(__file__).resolve().parent
REPO_ROOT = PILOT_DIR.parent
LIBRARY_DIR = PILOT_DIR / "library"
ARCHIVE_DIR = PILOT_DIR / "_archive"

MODEL = "gpt-4.1-mini"
EMBED_MODEL = "text-embedding-3-small"
EMBED_DIMS = 512
BATCH_SIZE = 10
EMBED_BATCH = 100
TIMEOUT_S = 60
MAX_ATTEMPTS = 3
MAX_ID_RETRIES = 2
VERBATIM_RUN = 11  # a run of 11+ identical consecutive words is rejected

PRICING = {"input": 0.40, "cached_input": 0.10, "output": 1.60}  # USD per 1M tokens
EMBED_PRICE = 0.02  # USD per 1M tokens

# ---------------------------------------------------------------- vocabulary
STAGES = ["idea", "pre-seed", "early-revenue", "scaling", "mature-ish"]
SITUATIONS = [
    "hiring", "firing", "cofounder-conflict", "fundraising", "pricing",
    "cash-flow", "customer-discovery", "product-market-fit", "sales",
    "negotiation", "competition", "strategy-choice", "focus", "decision-making",
    "forecasting", "risk", "stress-and-motivation", "team-culture",
    "leadership", "persuasion", "growth", "operations", "ethics",
    "new-technology", "market-timing", "bias-and-judgment",
]
APPLIES_VOCAB = STAGES + SITUATIONS
PILLARS = ["how_companies_win", "human_mind", "money_game",
           "move_people", "think_sharper", "whats_coming"]
CHUNK_TYPES = ["argument", "story", "data"]
STRENGTHS = ["strong", "weak", "none"]

# CLAUDE.md forbidden phrases, matched on word boundaries, case-insensitive.
FORBIDDEN_PHRASES = [
    "great question", "certainly", "i understand", "that's interesting",
    "that’s interesting", "absolutely", "of course", "i'd be happy to",
    "i’d be happy to", "great",
]
_FORBIDDEN_RE = re.compile(
    r"(?<![\w])(" + "|".join(re.escape(p) for p in FORBIDDEN_PHRASES) + r")(?![\w])",
    re.IGNORECASE)

ENRICH_FIELDS = ["context_line", "summary", "key_takeaway", "example_questions",
                 "chunk_type", "applies_when", "pillars", "lesson_strength"]

SYSTEM_PROMPT = f"""You annotate passages from business and thinking books for a library that serves startup founders. You receive a JSON list of passages, each with an id, book, author, chapter, section and text. Return one annotation per passage, using the exact id given.

For each passage return:
- context_line: ONE sentence naming the book, the chapter (if given) and what the passage is about.
- summary: 2 to 3 sentences paraphrasing the passage in plain language, attributed to the author by name (for example "Stone describes..."). Use only facts that are in the passage. Do not add outside knowledge, examples or interpretation. Put it in your own words: never copy more than 10 consecutive words from the passage. No quote longer than 10 words.
- key_takeaway: ONE specific sentence a founder can act on or reason with, drawn from this passage only. Never generic advice that would fit any book. Set it to null if and only if lesson_strength is "none".
- example_questions: exactly 2 questions a founder might realistically ask that this passage answers, in a founder's own words, first person, specific, no jargon from the book.
- chunk_type: "argument" (the author reasons toward a claim), "story" (a narrative of events or people), or "data" (facts, figures, studies, lists of evidence).
- applies_when: 1 to 4 tags from this closed vocabulary only: stages {STAGES} and situations {SITUATIONS}. Pick the stages and situations where this passage would help a founder.
- pillars: one or more of {PILLARS}. how_companies_win = strategy and competitive advantage; human_mind = psychology, behavior, cognitive science; money_game = economics, capital, pricing, financial literacy; move_people = influence, persuasion, negotiation, leadership; think_sharper = mental models, decision making, reasoning; whats_coming = emerging tech, geopolitics, futures thinking.
- lesson_strength: "strong" if a founder could take a concrete lesson from this passage alone, "weak" if the lesson is thin or needs outside context, "none" if the passage is scene-setting, biography or background with no lesson.

Style: direct, specific, no filler. Never use the words or phrases: great, certainly, absolutely, of course, I understand, that's interesting, I'd be happy to. Never invent facts, numbers, names or quotes. Return every id exactly once."""


# ---------------------------------------------------------------- schemas
class ChunkEnrichment(BaseModel):
    id: str
    context_line: str
    summary: str
    key_takeaway: Optional[str]
    example_questions: List[str]
    chunk_type: Literal["argument", "story", "data"]
    applies_when: List[Literal[tuple(APPLIES_VOCAB)]]  # type: ignore[valid-type]
    pillars: List[Literal[tuple(PILLARS)]]  # type: ignore[valid-type]
    lesson_strength: Literal["strong", "weak", "none"]


class EnrichmentBatch(BaseModel):
    items: List[ChunkEnrichment]


# ---------------------------------------------------------------- state adapter
class _FallbackState:
    """Used only if Part A's library_state is not importable yet."""

    def __init__(self):
        self.statuses, self.costs = {}, []

    def set_status(self, source, status):
        self.statuses[source] = status

    def add_cost(self, source, usd, purpose):
        self.costs.append((source, usd, purpose))

    def budget_remaining(self):
        return 15.0 - sum(c[1] for c in self.costs)

    def can_start(self, estimated_usd):
        return estimated_usd <= self.budget_remaining()


def _load_state():
    try:
        import library_state  # type: ignore
        return library_state
    except ImportError:
        return _FallbackState()


STATE = _load_state()


class BudgetRefused(RuntimeError):
    pass


# ---------------------------------------------------------------- helpers
def text_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]


def _words(text: str) -> List[str]:
    return re.findall(r"[a-z0-9]+(?:['’-][a-z0-9]+)*", text.lower())


def longest_verbatim_run(summary: str, source: str) -> int:
    """Length in words of the longest run of the summary that appears verbatim in source."""
    s, t = _words(summary), _words(source)
    if not s or not t:
        return 0
    best = 0
    prev = [0] * (len(t) + 1)
    for i in range(1, len(s) + 1):
        cur = [0] * (len(t) + 1)
        for j in range(1, len(t) + 1):
            if s[i - 1] == t[j - 1]:
                cur[j] = prev[j - 1] + 1
                best = max(best, cur[j])
        prev = cur
    return best


def has_forbidden(text: str) -> Optional[str]:
    for m in _FORBIDDEN_RE.finditer(text or ""):
        # "Great Depression", "Great Britain": proper nouns are not filler.
        if m.group(1).lower() == "great" and re.match(r"\s+[A-Z]", text[m.end():]):
            continue
        return m.group(1)
    return None


def truncate_verbatim(summary: str, source: str) -> str:
    """Drop sentences that contain a long verbatim run. May return ''."""
    sentences = re.split(r"(?<=[.!?])\s+", summary.strip())
    kept = [s for s in sentences if longest_verbatim_run(s, source) < VERBATIM_RUN]
    return " ".join(kept)


def validate_item(item: ChunkEnrichment, chunk_text: str) -> List[str]:
    """Return list of problem codes ('' list = valid)."""
    problems = []
    if (item.lesson_strength == "none") != (item.key_takeaway is None):
        problems.append("takeaway_rule")
    if item.key_takeaway is not None and not item.key_takeaway.strip():
        problems.append("takeaway_rule")
    if len(item.example_questions) != 2 or any(not q.strip() for q in item.example_questions):
        problems.append("example_questions")
    if not item.context_line.strip() or not item.summary.strip():
        problems.append("empty_text")
    if not item.applies_when:
        problems.append("applies_when")
    if not item.pillars:
        problems.append("pillars")
    generated = " ".join([item.context_line, item.summary, item.key_takeaway or "",
                          *item.example_questions])
    bad = has_forbidden(generated)
    if bad:
        problems.append(f"forbidden:{bad.lower()}")
    if longest_verbatim_run(item.summary, chunk_text) >= VERBATIM_RUN:
        problems.append("verbatim")
    return problems


def enrichment_to_fields(item: ChunkEnrichment) -> dict:
    d = item.model_dump()
    d.pop("id", None)
    return d


def embed_text(chunk: dict) -> str:
    parts = [chunk.get("context_line"), chunk.get("summary"), chunk.get("key_takeaway")]
    parts += list(chunk.get("example_questions") or [])
    return "\n".join(p.strip() for p in parts if p and p.strip())


# ---------------------------------------------------------------- cost
def llm_cost(usage) -> float:
    pt = getattr(usage, "prompt_tokens", 0) or 0
    ct = getattr(usage, "completion_tokens", 0) or 0
    details = getattr(usage, "prompt_tokens_details", None)
    cached = (getattr(details, "cached_tokens", 0) or 0) if details else 0
    return ((pt - cached) * PRICING["input"] + cached * PRICING["cached_input"]
            + ct * PRICING["output"]) / 1_000_000


def embed_cost(usage) -> float:
    return (getattr(usage, "total_tokens", None) or getattr(usage, "prompt_tokens", 0) or 0) \
        * EMBED_PRICE / 1_000_000


def estimate_source_cost(chunks: List[dict], stages=("enrich", "embed")) -> float:
    """Conservative pre-start estimate in USD, including a 25% retry margin."""
    n = len(chunks)
    words = sum(c.get("word_count") or len(c.get("text", "").split()) for c in chunks)
    total = 0.0
    if "enrich" in stages:
        batches = -(-n // BATCH_SIZE)
        in_tokens = words * 1.4 + batches * 1100  # text + system prompt per batch
        out_tokens = n * 330
        total += (in_tokens * PRICING["input"] + out_tokens * PRICING["output"]) / 1e6
    if "embed" in stages:
        total += n * 220 * EMBED_PRICE / 1e6
    return round(total * 1.25, 6)


# ---------------------------------------------------------------- OpenAI client
def get_client():
    from dotenv import dotenv_values
    from openai import OpenAI
    key = dotenv_values(REPO_ROOT / ".env").get("OPENAI_API_KEY")
    return OpenAI(api_key=key, max_retries=0, timeout=TIMEOUT_S)


def _sleep(seconds):
    time.sleep(seconds)


def _is_timeout(exc) -> bool:
    return "timeout" in type(exc).__name__.lower() or isinstance(exc, TimeoutError)


def _call_with_retries(source, purpose, fn, est_timeout_usd, sleep=None):
    """Run fn() up to MAX_ATTEMPTS with backoff. On timeout the bill is uncertain:
    record a conservative estimate under a '_uncertain' purpose."""
    sleep = sleep or _sleep
    last = None
    for attempt in range(MAX_ATTEMPTS):
        try:
            return fn()
        except Exception as exc:  # noqa: BLE001
            last = exc
            if _is_timeout(exc):
                STATE.add_cost(source, est_timeout_usd, f"{purpose}_timeout_uncertain")
            if attempt < MAX_ATTEMPTS - 1:
                sleep(2 ** attempt * 2)
    raise last


def _payload(chunks: List[dict]) -> str:
    return json.dumps([{"id": c["id"], "book": c.get("book"), "author": c.get("author"),
                        "chapter": c.get("chapter"), "section": c.get("section"),
                        "text": c["text"]} for c in chunks], ensure_ascii=False)


def call_enrich(client, source, chunks: List[dict], feedback: str = "") -> List[ChunkEnrichment]:
    user = _payload(chunks)
    if feedback:
        user += "\n\nFix these problems from the previous attempt: " + feedback
    est = (sum(len(c["text"].split()) for c in chunks) * 1.4 + 1100) * PRICING["input"] / 1e6 \
        + len(chunks) * 330 * PRICING["output"] / 1e6

    def go():
        return client.beta.chat.completions.parse(
            model=MODEL, temperature=0,
            messages=[{"role": "system", "content": SYSTEM_PROMPT},
                      {"role": "user", "content": user}],
            response_format=EnrichmentBatch, max_completion_tokens=8000, timeout=TIMEOUT_S)

    resp = _call_with_retries(source, "enrich", go, est)
    STATE.add_cost(source, llm_cost(resp.usage), "enrich")
    parsed = resp.choices[0].message.parsed
    return list(parsed.items) if parsed else []


# ---------------------------------------------------------------- IO
def source_dir(source_id: str) -> Path:
    return LIBRARY_DIR / source_id


def read_jsonl(path: Path) -> List[dict]:
    if not path.exists():
        return []
    return [json.loads(l) for l in path.read_text(encoding="utf-8").splitlines() if l.strip()]


def archive_and_write_chunks(source_id: str, chunks: List[dict]) -> Path:
    path = source_dir(source_id) / "chunks.jsonl"
    if path.exists():
        dest_dir = ARCHIVE_DIR / source_id
        dest_dir.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now().strftime("%Y%m%d_%H%M")
        dest = dest_dir / f"chunks_{stamp}.jsonl"
        n = 1
        while dest.exists():  # never overwrite an archive
            dest = dest_dir / f"chunks_{stamp}_{n}.jsonl"
            n += 1
        shutil.copy2(path, dest)
    tmp = path.with_suffix(".jsonl.tmp")
    with tmp.open("w", encoding="utf-8") as f:
        for c in chunks:
            f.write(json.dumps(c, ensure_ascii=False) + "\n")
    tmp.replace(path)
    return path


def load_cache(source_id: str) -> dict:
    cache = {}
    for r in read_jsonl(source_dir(source_id) / "enrichment_cache.jsonl"):
        cache[(r["id"], r["hash"])] = r["fields"]
    return cache


def append_cache(source_id: str, chunk: dict, fields: dict, flags: List[str]):
    p = source_dir(source_id) / "enrichment_cache.jsonl"
    with p.open("a", encoding="utf-8") as f:
        f.write(json.dumps({"id": chunk["id"], "hash": text_hash(chunk["text"]),
                            "fields": fields, "flags": flags}, ensure_ascii=False) + "\n")


# ---------------------------------------------------------------- enrichment
def _resolve(client, source, chunk, first: Optional[ChunkEnrichment], log):
    """Validate an item; re-request individually up to MAX_ID_RETRIES. Returns
    (fields, flags) or (None, reason)."""
    item, flags = first, []
    verbatim_requested = False
    for attempt in range(MAX_ID_RETRIES + 1):
        if item is not None:
            problems = validate_item(item, chunk["text"])
            if not problems:
                return enrichment_to_fields(item), flags
            if problems == ["verbatim"] and verbatim_requested:
                break  # already re-requested once; truncate below
            if "verbatim" in problems:
                verbatim_requested = True
            feedback = "; ".join(problems)
        else:
            feedback = "this id was missing from the previous response"
        if attempt == MAX_ID_RETRIES:
            break
        log(f"  retry {chunk['id']}: {feedback}")
        try:
            got = call_enrich(client, source, [chunk], feedback)
        except Exception as exc:  # noqa: BLE001
            log(f"  call failed for {chunk['id']}: {type(exc).__name__}")
            item = None
            continue
        item = next((g for g in got if g.id == chunk["id"]), None)
    # exhausted: salvage a verbatim-only failure by truncating
    if item is not None and validate_item(item, chunk["text"]) == ["verbatim"]:
        cut = truncate_verbatim(item.summary, chunk["text"])
        if cut:
            item.summary = cut
            if not validate_item(item, chunk["text"]):
                return enrichment_to_fields(item), ["summary_truncated_verbatim"]
    return None, ["enrichment_failed"]


def enrich_source(source_id: str, client=None, log=print) -> dict:
    chunks = read_jsonl(source_dir(source_id) / "chunks.jsonl")
    if not chunks:
        raise FileNotFoundError(f"no chunks for {source_id}")
    client = client or get_client()
    cache = load_cache(source_id)
    todo = [c for c in chunks if (c["id"], text_hash(c["text"])) not in cache]

    est = estimate_source_cost(todo, stages=("enrich",))
    if todo and not STATE.can_start(est):
        raise BudgetRefused(f"{source_id}: estimate ${est:.2f} exceeds remaining "
                            f"${STATE.budget_remaining():.2f}")

    failed = []
    for i in range(0, len(todo), BATCH_SIZE):
        batch = todo[i:i + BATCH_SIZE]
        log(f"enrich {source_id}: batch {i // BATCH_SIZE + 1} ({len(batch)} chunks)")
        returned = {}
        try:
            for it in call_enrich(client, source_id, batch):
                if it.id in {c["id"] for c in batch} and it.id not in returned:
                    returned[it.id] = it  # first occurrence wins; duplicates ignored
        except Exception as exc:  # noqa: BLE001
            log(f"  batch call failed: {type(exc).__name__}")
        for c in batch:
            fields, flags = _resolve(client, source_id, c, returned.get(c["id"]), log)
            if fields is None:
                failed.append(c)
            else:
                cache[(c["id"], text_hash(c["text"]))] = fields
                append_cache(source_id, c, fields, flags)

    # final retry pass for failures, then flag whatever is still failing
    still_failed = []
    for c in failed:
        log(f"  final retry {c['id']}")
        fields, flags = _resolve(client, source_id, c, None, log)
        if fields is None:
            still_failed.append(c["id"])
        else:
            cache[(c["id"], text_hash(c["text"]))] = fields
            append_cache(source_id, c, fields, flags)

    out, changed = [], False
    for c in chunks:
        c = dict(c)
        flags = [f for f in c.get("flags", []) if f not in ("enrichment_failed",
                                                          "summary_truncated_verbatim")]
        fields = cache.get((c["id"], text_hash(c["text"])))
        if fields:
            if any(c.get(k) != v for k, v in fields.items()):
                c.pop("embedding", None)  # enrichment changed, vector is stale
            c.update(fields)
            for r in read_flag_cache(source_id, c):
                flags.append(r)
        else:
            flags.append("enrichment_failed")
        c["flags"] = flags
        out.append(c)
    archive_and_write_chunks(source_id, out)
    if not still_failed:
        STATE.set_status(source_id, "enriched")
    return {"source": source_id, "chunks": len(chunks), "enriched_now": len(todo) - len(still_failed),
            "cached": len(chunks) - len(todo), "failed": still_failed}


def read_flag_cache(source_id: str, chunk: dict) -> List[str]:
    h = text_hash(chunk["text"])
    flags = []
    for r in read_jsonl(source_dir(source_id) / "enrichment_cache.jsonl"):
        if r["id"] == chunk["id"] and r["hash"] == h:
            flags = r.get("flags", [])
    return flags


# ---------------------------------------------------------------- embeddings
def embed_source(source_id: str, client=None, log=print) -> dict:
    chunks = read_jsonl(source_dir(source_id) / "chunks.jsonl")
    if not chunks:
        raise FileNotFoundError(f"no chunks for {source_id}")
    missing = [c["id"] for c in chunks if not c.get("summary")]
    if missing:
        raise RuntimeError(f"{len(missing)} chunks not enriched; run enrich first")
    todo = [c for c in chunks if not (c.get("embedding") and len(c["embedding"]) == EMBED_DIMS)]
    est = estimate_source_cost(todo, stages=("embed",))
    if todo and not STATE.can_start(est):
        raise BudgetRefused(f"{source_id}: embed estimate ${est:.4f} exceeds remaining budget")
    client = client or get_client() if todo else client

    for i in range(0, len(todo), EMBED_BATCH):
        batch = todo[i:i + EMBED_BATCH]
        texts = [embed_text(c) for c in batch]
        log(f"embed {source_id}: {len(batch)} chunks")
        est_t = sum(len(t.split()) for t in texts) * 1.4 * EMBED_PRICE / 1e6

        def go():
            return client.embeddings.create(model=EMBED_MODEL, input=texts,
                                            dimensions=EMBED_DIMS, timeout=TIMEOUT_S)

        resp = _call_with_retries(source_id, "embed", go, est_t)
        STATE.add_cost(source_id, embed_cost(resp.usage), "embed")
        data = sorted(resp.data, key=lambda d: d.index)
        if len(data) != len(batch):
            raise RuntimeError("embedding count mismatch")
        for c, d in zip(batch, data):
            if len(d.embedding) != EMBED_DIMS:
                raise RuntimeError(f"embedding for {c['id']} has {len(d.embedding)} dims")
            c["embedding"] = [round(float(x), 6) for x in d.embedding]

    if todo:
        todo_ids = {c["id"]: c for c in todo}
        merged = [todo_ids.get(c["id"], c) for c in chunks]
        archive_and_write_chunks(source_id, merged)
    STATE.set_status(source_id, "embedded")
    return {"source": source_id, "embedded_now": len(todo), "total": len(chunks)}


# ---------------------------------------------------------------- CLI
def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", required=True)
    ap.add_argument("--stages", default="enrich,embed")
    ap.add_argument("--dry-run-estimate", action="store_true")
    a = ap.parse_args(argv)
    stages = [s.strip() for s in a.stages.split(",") if s.strip()]
    if a.dry_run_estimate:
        chunks = read_jsonl(source_dir(a.source) / "chunks.jsonl")
        cache = load_cache(a.source)
        todo = [c for c in chunks if (c["id"], text_hash(c["text"])) not in cache]
        est = estimate_source_cost(todo if "enrich" in stages else chunks, tuple(stages))
        print(json.dumps({"source": a.source, "chunks": len(chunks), "uncached": len(todo),
                          "estimate_usd": est,
                          "budget_remaining_usd": STATE.budget_remaining()}))
        return 0
    try:
        if "enrich" in stages:
            print(json.dumps(enrich_source(a.source)))
        if "embed" in stages:
            print(json.dumps(embed_source(a.source)))
    except BudgetRefused as exc:
        print(f"REFUSED: {exc}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
