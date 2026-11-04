"""Editor pass (EDITOR_VERSION 'editor-v2.0-mini'): one gpt-4.1-mini call per lesson, keep or drop, rewrite the index card.

A lesson is an index card: it points at stored paragraphs and says what idea they hold. The editor sees the
lesson and its cited paragraphs and either drops it or rewrites title, author_argues, principle and
example_questions so that every claim is supported by those paragraphs. Paragraph ids, evidence, caveat,
short_quote, applies_when, lesson_type and pillars are never touched.

  python editor.py --lessons merged.jsonl --out DIR [--workers 4] [--max-cost USD] [--dry-run]

Writes DIR/edited.jsonl (kept, with 'orig' holding the pre-edit card), DIR/editor_dropped.jsonl, DIR/editor_cost.json.
Cached per (version, model, lesson content); reruns cost nothing. Cost recorded through library_state
(purpose 'editor'). No database.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import threading
import time
from difflib import SequenceMatcher
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, Field

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import library_lessons as v2  # noqa: E402
import library_lessons_v3 as l3  # noqa: E402
import library_state as state  # noqa: E402

EDITOR_VERSION = "editor-v2.0-mini"
MODEL = "gpt-4.1-mini"
CAP_USD = 40.00
MAX_ATTEMPTS = 3
TIMEOUT_S = 120
MAX_COMPLETION_TOKENS = 2000
CACHE_PATH = HERE / "editor_cache.jsonl"
EDITED_FIELDS = ("title", "author_argues", "principle", "example_questions")

SYSTEM_PROMPT = """You are the editor of a library of lessons for startup founders. Every lesson is an INDEX CARD. It points to specific source paragraphs, which are stored with the card and shown to the founder word for word when they ask a question. The card only has to say, correctly and findably, what idea those paragraphs hold. You see one lesson and the full text of the paragraphs it cites. Decide keep or drop, and if you keep it, rewrite the card.

What must be right: (1) the idea is real and a founder could use it to decide or do something; (2) the cited paragraphs actually hold that idea; (3) a founder's question would find it; (4) the speaker is named correctly. Small looseness in a summary is not a reason to drop: fix it in the rewrite.

DROP when any of these is true:
- platitude or exhortation: "take action", "learn from others", "be persistent", "your choices shape your future", or any principle that could appear unchanged in any self-help or business book
- scene setting, or story setup whose lesson is not in the cited paragraphs (the payoff is somewhere you cannot see)
- an anecdote presented as a general rule the paragraphs do not state
- two or more separate ideas bundled in one card, or paragraphs that do not belong together
- a single statistic or fact with no decision attached
- an opening or headline statistic, number or dramatic comparison that the paragraphs only state, without saying what to do or decide because of it
- ANY cited paragraph that is a scene-setting aside, transition, or about a different subject than the core claim (a bundled or padded citation set cannot be fixed by rewriting, so drop)
- a personal story or episode where the paragraphs show what happened but no cited sentence draws the rule; do not infer motives, qualities, trust, quality or results the text does not state
- not something a founder could use to decide anything (market commentary, investor analysis, trivia)
- CORE CLAIM CHECK: you must quote the sentence in the cited paragraphs that states the core claim (stating_sentence). If no such sentence exists, drop.
- ETHICS: the only lesson is an illegal, deceptive or unethical act itself (fraud, counterfeiting, manipulating or deceiving customers or partners). Drop (verdict drop) only when the cited text offers nothing transferable beyond the act. If the text itself praises or names a transferable quality (creativity, resourcefulness, leverage, reading people), the lesson is that quality: keep it under the ETHICS rewrite rule below, and leave act_is_the_lesson false.
Otherwise KEEP.

