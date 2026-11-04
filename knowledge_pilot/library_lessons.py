"""Stages 3 to 6 of the lessons pipeline: extraction, validation, dedupe, embedding.

The library unit is a LESSON: one idea from the author, grounded in specific
paragraphs, turned into something a founder can act on. Text that teaches nothing
becomes nothing (zero lessons for a window is a valid answer).

  3. extract   one structured-output call per reading window (gpt-4.1-mini or gpt-4.1)
  4. validate  deterministic and free; failures go to dropped.jsonl with the reason
  5. dedupe    embedding similarity > 0.92 inside one source, keep the more specific
  6. embed     512 dimensions, text-embedding-3-small -> lessons.jsonl

Cost is recorded per call from RETURNED usage through library_state (purpose
'lessons_extract', model name on the row) so spend is visible per source AND per
model, and the A/B outputs live in separate directories and never overwrite each other.
No database access. Keys are never printed.
"""

from __future__ import annotations

import hashlib
import json
import math
import re
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, Callable, Literal, Optional

from pydantic import BaseModel, Field

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import library_paragraphs as lp  # noqa: E402
import library_state as state  # noqa: E402
from library_text import word_count  # noqa: E402

PIPELINE_VERSION = "lessons-2026.10.a1"
PROMPT_VERSION = "lessons-prompt-2026.10.a1"
MODELS = ("gpt-4.1-mini", "gpt-4.1")
DEFAULT_MODEL = "gpt-4.1-mini"
EMBED_MODEL = "text-embedding-3-small"
EMBED_DIMS = 512
EMBED_BATCH = 100
TIMEOUT_S = 60
MAX_ATTEMPTS = 3
MAX_COMPLETION_TOKENS = 6000
DEDUPE_THRESHOLD = 0.92
MAX_QUOTE_WORDS = 15
PILLARS = ["how_companies_win", "human_mind", "money_game", "move_people", "think_sharper", "whats_coming"]
LESSON_TYPES = ["principle", "framework", "story", "data"]

# Estimation constants (the dry run uses the real paragraph/window counts and these ratios).
EST_PROMPT_TOKENS = 1900             # system prompt + per-window header
EST_TOKENS_PER_WORD = 1.35
EST_LESSONS_PER_1000_WORDS = 2.5
EST_TOKENS_PER_LESSON = 330
EST_EMBED_TOKENS_PER_LESSON = 230
EST_RETRY_MARGIN = 1.15


# ----------------------------------------------------------------------------
# Output schema (structured output)
# ----------------------------------------------------------------------------

class LessonOut(BaseModel):
    paragraph_ids: list[str] = Field(description="Ids of the paragraphs (from 'PARAGRAPHS YOU MAY CITE' only) that ground this lesson.")
    title: str = Field(description="5 to 10 words naming the lesson.")
    author_argues: str = Field(description="2 to 3 sentences. What the author argues, attributed by name.")
    founder_action: str = Field(description="1 to 2 sentences. A specific thing a founder can do, grounded in the text.")
    applies_when: str = Field(description="The founder situation in which this applies.")
    caveat: Optional[str] = Field(description="A limit the author states or clearly implies. null if none. Never invented.")
    evidence: Optional[str] = Field(description="One sentence: the example, number or story the author uses. null if none.")
    short_quote: Optional[str] = Field(description="An exact quote of 15 words or fewer copied from the cited paragraphs. null if none.")
    example_questions: list[str] = Field(description="Exactly 3 questions a founder might type, in a founder's own words.")
    lesson_type: Literal["principle", "framework", "story", "data"]
    pillars: list[Literal["how_companies_win", "human_mind", "money_game", "move_people", "think_sharper", "whats_coming"]] = Field(
        description="Pillars the lesson clearly belongs to. Empty list if not clearly supported.")


class WindowOut(BaseModel):
    lessons: list[LessonOut] = Field(description="Every lesson a founder could genuinely use. An empty list is a valid answer.")


REQUIRED_TEXT_FIELDS = ("title", "author_argues", "founder_action", "applies_when")


