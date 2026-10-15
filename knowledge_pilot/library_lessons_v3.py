"""Lesson extractor v3 (PROMPT_VERSION 'lessons-v3.0'), used on the golden windows first.

Differences from library_lessons.py (v2, untouched): one idea per lesson grounded in 1-3 paragraphs, a
`principle` (one-sentence mechanism) instead of founder_action, evidence and caveat are VERBATIM sentences
(or null), attribution to the actual speaker, and explicit bad examples. The prompt is static instructions
plus 3 good and 3 bad examples (read from golden/examples.json), and the source window text comes LAST.

All spend goes through library_state (cost from returned usage only), capped at CAP_USD. No database.
Keys are never printed. The CLI runs on golden windows only.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import time
from pathlib import Path
from typing import Any, Callable, Literal, Optional

from pydantic import BaseModel, Field

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import library_lessons as v2  # noqa: E402  (shared helpers only)
import library_state as state  # noqa: E402

PROMPT_VERSION = "lessons-v3.0"
MODELS = ("gpt-4.1-mini", "gpt-4.1")
DEFAULT_MODEL = "gpt-4.1-mini"
CAP_USD = 6.90
GOLDEN = HERE / "golden"
EXAMPLES_PATH = GOLDEN / "examples.json"
WINDOWS_PATH = GOLDEN / "windows.json"
CACHE_PATH = HERE / "lesson_cache.jsonl"
LIB = HERE / "library"
MAX_QUOTE_WORDS = 15
MAX_ATTEMPTS = 3
TIMEOUT_S = 90
MAX_COMPLETION_TOKENS = 5000
DEDUPE_THRESHOLD = 0.92
LESSON_TYPES = ("principle", "framework", "story", "data")
PILLARS = tuple(v2.PILLARS)
AUTHOR_FALLBACK = {"human-mind-books-thinking-fast-and-slow": "Daniel Kahneman"}

# Estimation constants for the dry run.
EST_LESSONS_PER_WINDOW = 3
EST_TOKENS_PER_LESSON = 380
EST_TOKENS_PER_WORD = 1.35


# ----------------------------------------------------------------------------
# Structured output schema (strict)
# ----------------------------------------------------------------------------

class LessonV3(BaseModel):
    paragraph_ids: list[str]
    title: str
    author_argues: str
    principle: str
    evidence: Optional[str]
    caveat: Optional[str]
    short_quote: Optional[str]
    applies_when: str
    example_questions: list[str]
    lesson_type: Literal["principle", "framework", "story", "data"]
    pillars: list[Literal["how_companies_win", "human_mind", "money_game", "move_people", "think_sharper", "whats_coming"]]


class WindowOutV3(BaseModel):
    lessons: list[LessonV3]


# ----------------------------------------------------------------------------
# Prompt
# ----------------------------------------------------------------------------

INSTRUCTIONS = """You turn one reading window from a book, paper or transcript into LESSONS for startup founders.

A lesson is ONE idea the author or speaker teaches, grounded in 1 to 3 specific paragraphs, with a mechanism a founder can reason with. Zero lessons is a valid and common answer. Return {"lessons": []} when the window teaches nothing a founder could use.

NOT lessons (never write one from these):
- slogans or sayings with no mechanism ("work smarter, not harder")
- signposts and previews ("in this chapter we will see...")
- transitions and summaries of what was just said
- scene setting and character introductions
- repeats of an idea already covered by another lesson in this window (write one lesson, cite the best paragraphs)

