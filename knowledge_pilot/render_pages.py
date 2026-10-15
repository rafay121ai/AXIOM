"""Visual check helper: render random BODY pages of a source next to what the extractor made of them.

    python render_pages.py --source ID --n 4 --seed S

Body pages are pages that contributed at least one paragraph (page_start of a paragraph in
library/<id>/paragraphs_<version>.jsonl). For each picked page N this writes
    visual_check/<id>/page_<N>.png      the page at ~110 dpi
    visual_check/<id>/page_<N>.json     the paragraphs extracted from that page (id, text)
so an auditor can compare image against extraction page by page. A paragraph that starts on page N and runs
onto N+1 is listed under N (its page_start); `continues_to` tells the auditor where it ends.
Page numbers are PDF page indexes, 1 based.
"""

from __future__ import annotations

import argparse
import json
import random
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import library_paragraphs as lp  # noqa: E402

DPI = 110


def pick_pages(paragraphs: list[dict], n: int, seed: int) -> list[int]:
    pages = sorted({p["page_start"] for p in paragraphs if p.get("page_start")})
    rng = random.Random(seed)
    return sorted(rng.sample(pages, min(n, len(pages))))


def render(source_id: str, n: int, seed: int, version: str = "v3.1", lib_root: Path | None = None,
           out_root: Path | None = None, pages: list[int] | None = None) -> list[Path]:
    import fitz
    lib_root = lib_root or HERE / "library"
    out_root = out_root or HERE / "visual_check"
    paras = lp.read_jsonl(lib_root / source_id / f"paragraphs_{version}.jsonl")
    if not paras:
        raise SystemExit(f"no paragraphs_{version}.jsonl for {source_id}; run extract.py first")
    entry = lp.manifest_entry(source_id)
    doc = fitz.open(lp.source_path(entry))
    out = out_root / source_id
    out.mkdir(parents=True, exist_ok=True)
    written = []
    for page in (pages or pick_pages(paras, n, seed)):
        png = out / f"page_{page}.png"
        doc[page - 1].get_pixmap(dpi=DPI).save(png)
        items = [{"id": p["id"], "text": p["text"], "chapter": p["chapter"], "section": p["section"],
                  "continues_to": p["page_end"] if p.get("page_end") and p["page_end"] != page else None}
                 for p in paras if p.get("page_start") == page]
        (out / f"page_{page}.json").write_text(
            json.dumps({"source_id": source_id, "page": page, "paragraphs": items}, indent=2, ensure_ascii=False),
            encoding="utf-8")
        written.append(png)
    return written


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", required=True)
    ap.add_argument("--n", type=int, default=4)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--version", default="v3.1")
    ap.add_argument("--out-dir", default=None, help="output root (default visual_check/)")
    ap.add_argument("--pages", default=None, help="comma separated exact PDF pages instead of random ones")
    a = ap.parse_args()
    out = Path(a.out_dir) if a.out_dir else None
    if out and not out.is_absolute():
        out = HERE / out
    pages = [int(x) for x in a.pages.split(",")] if a.pages else None
    for p in render(a.source, a.n, a.seed, a.version, out_root=out, pages=pages):
        print(p)


if __name__ == "__main__":
    main()
