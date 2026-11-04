"""Run match_wiki_chunks(query_embedding, 10) like the app (anon key, REST RPC). Usage: search_check.py before|after
Embeds situations 1, 3, 9, 12, 17 once (text-embedding-3-small, 1536) and reuses the vectors for the after run."""
import json, sys, time
from pathlib import Path
import requests
from dotenv import dotenv_values
D = Path(__file__).resolve().parent
env = dotenv_values("/Users/rafayessani/AXIOM/.env")
label = sys.argv[1]
sits = {s["id"]: s for s in json.load(open("/Users/rafayessani/AXIOM/knowledge_pilot/eval/situations.json"))}
vp = D / "query_vectors.json"
if vp.exists():
    vecs = json.loads(vp.read_text())
else:
    from openai import OpenAI
    c = OpenAI(api_key=env["OPENAI_API_KEY"])
    ids = [1, 3, 9, 12, 17]
    r = c.embeddings.create(model="text-embedding-3-small", input=[sits[i]["text"] for i in ids], dimensions=1536)
    vecs = {str(i): d.embedding for i, d in zip(ids, sorted(r.data, key=lambda d: d.index))}
    vp.write_text(json.dumps(vecs))
url = env["VITE_KNOWLEDGE_SUPABASE_URL"].rstrip("/") + "/rest/v1/rpc/match_wiki_chunks"
key = env["VITE_KNOWLEDGE_SUPABASE_ANON_KEY"]
out = {}
for sid, v in vecs.items():
    t = time.time()
    r = requests.post(url, headers={"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"},
                      json={"query_embedding": v, "match_count": 10}, timeout=120)
    dt = time.time() - t
    r.raise_for_status()
    rows = r.json()
    out[sid] = {"seconds": round(dt, 3), "n": len(rows),
                "results": [{"id": x["id"], "title": x["title"], "author": x["author"], "similarity": round(x["similarity"], 4)} for x in rows]}
    print(sid, len(rows), f"{dt:.2f}s", [x["title"][:20] for x in rows[:3]])
(D / f"search_{label}.json").write_text(json.dumps(out, indent=1))
