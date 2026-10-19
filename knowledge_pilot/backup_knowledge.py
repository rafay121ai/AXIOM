"""Export wiki_chunks, wiki_sources, source_learning_maps from the Knowledge project to JSONL (read only).
Keys come from /Users/rafayessani/AXIOM/.env and are never printed."""
import hashlib, json, sys, time
from pathlib import Path
import requests
from dotenv import dotenv_values

OUT = Path("/Users/rafayessani/AXIOM-backups/2026-10-19/knowledge")
OUT.mkdir(parents=True, exist_ok=True)
env = dotenv_values("/Users/rafayessani/AXIOM/.env")
BASE = env["VITE_KNOWLEDGE_SUPABASE_URL"].rstrip("/") + "/rest/v1/"
KEY = env["KNOWLEDGE_SUPABASE_SERVICE_ROLE_KEY"]
H = {"apikey": KEY, "Authorization": f"Bearer {KEY}"}
PAGE = {"wiki_chunks": 200, "wiki_sources": 100, "source_learning_maps": 500}
res = {}
for table, page in PAGE.items():
    r = requests.head(BASE + table, headers={**H, "Prefer": "count=exact"}, params={"select": "id"}, timeout=60)
    live = int(r.headers["content-range"].split("/")[1])
    path, seen, n = OUT / f"{table}.jsonl", set(), 0
    with path.open("w", encoding="utf-8") as fh:
        off = 0
        while True:
            for attempt in range(4):
                try:
                    g = requests.get(BASE + table, headers=H, params={"select": "*", "order": "id", "limit": page, "offset": off}, timeout=180)
                    g.raise_for_status()
                    break
                except Exception:
                    if attempt == 3:
                        raise
                    time.sleep(5)
            rows = g.json()
            if not rows:
                break
            for row in rows:
                seen.add(row["id"])
                fh.write(json.dumps(row, ensure_ascii=False) + "\n")
                n += 1
            off += page
    sha = hashlib.sha256(path.read_bytes()).hexdigest()
    res[table] = {"live_count": live, "file_rows": n, "unique_ids": len(seen), "bytes": path.stat().st_size, "sha256": sha}
    print(table, res[table], flush=True)
(OUT / "manifest.json").write_text(json.dumps(res, indent=1))
