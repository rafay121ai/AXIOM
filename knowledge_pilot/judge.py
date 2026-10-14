"""LLM judge for lessons (gpt-4.1, structured outputs) plus API-free core recall.

Usage:
  python judge.py --lessons PATH [--sample N --seed S] --out PATH
  python judge.py --lessons PATH --golden REFS.jsonl --out PATH   (recall is added to the report)

Five tests per lesson: grounded, specific, one_idea, attributed, findable.
A lesson passes only if all five pass. Verdicts are cached per
(JUDGE_PROMPT_VERSION, lesson content hash, model) so reruns cost nothing.
Cost is recorded per call, from returned usage, through library_state with
purpose 'judge'. The budget is checked before every call.

CORE RECALL RULE (recall_report): a reference lesson is covered when some
produced lesson shares >= 50% of the REFERENCE's paragraph_ids
(|ref ids & produced ids| / |ref ids| >= 0.5). The looser variant counts a
reference covered on >= 1 shared paragraph. Both are reported, per tier.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import random
import sys
import time
from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field

sys.path.insert(0, str(Path(__file__).resolve().parent))
import library_state as state  # noqa: E402

HERE = Path(__file__).resolve().parent
JUDGE_MODEL = "gpt-4.1"
JUDGE_PROMPT_VERSION = "judge-v1"
BATCH_SIZE = 8
MAX_ATTEMPTS = 3
MAX_COMPLETION_TOKENS = 4000
TIMEOUT_S = 120
TESTS = ("grounded", "specific", "one_idea", "attributed", "findable")
CACHE_PATH = HERE / "judge_cache.jsonl"

SYSTEM_PROMPT = """You are a strict reviewer of lessons extracted from nonfiction books and transcripts for a library that founders use to decide what to do. Each lesson claims to capture one idea from specific paragraphs of the source. You see the lesson and the full text of the paragraphs it cites (evidence_text). Judge each lesson against the five tests below. Judge only against the cited paragraphs; use no outside knowledge of the book. Be strict: when in doubt, fail, and say why in one short sentence.

For every lesson return a pass (true/false) and a one-line reason for each test. Keep each reason under 25 words and point at the specific words that decided it.

THE FIVE TESTS

1. grounded. Nothing in author_argues or principle may go beyond what the cited paragraphs support. Fail if a claim, number, mechanism, cause, or recommendation appears in the lesson but not in the paragraphs, or if the lesson overstates (a sometimes becomes an always, an anecdote becomes a law). The principle may be phrased as advice, but it must follow from what the author says. Also fail if short_quote, evidence, or caveat is present but is not verbatim (or a faithful near-verbatim restatement, for evidence and caveat) of the paragraphs. A null short_quote, evidence, or caveat is fine.

2. specific. The lesson is a distinct idea with a mechanism: it says what to do or see and why it works, so it could not be pasted unchanged into any business book. Fail slogans, exhortations, and platitudes with no mechanism ("be persistent", "listen to customers", "culture matters", "focus on what matters").

3. one_idea. Exactly one idea. Fail if two separable ideas are bundled (the principle could be split into two lessons that each stand alone). Fail if the lesson is really a signpost, transition, chapter summary, preview, or scene setting rather than a teaching.

4. attributed. The lesson credits the right speaker. If a character, interviewee, or quoted third party says it, the lesson must say so rather than crediting the author. For transcripts, the speaker must be named. Fail if the author is credited with someone else's view, if the author is only describing a view they reject, or if author_argues does not name who is arguing.

5. findable. The three example_questions are questions this idea genuinely answers, in a founder's voice. Fail if any question is answered better by a different idea, is not really answered by the lesson, or if there are fewer than three questions.

WORKED EXAMPLES

