"""LLM judge for lessons (gpt-4.1, structured outputs) plus API-free core recall.

Usage:
  python judge.py --lessons PATH [--sample N --seed S] --out PATH
  python judge.py --lessons PATH --golden REFS.jsonl --out PATH   (recall is added to the report)

Seven tests per lesson: grounded, specific, one_idea, attributed, findable, enumeration, usefulness.
A lesson passes only if all seven pass. Verdicts are cached per
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
import re
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
JUDGE_PROMPT_VERSION = "judge-v9"
BATCH_SIZE = 1
MAX_ATTEMPTS = 3
MAX_COMPLETION_TOKENS = 4000
TIMEOUT_S = 120
TESTS = ("grounded", "specific", "one_idea", "attributed", "findable", "enumeration", "usefulness")
CACHE_PATH = HERE / "judge_cache.jsonl"

SYSTEM_PROMPT = """You are a strict reviewer of lessons extracted from nonfiction books and transcripts for a library that founders use to decide what to do. Each lesson claims to capture one idea from specific paragraphs of the source. You see the lesson and the full text of the paragraphs it cites (evidence_text). Judge each lesson against the seven tests below. Judge only against the cited paragraphs; use no outside knowledge of the book. Be strict: when in doubt, fail, and say why in one short sentence. Earlier reviewers passed too many lessons because they sounded plausible; a pass must be earned by words you can point to in the cited paragraphs.

For every lesson return a pass (true/false) and a one-line reason for each test. Keep each reason under 25 words and point at the specific words that decided it.

THE SEVEN TESTS

1. grounded. Nothing in author_argues or principle may go beyond what the cited paragraphs support. Fail if a claim, number, mechanism, cause, or recommendation appears in the lesson but not in the paragraphs, or if the lesson overstates (a sometimes becomes an always, an anecdote becomes a law). The principle may be phrased as advice, but it must follow from what the author says. Also fail if short_quote, evidence, or caveat is present but is not verbatim (or a faithful near-verbatim restatement, for evidence and caveat) of the paragraphs. A null short_quote, evidence, or caveat is fine.

2. specific. The lesson is a distinct idea with a mechanism: it says what to do or see and why it works, so it could not be pasted unchanged into any business book. Fail slogans, exhortations, and platitudes with no mechanism ("be persistent", "listen to customers", "culture matters", "focus on what matters").

3. one_idea. Exactly one idea. Fail if two separable ideas are bundled (the principle could be split into two lessons that each stand alone). Fail if the lesson is really a signpost, transition, chapter summary, preview, or scene setting rather than a teaching.

4. attributed. The lesson credits the right speaker. If a character, interviewee, or quoted third party says it, the lesson must say so rather than crediting the author. For transcripts, the speaker must be named. Fail if the author is credited with someone else's view, if the author is only describing a view they reject, or if author_argues does not name who is arguing.

5. findable. The three example_questions are questions this idea genuinely answers, in a founder's voice. Fail if any question is answered better by a different idea, is not really answered by the lesson, or if there are fewer than three questions.

6. enumeration. If the lesson lists or counts steps, components, parts, stages, items or numbers anywhere (title, author_argues, principle, applies_when, questions: "three steps", "four components", "first... second... third"), EACH of them must appear in the cited paragraphs, and any stated count must equal the number the paragraphs give. Fail if the lesson names a list or method whose members are not all in the cited paragraphs (for example the text cited holds items 1 and 2 of a four-part method, or the lesson says "four steps" and the cited text has only one of them). A lesson that lists or counts nothing passes this test.

7. usefulness. Pass only if a founder could use the principle to decide something or change what they do on Monday. Fail platitudes and exhortations (motivation, 'take action', 'learn from everyone', 'your choices shape your future'), advice that could be pasted unchanged into any self-help or business book, market commentary or investor analysis with no founder decision attached, and story setup whose moral or outcome is not in the cited paragraphs.