# ----------------------------------------------------------------------------
# Prompt
# ----------------------------------------------------------------------------

SYSTEM_PROMPT = """You turn a reading window from a book (or transcript) into LESSONS for startup founders.

A lesson is ONE idea from the author, grounded in specific paragraphs, turned into something a founder can act on. You are not summarising. Text that teaches a founder nothing becomes nothing. Returning zero lessons for a window is a correct and common answer.

QUALITY RULES
1. SPECIFIC. A founder must be able to tell what to do. Bad founder_action: "Take action on new ideas." Good founder_action: "When you find a promising method, run it once at small scale within days, before anyone talks you out of it, then judge it on the result."
2. ACTIONABLE. founder_action names a concrete move a founder can start this week. Not "think about", "be aware of" or "consider".
3. GROUNDED. Use only what is in the cited paragraphs. No claim, number, name or example may appear in your lesson unless it is in those paragraphs. Do not add your own advice, general business knowledge or other books. If the text only implies a limit, a caveat may state it; otherwise caveat is null.
4. NO LESSON from scene setting, introductions, transitions, acknowledgements, scene-by-scene anecdote with no transferable point, or dialogue that only moves a story along. A story is a lesson only when the author draws a point a founder can use; then lesson_type is "story" and the point is the lesson.
5. ONE LESSON per idea. If two passages in the window teach the same idea, write one lesson and cite both. Do not write near-duplicates. Do not split one idea into fragments.
6. ATTRIBUTE by name. author_argues names the author exactly as given in AUTHOR (never "the author", never "he/she" alone in the first sentence). If AUTHOR is unknown, name the speaker as written in the text. Never invent a name.
7. CITE precisely. paragraph_ids lists only paragraphs from "PARAGRAPHS YOU MAY CITE", the smallest set that grounds the lesson. Paragraphs under "CONTEXT ONLY" are there so you understand the passage; never cite them and never build a lesson only from them.
8. short_quote is copied exactly (same words, same punctuation) from one cited paragraph, 15 words or fewer, or null. Do not paraphrase inside it.
9. example_questions: exactly 3, each a different phrasing of a real situation a founder might be in, written in the founder's own voice ("My cofounder keeps ..."), with no mention of the book or author.
10. Numbers: any figure in author_argues, founder_action or evidence must appear in the cited paragraphs.
11. Voice: direct, plain words, no filler, no hype. Never write "great", "absolutely", "certainly".

FIELDS
- paragraph_ids, title (5 to 10 words), author_argues (2 to 3 sentences), founder_action (1 to 2 sentences), applies_when (one sentence naming the founder situation), caveat (or null), evidence (one sentence, or null), short_quote (or null), example_questions (3), lesson_type, pillars.
- lesson_type: "principle" = a claim or rule; "framework" = a named model, steps or categories; "story" = a story whose point is the lesson; "data" = a finding, number or study.
- pillars (only when clearly supported, else an empty list): how_companies_win = strategy and competitive advantage; human_mind = psychology and behaviour; money_game = economics, capital, pricing, financial literacy; move_people = influence, persuasion, negotiation, leadership; think_sharper = mental models, decision making, reasoning; whats_coming = emerging technology, geopolitics, futures.

Return JSON matching the schema. Do not explain."""


def render_window(window: dict, book: str | None, author: str | None) -> str:
    lines = [f"BOOK: {book or 'unknown'}",
             f"AUTHOR: {author or 'unknown (name the speaker as written in the text)'}",
             f"CHAPTER: {window.get('chapter') or 'unknown'}"]
    if window.get("sections"):
        lines.append("SECTIONS IN THIS WINDOW: " + "; ".join(window["sections"]))
    if window.get("context"):
        lines += ["", "CONTEXT ONLY (end of the previous window; never cite these ids)"]
        lines += [f"[{p['id']}] {p['text']}" for p in window["context"]]
    lines += ["", "PARAGRAPHS YOU MAY CITE"]
    lines += [f"[{p['id']}] {p['text']}" for p in window["paragraphs"]]
    return "\n".join(lines)