Example A (passes all five).
Cited paragraphs: "Most teams treat the first call with a customer as a pitch. Voss argues the first four minutes should be spent on one thing: getting the counterpart to say 'that's right'. He found that when people hear their own position summarized accurately, they stop defending it and start adding detail. A summary that draws 'you're right' only produces agreement; one that draws 'that's right' produces trust."
Lesson: title "Summarize their position until they say 'that's right'"; author_argues "Voss argues that summarizing the counterpart's position accurately makes them drop their defences and add detail. He distinguishes 'you're right', which only ends the exchange, from 'that's right', which signals trust."; principle "Before you pitch, restate the customer's situation in your own words and keep adjusting until they answer 'that's right'."; short_quote "stop defending it and start adding detail"; example_questions ["How do I open a sales call with a skeptical customer?", "Why do prospects go quiet when I pitch early?", "How do I know a customer feels understood?"].
Verdict: grounded pass (every claim is in the paragraphs, quote verbatim); specific pass (names a mechanism: accurate summary lowers defence); one_idea pass; attributed pass (Voss named as arguing it); findable pass.

Example B (fails).
Cited paragraphs: "Every founder I interviewed told me the same thing: you have to stay hungry. The day Maria quit her job she told her husband, 'I will not let this company die.' Three years later, she says, the same stubbornness is what carried them through."
Lesson: title "Persistence is the key to startup success"; author_argues "The author argues that persistence is what separates successful founders from the rest and that founders must never give up."; principle "Never give up and keep pushing no matter what."; short_quote "persistence is what separates"; example_questions ["How do I stay motivated?", "What is the best way to price my product?", "How do I find investors?"].
Verdict: grounded FAIL (the paragraphs say nothing about separating successful founders from the rest, and the quote does not appear); specific FAIL (a slogan with no mechanism that fits any business book); one_idea pass; attributed FAIL (the stubbornness is Maria's own account, not the author's argument, and the lesson does not say so); findable FAIL (two of the three questions are not answered by this lesson).