HOW TO APPLY THE TESTS (follow these steps, they are where lenient reviewers go wrong)
- grounded: list every factual claim, number, name, mechanism and causal link in author_argues and principle, and find each one in the cited paragraphs. One claim you cannot find is a fail. Do not let plausible background knowledge stand in for the text.
- specific: write down what the lesson says in one sentence and ask whether it would still be true and useful pasted into an unrelated book. If the principle restates the title in more general words, drops the particular case, number or mechanism the paragraphs give, or amounts to 'do the right thing carefully', FAIL. Abstract nouns doing the work ('deliberate choices', 'mindset', 'attention', 'approach') with no concrete action, number, case or mechanism from the paragraphs also FAIL, even when each word loosely appears in the text. A lesson passes only if the paragraphs' own distinct mechanism is visible in the principle.
- one_idea: split author_argues and principle into the separate claims they contain. If the lesson joins two claims that appear in different paragraphs, or a title with 'and' that joins two points, or a principle that could be split into two lessons that each stand alone, FAIL. A story plus the single point it makes is one idea. A title or principle built as 'X and Y' / 'both X and Y' where X and Y are different mechanisms FAILS even if the lesson calls them related.
- attributed: first copy the name credited in author_argues, then find the paragraph that carries the lesson's main claim and copy who speaks it (the speaker label at its start in a transcript; the narrator or the quoted person in a book). If the two names differ, FAIL, even if the credited person is mentioned or agrees elsewhere in the passage. In transcripts, check the speaker label of each paragraph: if the lesson names speaker X but the paragraph carrying the claim is spoken by Y (or X only asks the question or rebuts it), FAIL. If a character's story, a quoted third party's view, or an interviewer's framing is presented as the author's general claim, FAIL. If the author describes a view only to reject it, FAIL. A lesson also FAILS attributed if it credits the author (or the book) with any claim, guess, prediction, interpretation or quote that the text gives to someone else: an executive, a character, an interviewee, a quoted expert, another author, or the other speaker in a transcript. Look for quotation marks, 'said', 'told', 'according to', and speaker labels in the cited paragraphs, and check the lesson names that person for that claim. Block quotations count too: if a cited paragraph is an excerpt of an interview, letter, article or speech (the paragraph before it usually introduces it, e.g. 'as noted in an article', 'one executive recalled'), then the guesses, explanations and motives inside it belong to that quoted person. A lesson that states them as 'the author argues' or as the author's own explanation FAILS attributed; it must say whose words they are. If a quoted person's own guess or interpretation ('I think they recognized...') is presented as what the author argues or as established fact, FAIL.
- findable: for each of the three questions, say in your reason whether the principle answers it. If any question asks for something the lesson does not tell, FAIL.
- grounded for stories and frameworks: the moral, outcome, mechanism or steps the lesson states must be stated or plainly shown in the cited paragraphs themselves. If the paragraphs only set up a story (who, where, what happened first) and the payoff or lesson comes in an uncited paragraph, or the lesson supplies a moral the text does not state, FAIL grounded.
- attributed in transcripts: "the speaker", "the host" or "the guest" instead of a name FAILS.
- enumeration: scan the lesson for any count or list (words like steps, components, parts, stages, factors, rules, ways, questions with a number; ordinal lists; 'both X and Y'). For each member write where it appears in the cited paragraphs, or NOT FOUND. Any NOT FOUND, or a count that differs from the paragraphs, is a FAIL. If nothing is listed or counted, pass.
- usefulness: in your work, write the decision as 'WHEN <situation from the paragraphs>, DO <specific action> INSTEAD OF <alternative>, BECAUSE <mechanism the paragraphs give>'. If you cannot fill all four slots with things the paragraphs actually say (not generic words), FAIL. FAIL when the principle's value is an abstract benefit ('valuable insights', 'motivation', 'effectiveness', 'focused expertise', 'financial strategy', 'resilience', 'learning') rather than a specific action with a mechanism. FAIL when the decision is 'be motivated', 'learn from everyone', 'structure your team well' or 'pay attention to X'. FAIL when it is an investor's or commentator's view of markets, companies or valuations and the founder gets no action (explaining why public companies behave a certain way is not a founder decision). FAIL a story whose cited paragraphs end before its moral. Lessons that merely sound sensible are the usual failure here: be strict.
- grounded, second pass: split the principle into its clauses ('makes offers', 'reveals true market value', 'creates opportunities to close deals'). Each clause needs words in the cited paragraphs that say it. A clause that is a reasonable inference or common sense but is not in the paragraphs ('you only know the right price when a second party wants to deal', 'combining the roles leads to neglect', 'learning over pay builds long-term success') is NOT FOUND, and one NOT FOUND is a FAIL.
- example_questions: if a question is generic enough to be asked of any book ('How do I find investors?') or unrelated to this lesson, FAIL findable.