If you KEEP, rewrite (leave a field as it is when it is already right):
- title: 5 to 10 words naming the idea.
- author_argues: 1 to 3 sentences. Every claim must be stated or plainly shown in the cited paragraphs, in the text's own words where you can. No added phrases, no consequences, morals, causes or numbers the paragraphs do not give. Attribute correctly. In a book, name the author for the author's own claims, and attribute characters' words to them: "Kiyosaki recounts rich dad saying...", "Moore describes a customer who...". If someone else's claim is quoted, say whose it is. In a transcript every paragraph is tagged with its speaker: name the tagged speaker who says the idea; never write "the speaker", "the host" or "the guest". In a book, a character's words are the character's, not the author's: write "Kiyosaki recounts rich dad saying...", never "Rich Dad argues" or "Kiyosaki argues" for a line only a character says. When an author presents a model, promise or view as someone else's or as the field's, say so ("Moore describes the model as promising...") instead of making it the author's own claim.
- principle: ONE sentence stating the mechanism or rule, with the same grounding rule. Every number must appear in the cited paragraphs.
- ETHICS: if the example involves an illegal, deceptive or unethical act (counterfeiting, fraud, manipulation, deceiving customers or partners) but also carries a transferable principle (creativity, resourcefulness, leverage, reading people), keep the principle and never endorse the act. author_argues must state plainly that the act is illegal or unethical (as the text says, or "this act is illegal/unethical"). principle must apply only to legitimate actions and must not say the illegal act is acceptable, even if it fails or is wrong (do not write 'even if illegal'), and example_questions must not ask how to do the act.
- example_questions: exactly 3 questions a founder would type, in their own words, each answered by what these paragraphs say.

Be strict: the library is better with 60 sharp cards than 100 padded ones, and a founder loses trust in a vague card. When in doubt, drop. Answer the structured checks honestly; a card with no stating sentence, or that reads the same in any book, or that only recounts one episode, or that bundles ideas, is dropped.

