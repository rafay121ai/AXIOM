"""Deterministic text rules shared by extraction, chunking and qa_check.

No network, no PDF dependency. Everything here is pure string logic so it is
unit-testable and so qa_check judges chunks by the same rules that built them.
"""

from __future__ import annotations

import re
from functools import lru_cache
from pathlib import Path

PIPELINE_VERSION = "library-2026.10.a1"

WORD_RE = re.compile(r"\b[\w’'-]+\b")
SENTENCE_END_RE = re.compile(r'[.!?…]["”’\')\]*]*$')

DASH_CHARS = "—–―"  # em, en, horizontal bar


def word_count(text: str) -> int:
    return len(WORD_RE.findall(text))


def is_sentence_complete(text: str) -> bool:
    return bool(SENTENCE_END_RE.search(text.strip()))


# ----------------------------------------------------------------------------
# Line joining (hyphen rule)
# ----------------------------------------------------------------------------

def join_lines(lines: list[str]) -> str:
    """Join physical lines into one paragraph string.

    A line that ends in a hyphen keeps the hyphen and is joined with no space,
    so "self-" + "control" -> "self-control". A line ending in an em or en dash
    also joins with no space. A soft hyphen (U+00AD) at a line end is a
    discretionary break, not a hyphen, and is removed. Everything else joins
    with one space.
    """
    out = ""
    for raw in lines:
        line = raw.replace("￾", "").replace(" ", " ").strip()
        if not line:
            continue
        if not out:
            out = line
            continue
        if out.endswith("\xad"):
            out = out[:-1] + line
        elif re.search(r"\w[-‐‑]$", out) and not out.endswith(" -"):
            out = out + line
        elif out[-1] in DASH_CHARS:
            out = out + line
        else:
            out = out + " " + line
    out = out.replace("\xad", "")
    return re.sub(r"\s+", " ", out).strip()


def clean_inline(text: str) -> str:
    text = text.replace("￾", "").replace("\xad", "").replace(" ", " ")
    return re.sub(r"\s+", " ", text).strip()


# ----------------------------------------------------------------------------
# Footnote markers
# ----------------------------------------------------------------------------

# A star or dagger glued to the end of a word/punctuation and followed by space,
# closing bracket, punctuation or end of text. "A**hole" (censoring) is kept
# because the stars sit between letters.
FOOTNOTE_MARK_RE = re.compile(
    r"(?<=[\w.,;:!?)\]”’\"'])[*†‡§]+(?=[\s)\]”’\"',.;:!?]|$)")
SUPERSCRIPT_DIGITS = str.maketrans("", "", "¹²³⁰⁴⁵⁶⁷⁸⁹")
# Digits glued to sentence-final punctuation before a capital: "time.12 The".
NOTE_DIGIT_RE = re.compile(r"(?<=[a-z”\"')])([.!?])\d{1,3}(?=\s+[A-Z“\"]|$)")


def strip_footnote_markers(text: str) -> tuple[str, int]:
    """Remove footnote reference markers. Returns (text, markers_removed)."""
    removed = 0

    def count(match: re.Match) -> str:
        nonlocal removed
        removed += 1
        return ""

    text = FOOTNOTE_MARK_RE.sub(count, text)
    before = text
    text = text.translate(SUPERSCRIPT_DIGITS)
    removed += len(before) - len(text)
    text = NOTE_DIGIT_RE.sub(lambda m: (count(m), m.group(1))[1], text)
    text = re.sub(r"\s+([,.;:!?])", r"\1", text) if removed else text
    return re.sub(r"\s{2,}", " ", text).strip(), removed


# ----------------------------------------------------------------------------
# Captions, datelines, attribution lines, scene breaks
# ----------------------------------------------------------------------------

FIGURE_CAPTION_RE = re.compile(
    r"^(?:Figure|Fig\.|Table|Chart|Exhibit|Graph|Illustration)\s+"
    r"(\d+(?:[.\-]\d+)*[a-z]?)(?:(\s*[:.\u2014\u2013-]\s*)(.*)|\s+(.*))?$", re.IGNORECASE)