WORKED EXAMPLES

Example A (passes all seven).
Cited paragraphs: "Most teams treat the first call with a customer as a pitch. Voss argues the first four minutes should be spent on one thing: getting the counterpart to say 'that's right'. He found that when people hear their own position summarized accurately, they stop defending it and start adding detail. A summary that draws 'you're right' only produces agreement; one that draws 'that's right' produces trust."
Lesson: title "Summarize their position until they say 'that's right'"; author_argues "Voss argues that summarizing the counterpart's position accurately makes them drop their defences and add detail. He distinguishes 'you're right', which only ends the exchange, from 'that's right', which signals trust."; principle "Before you pitch, restate the customer's situation in your own words and keep adjusting until they answer 'that's right'."; short_quote "stop defending it and start adding detail"; example_questions ["How do I open a sales call with a skeptical customer?", "Why do prospects go quiet when I pitch early?", "How do I know a customer feels understood?"].
Verdict: grounded pass (every claim is in the paragraphs, quote verbatim); specific pass (names a mechanism: accurate summary lowers defence); one_idea pass; attributed pass (Voss named as arguing it); findable pass.

Example B (fails).
Cited paragraphs: "Every founder I interviewed told me the same thing: you have to stay hungry. The day Maria quit her job she told her husband, 'I will not let this company die.' Three years later, she says, the same stubbornness is what carried them through."
Lesson: title "Persistence is the key to startup success"; author_argues "The author argues that persistence is what separates successful founders from the rest and that founders must never give up."; principle "Never give up and keep pushing no matter what."; short_quote "persistence is what separates"; example_questions ["How do I stay motivated?", "What is the best way to price my product?", "How do I find investors?"].
Verdict: grounded FAIL (the paragraphs say nothing about separating successful founders from the rest, and the quote does not appear); specific FAIL (a slogan with no mechanism that fits any business book); one_idea pass; attributed FAIL (the stubbornness is Maria's own account, not the author's argument, and the lesson does not say so); findable FAIL (two of the three questions are not answered by this lesson).

