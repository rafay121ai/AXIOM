"""Hybrid eval: old library picks the sources, local lessons inside those sources supply the results. Read-only."""
from __future__ import annotations

import difflib
import json
import random
import re
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import library_lessons as v2  # noqa: E402
import library_state as state  # noqa: E402

EV, LIB, K = HERE / "eval", HERE / "library", 5
STOP = {"the", "a", "of", "and", "how", "i", "built", "this"}


def toks(t: str) -> list[str]:
    t = re.sub(r"[—–-]", " ", t.lower().replace("&", "and")).replace("'", "")
    return [w for w in re.sub(r"[^a-z0-9 ]", "", t).split() if w not in STOP]


def match_source(title: str, local: dict[str, list[str]]) -> str | None:
    ct, best = toks(title), None
    for sid, t in local.items():
        if not ct or not t:
            continue
        r = difflib.SequenceMatcher(None, " ".join(ct), " ".join(t)).ratio()
        if r >= 0.85 or ((set(ct) <= set(t) or set(t) <= set(ct)) and r >= 0.5):
            if not best or r > best[1]:
                best = (sid, r)
    return best[0] if best else None


def main() -> int:
    ret = json.loads((EV / "retrieval.json").read_text())
    order = json.loads((HERE / "library_order.json").read_text())
    local = {o["source_id"]: toks(o["title"]) for o in order}
    rows, mat = [], []
    for p in sorted(LIB.glob("*/lessons.jsonl")):
        for line in p.read_text(encoding="utf-8").splitlines():
            if line.strip():
                l = json.loads(line)
                mat.append(l.pop("embedding"))
                rows.append(l)
    M = np.array(mat, dtype=np.float32)
    M /= np.linalg.norm(M, axis=1, keepdims=True)
    sid_arr = np.array([r["source_id"] for r in rows])
    client = v2.get_client()
    r = client.embeddings.create(model="text-embedding-3-small", input=[s["text"] for s in ret], dimensions=512)
    state.add_cost("_eval", state.cost_from_usage("text-embedding-3-small", prompt_tokens=r.usage.total_tokens), "eval_embed_512", None,
                   model="text-embedding-3-small", usage={"prompt_tokens": r.usage.total_tokens})
    Q = np.array([d.embedding for d in sorted(r.data, key=lambda d: d.index)], dtype=np.float32)
    Q /= np.linalg.norm(Q, axis=1, keepdims=True)

    rnd, key_map, blind, hyb = random.Random(77), {}, [], []
    for s, q in zip(ret, Q):
        srcs = [m for m in (match_source(o["title"], local) for o in s["old"]) if m]
        mask = np.isin(sid_arr, list(dict.fromkeys(srcs)))
        sims = np.where(mask, M @ q, -1.0)
        top = [i for i in np.argsort(-sims)[:K] if mask[i]]
        h = [{"lesson_id": rows[i]["lesson_id"], "source_title": rows[i]["source_title"], "author": rows[i]["author"], "title": rows[i]["title"],
              "author_argues": rows[i]["author_argues"], "principle": rows[i]["principle"],
              "paragraphs": [p["text"] for p in rows[i]["paragraphs"]], "similarity": round(float(sims[i]), 4)} for i in top]
        hyb.append({"id": s["id"], "old_sources_with_local_lessons": srcs, "hybrid": h})
        items = [("old", i, o) for i, o in enumerate(s["old"])] + [("hybrid", i, x) for i, x in enumerate(h)]
        rnd.shuffle(items)
        res = []
        for j, (origin, i, it) in enumerate(items, 1):
            rid = f"H{s['id']}-R{j}"
            key_map[rid] = {"origin": origin, "rank": i + 1}
            body = (f"{it['title']} — {it['author']}\n{it['key_frameworks']}" if origin == "old" else
                    f"{it['title']} — {it['author']}, {it['source_title']}\n{it['author_argues']}\nPrinciple: {it['principle']}\n"
                    "Source text: " + " ".join(it["paragraphs"])[:900])
            res.append({"result_id": rid, "content": body})
        blind.append({"situation_id": s["id"], "situation": s["text"], "results": res})
    (EV / "hybrid_retrieval.json").write_text(json.dumps(hyb, indent=1, ensure_ascii=False), encoding="utf-8")
    (EV / "hybrid_key_SECRET.json").write_text(json.dumps(key_map, indent=1), encoding="utf-8")
    (EV / "hblind_1.json").write_text(json.dumps(blind[:10], indent=1, ensure_ascii=False), encoding="utf-8")
    (EV / "hblind_2.json").write_text(json.dumps(blind[10:], indent=1, ensure_ascii=False), encoding="utf-8")
    cover = sum(1 for h in hyb if h["hybrid"])
    print(f"situations with at least one local source among old top 5: {cover}/20; avg hybrid results {sum(len(h['hybrid']) for h in hyb)/20:.1f}")
    print({h['id']: len(h['hybrid']) for h in hyb})
    return 0


if __name__ == "__main__":
    sys.exit(main())