# ----------------------------------------------------------------------------
# Source metadata
# ----------------------------------------------------------------------------

def source_meta(source_id: str, library_dir: Path | None = None, manifest: dict | None = None) -> dict:
    """book title from the manifest; author from PDF metadata (cleaned), as saved in the paragraph report."""
    entry = lp.manifest_entry(source_id, manifest)
    rep_path = lp.source_dir(source_id, library_dir) / "paragraphs_v2_report.json"
    author = None
    if rep_path.exists():
        rep = json.loads(rep_path.read_text(encoding="utf-8"))
        author = rep.get("author") or lp.clean_author(rep.get("meta_author"))
    return {"book": entry.get("title"), "author": lp.clean_author(author), "pillar": entry.get("pillar")}


def lessons_dir(source_id: str, model: str, suffix: str | None = None, library_dir: Path | None = None) -> Path:
    """library/<source_id>/lessons_<suffix or model>/ -- A/B runs never share a directory."""
    label = re.sub(r"[^\w.\-]+", "_", suffix or model)
    return lp.source_dir(source_id, library_dir) / f"lessons_{label}"


# ----------------------------------------------------------------------------
# Cost and the OpenAI call
# ----------------------------------------------------------------------------

def usage_numbers(usage: Any) -> dict:
    pt = getattr(usage, "prompt_tokens", 0) or 0
    ct = getattr(usage, "completion_tokens", 0) or 0
    details = getattr(usage, "prompt_tokens_details", None)
    cached = (getattr(details, "cached_tokens", 0) or 0) if details else 0
    return {"prompt_tokens": pt, "completion_tokens": ct, "cached_tokens": cached}


def get_client():  # pragma: no cover - never used by tests
    import os
    from dotenv import dotenv_values
    from openai import OpenAI
    key = dotenv_values(lp.ROOT / ".env").get("OPENAI_API_KEY") or os.environ.get("OPENAI_API_KEY")
    if not key:
        raise RuntimeError("No OpenAI key configured")
    return OpenAI(api_key=key, max_retries=0, timeout=TIMEOUT_S)


def _is_timeout(exc: Exception) -> bool:
    return "timeout" in type(exc).__name__.lower() or isinstance(exc, TimeoutError)


def estimate_window_cost(model: str, window_words: int, context_words: int = 0) -> float:
    in_tok = EST_PROMPT_TOKENS + (window_words + context_words) * EST_TOKENS_PER_WORD
    out_tok = max(1, window_words / 1000 * EST_LESSONS_PER_1000_WORDS) * EST_TOKENS_PER_LESSON + 60
    return state.cost_from_usage(model, int(in_tok), int(out_tok))