Rules for each field:
- paragraph_ids: 1 to 3 ids copied from "PARAGRAPHS YOU MAY CITE". Never cite a CONTEXT ONLY id. One idea per lesson, so cite only the paragraphs that carry it.
- title: 5 to 10 words naming the idea.
- author_argues: 2 to 3 sentences. Attribute to the ACTUAL speaker by name, in the voice of the text: if a character speaks, say so ("Kiyosaki recounts rich dad saying..."); in a transcript name the guest or host who said it. Do not put one person's words in another's mouth. Every number you write must appear in the cited paragraphs.
- principle: ONE sentence stating the mechanism (what causes what, or what to do and why). It must not be a slogan. Every number must appear in the cited paragraphs.
- evidence: one sentence copied VERBATIM from the cited paragraphs (the example, number or story), or null.
- caveat: one sentence copied VERBATIM from the cited paragraphs that limits the idea, or null. Never infer or invent a caveat.
- short_quote: an exact quote of 15 words or fewer copied from the cited paragraphs, or null.
- applies_when: the founder situation in which this applies, in one sentence.
- example_questions: exactly 3 questions a founder might type, in a founder's own words and specific to this idea.
- lesson_type: principle, framework (named steps or parts), story (the point is carried by an episode), or data (a finding or number).
- pillars: only pillars the lesson clearly belongs to (how_companies_win, human_mind, money_game, move_people, think_sharper, whats_coming); an empty list if unsure.