OUTPUT
Return one verdict per lesson, in the same order, using the lesson_id shown with each lesson. Return exactly as many verdicts as lessons. Do not add commentary outside the structured fields."""


class TestVerdict(BaseModel):
    passed: bool
    reason: str = Field(description="One short line naming the words that decided it")


class LessonVerdict(BaseModel):
    lesson_id: str
    grounded: TestVerdict
    specific: TestVerdict
    one_idea: TestVerdict
    attributed: TestVerdict
    findable: TestVerdict


class BatchOut(BaseModel):
    verdicts: list[LessonVerdict]


# ----------------------------------------------------------------------------
# Lessons and rendering
# ----------------------------------------------------------------------------

def load_jsonl(path: Path | str) -> list[dict]:
    rows = []
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        if line.strip():
            rows.append(json.loads(line))
    return rows


def lesson_principle(lesson: dict) -> str | None:
    """v3 has 'principle'; the older v2 format has 'founder_action'."""
    return lesson.get("principle") if lesson.get("principle") is not None else lesson.get("founder_action")


def evidence_paragraphs(lesson: dict) -> str:
    text = lesson.get("evidence_text")
    if isinstance(text, list):
        text = "\n\n".join(str(t.get("text", t)) if isinstance(t, dict) else str(t) for t in text)
    return text or ""


def lesson_view(lesson: dict) -> dict:
    """The fields the judge sees, in a stable order."""
    return {
        "paragraph_ids": lesson.get("paragraph_ids"),
        "author": lesson.get("author"),
        "lesson_type": lesson.get("lesson_type"),
        "title": lesson.get("title"),
        "author_argues": lesson.get("author_argues"),
        "principle": lesson_principle(lesson),
        "applies_when": lesson.get("applies_when"),
        "caveat": lesson.get("caveat"),
        "evidence": lesson.get("evidence"),
        "short_quote": lesson.get("short_quote"),
        "example_questions": lesson.get("example_questions"),
        "cited_paragraphs": evidence_paragraphs(lesson),
    }


def lesson_hash(lesson: dict) -> str:
    blob = json.dumps(lesson_view(lesson), sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()[:20]


def cache_key(lesson: dict, model: str = JUDGE_MODEL) -> str:
    return f"{JUDGE_PROMPT_VERSION}:{lesson_hash(lesson)}:{model}"


def render_batch(items: list[tuple[str, dict]]) -> str:
    parts = ["Judge these lessons."]
    for lid, lesson in items:
        v = lesson_view(lesson)
        cited = v.pop("cited_paragraphs")
        parts.append(f"=== lesson_id: {lid} ===\nLESSON:\n{json.dumps(v, ensure_ascii=False, indent=1)}\n"
                     f"CITED PARAGRAPHS:\n{cited}")
    return "\n\n".join(parts)


# ----------------------------------------------------------------------------
# Cost
# ----------------------------------------------------------------------------

def usage_numbers(usage: Any) -> dict:
    pt = getattr(usage, "prompt_tokens", 0) or 0
    ct = getattr(usage, "completion_tokens", 0) or 0
    details = getattr(usage, "prompt_tokens_details", None)
    cached = (getattr(details, "cached_tokens", 0) or 0) if details else 0
    return {"prompt_tokens": pt, "completion_tokens": ct, "cached_tokens": cached}


def approx_tokens(text: str) -> int:
    return int(len(text) / 4) + 1


def estimate_batch_cost(items: list[tuple[str, dict]], model: str = JUDGE_MODEL) -> float:
    in_tok = approx_tokens(SYSTEM_PROMPT) + approx_tokens(render_batch(items))
    out_tok = 150 * len(items)
    return state.cost_from_usage(model, in_tok, out_tok)


def estimate_cost(n_lessons: int, avg_lesson_tokens: int = 800, model: str = JUDGE_MODEL) -> dict:
    """Planning estimate. avg_lesson_tokens covers the lesson plus its cited paragraphs.
    Worst case counts the static prompt as uncached on every call; typical assumes it is cached after the first."""
    calls = -(-n_lessons // BATCH_SIZE)
    static = approx_tokens(SYSTEM_PROMPT)
    body = n_lessons * avg_lesson_tokens
    out = n_lessons * 150
    worst = state.cost_from_usage(model, calls * static + body, out)
    typical = state.cost_from_usage(model, calls * static + body, out,
                                    cached_tokens=(calls - 1) * static if static >= 1024 else 0)
    return {"lessons": n_lessons, "calls": calls, "worst_usd": round(worst, 4), "typical_usd": round(typical, 4)}


def get_client():  # pragma: no cover - never used by tests
    import os
    from dotenv import dotenv_values
    from openai import OpenAI
    key = dotenv_values(HERE.parent / ".env").get("OPENAI_API_KEY") or os.environ.get("OPENAI_API_KEY")
    if not key:
        raise RuntimeError("No OpenAI key configured")
    return OpenAI(api_key=key, max_retries=0, timeout=TIMEOUT_S)


# ----------------------------------------------------------------------------
# Judge
# ----------------------------------------------------------------------------

def _row_from_verdict(v: LessonVerdict) -> dict:
    tests = {t: {"pass": bool(getattr(v, t).passed), "reason": getattr(v, t).reason} for t in TESTS}
    return {"tests": tests, "passed": all(x["pass"] for x in tests.values())}


class Judge:
    def __init__(self, client: Any, source_id: str = "judge", model: str = JUDGE_MODEL,
                 state_path: Path | str | None = None, cache_path: Path | str | None = None,
                 sleep=time.sleep):
        self.client, self.source_id, self.model = client, source_id, model
        self.state_path = state_path
        self.cache_path = Path(cache_path or CACHE_PATH)
        self.sleep = sleep
        self.calls = 0
        self.cost_usd = 0.0
        self.cache_hits = 0
        self._cache = self._load_cache()

    def _load_cache(self) -> dict[str, dict]:
        out: dict[str, dict] = {}
        if self.cache_path.exists():
            for line in self.cache_path.read_text(encoding="utf-8").splitlines():
                if line.strip():
                    try:
                        row = json.loads(line)
                        out[row["key"]] = row["result"]
                    except (ValueError, KeyError):
                        continue
        return out

    def _save(self, key: str, result: dict) -> None:
        self._cache[key] = result
        self.cache_path.parent.mkdir(parents=True, exist_ok=True)
        with open(self.cache_path, "a", encoding="utf-8") as fh:
            fh.write(json.dumps({"key": key, "result": result}, ensure_ascii=False) + "\n")

    def _call_batch(self, items: list[tuple[str, dict]]) -> dict[str, dict]:
        """One API call for up to BATCH_SIZE lessons. Retries on malformed or incomplete output."""
        est = estimate_batch_cost(items, self.model)
        wanted = {lid for lid, _ in items}
        got: dict[str, dict] = {}
        last: Exception | None = None
        for attempt in range(MAX_ATTEMPTS):
            pending = [(lid, l) for lid, l in items if lid not in got]
            if not pending:
                break
            state.refuse_to_start(est, self.state_path)
            try:
                resp = self.client.beta.chat.completions.parse(
                    model=self.model, temperature=0,
                    messages=[{"role": "system", "content": SYSTEM_PROMPT},
                              {"role": "user", "content": render_batch(pending)}],
                    response_format=BatchOut, max_completion_tokens=MAX_COMPLETION_TOKENS, timeout=TIMEOUT_S)
                self.calls += 1
                nums = usage_numbers(resp.usage)
                usd = state.cost_from_usage(self.model, **nums)
                state.add_cost(self.source_id, usd, "judge", self.state_path, model=self.model, usage=nums)
                self.cost_usd += usd
                parsed = resp.choices[0].message.parsed
                if parsed is None:
                    raise ValueError("model returned no parsable output")
                still = {lid for lid, _ in pending}
                for v in parsed.verdicts:
                    if v.lesson_id in still and v.lesson_id not in got:
                        got[v.lesson_id] = _row_from_verdict(v)
                if not (wanted <= set(got)):
                    raise ValueError(f"verdicts missing for {sorted(wanted - set(got))}")
            except state.BudgetExhausted:
                raise
            except Exception as exc:  # noqa: BLE001
                last = exc
                if attempt < MAX_ATTEMPTS - 1:
                    self.sleep(2 ** attempt)
        if not wanted <= set(got):
            raise RuntimeError(f"judge failed for {sorted(wanted - set(got))} after {MAX_ATTEMPTS} attempts: "
                               f"{type(last).__name__}: {last}") from last
        return got

    def judge(self, lessons: list[dict]) -> list[dict]:
        """Return one result per lesson, in order. Cached lessons cost nothing."""
        results: list[dict | None] = [None] * len(lessons)
        todo: list[int] = []
        seen: dict[str, int] = {}
        for i, l in enumerate(lessons):
            key = cache_key(l, self.model)
            if key in self._cache:
                results[i] = self._cache[key]
                self.cache_hits += 1
            elif key in seen:
                pass  # duplicate content within this run; filled in after
            else:
                seen[key] = i
                todo.append(i)
        for start in range(0, len(todo), BATCH_SIZE):
            idxs = todo[start:start + BATCH_SIZE]
            items = [(f"L{n}", lessons[i]) for n, i in enumerate(idxs)]
            got = self._call_batch(items)
            for n, i in enumerate(idxs):
                res = got[f"L{n}"]
                results[i] = res
                self._save(cache_key(lessons[i], self.model), res)
        for i, l in enumerate(lessons):
            if results[i] is None:
                results[i] = self._cache[cache_key(l, self.model)]
        return results  # type: ignore[return-value]


def build_report(lessons: list[dict], results: list[dict], judge: Judge | None = None, **meta: Any) -> dict:
    n = len(lessons)
    per = []
    for l, r in zip(lessons, results):
        per.append({"paragraph_ids": l.get("paragraph_ids"), "title": l.get("title"),
                    "passed": r["passed"], "tests": r["tests"]})
    rates = {t: (round(sum(1 for r in results if r["tests"][t]["pass"]) / n, 4) if n else None) for t in TESTS}
    return {"judge_prompt_version": JUDGE_PROMPT_VERSION, "model": judge.model if judge else JUDGE_MODEL,
            "lessons_judged": n, "pass_rates": rates,
            "overall_pass_rate": round(sum(1 for r in results if r["passed"]) / n, 4) if n else None,
            "cost": {"usd": round(judge.cost_usd, 6) if judge else 0.0, "api_calls": judge.calls if judge else 0,
                     "cache_hits": judge.cache_hits if judge else 0},
            **meta, "results": per}


# ----------------------------------------------------------------------------
# Core recall (no API)
# ----------------------------------------------------------------------------

def _covers(ref_ids: set[str], produced: list[set[str]], min_fraction: float | None) -> bool:
    for ids in produced:
        shared = len(ref_ids & ids)
        if min_fraction is None:
            if shared >= 1:
                return True
        elif ref_ids and shared / len(ref_ids) >= min_fraction:
            return True
    return False


def recall_report(references: list[dict], produced: list[dict]) -> dict:
    """Recall per tier. Covered = some produced lesson contains >= 50% of the reference's paragraph_ids
    (strict rule); the loose variant needs only >= 1 shared paragraph."""
    prod = [set(p.get("paragraph_ids") or []) for p in produced]
    out: dict[str, Any] = {"rule": ">= 50% of the reference's paragraph_ids appear in one produced lesson",
                           "loose_rule": ">= 1 shared paragraph_id"}
    missed_core, missed_core_loose = [], []
    for tier in ("core", "minor"):
        refs = [r for r in references if r.get("tier") == tier]
        strict = loose = 0
        for r in refs:
            ids = set(r.get("paragraph_ids") or [])
            s, lo = _covers(ids, prod, 0.5), _covers(ids, prod, None)
            strict += s
            loose += lo
            if tier == "core":
                if not s:
                    missed_core.append(r)
                if not lo:
                    missed_core_loose.append(r)
        n = len(refs)
        out[f"{tier}_total"] = n
        out[f"{tier}_covered"] = strict
        out[f"{tier}_recall"] = round(strict / n, 4) if n else None
        out[f"{tier}_covered_loose"] = loose
        out[f"{tier}_recall_loose"] = round(loose / n, 4) if n else None
    out["missed_core"] = [{"paragraph_ids": r.get("paragraph_ids"), "title": r.get("title")} for r in missed_core]
    out["missed_core_loose"] = [{"paragraph_ids": r.get("paragraph_ids"), "title": r.get("title")}
                                for r in missed_core_loose]
    return out


# ----------------------------------------------------------------------------
# CLI
# ----------------------------------------------------------------------------

def main(argv: list[str] | None = None, client: Any = None) -> int:
    ap = argparse.ArgumentParser(description="Judge lessons with gpt-4.1; optional core recall")
    ap.add_argument("--lessons", required=True)
    ap.add_argument("--sample", type=int)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--out", required=True)
    ap.add_argument("--golden", help="reference lessons JSONL (paragraph_ids, tier core|minor); adds recall, no API")
    ap.add_argument("--recall-only", action="store_true", help="skip judging, compute recall only")
    ap.add_argument("--state", help="library_state path (tests)")
    args = ap.parse_args(argv)

    lessons = load_jsonl(args.lessons)
    report: dict[str, Any] = {}
    if not args.recall_only:
        chosen = lessons
        if args.sample and args.sample < len(lessons):
            chosen = random.Random(args.seed).sample(lessons, args.sample)
        source_id = Path(args.lessons).resolve().parent.name or "judge"
        judge = Judge(client or get_client(), source_id=source_id, state_path=args.state)
        results = judge.judge(chosen)
        report = build_report(chosen, results, judge, source_file=str(args.lessons),
                              sample=args.sample, seed=args.seed)
    if args.golden:
        report["recall"] = recall_report(load_jsonl(args.golden), lessons)
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out).write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    if report.get("results") is not None:
        print(f"judged {report['lessons_judged']}  overall pass {report['overall_pass_rate']}  "
              f"cost ${report['cost']['usd']}  pass rates {report['pass_rates']}")
    if "recall" in report:
        r = report["recall"]
        print(f"core recall {r['core_recall']} (loose {r['core_recall_loose']})  minor recall {r['minor_recall']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
