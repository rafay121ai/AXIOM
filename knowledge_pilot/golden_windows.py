"""Golden-set reading windows (offline, seeded). Reads library/<id>/paragraphs_v3.2.jsonl + headings_v3.2.jsonl.

Picks about 12 windows of about 2,000 words (paragraph boundaries only, inside one chapter, preferring
heading breaks), each with the last 2 paragraphs of the previous window as CONTEXT ONLY.
Writes golden/windows.json and golden/windows_text/<window_id>.txt. No API, no database.

Note: no academic papers exist in the library, so the 'paper' slot uses 7 Powers (a framework-heavy
business strategy book) as a stand-in.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import random
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
LIB = HERE / "library"
GOLDEN = HERE / "golden"
SEED = 7
VERSION = "v3.2"
TARGET, LO, HI = 2000, 1500, 2600
CONTEXT_N = 2

# (short name, source_id, type, number of windows)
PLAN = [
    ("rich-dad", "money-game-books-rich-dad-poor-dad", "dialogue", 3),
    ("chasm", "how-companies-win-books-crossing-the-chasm", "argument", 3),
    ("tfas", "human-mind-books-thinking-fast-and-slow", "data-heavy", 2),
    ("ai-econ", "transcripts-plain-english-ai-economics", "transcript", 2),
    ("7powers", "how-companies-win-books-7-powers-the-foundations-of-business-strategy", "paper-stand-in", 2),
]
NOTE = ("No papers exist in the library. 7 Powers (source type 'paper-stand-in') stands in for the paper slot.")

NON_BODY_CHAPTER = re.compile(r"acknowledg|about the author|index|bibliograph|appendix|^notes?$|glossary|"
                              r"preface|foreword|contents|copyright|also by|praise", re.I)
FIGURE_RE = re.compile(r"\b(?:Figure|Fig\.|Table|Exhibit)\s+\d", re.I)


def read_jsonl(path: Path) -> list[dict]:
    if not path.exists():
        return []
    return [json.loads(l) for l in path.read_text(encoding="utf-8").splitlines() if l.strip()]


def load_source(source_id: str, library_dir: Path = LIB) -> tuple[list[dict], set[str], dict]:
    d = library_dir / source_id
    paras = read_jsonl(d / f"paragraphs_{VERSION}.jsonl")
    heads = {h["before_paragraph"] for h in read_jsonl(d / f"headings_{VERSION}.jsonl") if h.get("before_paragraph")}
    notes_path = d / f"extraction_notes_{VERSION}.json"
    notes = json.loads(notes_path.read_text(encoding="utf-8")) if notes_path.exists() else {}
    return paras, heads, notes


def build_windows(paras: list[dict], heading_before: set[str], target: int = TARGET) -> list[list[dict]]:
    """Greedy windows per chapter. The break is the heading boundary (else the paragraph boundary)
    closest to the target inside [LO, HI] words. A short tail joins the previous window if it fits."""
    chapters: list[list[dict]] = []
    for p in paras:
        if p.get("kind", "body") != "body":
            continue
        if not chapters or chapters[-1][0]["chapter"] != p["chapter"]:
            chapters.append([])
        chapters[-1].append(p)
    out: list[list[dict]] = []
    for ch in chapters:
        i = 0
        while i < len(ch):
            total, j, best = 0, i, None
            cands = []   # (score, end_exclusive)
            while j < len(ch):
                total += ch[j]["word_count"]
                j += 1
                if total >= LO:
                    nxt_heading = j < len(ch) and ch[j]["id"] in heading_before
                    nxt_section = j < len(ch) and ch[j].get("section") != ch[j - 1].get("section")
                    bonus = 400 if nxt_heading else (250 if nxt_section else 0)
                    cands.append((abs(total - target) - bonus, j, total))
                if total >= HI:
                    break
            if cands and j < len(ch) or (cands and total >= LO):
                best = min(cands)
                end, words = best[1], best[2]
            else:
                end, words = len(ch), sum(p["word_count"] for p in ch[i:])
            rest = sum(p["word_count"] for p in ch[end:])
            if 0 < rest < LO * 0.5:       # absorb a short tail if it keeps the window within HI + a little
                if words + rest <= HI + 300:
                    end, words = len(ch), words + rest
            out.append(ch[i:end])
            i = end
    return out


def window_flags(win: list[dict], notes: dict) -> list[str]:
    reasons = []
    pages = set()
    for p in win:
        a, b = p.get("page_start") or p.get("page"), p.get("page_end") or p.get("page")
        if a is not None:
            pages.update(range(a, (b or a) + 1))
    eq = notes.get("equation_or_diagram") or []
    if any(isinstance(x, int) and x in pages for x in eq):
        reasons.append("equation_or_diagram_page")
    if any(FIGURE_RE.search(p["text"]) for p in win):
        reasons.append("figure_or_table_reference")
    if NON_BODY_CHAPTER.search(win[0]["chapter"] or ""):
        reasons.append("front_or_back_matter_chapter")
    if any(p.get("kind", "body") != "body" for p in win):
        reasons.append("non_body_paragraph")
    return reasons


def eligible(windows: list[list[dict]], notes: dict) -> list[tuple[int, list[dict]]]:
    out = []
    for k, w in enumerate(windows):
        words = sum(p["word_count"] for p in w)
        if LO * 0.9 <= words <= HI + 300 and not window_flags(w, notes):
            out.append((k, w))
    return out


def window_hash(paras: list[dict]) -> str:
    return hashlib.sha256("\n".join(f"{p['id']}|{p['text']}" for p in paras).encode()).hexdigest()[:16]


def pick(source_id: str, short: str, n: int, seed: int = SEED, library_dir: Path = LIB) -> list[dict]:
    paras, heads, notes = load_source(source_id, library_dir)
    wins = build_windows(paras, heads)
    elig = eligible(wins, notes)
    if len(elig) < n:
        raise RuntimeError(f"{source_id}: only {len(elig)} eligible windows, need {n}")
    # Skip the first and last 10% of the book (intro/epilogue style text) when enough remain.
    lo, hi = len(wins) * 0.1, len(wins) * 0.9
    core = [e for e in elig if lo <= e[0] < hi]
    pool = core if len(core) >= n else elig
    rng = random.Random(f"{seed}:{source_id}")
    chosen = sorted(rng.sample(pool, n), key=lambda e: e[0])
    out = []
    for k, w in chosen:
        prev = wins[k - 1] if k > 0 and wins[k - 1][0]["chapter"] == w[0]["chapter"] else []
        ctx = prev[-CONTEXT_N:]
        pages = [p.get("page_start") or p.get("page") for p in w] + [p.get("page_end") or p.get("page") for p in w]
        pages = [x for x in pages if x is not None]
        out.append({
            "window_id": f"{short}_{w[0]['id'].rsplit('_', 1)[1]}",
            "source_id": source_id,
            "chapter": w[0]["chapter"],
            "sections": sorted({p["section"] for p in w if p.get("section")}),
            "paragraph_ids": [p["id"] for p in w],
            "context_ids": [p["id"] for p in ctx],
            "word_count": sum(p["word_count"] for p in w),
            "context_word_count": sum(p["word_count"] for p in ctx),
            "page_start": min(pages) if pages else None,
            "page_end": max(pages) if pages else None,
            "hash": window_hash(ctx + w),
            "_paras": w, "_ctx": ctx,
        })
    return out


def render_text(win: dict) -> str:
    lines = [f"WINDOW {win['window_id']}  SOURCE {win['source_id']}  CHAPTER {win['chapter']}  "
             f"WORDS {win['word_count']}", ""]
    if win["_ctx"]:
        lines.append("CONTEXT ONLY (end of the previous window; do not write lessons from these)")
        lines += [f"[{p['id']}] {p['text']}" for p in win["_ctx"]]
        lines.append("")
    lines.append("PARAGRAPHS")
    lines += [f"[{p['id']}] {p['text']}" for p in win["_paras"]]
    return "\n".join(lines) + "\n"


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--seed", type=int, default=SEED)
    ap.add_argument("--out", type=Path, default=GOLDEN)
    args = ap.parse_args(argv)
    all_w: list[dict] = []
    for short, sid, typ, n in PLAN:
        for w in pick(sid, short, n, args.seed):
            w["source_type"] = typ
            all_w.append(w)
    (args.out / "windows_text").mkdir(parents=True, exist_ok=True)
    public = []
    for w in all_w:
        (args.out / "windows_text" / f"{w['window_id']}.txt").write_text(render_text(w), encoding="utf-8")
        public.append({k: v for k, v in w.items() if not k.startswith("_")})
    doc = {"seed": args.seed, "extraction": VERSION, "note": NOTE,
           "total_words": sum(w["word_count"] for w in public), "windows": public}
    (args.out / "windows.json").write_text(json.dumps(doc, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    for w in public:
        print(f"{w['window_id']:22} {w['source_type']:15} {w['word_count']:5}w  {w['chapter'][:50]}")
    print("total words", doc["total_words"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