Fill in "work" first: (a) the idea in one sentence; (b) the decision a founder could make with it, as WHEN <situation from the paragraphs>, DO <specific action> INSTEAD OF <alternative>; if you can only fill that with generic words (motivation, insights, learning, strategy), the card is a platitude; (c) which cited paragraph states it, and the speaker; (d) any claim in the old card you cannot find in the paragraphs; (e) list each cited paragraph id with one phrase on how it supports the core claim, and drop if any has none. Then classify every cited paragraph (paragraph_roles), the stating sentence (stating_type), and who says it (speaker_type), copy the stating sentence, answer the flags, and give the verdict. For a drop, give drop_reason in one sentence and leave title, author_argues, principle empty and example_questions an empty list."""


def _words(t: str) -> list[str]:
    return re.findall(r"[a-z0-9$%]+", t.lower().replace("’", "'").replace("'", ""))


def sentence_in_text(sentence: str, texts: list[str], min_share: float = 0.85) -> bool:
    """Every ellipsis-separated fragment of `sentence` (4+ words) must appear, in order, in one paragraph:
    a contiguous run covering at least min_share of its words. Tolerates quote and punctuation variants."""
    frags = [f for f in re.split(r"\.\.\.|…", sentence) if len(_words(f)) >= 4]
    if not frags:
        return False
    paras = [_words(t) for t in texts]
    for f in frags:
        fw = _words(f)
        best = 0
        for pw in paras:
            best = max(best, SequenceMatcher(None, fw, pw, autojunk=False).find_longest_match(0, len(fw), 0, len(pw)).size)
        if best < min_share * len(fw):
            return False
    return True


class ParaRole(BaseModel):
    id: str
    role: Literal["states_claim", "supports_claim", "scene_or_aside", "unrelated"] = Field(description="states_claim: contains the sentence that states the core claim. supports_claim: gives the example, reasoning or evidence for that claim. scene_or_aside: sets a scene, transitions, narrates an unrelated moment or a tangent. unrelated: about a different point than the core claim.")


class EditOut(BaseModel):
    work: str = Field(description="(a) the idea in one sentence; (b) the founder decision: WHEN <situation>, DO <specific action> INSTEAD OF <alternative>; (c) paragraph and speaker; (d) unsupported claims in the old card")
    stating_sentence: str = Field(description="ONE sentence copied word for word from the cited paragraphs in which the speaker or author states the rule, mechanism, number or point of this idea. Empty string if no sentence in the cited paragraphs states it (for example the paragraphs only set up a story, describe what happened, or the point is only in your head).")
    paragraph_roles: list[ParaRole] = Field(default_factory=list, description="One entry per cited paragraph id, classified honestly by what that paragraph does for the stating sentence's claim.")
    stating_type: Literal["rule_or_advice", "mechanism_or_test", "fact_or_statistic", "event_or_scene"] = Field(default="rule_or_advice", description="What the stating sentence does. rule_or_advice: tells what to do, avoid or decide. mechanism_or_test: explains how or why something works, or gives a test. fact_or_statistic: reports a figure, size or fact. event_or_scene: reports what happened in a moment, a setup, a description. Be honest: a sentence reporting an event, even a successful one, is event_or_scene unless it itself draws a rule.")
    speaker_type: Literal["author_narration", "character_dialogue", "quoted_other", "transcript_speaker"] = Field(default="author_narration", description="Who says the stating sentence. author_narration: the book author in their own voice. character_dialogue: a person in the author's story is quoted speaking (for example rich dad, the author's father). quoted_other: the author quotes or reports someone else's claim or a model/promise. transcript_speaker: a tagged speaker in a transcript.")
    same_in_any_book: bool = Field(description="True if, with all names, numbers and cases removed, the principle would read the same in any self-help or business book and gives a founder no specific action or test (motivation, exhortation, 'learn from others', 'be smart with money', 'persist').")
    anecdote_only: bool = Field(description="True if the paragraphs only recount one episode and the speaker does not draw a rule from it in the cited text.")
    bundled: bool = Field(description="True if the card combines two or more separate ideas, or the cited paragraphs hold different ideas.")
    act_is_the_lesson: bool = Field(default=False, description="True ONLY if the paragraphs name no transferable quality at all (creativity, resourcefulness, leverage, reading people) and the act itself is all there is. False when a speaker names or praises such a quality, even if the act that showed it was illegal or unethical; in that case keep and rewrite per the ETHICS rewrite rule.")
    single_fact_only: bool = Field(default=False, description="True if the card is a single statistic or fact with no decision attached.")
    verdict: Literal["keep", "drop"]
    drop_reason: str
    title: str
    author_argues: str
    principle: str
    example_questions: list[str]


# ----------------------------------------------------------------------------

def render_user(lesson: dict, library_dir: Path = l3.LIB) -> str:
    sid = lesson.get("source_id") or ""
    book, author = l3.source_info(sid, library_dir) if sid else (None, None)
    sp = l3.speaker_map(sid, library_dir) if sid else {}
    paras = lesson.get("evidence_paragraphs") or []
    lines = [f"BOOK: {book or 'unknown'}", f"AUTHOR: {author or ('transcript; speakers tagged below' if sp else 'unknown')}"]
    if sp:
        lines.append("SPEAKERS: " + ", ".join(dict.fromkeys(sp.values())))
    lines.append(f"CHAPTER: {lesson.get('chapter') or 'unknown'}")
    card = {k: lesson.get(k) for k in ("lesson_type", "title", "author_argues", "principle", "evidence", "caveat",
                                       "short_quote", "applies_when", "example_questions")}
    lines += ["", "LESSON CARD", json.dumps(card, ensure_ascii=False, indent=1), "", "CITED PARAGRAPHS"]
    for p in paras:
        tag = f" (speaker: {sp[p['id']]})" if p["id"] in sp else ""
        lines.append(f"[{p['id']}]{tag} {p['text']}")
    return "\n".join(lines)


def content_hash(lesson: dict) -> str:
    blob = json.dumps({k: lesson.get(k) for k in ("paragraph_ids", "title", "author_argues", "principle", "evidence",
                                                  "caveat", "short_quote", "applies_when", "example_questions",
                                                  "lesson_type")}, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(blob.encode()).hexdigest()[:20]


def cache_key(lesson: dict, model: str = MODEL) -> str:
    sh = hashlib.sha256(SYSTEM_PROMPT.encode()).hexdigest()[:8]
    return f"{EDITOR_VERSION}:{sh}:{content_hash(lesson)}:{model}"


def validate_edit(lesson: dict, edit: dict, library_dir: Path = l3.LIB) -> list[str]:
    """Deterministic checks on a kept edit (free): shape, grounded numbers, enumeration counts, speaker names."""
    probs: list[str] = []
    for f in ("title", "author_argues", "principle"):
        if not str(edit.get(f) or "").strip():
            probs.append(f"empty:{f}")
    qs = edit.get("example_questions") or []
    if len(qs) != 3 or any(not str(q).strip() for q in qs):
        probs.append("example_questions_not_3")
    if probs:
        return probs
    texts = [p["text"] for p in lesson.get("evidence_paragraphs") or []]
    grounded = v2.grounded_numbers(" ".join(texts))
    for f in ("author_argues", "principle"):
        bad = sorted(v2.numbers_in(edit[f]) - grounded)
        if bad:
            probs.append(f"number_not_in_paragraphs:{f}:{','.join(bad)}")
    probs += l3.enumeration_problems(edit, texts)
    sid = lesson.get("source_id") or ""
    sp = l3.speaker_map(sid, library_dir) if sid else {}
    if sp:
        argues = edit["author_argues"].lower()
        if l3.GENERIC_SPEAKER_RE.search(argues):
            probs.append("generic_speaker_name")
        else:
            toks = {t.lower() for i in lesson.get("paragraph_ids") or [] for t in sp.get(i, "").split() if len(t) >= 3}
            if toks and not any(t in argues for t in toks):
                probs.append("speaker_not_named")
    return probs


RECOUNT_RE = re.compile(r"\b(recounts?|describes?|relays?|tells|told|quotes?|says|said|remembers?|reports?|explains that .{0,40} (said|told))\b", re.I)
AUTHOR_VOICE_RE = re.compile(r"\b(argues|claims|believes|contends|asserts|insists)\b", re.I)


def attribution_problems(res: dict) -> list[str]:
    """A character's or other person's words must not be written up as the author's argument."""
    st = (res.get("flags") or {}).get("speaker_type")
    text = (res.get("fields") or {}).get("author_argues") or ""
    if st == "character_dialogue" and (AUTHOR_VOICE_RE.search(text) or not RECOUNT_RE.search(text)):
        return ["character_words_attributed_as_argument: write 'the author recounts <character> saying ...', not 'argues/claims'"]
    if st == "quoted_other" and AUTHOR_VOICE_RE.search(text) and not RECOUNT_RE.search(text):
        return ["quoted_claim_attributed_as_author_claim: say whose claim it is"]
    return []