_TITLE_FILLER = {"of", "and", "the", "in", "by", "vs", "vs.", "for", "to", "a", "an", "on", "at", "with", "from", "per", "or"}
MONTHS = r"(?:January|February|March|April|May|June|July|August|September|October|November|December)"
DATELINE_RE = re.compile(
    rf"^(?:{MONTHS}\s+\d{{1,2}}(?:st|nd|rd|th)?,?\s+\d{{4}}|\d{{1,2}}\s+{MONTHS}\s+\d{{4}}"
    rf"|{MONTHS}\s+\d{{4}}|(?:Early|Late|Mid)[- ]\w+\s+\d{{4}}"
    rf"|[A-Z][A-Za-z.'’ ]+,\s+(?:[A-Z][A-Za-z.'’ ]+,\s+)?{MONTHS}\s+\d{{1,2}}(?:,\s+\d{{4}})?"
    rf"|(?:[A-Z][A-Za-z.'’ ]+,\s+){{1,2}}(?:19|20)\d{{2}})\.?$")
ATTRIBUTION_RE = re.compile(r"^[—–―-]{1,2}\s*[A-Z][^.!?]{1,80}$")
SCENE_BREAK_RE = re.compile(r"^(?:\*\s*){3,}$|^(?:[#•·~=_-]\s*){3,}$|^\*\s*\*\s*\*$|^#$")


def is_figure_caption(text: str) -> bool:
    """True for a bare caption line like "Figure 5.3: Tiffany Stock Price"."""
    t = text.strip()
    m = FIGURE_CAPTION_RE.match(t)
    if not m or word_count(t) > 18:
        return False
    if m.group(3) is not None:  # "Figure 5.3: Title" with an explicit separator
        title = re.sub(r"\b(?:vs|inc|co|corp|ltd|st|no|dr|mr|mrs|ms|u\.s|etc|e\.g|i\.e)\.", "x", m.group(3), flags=re.I)
        return not re.search(r"[.!?]\s+\S", title)
    rest = (m.group(4) or "").strip()  # "Figure 5.3 Title Case Words" or bare "Figure 9.6"
    if not rest:
        return True
    return not rest.endswith((".", "?", "!")) and all(
        w[0].isupper() or w[0].isdigit() or w.lower() in _TITLE_FILLER or not w[0].isalpha()
        for w in rest.split())


def is_dateline(text: str) -> bool:
    return word_count(text) <= 8 and bool(DATELINE_RE.match(text.strip()))


def is_attribution(text: str) -> bool:
    return bool(ATTRIBUTION_RE.match(text.strip()))


def is_scene_break(text: str) -> bool:
    return bool(SCENE_BREAK_RE.match(text.strip()))


# ----------------------------------------------------------------------------
# Self-containment: continuation openers and lead-ins
# ----------------------------------------------------------------------------

