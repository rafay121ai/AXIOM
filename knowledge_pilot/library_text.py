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
NOTE_DIGIT_RE = re.compile(
    r"(?<=[a-z”\"')])([.!?])\d{1,3}(?=\s+[A-Z“\"]|$)|(?<=[.!?])([\"”’'])\d{1,3}(?=\s+[A-Z“\"]|$)")
# A bare page number left on the end of a paragraph after its final full stop ("... myself.” 69").
TRAILING_PAGE_NO_RE = re.compile(r"(?<=[.!?”\"’')])\s+\d{1,4}$")


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
    text = NOTE_DIGIT_RE.sub(lambda m: (count(m), m.group(1) or m.group(2))[1], text)
    text = TRAILING_PAGE_NO_RE.sub(lambda m: (count(m), "")[1], text)
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


PHOTO_CREDIT_RE = re.compile(
    r"^\(?\s*(?:courtesy of|photo(?:graph)?s? (?:by|courtesy|credit)|photo credit|image credit|credit:|©)", re.I)


def is_photo_credit(text: str) -> bool:
    """A picture credit or caption fragment such as "(Courtesy of the Rockefeller Archive Center)"."""
    t = text.strip()
    return word_count(t) <= 25 and bool(PHOTO_CREDIT_RE.match(t))


