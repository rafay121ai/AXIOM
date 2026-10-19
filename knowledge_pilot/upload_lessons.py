"""Upload the local lesson library to the Knowledge project's `lessons` table. WRITTEN, NOT RUN.

  python upload_lessons.py --dry-run                 # counts and payload size only, no network
  python upload_lessons.py --source SOURCE_ID ...    # only these sources (default: every library/*/lessons.jsonl)

Idempotent per source: for each source it upserts every lesson on lesson_id, then deletes rows of that source whose
lesson_id is no longer in the local file. Re-running a source gives the same table. Uses the service role key from the
environment (KNOWLEDGE_SUPABASE_SERVICE_ROLE_KEY, VITE_KNOWLEDGE_SUPABASE_URL); the key is never printed.
Run sql/create_lessons.sql first. Needs explicit instruction before use: it writes to the live Knowledge project.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
LIB = HERE / "library"
BATCH = 100
COLS = ("lesson_id", "source_id", "source_title", "author", "chapter", "page_start", "page_end", "title",
        "author_argues", "principle", "evidence", "caveat", "short_quote", "applies_when", "example_questions",
        "lesson_type", "origin", "paragraph_ids", "paragraphs", "extraction_version", "prompt_version",
        "editor_version", "model", "pillars")


def rows_for(source_id: str, pillar: str | None, wiki_ids: dict[str, str]) -> list[dict]:
    p = LIB / source_id / "lessons.jsonl"
    out = []
    for line in p.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        l = json.loads(line)
        r = {c: l.get(c) for c in COLS}
        r["pillars"] = l.get("pillars") or []
        r["pillar"] = pillar
        r["wiki_source_id"] = wiki_ids.get(source_id)
        r["embedding"] = "[" + ",".join(f"{x:.6f}" for x in l["embedding"]) + "]"
        out.append(r)
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--source", nargs="*")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--wiki-map", type=Path, default=HERE / "wiki_source_map.json",
                    help="optional {source_id: wiki_sources.id} so lessons link to wiki_sources")
    a = ap.parse_args()
    order = {o["source_id"]: o for o in json.loads((HERE / "library_order.json").read_text())}
    wiki_ids = json.loads(a.wiki_map.read_text()) if a.wiki_map.exists() else {}
    sids = a.source or sorted(p.parent.name for p in LIB.glob("*/lessons.jsonl"))
    total = size = 0
    for sid in sids:
        rows = rows_for(sid, (order.get(sid) or {}).get("pillar"), wiki_ids)
        payload = sum(len(json.dumps(r)) for r in rows)
        total += len(rows)
        size += payload
        if a.dry_run:
            print(f"{sid}: {len(rows)} lessons, {payload / 1e6:.2f} MB payload")
            continue
        import requests
        url = os.environ["VITE_KNOWLEDGE_SUPABASE_URL"].rstrip("/") + "/rest/v1/lessons"
        key = os.environ["KNOWLEDGE_SUPABASE_SERVICE_ROLE_KEY"]
        h = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}
        for i in range(0, len(rows), BATCH):
            r = requests.post(url + "?on_conflict=lesson_id", headers={**h, "Prefer": "resolution=merge-duplicates,return=minimal"},
                              data=json.dumps(rows[i:i + BATCH]), timeout=120)
            r.raise_for_status()
        keep = ",".join(f'"{r["lesson_id"]}"' for r in rows)
        d = requests.delete(url, headers=h, params={"source_id": f"eq.{sid}", "lesson_id": f"not.in.({keep})"}, timeout=120)
        d.raise_for_status()
        print(f"{sid}: upserted {len(rows)}")
    print(f"total {total} lessons, {size / 1e6:.1f} MB payload")
    return 0


if __name__ == "__main__":
    sys.exit(main())