class Extractor:
    """Runs window extraction for one source and one model. All spend goes through library_state."""

    def __init__(self, source_id: str, model: str, client: Any, out_dir: Path, state_path: Path | str | None = None,
                 book: str | None = None, author: str | None = None, sleep: Callable[[float], None] | None = None,
                 workers: int = 1):
        if model not in MODELS:
            raise ValueError(f"model must be one of {MODELS}")
        self.source_id, self.model, self.client = source_id, model, client
        self.out_dir, self.state_path = Path(out_dir), state_path
        self.book, self.author = book, author
        self.sleep = sleep or time.sleep
        self.workers = max(1, workers)
        self.cache_path = self.out_dir / "window_cache.jsonl"
        self._lock = threading.Lock()
        self.cache = self._load_cache()
        self.stats = {"windows": 0, "cached": 0, "called": 0, "failed": 0, "refused_budget": 0, "cost_usd": 0.0}

    # -- cache -------------------------------------------------------------
    def cache_key(self, window: dict) -> str:
        return hashlib.sha256(f"{self.model}|{PROMPT_VERSION}|{window['hash']}".encode()).hexdigest()

    def _load_cache(self) -> dict[str, dict]:
        return {r["key"]: r for r in lp.read_jsonl(self.cache_path)}

    def _save_cache_row(self, row: dict) -> None:
        with self._lock:
            self.out_dir.mkdir(parents=True, exist_ok=True)
            with self.cache_path.open("a", encoding="utf-8") as fh:
                fh.write(json.dumps(row, ensure_ascii=False) + "\n")
            self.cache[row["key"]] = row

    # -- one window --------------------------------------------------------
    def call_window(self, window: dict) -> list[dict]:
        user = render_window(window, self.book, self.author)
        est = estimate_window_cost(self.model, window["word_count"],
                                   sum(word_count(p["text"]) for p in window.get("context", [])))
        state.refuse_to_start(est, self.state_path)       # raises BudgetExhausted before any spend
        last: Exception | None = None
        for attempt in range(MAX_ATTEMPTS):
            try:
                resp = self.client.beta.chat.completions.parse(
                    model=self.model, temperature=0,
                    messages=[{"role": "system", "content": SYSTEM_PROMPT}, {"role": "user", "content": user}],
                    response_format=WindowOut, max_completion_tokens=MAX_COMPLETION_TOKENS, timeout=TIMEOUT_S)
                nums = usage_numbers(resp.usage)
                usd = state.cost_from_usage(self.model, **nums)
                state.add_cost(self.source_id, usd, "lessons_extract", self.state_path, model=self.model, usage=nums)
                with self._lock:
                    self.stats["cost_usd"] += usd
                parsed = resp.choices[0].message.parsed
                if parsed is None:
                    raise ValueError("model returned no parsable output (refusal or truncation)")
                lessons = [l.model_dump() for l in parsed.lessons]
                self._save_cache_row({"key": self.cache_key(window), "window_id": window["window_id"],
                                      "model": self.model, "prompt_version": PROMPT_VERSION,
                                      "window_hash": window["hash"], "usage": nums, "cost_usd": round(usd, 8),
                                      "lessons": lessons})
                return lessons
            except state.BudgetExhausted:
                raise
            except Exception as exc:  # noqa: BLE001
                last = exc
                if _is_timeout(exc):
                    # The bill for a timed-out call is unknown: record a conservative estimate.
                    state.add_cost(self.source_id, est, "lessons_extract_timeout_uncertain", self.state_path,
                                   model=self.model)
                if attempt < MAX_ATTEMPTS - 1:
                    self.sleep(2 ** attempt * 2)
        raise RuntimeError(f"window {window['window_id']} failed after {MAX_ATTEMPTS} attempts: "
                           f"{type(last).__name__}") from last

    def run(self, windows: list[dict], limit: int | None = None) -> list[dict]:
        """Extract every window not already in the cache. Returns rows {window_id, lessons} in window order."""
        todo = windows[:limit] if limit else windows
        self.stats["windows"] = len(todo)
        results: dict[str, list[dict]] = {}
        pending = []
        for w in todo:
            hit = self.cache.get(self.cache_key(w))
            if hit is not None:
                results[w["window_id"]] = hit["lessons"]
                self.stats["cached"] += 1
            else:
                pending.append(w)
        budget_stop = False

        def work(w: dict):
            nonlocal budget_stop
            if budget_stop:
                return w, None
            try:
                return w, self.call_window(w)
            except state.BudgetExhausted:
                budget_stop = True
                with self._lock:
                    self.stats["refused_budget"] += 1
                return w, None
            except RuntimeError:
                with self._lock:
                    self.stats["failed"] += 1
                return w, None

        if self.workers > 1 and len(pending) > 1:
            with ThreadPoolExecutor(self.workers) as pool:
                outcomes = list(pool.map(work, pending))
        else:
            outcomes = [work(w) for w in pending]
        for w, lessons in outcomes:
            if lessons is not None:
                results[w["window_id"]] = lessons
                self.stats["called"] += 1
        return [{"window_id": w["window_id"], "lessons": results[w["window_id"]]} for w in todo if w["window_id"] in results]


# ----------------------------------------------------------------------------
# Stage 4: deterministic validation
# ----------------------------------------------------------------------------

_QUOTE_MAP = str.maketrans({"“": '"', "”": '"', "„": '"', "‟": '"', "‘": "'", "’": "'", "‚": "'", "‛": "'",
                            "′": "'", "″": '"', "–": "-", "—": "-", "‐": "-", "‑": "-", "\xad": "", "\xa0": " "})