class Editor:
    def __init__(self, client: Any, model: str = MODEL, cache_path: Path | str = CACHE_PATH,
                 state_path: Path | str | None = None, cap: float = CAP_USD, library_dir: Path = l3.LIB,
                 sleep=time.sleep):
        self.client, self.model, self.cap = client, model, cap
        self.cache_path, self.state_path, self.library_dir, self.sleep = Path(cache_path), state_path, library_dir, sleep
        self.lock = threading.Lock()
        self.cache: dict[str, dict] = {}
        if self.cache_path.exists():
            for line in self.cache_path.read_text(encoding="utf-8").splitlines():
                if line.strip():
                    r = json.loads(line)
                    self.cache[r["key"]] = r["edit"]
        self.stats = {"calls": 0, "cached": 0, "cost_usd": 0.0}

    def estimate(self, lesson: dict) -> float:
        user = render_user(lesson, self.library_dir)
        return state.cost_from_usage(self.model, int((len(SYSTEM_PROMPT) + len(user)) / 4) + 1, 450)

    def _call(self, lesson: dict, extra: str = "") -> EditOut:
        user = render_user(lesson, self.library_dir) + extra
        est = self.estimate(lesson)
        last: Exception | None = None
        for attempt in range(MAX_ATTEMPTS):
            if state.total_cost(self.state_path) + est > self.cap:
                raise state.BudgetExhausted(f"editor cap ${self.cap:.2f} reached")
            state.refuse_to_start(est, self.state_path)
            try:
                resp = self.client.beta.chat.completions.parse(
                    model=self.model, temperature=0,
                    messages=[{"role": "system", "content": SYSTEM_PROMPT}, {"role": "user", "content": user}],
                    response_format=EditOut, max_completion_tokens=MAX_COMPLETION_TOKENS, timeout=TIMEOUT_S)
                nums = v2.usage_numbers(resp.usage)
                usd = state.cost_from_usage(self.model, **nums)
                state.add_cost(lesson.get("source_id") or "editor", usd, "editor", self.state_path,
                               model=self.model, usage=nums)
                with self.lock:
                    self.stats["calls"] += 1
                    self.stats["cost_usd"] += usd
                parsed = resp.choices[0].message.parsed
                if parsed is None:
                    raise ValueError("no parsable output")
                return parsed
            except state.BudgetExhausted:
                raise
            except Exception as exc:  # noqa: BLE001
                last = exc
                if attempt < MAX_ATTEMPTS - 1:
                    self.sleep(2 ** attempt * 2)
        raise RuntimeError(f"editor failed after {MAX_ATTEMPTS} attempts: {type(last).__name__}") from last

    @staticmethod
    def _result(lesson: dict, out: EditOut, problems: list[str]) -> dict:
        """The model's verdict plus the deterministic gates: no verbatim stating sentence, or any flag, drops."""
        res = {"verdict": out.verdict, "drop_reason": out.drop_reason,
               "fields": {f: getattr(out, f) for f in EDITED_FIELDS}, "problems": problems,
               "flags": {"same_in_any_book": out.same_in_any_book, "anecdote_only": out.anecdote_only,
                         "bundled": out.bundled, "act_is_the_lesson": out.act_is_the_lesson,
                         "single_fact_only": out.single_fact_only, "stating_type": out.stating_type,
                         "speaker_type": out.speaker_type, "paragraph_roles": {r.id: r.role for r in out.paragraph_roles}, "stating_sentence": out.stating_sentence}}
        if out.verdict == "keep":
            texts = [p["text"] for p in lesson.get("evidence_paragraphs") or []]
            why = []
            if not sentence_in_text(out.stating_sentence, texts):
                why.append("no_verbatim_stating_sentence")
            roles = {r.id: r.role for r in out.paragraph_roles}
            ids = [p["id"] for p in lesson.get("evidence_paragraphs") or []]
            if out.paragraph_roles:
                bad = [i for i in ids if roles.get(i) in ("scene_or_aside", "unrelated")]
                if bad:
                    why.append("padded_or_bundled_paragraphs:" + ",".join(bad))
                if not any(v in ("states_claim",) for v in roles.values()):
                    why.append("no_paragraph_states_claim")
            if out.stating_type in ("fact_or_statistic", "event_or_scene"):
                why.append("stating_sentence_is_" + out.stating_type)
            why += [f for f in ("same_in_any_book", "anecdote_only", "bundled", "single_fact_only") if getattr(out, f)]
            if why:
                res.update(verdict="drop", drop_reason="gate: " + ", ".join(why) +
                           (f" ({out.drop_reason})" if out.drop_reason else ""))
        return res

    def edit(self, lesson: dict) -> dict:
        """Returns {'verdict','drop_reason','fields','problems'}; one retry when the rewrite fails validation."""
        key = cache_key(lesson, self.model)
        if key in self.cache:
            with self.lock:
                self.stats["cached"] += 1
            return self.cache[key]
        out = self._call(lesson)
        res = self._result(lesson, out, [])
        if res["verdict"] == "keep":
            probs = validate_edit(lesson, res["fields"], self.library_dir) + attribution_problems(res)
            if probs:
                out = self._call(lesson, "\n\nYOUR PREVIOUS REWRITE FAILED THESE CHECKS: " + "; ".join(probs) +
                                 ". Rewrite again, fixing exactly these, or drop the lesson.")
                res = self._result(lesson, out, probs)
                if res["verdict"] == "keep":
                    probs2 = validate_edit(lesson, res["fields"], self.library_dir) + attribution_problems(res)
                    if probs2:
                        res.update(verdict="drop", drop_reason="rewrite_failed_validation: " + "; ".join(probs2),
                                   problems=probs + probs2)
        with self.lock:
            self.cache[key] = res
            self.cache_path.parent.mkdir(parents=True, exist_ok=True)
            with self.cache_path.open("a", encoding="utf-8") as fh:
                fh.write(json.dumps({"key": key, "edit": res}, ensure_ascii=False) + "\n")
        return res



