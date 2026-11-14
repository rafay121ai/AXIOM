"""Load one local book into the live Knowledge library: one wiki_sources row and its wiki_chunks passages.

  python load_book_chunks.py --dry-run     # chunks the book and prints counts, sizes and a cost estimate; no network
  python load_book_chunks.py               # writes to the LIVE Knowledge project (needs explicit instruction)

Built for the books that have lessons but no live passages (first: The Psychology of Money, Nov 14). Passages are whole
paragraphs from the extracted book, never split, never across a chapter, about 2,000 to 3,300 characters like the live
ones. Embeddings are text-embedding-3-small at 1536 dimensions, the same as every live chunk. Keys come from the
environment and are never printed. Re-running replaces this source's chunks only: nothing else is touched.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
BOOKS = {
    "money-game-books-psychology-of-money": {
        "pillar": "money_game", "title": "The Psychology of Money", "author": "Morgan Housel",
        "source_key": "money-game-book-the-psychology-of-money",
    },
}
TARGET = 3000   # close a passage once adding the next paragraph would pass this
MIN_TAIL = 1500  # a shorter last passage of a chapter joins the one before it, up to JOIN_MAX
JOIN_MAX = 3400
EMBED_BATCH = 32


def passages(source_id: str) -> list[str]:
    paras = [json.loads(l) for l in (HERE / "library" / source_id / "paragraphs_v3.2.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()]
    out: list[tuple[str, str]] = []  # (chapter, text)
    cur, chapter = "", None
    for p in paras:
        if p.get("kind") != "body" or not p["text"].strip():
            continue
        if cur and (p.get("chapter") != chapter or len(cur) + len(p["text"]) + 1 > TARGET):
            out.append((chapter, cur))
            cur = ""
        chapter = p.get("chapter")
        cur = (cur + "\n\n" + p["text"].strip()) if cur else p["text"].strip()
    if cur:
        out.append((chapter, cur))
    merged: list[tuple[str, str]] = []
    for ch, t in out:
        if merged and merged[-1][0] == ch and len(t) < MIN_TAIL and len(merged[-1][1]) + len(t) + 2 <= JOIN_MAX:
            merged[-1] = (ch, merged[-1][1] + "\n\n" + t)
        else:
            merged.append((ch, t))
    return [t for _, t in merged]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--source", default="money-game-books-psychology-of-money", choices=sorted(BOOKS))
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    meta = BOOKS[a.source]
    texts = passages(a.source)
    chars = [len(t) for t in texts]
    est_tokens = sum(chars) / 4
    print(f"{a.source}: {len(texts)} passages, {min(chars)} to {max(chars)} chars (median {sorted(chars)[len(chars) // 2]}), "
          f"about {est_tokens / 1e3:.0f}k tokens, about ${est_tokens / 1e6 * 0.02:.4f} to embed")
    if a.dry_run:
        return 0

    import requests
    base = os.environ["VITE_KNOWLEDGE_SUPABASE_URL"].rstrip("/") + "/rest/v1/"
    key = os.environ["KNOWLEDGE_SUPABASE_SERVICE_ROLE_KEY"]
    h = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}

    embeddings: list[list[float]] = []
    for i in range(0, len(texts), EMBED_BATCH):
        r = requests.post("https://api.openai.com/v1/embeddings", timeout=120,
                          headers={"Authorization": f"Bearer {os.environ['OPENAI_API_KEY']}"},
                          json={"model": "text-embedding-3-small", "input": texts[i:i + EMBED_BATCH]})
        r.raise_for_status()
        embeddings += [d["embedding"] for d in sorted(r.json()["data"], key=lambda d: d["index"])]
    assert len(embeddings) == len(texts) and all(len(e) == 1536 for e in embeddings)

    found = requests.get(base + "wiki_sources", headers=h, params={"select": "id", "source_key": f"eq.{meta['source_key']}"}, timeout=60)
    found.raise_for_status()
    if found.json():
        source_id = found.json()[0]["id"]
    else:
        made = requests.post(base + "wiki_sources", headers={**h, "Prefer": "return=representation"}, timeout=60, data=json.dumps({
            "pillar": meta["pillar"], "content_type": "book", "title": meta["title"], "author": meta["author"],
            "source_key": meta["source_key"], "enrichment_status": "raw", "is_core_library": True}))
        made.raise_for_status()
        source_id = made.json()[0]["id"]

    # Only this source's own chunks are replaced on a re-run.
    requests.delete(base + "wiki_chunks", headers=h, params={"source_id": f"eq.{source_id}"}, timeout=120).raise_for_status()
    rows = [{"source_id": source_id, "pillar": meta["pillar"], "content_type": "book", "title": meta["title"], "author": meta["author"],
             "chunk_index": i, "key_frameworks": t, "embedding": "[" + ",".join(f"{x:.7f}" for x in e) + "]"}
            for i, (t, e) in enumerate(zip(texts, embeddings))]
    for i in range(0, len(rows), 25):
        requests.post(base + "wiki_chunks", headers={**h, "Prefer": "return=minimal"}, data=json.dumps(rows[i:i + 25]), timeout=120).raise_for_status()
    print(f"loaded {len(rows)} passages for source {source_id}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
