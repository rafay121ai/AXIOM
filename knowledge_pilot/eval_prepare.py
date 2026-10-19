"""Eval retrieval (Step 3). Old library: match_wiki_chunks via the public RPC, READ ONLY. New library: local cosine.

  python eval_prepare.py          # embeds each situation (1536 and 512 dims), writes eval/retrieval.json and eval/blind_*.json
No database writes. The anon key is read from .env and never printed.
"""
from __future__ import annotations

import json
import random
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import library_lessons as v2  # noqa: E402
import library_state as state  # noqa: E402

EV = HERE / "eval"
LIB = HERE / "library"
K = 5
EMB = "text-embedding-3-small"


def embed(client, texts: list[str], dims: int) -> list[list[float]]:
    r = client.embeddings.create(model=EMB, input=texts, dimensions=dims)
    state.add_cost("_eval", state.cost_from_usage(EMB, prompt_tokens=r.usage.total_tokens), f"eval_embed_{dims}", None,
                   model=EMB, usage={"prompt_tokens": r.usage.total_tokens})
    return [d.embedding for d in sorted(r.data, key=lambda d: d.index)]


def main() -> int:
    import requests
    from dotenv import dotenv_values
    env = dotenv_values(HERE.parent / ".env")
    url = env["VITE_KNOWLEDGE_SUPABASE_URL"].rstrip("/") + "/rest/v1/rpc/match_wiki_chunks"
    key = env["VITE_KNOWLEDGE_SUPABASE_ANON_KEY"]
    sits = json.loads((EV / "situations.json").read_text())
    client = v2.get_client()
    texts = [s["text"] for s in sits]
    q1536, q512 = embed(client, texts, 1536), embed(client, texts, 512)

    rows, mat = [], []
    for p in sorted(LIB.glob("*/lessons.jsonl")):
        for line in p.read_text(encoding="utf-8").splitlines():
            if line.strip():
                l = json.loads(line)
                mat.append(l.pop("embedding"))
                rows.append(l)
    M = np.array(mat, dtype=np.float32)
    M /= np.linalg.norm(M, axis=1, keepdims=True)
    print(f"{len(rows)} local lessons")

    out = []
    for s, a, b in zip(sits, q1536, q512):
        r = requests.post(url, headers={"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"},
                          json={"query_embedding": a, "match_count": K}, timeout=60)
        r.raise_for_status()
        old = [{"title": x["title"], "author": x["author"], "pillar": x["pillar"], "key_frameworks": x["key_frameworks"],
                "similarity": round(x["similarity"], 4)} for x in r.json()]
        q = np.array(b, dtype=np.float32)
        q /= np.linalg.norm(q)
        sims = M @ q
        top = np.argsort(-sims)[:K]
        new = [{"lesson_id": rows[i]["lesson_id"], "source_title": rows[i]["source_title"], "author": rows[i]["author"],
                "title": rows[i]["title"], "author_argues": rows[i]["author_argues"], "principle": rows[i]["principle"],
                "paragraphs": [p["text"] for p in rows[i]["paragraphs"]], "similarity": round(float(sims[i]), 4)}
               for i in top]
        out.append({**s, "old": old, "new": new})
    (EV / "retrieval.json").write_text(json.dumps(out, indent=1, ensure_ascii=False), encoding="utf-8")

    # blind files: 10 results per situation, shuffled, no origin labels
    rnd = random.Random(2026)
    key_map, blind = {}, []
    for s in out:
        items = [("old", i, o) for i, o in enumerate(s["old"])] + [("new", i, n) for i, n in enumerate(s["new"])]
        rnd.shuffle(items)
        res = []
        for j, (origin, i, it) in enumerate(items, 1):
            rid = f"S{s['id']}-R{j}"
            key_map[rid] = {"origin": origin, "rank": i + 1}
            if origin == "old":
                body = f"{it['title']} — {it['author']}\n{it['key_frameworks']}"
            else:
                body = (f"{it['title']} — {it['author']}, {it['source_title']}\n{it['author_argues']}\nPrinciple: {it['principle']}\n"
                        "Source text: " + " ".join(it["paragraphs"])[:900])
            res.append({"result_id": rid, "content": body})
        blind.append({"situation_id": s["id"], "situation": s["text"], "results": res})
    (EV / "blind_key_SECRET.json").write_text(json.dumps(key_map, indent=1), encoding="utf-8")
    (EV / "blind_1.json").write_text(json.dumps(blind[:10], indent=1, ensure_ascii=False), encoding="utf-8")
    (EV / "blind_2.json").write_text(json.dumps(blind[10:], indent=1, ensure_ascii=False), encoding="utf-8")
    print("wrote eval/retrieval.json, blind_1.json, blind_2.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