NUMBER_RE = re.compile(r"(?<![\w.])\d[\d,]*(?:\.\d+)?")
NUMBER_WORDS = {"one": "1", "two": "2", "three": "3", "four": "4", "five": "5", "six": "6", "seven": "7",
                "eight": "8", "nine": "9", "ten": "10", "eleven": "11", "twelve": "12", "thirteen": "13",
                "fourteen": "14", "fifteen": "15", "sixteen": "16", "seventeen": "17", "eighteen": "18",
                "nineteen": "19", "twenty": "20", "thirty": "30", "forty": "40", "fifty": "50", "sixty": "60",
                "seventy": "70", "eighty": "80", "ninety": "90", "hundred": "100", "thousand": "1000"}


def normalize_text(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").translate(_QUOTE_MAP)).strip()


def numbers_in(text: str) -> set[str]:
    out = set()
    for m in NUMBER_RE.findall(text or ""):
        n = m.replace(",", "").rstrip(".")
        n = n.rstrip("0").rstrip(".") if "." in n else n
        out.add(n)
    return out


def grounded_numbers(evidence: str) -> set[str]:
    """Numbers present in the cited text: digits, plus number words (so '3' is grounded by 'three')."""
    nums = numbers_in(evidence)
    for w in re.findall(r"[A-Za-z]+", evidence.lower()):
        if w in NUMBER_WORDS:
            nums.add(NUMBER_WORDS[w])
    return nums


def author_named(author: str | None, text: str) -> bool:
    if not author:
        return True
    low = text.lower()
    names = [n for n in re.split(r"\s+and\s+|,\s*", author) if n.strip()]
    return any(n.lower() in low or n.split()[-1].lower() in low for n in names)


def validate_lesson(lesson: dict, window: dict, author: str | None = None) -> list[str]:
    """Reasons this lesson must be dropped. Empty list = valid."""
    reasons: list[str] = []
    allowed = {p["id"]: p for p in window["paragraphs"] if not p.get("context_only")}
    context_ids = {p["id"] for p in window.get("context", [])} | {p["id"] for p in window["paragraphs"] if p.get("context_only")}
    ids = lesson.get("paragraph_ids") or []
    if not ids:
        reasons.append("missing_field:paragraph_ids")
    for pid in ids:
        if pid in context_ids and pid not in allowed:
            reasons.append(f"cites_context_only:{pid}")
        elif pid not in allowed:
            reasons.append(f"unknown_paragraph_id:{pid}")
    for f in REQUIRED_TEXT_FIELDS:
        if not str(lesson.get(f) or "").strip():
            reasons.append(f"missing_field:{f}")
    if lesson.get("lesson_type") not in LESSON_TYPES:
        reasons.append("bad_lesson_type")
    if any(p not in PILLARS for p in (lesson.get("pillars") or [])):
        reasons.append("bad_pillar")
    qs = lesson.get("example_questions")
    if not isinstance(qs, list) or len(qs) != 3 or any(not str(q or "").strip() for q in qs):
        reasons.append("example_questions_not_3")
    if reasons:
        return reasons                   # nothing else is meaningful without valid citations
    evidence = "\n".join(allowed[pid]["text"] for pid in ids)
    ev_norm = normalize_text(evidence)
    quote = lesson.get("short_quote")
    if quote is not None and str(quote).strip():
        q = normalize_text(quote)
        if word_count(q) > MAX_QUOTE_WORDS:
            reasons.append("short_quote_too_long")
        if q not in ev_norm:
            reasons.append("short_quote_not_exact")
    known = grounded_numbers(evidence)
    for field in ("founder_action", "author_argues", "evidence"):
        bad = sorted(n for n in numbers_in(lesson.get(field) or "") if n not in known)
        if bad:
            reasons.append(f"number_not_in_paragraphs:{field}:{','.join(bad)}")
    if not author_named(author, lesson["author_argues"]):
        reasons.append("author_not_named")
    return reasons


def validate_all(extracted: list[dict], windows: list[dict], author: str | None
                 ) -> tuple[list[dict], list[dict]]:
    """extracted: [{window_id, lessons}]. Returns (valid candidates, dropped rows)."""
    by_id = {w["window_id"]: w for w in windows}
    valid, dropped = [], []
    for row in extracted:
        w = by_id[row["window_id"]]
        for l in row["lessons"]:
            reasons = validate_lesson(l, w, author)
            if reasons:
                dropped.append({"window_id": w["window_id"], "reasons": reasons, "lesson": l})
            else:
                valid.append({"window_id": w["window_id"], "lesson": l})
    return valid, dropped


# ----------------------------------------------------------------------------
# Embedding text, embedding calls
# ----------------------------------------------------------------------------

def embedding_text(lesson: dict) -> str:
    parts = [lesson["title"], lesson["author_argues"], lesson["founder_action"], lesson["applies_when"]]
    parts += list(lesson.get("example_questions") or [])
    return "\n".join(p.strip() for p in parts if p and p.strip())


class Embedder:
    """text-embedding-3-small at 512 dims, cached by text hash, cost recorded from returned usage."""

    def __init__(self, source_id: str, client: Any, cache_path: Path, state_path: Path | str | None = None,
                 sleep: Callable[[float], None] | None = None):
        self.source_id, self.client, self.cache_path, self.state_path = source_id, client, Path(cache_path), state_path
        self.sleep = sleep or time.sleep
        self.cache = {r["hash"]: r["embedding"] for r in lp.read_jsonl(self.cache_path)}
        self.calls = 0

    @staticmethod
    def text_hash(text: str) -> str:
        return hashlib.sha256(text.encode()).hexdigest()[:20]

    def embed(self, texts: list[str]) -> list[list[float]]:
        missing = list(dict.fromkeys(t for t in texts if self.text_hash(t) not in self.cache))
        for i in range(0, len(missing), EMBED_BATCH):
            batch = missing[i:i + EMBED_BATCH]
            est = sum(word_count(t) for t in batch) * 1.4 * state.PRICING[EMBED_MODEL]["input"] / 1e6
            state.refuse_to_start(est, self.state_path)
            last = None
            for attempt in range(MAX_ATTEMPTS):
                try:
                    resp = self.client.embeddings.create(model=EMBED_MODEL, input=batch, dimensions=EMBED_DIMS,
                                                         timeout=TIMEOUT_S)
                    break
                except Exception as exc:  # noqa: BLE001
                    last = exc
                    if attempt == MAX_ATTEMPTS - 1:
                        raise RuntimeError(f"embedding failed: {type(last).__name__}") from last
                    self.sleep(2 ** attempt * 2)
            tokens = getattr(resp.usage, "total_tokens", None) or getattr(resp.usage, "prompt_tokens", 0) or 0
            state.add_cost(self.source_id, state.cost_from_usage(EMBED_MODEL, prompt_tokens=tokens),
                           "lessons_embed", self.state_path, model=EMBED_MODEL, usage={"prompt_tokens": tokens})
            data = sorted(resp.data, key=lambda d: d.index)
            if len(data) != len(batch):
                raise RuntimeError("embedding count mismatch")
            self.calls += 1
            with self.cache_path.open("a", encoding="utf-8") as fh:
                for t, d in zip(batch, data):
                    if len(d.embedding) != EMBED_DIMS:
                        raise RuntimeError(f"embedding has {len(d.embedding)} dims, expected {EMBED_DIMS}")
                    emb = [round(float(x), 6) for x in d.embedding]
                    self.cache[self.text_hash(t)] = emb
                    fh.write(json.dumps({"hash": self.text_hash(t), "embedding": emb}) + "\n")
        return [self.cache[self.text_hash(t)] for t in texts]


def cosine(a: list[float], b: list[float]) -> float:
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(x * x for x in b))
    return sum(x * y for x, y in zip(a, b)) / (na * nb) if na and nb else 0.0


