"""Build data/solid_words.txt: a modern general-purpose word list from the library's own PDFs.

Source: the text layers of the source PDFs on this machine (no network, no external dictionary).
Two files. solid_words.txt (used by the hyphen rule) = words printed solid at least twice in each of >= 3
books. known_words.txt (used only to judge "suspected glued" words) = words printed solid in >= 2 books.
Rule: a lowercase alphabetic token of 3+ letters counts only when it stands alone (not touching a hyphen or
digit). A word is kept when it appears at least twice in each of >= MIN_BOOKS different books. Words that are
glued or broken in one book therefore never qualify; only words many books print solid do.
Usage: python build_wordlist.py [--pages-per-book 160]
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from multiprocessing import Pool
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
TOKEN_RE = re.compile(r"(?<![\w\-‐‑'’])[a-z]{3,}(?![\w\-‐‑'’])")
MIN_BOOKS = 3


def book_counts(args):
    path, per_book = args
    import fitz
    c: Counter = Counter()
    try:
        doc = fitz.open(path)
    except Exception:
        return c
    n = len(doc)
    step = max(1, n // per_book)
    for i in range(0, n, step):
        c.update(TOKEN_RE.findall(doc[i].get_text("text")))
    return dict(c)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pages-per-book", type=int, default=160)
    a = ap.parse_args()
    man = json.loads((HERE / "library_manifest.json").read_text())
    paths = [str(ROOT / s["path"]) for s in man["sources"] if s["format"] == "pdf" and s["status_hint"] != "duplicate"]
    with Pool(6) as pool:
        results = pool.map(book_counts, [(p, a.pages_per_book) for p in paths])
    books: Counter = Counter()      # word -> books where it appears at least twice
    seen: Counter = Counter()       # word -> books where it appears at all
    for r in results:
        books.update(w for w, k in r.items() if k >= 2)
        seen.update(r.keys())
    words = sorted(w for w, k in books.items() if k >= MIN_BOOKS)
    known = sorted(w for w, k in seen.items() if k >= 2)
    (HERE / "data" / "known_words.txt").write_text("\n".join(known) + "\n", encoding="utf-8")
    print(f"{len(known)} known words (solid in >= 2 books) -> data/known_words.txt")
    out = HERE / "data" / "solid_words.txt"
    out.write_text("\n".join(words) + "\n", encoding="utf-8")
    print(f"{len(words)} words from {len(paths)} PDFs -> {out}")


if __name__ == "__main__":
    main()