def looks_like_index(text: str) -> bool:
    """Index or table-of-pages debris: mostly "Name, 12, 45-47" runs, almost no prose."""
    tokens = text.split()
    if len(tokens) < 20:
        return False
    nums = sum(1 for t in tokens if re.fullmatch(r"\d{1,4}(?:[-–]\d{1,4})?[,;.]?", t))
    sentences = len(re.findall(r"[a-z][.!?][\"”’]?(?:\s|$)", text))
    return nums >= 0.22 * len(tokens) and sentences <= max(1, len(tokens) // 40)


RUNIN_CAPS_RE = re.compile(
    r"^((?:[A-Z0-9#][A-Z0-9’'&.\-/]*[,;]?\s+){2,}[A-Z0-9#][A-Z0-9’'&.\-/]*:?)\s+(?=[\"“‘(]?[A-Z][a-z’'])")


def split_runin_heading(text: str) -> tuple[str, str] | None:
    """Split an ALL-CAPS run-in heading off the front of a paragraph.

    "INVEST FIRST IN EDUCATION: In reality, the only..." -> ("INVEST FIRST IN EDUCATION", "In reality, ...").
    A caps lead-in that ends with a comma ("ON THE CONCORDE BACK TO NEW YORK, Brad tells me") is the
    opening of a sentence, not a heading, and is left alone.
    """
    m = RUNIN_CAPS_RE.match(text)
    if not m:
        return None
    head = m.group(1)
    letters = re.sub(r"[^A-Za-z]", "", head)
    if len(letters) < 10 or len(head.split()) < 3:
        return None
    rest = text[m.end():].strip()
    if word_count(rest) < 5:
        return None
    return head.rstrip(":").strip(), rest


HEADING_FILLER = {"of", "and", "the", "in", "by", "vs", "for", "to", "a", "an", "on", "at", "with", "from", "or",
                  "is", "are", "as", "your", "our", "why", "how", "what", "do", "not", "be", "it", "its"}


def is_heading_like(text: str) -> bool:
    """A short unpunctuated title line ("Market Timing", "THE GODDESS OF GOOD LUCK") that opens what follows."""
    t = text.strip()
    n = word_count(t)
    if not t or n == 0 or n > 10 or "\n" in t or SENTENCE_END_RE.search(t) or t.endswith((",", ";", ":")):
        return False
    if t.startswith(("—", "–", "-", "•", "(", "[")) or is_attribution(t):
        return False
    words = [w for w in t.split() if any(c.isalpha() for c in w)]
    if not words or not t[0].isupper():
        return False
    if t.isupper():
        return True
    return all(w[0].isupper() or w.lower().strip(".,") in HEADING_FILLER or not w[0].isalpha() for w in words)


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


OPTION_RE = re.compile(r"^(?:\(?[a-hA-H][).:]\s|\(?[ivxIVX]{1,4}[).]\s|\d{1,2}[).]\s|[•●▪–—*-]\s|(?:Lesson|Step|Rule|Principle|Tip)\s*#\s*\d+\b|(?:OR|AND)$)")


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


# ----------------------------------------------------------------------------
# Glued-word repair (a space or hyphen lost inside the source text itself)
# ----------------------------------------------------------------------------

_GLUE_TOKEN_RE = re.compile(r"\b[A-Za-z]{7,}\b")
_HYPHEN_FORM_RE = re.compile(r"\b[A-Za-z]+(?:-[A-Za-z]+)+\b")
SAFE_HYPHEN_PREFIXES = ("self", "well", "long", "short", "high", "low", "half", "full", "ever", "ill", "old",
                        "three", "four", "five", "six", "seven", "eight", "nine", "ten", "twenty", "thirty",
                        "forty", "fifty", "sixty", "seventy", "eighty", "ninety", "hundred", "first", "second",
                        "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth", "one")
_OPEN_PARTS = {"hyper", "under", "super", "inter", "intra", "extra", "ultra", "micro", "macro", "mega", "semi",
               "anti", "counter", "cross", "after", "fore", "multi", "trans", "every", "other", "water", "world",
               "wheel", "worth"}
_OPEN_TAILS = {"while", "chair", "place", "where", "thing", "times", "ships", "ward", "wards", "wise", "like",
               "ness", "ship", "hood", "able", "ible", "ment", "ments", "ways", "side", "sides"}
_INFLECTIONS = (("ies", "y"), ("ied", "y"), ("ing", ""), ("ing", "e"), ("ed", ""), ("ed", "e"), ("es", ""),
                ("s", ""), ("ly", ""), ("er", ""), ("ers", ""), ("est", ""), ("ness", ""), ("ment", ""),
                ("ments", ""), ("ally", "al"), ("ier", "y"), ("iest", "y"))


# A lost space almost always sits before a function word ("steppedacross", "walkedthrough").
_GLUE_FUNCTION_WORDS = {"across", "about", "around", "before", "between", "because", "through", "without",
                        "within", "toward", "towards", "against", "after", "under", "other", "there", "where",
                        "their", "which", "would", "could", "should", "while", "along", "among", "behind",
                        "beyond", "during", "except", "inside", "outside", "until", "upon", "with", "from",
                        "into", "over", "that", "this", "than", "then", "when", "what", "were", "they"}


def is_known_word(token: str, words: frozenset[str]) -> bool:
    """Dictionary word, allowing common inflections (the system list has few)."""
    if token in words:
        return True
    for suf, repl in _INFLECTIONS:
        if token.endswith(suf) and len(token) - len(suf) >= 3:
            stem = token[: -len(suf)] + repl
            if stem in words or (len(stem) > 3 and stem[-1] == stem[-2] and stem[:-1] in words):
                return True
    return False


def repair_glued_words(texts: list[str], words: frozenset[str] | None = None) -> tuple[list[str], dict[str, str]]:
    """Fix compounds the SOURCE printed glued ("steppedacross", "threemonth", "havenots").

    Evidence only, in this order, and never for a dictionary word or a majority spelling:
      A. the same document writes it hyphenated at least as often as solid -> use that hyphen form;
      B. a safe number/ordinal/self/well... prefix + dictionary word -> prefix-word;
      C. a rare token (<=2 uses) of a dictionary word + a function word ("steppedacross") -> two words.
    Returns (new texts, {glued: replacement}).
    """
    words = words if words is not None else dictionary()
    if not words:
        return texts, {}
    from collections import Counter
    freq: Counter = Counter()
    twins: dict[str, Counter] = {}
    for t in texts:
        for m in _GLUE_TOKEN_RE.finditer(t):
            freq[m.group(0).lower()] += 1
        for m in _HYPHEN_FORM_RE.finditer(t):
            twins.setdefault(m.group(0).lower().replace("-", ""), Counter())[m.group(0).lower()] += 1
    fixes: dict[str, str] = {}
    for tok, n in freq.items():
        if len(tok) < 7 or is_known_word(tok, words):
            continue
        twin = twins.get(tok)
        if twin and sum(twin.values()) >= n:
            fixes[tok] = twin.most_common(1)[0][0]
            continue
        if n > 2:
            continue
        pre = next((p for p in SAFE_HYPHEN_PREFIXES if tok.startswith(p) and len(tok) - len(p) >= 4
                    and tok[len(p):] in words), None)
        if pre:
            fixes[tok] = f"{pre}-{tok[len(pre):]}"
            continue
        for i in range(4, len(tok) - 3):
            a, b = tok[:i], tok[i:]
            if is_known_word(a, words) and b in _GLUE_FUNCTION_WORDS and a not in _OPEN_PARTS:
                fixes[tok] = f"{a} {b}"
                break
    if not fixes:
        return texts, {}

    def sub(m: re.Match) -> str:
        rep = fixes.get(m.group(0).lower())
        if rep is None:
            return m.group(0)
        return rep[0].upper() + rep[1:] if m.group(0)[0].isupper() else rep

    return [_GLUE_TOKEN_RE.sub(sub, t) for t in texts], fixes


_ART_TOKEN_RE = re.compile(r"^[\s+|\\/_<>^\-=*~]*$")


def strip_ascii_diagram(text: str) -> tuple[str, str]:
    """Remove ASCII-art boxes and arrows ("+-----+", "--->", "|____|") from a paragraph.

    Returns (text without the art, removed art). Prose around the art is kept. If what is left is only
    a few unpunctuated label words (the diagram's labels), the whole thing was a figure: return ("", all).
    """
    kept, art = [], []
    for tok in text.split():
        stripped = tok.strip("|")
        if _ART_TOKEN_RE.match(tok) and len(tok) >= 2 or re.fullmatch(r"[+|]?-{3,}[+>|]?", tok):
            art.append(tok)
        else:
            kept.append(stripped if stripped else tok)
    cleaned = " ".join(kept).strip()
    if word_count(cleaned) <= 25 and not SENTENCE_END_RE.search(cleaned):
        return "", text
    return cleaned, " ".join(art)