# ----------------------------------------------------------------------------
# Stage 5: dedupe
# ----------------------------------------------------------------------------

def concrete_tokens(text: str) -> int:
    """Concrete tokens: numbers, units/currency, quoted strings, and proper nouns that are not sentence-initial."""
    n = len(re.findall(r"\d[\d,.]*%?|\$", text))
    n += len(re.findall(r"[\"“][^\"”]+[\"”]", text))
    words = text.split()
    for i, w in enumerate(words):
        if i and re.match(r"[A-Z][a-z]{2,}", w) and not re.search(r"[.!?]$", words[i - 1]):
            n += 1
    return n


def specificity(lesson: dict) -> tuple[int, int]:
    """The specificity rule: more concrete tokens in founder_action first, then a longer founder_action,
    then more concrete tokens in applies_when. (Documented in DEDUPE_RULE.)"""
    fa = lesson.get("founder_action") or ""
    return (concrete_tokens(fa) * 3 + word_count(fa), concrete_tokens(lesson.get("applies_when") or ""))


DEDUPE_RULE = ("Within one source, lessons whose embeddings have cosine similarity > 0.92 are merged. The kept "
               "lesson is the more specific one: score = 3 x concrete tokens in founder_action + words in "
               "founder_action (concrete = numbers, currency, quoted strings, non-initial proper nouns); ties go "
               "to the lesson with more concrete tokens in applies_when, then to the earlier one. "
               "paragraph_ids of both lessons are unioned. The merge is logged to merges.jsonl.")