_OPEN_Q = "\"'“‘(["
_CONNECTIVES = (
    r"But|And|Or|Nor|Yet|So|Then|Which|Whose|Whom|Another|Also|Still|Thus|Therefore|"
    r"However|Moreover|Furthermore|Meanwhile|Instead|Otherwise|Hence|Besides|Likewise|"
    r"Similarly|Conversely|Alternatively|Nonetheless|Nevertheless|Consequently|Accordingly|"
    r"Such|Afterward|Afterwards|Thereafter|"
    r"For example|For instance|In addition|In contrast|By contrast|In other words|"
    r"On the other hand|That said|That is|Even so|At the same time|As a result|"
    r"As such|In turn|In fact|In short|In sum|Or so|Not only|Second|Secondly|Third|Thirdly|"
    r"Fourth|Fifth|Lastly|Finally|Of course|After all|Even then|Still more|What is more|"
    r"More important|Most important|Put differently|Put another way|"
    r"The second|The third|The fourth|The fifth|The sixth|The seventh|The eighth|The ninth|"
    r"The tenth|The latter|The former|The above|The preceding"
)
_PRONOUNS = r"He|She|His|Her|Hers|Him|They|Their|Them|Theirs|It|Its|This|That|These|Those"
CONTINUATION_RE = re.compile(rf"^[{re.escape(_OPEN_Q)}]*(?:{_CONNECTIVES})\b(?!['’]s\b)")
PRONOUN_OPEN_RE = re.compile(rf"^[{re.escape(_OPEN_Q)}]*(?:{_PRONOUNS})\b")
IMPERSONAL_IT_RE = re.compile(
    r"^It(?: later)? (?:became fashionable to say|(?:is|was|may be|might be|would be) "
    r"(?:possible|impossible|easy|hard|difficult|important|tempting|natural|worth|no|not|"
    r"a (?:mistake|common|good|bad)|true|clear|unclear|time|better|worse|likely|unlikely)|"
    r"(?:is|was) (?:said|argued|reported|believed|estimated|assumed|widely|often|a|an|the)|"
    r"seems|seemed|takes|took|turns out|turned out|happened|happens|rained|snowed)\b")
IMPERSONAL_THERE_RE = re.compile(r"^There (?:is|are|was|were|has|have|had|will|would|might|may|can|could|exist)\b")
# "That" as a determiner of a new sentence subject is still dependent. "This" likewise.


def opens_dependent(text: str) -> bool:
    """True if a passage opens on a continuation word or unresolved pronoun."""
    t = text.lstrip()
    if not t:
        return False
    if PRONOUN_OPEN_RE.match(t):
        if IMPERSONAL_IT_RE.match(t.lstrip(_OPEN_Q)) or IMPERSONAL_THERE_RE.match(t.lstrip(_OPEN_Q)):
            return False
        return True
    if CONTINUATION_RE.match(t):
        return True
    first = t.lstrip(_OPEN_Q)
    # Starts mid-sentence in lowercase (but allow brands like iPhone, eBay, e.g.).
    if first and first[0].islower() and not re.match(r"^[a-z]+[A-Z]|^[a-z]\.[a-z]\.", first):
        return True
    return False


LEAD_IN_COLON_RE = re.compile(r":[\"'”’)\]]*$")
LEAD_IN_PHRASE_RE = re.compile(
    r"(?i)\b(?:here (?:are|is)|consider the following|the following|as follows|these are|"
    r"look at (?:these|the following)|for example|such as|including)\b[^.!?]*$")


def ends_with_lead_in(text: str) -> bool:
    """True when a passage ends on a lead-in whose content comes next."""
    t = text.strip()
    if not t:
        return False
    if LEAD_IN_COLON_RE.search(t):
        return True
    last_para = t.split("\n\n")[-1].strip()
    last = re.split(r"(?<=[.!?])\s+", last_para)[-1]
    if not is_sentence_complete(last_para) and LEAD_IN_PHRASE_RE.search(last):
        return True
    return False


OPTION_RE = re.compile(r"^(?:\(?[a-hA-H][).:]\s|\(?[ivxIVX]{1,4}[).]\s|\d{1,2}[).]\s|[•●▪–—*-]\s|(?:OR|AND)$)")


def is_list_item(text: str) -> bool:
    return bool(OPTION_RE.match(text.strip()))


OUTCOME_RE = re.compile(
    r"^(?:In the end|In the years|Eventually|Ultimately|As a result|The result|The upshot|"
    r"The outcome|Today|By the end|Years later|Months later|Weeks later|Afterward|Finally|"
    r"To this day|In hindsight|In retrospect)\b")


# ----------------------------------------------------------------------------
# Dictionary (for the conservative lost-hyphen check only)
# ----------------------------------------------------------------------------

@lru_cache(maxsize=1)
def dictionary() -> frozenset[str]:
    path = Path("/usr/share/dict/words")
    if not path.exists():
        return frozenset()
    return frozenset(w.strip().lower() for w in path.read_text(errors="ignore").splitlines() if w.strip())