def apply_edit(lesson: dict, res: dict) -> dict:
    out = dict(lesson)
    out["orig"] = {f: lesson.get(f) for f in EDITED_FIELDS}
    out.update(res["fields"])
    out["editor_version"] = EDITOR_VERSION
    return out


def run_editor(lessons: list[dict], editor: Editor, out_dir: Path, workers: int = 4,
               max_cost: float | None = None) -> dict:
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    results: list[Any] = [None] * len(lessons)
    stop = threading.Event()
    errors: list[str] = []

    def work(i: int) -> None:
        if stop.is_set():
            return
        if max_cost is not None and editor.stats["cost_usd"] + editor.estimate(lessons[i]) > max_cost:
            stop.set()
            errors.append(f"max_cost {max_cost} reached")
            return
        try:
            results[i] = editor.edit(lessons[i])
        except state.BudgetExhausted as exc:
            stop.set()
            errors.append(str(exc))
        except RuntimeError as exc:
            errors.append(f"{lessons[i].get('lesson_id')}: {exc}")

    with ThreadPoolExecutor(max_workers=max(1, workers)) as ex:
        list(ex.map(work, range(len(lessons))))
    kept = [apply_edit(l, r) for l, r in zip(lessons, results) if r and r["verdict"] == "keep"]
    dropped = [{"lesson_id": l.get("lesson_id"), "title": l.get("title"), "reason": r["drop_reason"],
                "lesson": l} for l, r in zip(lessons, results) if r and r["verdict"] == "drop"]
    unprocessed = sum(1 for r in results if r is None)

    def dump(name: str, rows: list[dict]) -> None:
        (out_dir / name).write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows), encoding="utf-8")
    dump("edited.jsonl", kept)
    dump("editor_dropped.jsonl", dropped)
    n = len(lessons)
    cost = {"editor_version": EDITOR_VERSION, "model": editor.model, "before": n, "after": len(kept),
            "dropped": len(dropped), "drop_rate": round(len(dropped) / n, 4) if n else None,
            "unprocessed": unprocessed, "api_calls": editor.stats["calls"], "cached": editor.stats["cached"],
            "cost_usd": round(editor.stats["cost_usd"], 6), "errors": errors[:5],
            "library_total_cost_usd": state.total_cost(editor.state_path)}
    (out_dir / "editor_cost.json").write_text(json.dumps(cost, indent=2) + "\n", encoding="utf-8")
    return cost


def main(argv: list[str] | None = None, client: Any = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--lessons", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--max-cost", type=float, default=None)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--state", help="library_state path (tests)")
    ap.add_argument("--cache", help="editor cache path (tests)")
    args = ap.parse_args(argv)
    lessons = [json.loads(l) for l in args.lessons.read_text(encoding="utf-8").splitlines() if l.strip()]
    if args.dry_run:
        ed = Editor(None, cache_path=args.cache or CACHE_PATH, state_path=args.state)
        todo = [l for l in lessons if cache_key(l) not in ed.cache]
        print(f"{len(lessons)} lessons, {len(todo)} not cached, est ${sum(ed.estimate(l) for l in todo):.4f} on {MODEL}")
        return 0
    ed = Editor(client or v2.get_client(), cache_path=args.cache or CACHE_PATH, state_path=args.state)
    print(json.dumps(run_editor(lessons, ed, args.out, args.workers, args.max_cost), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