def dedupe(cands: list[dict], embeddings: list[list[float]], threshold: float = DEDUPE_THRESHOLD
           ) -> tuple[list[dict], list[dict]]:
    """cands: [{window_id, lesson}] in document order. Greedy by specificity so a chain collapses onto its best member."""
    order = sorted(range(len(cands)), key=lambda i: (tuple(-x for x in specificity(cands[i]["lesson"])), i))
    kept: list[int] = []
    merged_ids: dict[int, set[str]] = {}
    merges: list[dict] = []
    for i in order:
        target = None
        best = threshold
        for k in kept:
            s = cosine(embeddings[i], embeddings[k])
            if s > best:
                best, target = s, k
        if target is None:
            kept.append(i)
            merged_ids[i] = set(cands[i]["lesson"]["paragraph_ids"])
        else:
            merged_ids[target] |= set(cands[i]["lesson"]["paragraph_ids"])
            merges.append({"kept_title": cands[target]["lesson"]["title"], "dropped_title": cands[i]["lesson"]["title"],
                           "similarity": round(best, 4), "kept_window": cands[target]["window_id"],
                           "dropped_window": cands[i]["window_id"],
                           "kept_founder_action": cands[target]["lesson"]["founder_action"],
                           "dropped_founder_action": cands[i]["lesson"]["founder_action"],
                           "_kept_idx": target})
    out = []
    for k in sorted(kept):
        c = {"window_id": cands[k]["window_id"], "lesson": dict(cands[k]["lesson"]), "embedding": embeddings[k]}
        c["lesson"]["paragraph_ids"] = sorted(merged_ids[k])
        c["merged_from"] = sum(1 for m in merges if m["_kept_idx"] == k)
        out.append(c)
    for m in merges:
        m.pop("_kept_idx")
    return out, merges


# ----------------------------------------------------------------------------
# Stage 6: final rows
# ----------------------------------------------------------------------------