Example C (fails specific). Paragraphs describe how a bakery chain found that customers bought more when the cheapest loaf sat at eye level next to a pricier loaf, because the comparison made the pricier one look like a trade-up. Lesson principle: "Think carefully about how you present your prices." Verdict: specific FAIL (true of any book; it drops the mechanism, which is a side-by-side comparison that frames the pricier item as a trade-up).
Example D (fails attributed). A podcast paragraph spoken by the guest says rural clinics lose money on every visit; a later paragraph spoken by the host says subsidies might fix it. The lesson credits the guest with the subsidy point. Verdict: attributed FAIL (the subsidy idea is the host's).
Example E (fails one_idea). Lesson title "Pricing tests and hiring speed both decide early survival", with a principle that joins running price experiments weekly with hiring the first ten staff within a month. Verdict: one_idea FAIL (two separable ideas from different paragraphs).

Example F (fails enumeration). Lesson principle: "Use the four-step method: define the segment, size it, pick a beachhead, and write the pitch." The cited paragraphs describe defining the segment and sizing it; beachhead and pitch appear only in uncited paragraphs. Verdict: enumeration FAIL (two of the four steps are not in the cited paragraphs).
Example G (fails usefulness). Principle: "Taking consistent daily action toward your goals leads to financial success." Verdict: usefulness FAIL (an exhortation; no decision a founder can make with it; fits any self-help book).

OUTPUT
Return one verdict per lesson, in the same order, using the lesson_id shown with each lesson. Return exactly as many verdicts as lessons. Do not add commentary outside the structured fields."""


_LABEL_RE = re.compile(r"^\s*([A-Z][A-Za-z.'\-]*(?: [A-Z][A-Za-z.'\-]*){0,3}):\s")
_SAID_RE = re.compile(r"\b([A-Z][a-z]+(?: [A-Z][a-z]+)?)\s+(?:said|told|says|replied|wrote|argued)\b")
_ACCORD_RE = re.compile(r"\b[Aa]ccording to ([A-Z][A-Za-z]+(?: [A-Z][A-Za-z]+)?)")
_NOT_NAMES = {"He", "She", "They", "It", "We", "I", "You", "Someone", "Everyone", "People", "Then", "When", "What", "Mike", "Mother"}


def _common_words() -> set[str]:
    global _COMMON
    try:
        return _COMMON
    except NameError:
        pass
    words: set[str] = set()
    try:
        for w in Path("/usr/share/dict/words").read_text(encoding="utf-8", errors="ignore").split():
            if w.islower():
                words.add(w)
    except OSError:
        pass
    _COMMON = words
    return words


def _is_plausible_name(name: str) -> bool:
    toks = name.split()
    if name in _NOT_NAMES:
        return False
    if len(toks) == 1 and (toks[0].lower() in _common_words() or toks[0].lower().endswith("ing")):
        return False
    return True


def _name_tokens(name: str) -> list[str]:
    return [t.lower() for t in re.split(r"\s+", name.strip()) if len(t) >= 3]


_PARA_CACHE: dict[str, list[dict]] = {}


def _speaker_of(pid: str, text: str) -> str | None:
    """Speaker label of a transcript paragraph. An unlabelled paragraph continues the turn of the
    nearest earlier labelled paragraph of the same source (looked up in paragraphs_v3.2.jsonl)."""
    m = _LABEL_RE.match(text)
    if m:
        return m.group(1)
    sid, _, num = pid.rpartition("_p")
    if not (sid and num.isdigit()):
        return None
    if sid not in _PARA_CACHE:
        f = HERE / "library" / sid / "paragraphs_v3.2.jsonl"
        rows = []
        if f.exists():
            rows = [json.loads(x) for x in f.read_text(encoding="utf-8").splitlines() if x.strip()]
        _PARA_CACHE[sid] = rows
    rows = _PARA_CACHE[sid]
    idx = next((i for i, r in enumerate(rows) if r.get("id") == pid or r.get("paragraph_id") == pid), None)
    if idx is None:
        return None
    for j in range(idx, max(-1, idx - 40), -1):
        mm = _LABEL_RE.match(rows[j].get("text", ""))
        if mm:
            return mm.group(1)
    return None


def attribution_flag(lesson: dict) -> str | None:
    """Deterministic attribution check. If the cited paragraphs name a speaker (a transcript
    'Name:' label, 'X said/told/says', 'according to X'), author_argues must name at least one
    of them. Returns a reason string when it does not, else None."""
    paras = lesson.get("evidence_paragraphs") or lesson.get("evidence_text") or []
    if isinstance(paras, str):
        paras = [paras]
    texts = [str(p.get("text", p)) if isinstance(p, dict) else str(p) for p in paras]
    if not texts:
        return None
    argues = (lesson.get("author_argues") or "").lower()
    labels, said = [], []
    pids = [p.get("id") for p in paras if isinstance(p, dict)] or list(lesson.get("paragraph_ids") or [])
    for n, t in enumerate(texts):
        pid = pids[n] if n < len(pids) else None
        if pid and not str(pid).startswith("transcripts-"):
            sp = None  # speaker labels only exist in transcripts
        else:
            sp = _speaker_of(pid, t) if pid else None
            if sp is None:
                m = _LABEL_RE.match(t)
                sp = m.group(1) if m else None
        if sp:
            labels.append(sp)
        for m in _SAID_RE.finditer(t):
            if _is_plausible_name(m.group(1)):
                said.append(m.group(1))
        for m in _ACCORD_RE.finditer(t):
            if _is_plausible_name(m.group(1)):
                said.append(m.group(1))
    if labels:  # transcript: the credited person must be one of the speakers of the cited turns
        if not any(any(tok in argues for tok in _name_tokens(n)) for n in labels):
            return f"credits none of the cited speakers {sorted(set(labels))}"
        return None
    names = [n for n in said if _name_tokens(n)]
    if names and not any(any(tok in argues for tok in _name_tokens(n)) for n in names):
        return f"the cited text attributes statements to {sorted(set(names))}; author_argues names none of them"
    return None


_GENERIC_SPEAKER_RE = re.compile(r"\bthe (?:speaker|host|guest|interviewer|interviewee)\b", re.I)


def apply_attribution_check(lesson: dict, result: dict) -> dict:
    reason = attribution_flag(lesson)
    pids = lesson.get("paragraph_ids") or []
    if not reason and pids and str(pids[0]).startswith("transcripts-") and \
            _GENERIC_SPEAKER_RE.search(lesson.get("author_argues") or ""):
        reason = "author_argues says 'the speaker/host/guest' instead of a name"
    if not reason or not result["tests"]["attributed"]["pass"]:
        return result
    out = json.loads(json.dumps(result))
    out["tests"]["attributed"] = {"pass": False, "reason": "deterministic: " + reason}
    out["passed"] = False
    return out


class TestVerdict(BaseModel):
    work: str = Field(description="Your working, written BEFORE deciding. grounded: each claim in author_argues/principle with the quoted paragraph words that support it, or 'NOT FOUND'. specific: the one-sentence content and what the paragraphs' particular mechanism is. one_idea: a numbered list of the distinct claims. attributed: (a) the name credited in author_argues; (b) the paragraph that carries the lesson's MAIN claim and the speaker label or narrator that begins it; (c) whether (a) equals (b), word for word. A transcript turn labelled with a different name is a mismatch. findable: for each of the three questions, the words of the principle that answer it, or 'NOT ANSWERED'. enumeration: every listed or counted item in the lesson and the cited words that hold it, or 'NOT FOUND'; write 'no list' if there is none. usefulness: the concrete decision a founder could make with the principle, or 'NONE'.")
    reason: str = Field(description="One short line naming the words that decided it")
    passed: bool


class LessonVerdict(BaseModel):
    lesson_id: str
    grounded: TestVerdict
    specific: TestVerdict
    one_idea: TestVerdict
    attributed: TestVerdict
    findable: TestVerdict
    enumeration: TestVerdict
    usefulness: TestVerdict


SKEPTIC_PROMPT = """You are the second, adversarial reviewer of a lesson that a first reviewer PASSED. Your job is to find the strongest reason it should fail. You see the lesson and the full text of the paragraphs it cites. Use only those paragraphs.

Look for exactly these defects:
- grounded: split author_argues and principle into clauses; any clause that is an inference, a generalisation, or common sense not stated or shown in the cited paragraphs (a sometimes made an always; a moral the paragraphs never state; a benefit, mechanism or consequence added by the writer).
- specific / usefulness: the principle is an exhortation, motivation, a platitude, or advice that could be pasted into any business or self-help book; or it describes how markets, investors or public companies behave, with no action a founder could take; or it is "learn from X", "persist", "take action", "have a purpose".
- enumeration: it lists or counts items not all present in the cited paragraphs.
- attributed: wrong or unnamed speaker ("the speaker", "the host"), or the author is credited with someone else's claim.
- one_idea: two separable ideas.

Rules: you must point at words. If the lesson is genuinely a specific, grounded, usable idea, answer flaw_found=false. Do not invent flaws; do not fail a lesson because it is short, or because it paraphrases the text, or because a clause is a trivial restatement of what the paragraphs say in other words. A clause is unsupported only when it adds a substantive claim, cause, number or moral the paragraphs do not give. But do not be charitable: if a clause of the principle has no support in the paragraphs, or the only founder decision you can name is generic, that is a flaw. Return failing_test as one of grounded, specific, one_idea, attributed, findable, enumeration, usefulness (or 'none'), and one short sentence quoting the words that decided it."""


class SkepticOut(BaseModel):
    work: str = Field(description="First list each clause of the principle with the quoted paragraph words supporting it or NOT FOUND, then the concrete decision a founder could make and what is generic about it.")
    flaw_found: bool
    failing_test: str
    reason: str


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
    if text is None:
        text = lesson.get("evidence_paragraphs")  # v3 lessons
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
    return f"{JUDGE_PROMPT_VERSION}:{hashlib.sha256(SYSTEM_PROMPT.encode()).hexdigest()[:8]}b{BATCH_SIZE}:{lesson_hash(lesson)}:{model}"


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
                 sleep=time.sleep, skeptic: bool = False):
        self.skeptic = skeptic
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

    def _skeptic(self, lesson: dict, result: dict) -> dict:
        """Optional second, adversarial read (--skeptic) of lessons the main judge passed; cached.
        Off by default: on the calibration sets it failed 61% of the reference lessons."""
        if not self.skeptic or not result["passed"]:
            return result
        key = f"skeptic:{hashlib.sha256(SKEPTIC_PROMPT.encode()).hexdigest()[:8]}:{lesson_hash(lesson)}:{self.model}"
        got = self._cache.get(key)
        if got is None:
            v = lesson_view(lesson)
            cited = v.pop("cited_paragraphs")
            user = f"LESSON:\n{json.dumps(v, ensure_ascii=False, indent=1)}\nCITED PARAGRAPHS:\n{cited}"
            est = state.cost_from_usage(self.model, approx_tokens(SKEPTIC_PROMPT + user), 300)
            last: Exception | None = None
            for attempt in range(MAX_ATTEMPTS):
                state.refuse_to_start(est, self.state_path)
                try:
                    resp = self.client.beta.chat.completions.parse(
                        model=self.model, temperature=0,
                        messages=[{"role": "system", "content": SKEPTIC_PROMPT}, {"role": "user", "content": user}],
                        response_format=SkepticOut, max_completion_tokens=1500, timeout=TIMEOUT_S)
                    self.calls += 1
                    nums = usage_numbers(resp.usage)
                    usd = state.cost_from_usage(self.model, **nums)
                    state.add_cost(self.source_id, usd, "judge_skeptic", self.state_path, model=self.model, usage=nums)
                    self.cost_usd += usd
                    p = resp.choices[0].message.parsed
                    if p is None:
                        raise ValueError("no parsable output")
                    got = {"flaw_found": p.flaw_found, "failing_test": p.failing_test, "reason": p.reason}
                    self._save(key, got)
                    break
                except state.BudgetExhausted:
                    raise
                except Exception as exc:  # noqa: BLE001
                    last = exc
                    if attempt < MAX_ATTEMPTS - 1:
                        self.sleep(2 ** attempt)
            if got is None:
                raise RuntimeError(f"skeptic failed after {MAX_ATTEMPTS} attempts: {type(last).__name__}") from last
        else:
            self.cache_hits += 1
        if got["flaw_found"] and got["failing_test"] in TESTS:
            out = json.loads(json.dumps(result))
            out["tests"][got["failing_test"]] = {"pass": False, "reason": "skeptic: " + got["reason"]}
            out["passed"] = False
            return out
        return result

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
        results = [self._skeptic(l, r) for l, r in zip(lessons, results)]  # type: ignore[arg-type]
        return [apply_attribution_check(l, r) for l, r in zip(lessons, results)]


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
    ap.add_argument("--skeptic", action="store_true", help="add the adversarial second pass (stricter)")
    ap.add_argument("--state", help="library_state path (tests)")
    ap.add_argument("--cache", help="judgment cache path (default knowledge_pilot/judge_cache.jsonl)")
    args = ap.parse_args(argv)

    lessons = load_jsonl(args.lessons)
    report: dict[str, Any] = {}
    if not args.recall_only:
        chosen = lessons
        if args.sample and args.sample < len(lessons):
            chosen = random.Random(args.seed).sample(lessons, args.sample)
        source_id = Path(args.lessons).resolve().parent.name or "judge"
        judge = Judge(client or get_client(), source_id=source_id, state_path=args.state,
                      cache_path=args.cache, skeptic=args.skeptic)
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