The window to read comes last, after the examples."""


def load_examples(path: Path = EXAMPLES_PATH) -> dict:
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    if len(data.get("good", [])) != 3 or len(data.get("bad", [])) != 3:
        raise ValueError(f"{path} must hold exactly 3 good and 3 bad examples")
    return data


def examples_block(examples: dict) -> str:
    lines = ["EXAMPLES"]
    if examples.get("_placeholder"):
        lines.append("(Placeholder examples: they show the format only.)")
    lines.append("")
    for i, ex in enumerate(examples["good"], 1):
        lines += [f"GOOD EXAMPLE {i}", json.dumps(ex["lesson"], ensure_ascii=False, indent=1),
                  f"Why it is good: {ex.get('why', '')}", ""]
    for i, ex in enumerate(examples["bad"], 1):
        lines += [f"BAD EXAMPLE {i} (do not write this)", json.dumps(ex["lesson"], ensure_ascii=False, indent=1),
                  f"Why it is bad: {ex.get('why', '')}", ""]
    return "\n".join(lines).rstrip()


def system_prompt(examples: dict) -> str:
    return INSTRUCTIONS + "\n\n" + examples_block(examples)


def render_user(window: dict, book: str | None, author: str | None) -> str:
    """Source window text: always the LAST thing in the prompt."""
    return v2.render_window(window, book, author)


def prompt_hash(system: str, user: str) -> str:
    return hashlib.sha256((system + "\x00" + user).encode()).hexdigest()


def cache_key(model: str, system: str, user: str) -> str:
    return hashlib.sha256(f"{PROMPT_VERSION}|{model}|{prompt_hash(system, user)}".encode()).hexdigest()


# ----------------------------------------------------------------------------
# Golden windows -> window dicts
# ----------------------------------------------------------------------------

def load_windows(windows_path: Path = WINDOWS_PATH, library_dir: Path = LIB) -> list[dict]:
    doc = json.loads(Path(windows_path).read_text(encoding="utf-8"))
    cache: dict[str, dict[str, dict]] = {}
    out = []
    for w in doc["windows"]:
        sid = w["source_id"]
        if sid not in cache:
            rows = [json.loads(l) for l in (library_dir / sid / "paragraphs_v3.2.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()]
            cache[sid] = {p["id"]: p for p in rows}
        pm = cache[sid]
        out.append({"window_id": w["window_id"], "source_id": sid, "chapter": w["chapter"],
                    "sections": w.get("sections") or [], "word_count": w["word_count"],
                    "paragraphs": [pm[i] for i in w["paragraph_ids"]],
                    "context": [pm[i] for i in w.get("context_ids", [])]})
    return out


def source_info(source_id: str, library_dir: Path = LIB) -> tuple[str | None, str | None]:
    p = library_dir / source_id / "extraction_notes_v3.2.json"
    notes = json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}
    author = AUTHOR_FALLBACK.get(source_id) or notes.get("main_author")
    return notes.get("title"), author


# ----------------------------------------------------------------------------
# Validation (deterministic, free)
# ----------------------------------------------------------------------------

REQUIRED = ("title", "author_argues", "principle", "applies_when")


def in_text(snippet: str, texts: list[str]) -> bool:
    s = v2.normalize_text(snippet)
    return bool(s) and any(s in v2.normalize_text(t) for t in texts)


def validate_lesson(lesson: dict, window: dict) -> tuple[dict | None, list[str], list[str]]:
    """Returns (cleaned lesson or None when dropped, drop reasons, notes about fields set to null)."""
    reasons: list[str] = []
    nulled: list[str] = []
    allowed = {p["id"]: p for p in window["paragraphs"]}
    ids = list(lesson.get("paragraph_ids") or [])
    if not 1 <= len(ids) <= 3:
        reasons.append(f"paragraph_ids_count:{len(ids)}")
    if len(set(ids)) != len(ids):
        reasons.append("duplicate_paragraph_ids")
    for pid in ids:
        if pid not in allowed:
            reasons.append(f"unknown_paragraph_id:{pid}")
    for f in REQUIRED:
        if not str(lesson.get(f) or "").strip():
            reasons.append(f"missing_field:{f}")
    qs = lesson.get("example_questions") or []
    if len(qs) != 3 or any(not str(q).strip() for q in qs):
        reasons.append("example_questions_not_3")
    if lesson.get("lesson_type") not in LESSON_TYPES:
        reasons.append("bad_lesson_type")
    if reasons:
        return None, reasons, nulled
    texts = [allowed[i]["text"] for i in ids]
    grounded = v2.grounded_numbers(" ".join(texts))
    for f in ("author_argues", "principle"):
        bad = sorted(v2.numbers_in(lesson[f]) - grounded)
        if bad:
            reasons.append(f"number_not_in_paragraphs:{f}:{','.join(bad)}")
    if reasons:
        return None, reasons, nulled
    clean = dict(lesson)
    for f in ("evidence", "caveat", "short_quote"):
        v = clean.get(f)
        if v is None:
            continue
        if not str(v).strip() or not in_text(v, texts):
            clean[f] = None
            nulled.append(f"{f}_not_verbatim")
    q = clean.get("short_quote")
    if q and len(q.split()) > MAX_QUOTE_WORDS:
        clean["short_quote"] = None
        nulled.append("short_quote_too_long")
    clean["paragraph_ids"] = ids
    clean["pillars"] = [p for p in (clean.get("pillars") or []) if p in PILLARS]
    return clean, reasons, nulled


def validate_all(lessons: list[dict], window: dict) -> tuple[list[dict], list[dict]]:
    kept, dropped = [], []
    for l in lessons:
        clean, reasons, nulled = validate_lesson(l, window)
        if clean is None:
            dropped.append({"window_id": window["window_id"], "reasons": reasons, "lesson": l})
        else:
            clean["nulled_fields"] = nulled
            kept.append(clean)
    return kept, dropped


# ----------------------------------------------------------------------------
# Dedupe (implemented for later phases; the golden CLI does not call it)
# ----------------------------------------------------------------------------

def specificity(lesson: dict) -> tuple[int, int]:
    p = lesson.get("principle") or ""
    ev = lesson.get("evidence") or ""
    return (v2.concrete_tokens(p) * 3 + v2.concrete_tokens(ev) * 2 + len(p.split()),
            v2.concrete_tokens(lesson.get("applies_when") or ""))


def dedupe(cands: list[dict], embeddings: list[list[float]], threshold: float = DEDUPE_THRESHOLD
           ) -> tuple[list[dict], list[dict]]:
    """cands: [{window_id, lesson}] in document order. Similarity > threshold merges; the more specific
    lesson (concrete tokens in principle/evidence, then longer principle) is kept, ties go to the earlier."""
    order = sorted(range(len(cands)), key=lambda i: (tuple(-x for x in specificity(cands[i]["lesson"])), i))
    kept: list[int] = []
    merges: list[dict] = []
    for i in order:
        target, best = None, threshold
        for k in kept:
            s = v2.cosine(embeddings[i], embeddings[k])
            if s > best:
                best, target = s, k
        if target is None:
            kept.append(i)
        else:
            merges.append({"kept_title": cands[target]["lesson"]["title"],
                           "dropped_title": cands[i]["lesson"]["title"], "similarity": round(best, 4),
                           "kept_window": cands[target]["window_id"], "dropped_window": cands[i]["window_id"]})
    return [cands[k] for k in sorted(kept)], merges


# ----------------------------------------------------------------------------
# Cache and extractor
# ----------------------------------------------------------------------------

def read_cache(path: Path = CACHE_PATH) -> dict[str, dict]:
    if not Path(path).exists():
        return {}
    rows = [json.loads(l) for l in Path(path).read_text(encoding="utf-8").splitlines() if l.strip()]
    return {r["key"]: r for r in rows}


def estimate_cost(model: str, system: str, user: str) -> tuple[int, int, float]:
    in_tok = int((len(system) + len(user)) / 4)
    out_tok = EST_LESSONS_PER_WINDOW * EST_TOKENS_PER_LESSON + 40
    return in_tok, out_tok, state.cost_from_usage(model, in_tok, out_tok)


def check_cap(estimate: float, state_path: Path | str | None = None, cap: float = CAP_USD) -> None:
    """Refuse when total spend plus the estimate would pass the cap, or the state budget is short."""
    if state.total_cost(state_path) + estimate > cap:
        raise state.BudgetExhausted(
            f"Cap ${cap:.2f}: ${state.total_cost(state_path):.4f} spent, ${estimate:.4f} needed")
    state.refuse_to_start(estimate, state_path)


class ExtractorV3:
    def __init__(self, client: Any, model: str = DEFAULT_MODEL, examples: dict | None = None,
                 cache_path: Path = CACHE_PATH, state_path: Path | str | None = None,
                 sleep: Callable[[float], None] | None = None, cap: float = CAP_USD,
                 library_dir: Path = LIB):
        if model not in MODELS:
            raise ValueError(f"model must be one of {MODELS}")
        self.client, self.model = client, model
        self.system = system_prompt(examples if examples is not None else load_examples())
        self.cache_path, self.state_path, self.cap = Path(cache_path), state_path, cap
        self.sleep = sleep or time.sleep
        self.library_dir = library_dir
        self.cache = read_cache(self.cache_path)
        self.stats = {"windows": 0, "cached": 0, "called": 0, "cost_usd": 0.0}

    def user_prompt(self, window: dict) -> str:
        book, author = source_info(window["source_id"], self.library_dir)
        return render_user(window, book, author)

    def extract(self, window: dict) -> list[dict]:
        user = self.user_prompt(window)
        key = cache_key(self.model, self.system, user)
        self.stats["windows"] += 1
        if key in self.cache:
            self.stats["cached"] += 1
            return self.cache[key]["lessons"]
        _, _, est = estimate_cost(self.model, self.system, user)
        check_cap(est, self.state_path, self.cap)
        last: Exception | None = None
        for attempt in range(MAX_ATTEMPTS):
            try:
                resp = self.client.beta.chat.completions.parse(
                    model=self.model, temperature=0,
                    messages=[{"role": "system", "content": self.system}, {"role": "user", "content": user}],
                    response_format=WindowOutV3, max_completion_tokens=MAX_COMPLETION_TOKENS, timeout=TIMEOUT_S)
                nums = v2.usage_numbers(resp.usage)
                usd = state.cost_from_usage(self.model, **nums)
                state.add_cost(window["source_id"], usd, "lessons_v3_extract", self.state_path,
                               model=self.model, usage=nums)
                self.stats["cost_usd"] += usd
                self.stats["called"] += 1
                parsed = resp.choices[0].message.parsed
                if parsed is None:
                    raise ValueError("no parsable output")
                lessons = [l.model_dump() for l in parsed.lessons]
                row = {"key": key, "window_id": window["window_id"], "model": self.model,
                       "prompt_version": PROMPT_VERSION, "usage": nums, "cost_usd": round(usd, 8),
                       "lessons": lessons}
                with self.cache_path.open("a", encoding="utf-8") as fh:
                    fh.write(json.dumps(row, ensure_ascii=False) + "\n")
                self.cache[key] = row
                return lessons
            except state.BudgetExhausted:
                raise
            except Exception as exc:  # noqa: BLE001
                last = exc
                if v2._is_timeout(exc):
                    state.add_cost(window["source_id"], est, "lessons_v3_timeout_uncertain", self.state_path,
                                   model=self.model)
                if attempt < MAX_ATTEMPTS - 1:
                    self.sleep(2 ** attempt * 2)
        raise RuntimeError(f"window {window['window_id']} failed after {MAX_ATTEMPTS} attempts: "
                           f"{type(last).__name__}") from last


# ----------------------------------------------------------------------------
# Round runner and CLI
# ----------------------------------------------------------------------------

def run_round(windows: list[dict], extractor: ExtractorV3, out_dir: Path) -> dict:
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    lessons_out, dropped_out = [], []
    for w in windows:
        raw = extractor.extract(w)
        kept, dropped = validate_all(raw, w)
        pm = {p["id"]: p for p in w["paragraphs"]}
        for i, l in enumerate(kept):
            lessons_out.append({"lesson_id": f"{w['window_id']}_l{i:02d}", "window_id": w["window_id"],
                                "source_id": w["source_id"], "chapter": w["chapter"],
                                "prompt_version": PROMPT_VERSION, "model": extractor.model, **l,
                                "evidence_paragraphs": [{"id": pid, "text": pm[pid]["text"]} for pid in l["paragraph_ids"]]})
        dropped_out += dropped
    def dump(name, rows):
        (out_dir / name).write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows), encoding="utf-8")
    dump("lessons.jsonl", lessons_out)
    dump("dropped.jsonl", dropped_out)
    cost = {"model": extractor.model, "prompt_version": PROMPT_VERSION, "windows": extractor.stats["windows"],
            "cached_windows": extractor.stats["cached"], "api_calls": extractor.stats["called"],
            "cost_usd": round(extractor.stats["cost_usd"], 6), "lessons_kept": len(lessons_out),
            "lessons_dropped": len(dropped_out),
            "library_total_cost_usd": state.total_cost(extractor.state_path)}
    (out_dir / "cost.json").write_text(json.dumps(cost, indent=2) + "\n", encoding="utf-8")
    return cost


def dry_run(windows: list[dict], model: str, examples: dict, show_prompt: bool = True,
            library_dir: Path = LIB, out=print) -> dict:
    system = system_prompt(examples)
    tin = tout = 0
    usd = 0.0
    first = True
    for w in windows:
        book, author = source_info(w["source_id"], library_dir)
        user = render_user(w, book, author)
        if show_prompt and first:
            out("=== SYSTEM ===\n" + system + "\n=== USER (window " + w["window_id"] + ") ===\n" + user + "\n=== END ===")
            first = False
        a, b, c = estimate_cost(model, system, user)
        tin, tout, usd = tin + a, tout + b, usd + c
        out(f"{w['window_id']:22} est input {a:6} output {b:5} tokens  ${c:.4f}")
    out(f"TOTAL {len(windows)} windows: input {tin} output {tout} tokens, est ${usd:.4f} on {model}")
    return {"windows": len(windows), "input_tokens": tin, "output_tokens": tout, "usd": round(usd, 4)}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Run lessons-v3.0 extraction on the golden windows only.")
    ap.add_argument("--model", default=DEFAULT_MODEL, choices=MODELS)
    ap.add_argument("--round", type=int, default=1, dest="round_n")
    ap.add_argument("--dry-run", action="store_true", help="print the prompt and estimated cost; no API")
    ap.add_argument("--windows", nargs="*", help="limit to these window ids")
    ap.add_argument("--no-prompt", action="store_true", help="dry run: skip printing the full prompt")
    args = ap.parse_args(argv)
    windows = load_windows()
    if args.windows:
        windows = [w for w in windows if w["window_id"] in set(args.windows)]
    examples = load_examples()
    if args.dry_run:
        dry_run(windows, args.model, examples, show_prompt=not args.no_prompt)
        return 0
    if examples.get("_placeholder"):
        print("Refusing to spend: golden/examples.json still holds placeholder examples. "
              "Fill it, remove the '_placeholder' key, or pass through the dry run.", file=sys.stderr)
        return 2
    ex = ExtractorV3(v2.get_client(), args.model, examples)
    cost = run_round(windows, ex, GOLDEN / "runs" / f"round_{args.round_n}")
    print(json.dumps(cost, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