def build_rows(source_id: str, kept: list[dict], paragraphs: list[dict], model: str, meta: dict) -> list[dict]:
    pmap = {p["id"]: p for p in paragraphs}
    rows = []
    for i, c in enumerate(kept):
        l = c["lesson"]
        ids = sorted(l["paragraph_ids"], key=lambda pid: pmap[pid]["index"])
        cited = [pmap[pid] for pid in ids]
        pages = [p["page_start"] for p in cited if p.get("page_start")] + [p["page_end"] for p in cited if p.get("page_end")]
        rows.append({
            "id": f"{source_id}_L{i:04d}", "source_id": source_id, "book": meta.get("book"), "author": meta.get("author"),
            "chapter": cited[0]["chapter"], "page_start": min(pages) if pages else None,
            "page_end": max(pages) if pages else None, "paragraph_ids": ids,
            "evidence_text": "\n\n".join(p["text"] for p in cited),
            "title": l["title"], "author_argues": l["author_argues"], "founder_action": l["founder_action"],
            "applies_when": l["applies_when"], "caveat": l.get("caveat"), "evidence": l.get("evidence"),
            "short_quote": l.get("short_quote"), "example_questions": l["example_questions"],
            "lesson_type": l["lesson_type"], "pillars": l.get("pillars") or [],
            "window_id": c["window_id"], "embedding": [round(float(x), 6) for x in c["embedding"]],
            "model": model, "pipeline_version": PIPELINE_VERSION,
        })
    return rows


# ----------------------------------------------------------------------------
# Estimates (dry run, no API)
# ----------------------------------------------------------------------------

def estimate_source(source_id: str, model: str, library_dir: Path | None = None) -> dict:
    """Projected cost from the REAL paragraph and window counts. No API call."""
    out_dir = lp.source_dir(source_id, library_dir)
    paras = lp.read_jsonl(out_dir / "paragraphs_v2.jsonl")
    basis = "paragraphs_v2"
    if not paras:
        old = lp.read_jsonl(out_dir / "paragraphs.jsonl")
        if not old:
            return {"source_id": source_id, "model": model, "basis": "none", "windows": 0, "paragraphs": 0,
                    "words": 0, "est_usd": None, "note": "no paragraphs yet: run the paragraphs stage first"}
        basis = "paragraphs_v1_fallback"
        paras = [{"id": f"{source_id}_p{i:04d}", "source_id": source_id, "index": i, "text": p["text"],
                  "chapter": p.get("chapter") or "Body", "section": p.get("section"), "kind": p.get("kind", "body"),
                  "word_count": word_count(p["text"]), "page_start": p.get("page_start"), "page_end": p.get("page_end")}
                 for i, p in enumerate(old)]
    windows = lp.build_windows(paras)
    total = 0.0
    in_tok = out_tok = 0
    for w in windows:
        cw = sum(word_count(p["text"]) for p in w["context"])
        total += estimate_window_cost(model, w["word_count"], cw)
        in_tok += int(EST_PROMPT_TOKENS + (w["word_count"] + cw) * EST_TOKENS_PER_WORD)
        out_tok += int(max(1, w["word_count"] / 1000 * EST_LESSONS_PER_1000_WORDS) * EST_TOKENS_PER_LESSON + 60)
    words = sum(w["word_count"] for w in windows)
    lessons = words / 1000 * EST_LESSONS_PER_1000_WORDS
    embed = lessons * EST_EMBED_TOKENS_PER_LESSON * state.PRICING[EMBED_MODEL]["input"] / 1e6
    return {"source_id": source_id, "model": model, "basis": basis, "paragraphs": len(paras), "windows": len(windows),
            "words": words, "est_input_tokens": in_tok, "est_output_tokens": out_tok,
            "est_lessons": round(lessons), "est_extract_usd": round(total * EST_RETRY_MARGIN, 4),
            "est_embed_usd": round(embed, 5), "est_usd": round((total + embed) * EST_RETRY_MARGIN, 4)}


def estimate_library(model: str, library_dir: Path | None = None, manifest: dict | None = None,
                     source_ids: list[str] | None = None) -> dict:
    manifest = manifest or lp.load_manifest()
    rows = []
    for e in manifest["sources"]:
        if source_ids and e["source_id"] not in source_ids:
            continue
        if e.get("status_hint") in ("excluded", "duplicate"):
            continue
        rows.append(estimate_source(e["source_id"], model, library_dir))
    known = [r for r in rows if r["est_usd"] is not None]
    return {"model": model, "sources_estimated": len(known), "sources_without_paragraphs": len(rows) - len(known),
            "windows": sum(r["windows"] for r in known), "est_usd": round(sum(r["est_usd"] for r in known), 4),
            "per_source": rows}
