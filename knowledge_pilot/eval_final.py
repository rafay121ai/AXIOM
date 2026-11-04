"""Final fair eval (budget cap $4). Read-only on databases (anon RPC match_wiki_chunks only).

  python eval_final.py embed        # re-embed all lessons at 1536 dims
  python eval_final.py queries      # structured query per situation
  python eval_final.py retrieve     # top 30 + gpt-4.1-mini rerank for A, A2, B; attach lessons for C
  python eval_final.py answers      # gpt-4.1 writes one Learn answer per version and situation
  python eval_final.py check        # deterministic quote and author checks
  python eval_final.py blind        # blind scoring files
Outputs in eval_final/. Cost is tracked in eval_final/cost.json and refused above CAP.
"""
from __future__ import annotations

import json
import random
import re
import sys
import threading
import time
import difflib
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import library_lessons as v2  # noqa: E402
import library_state as st  # noqa: E402

OUT = HERE / "eval_final"
OUT.mkdir(exist_ok=True)
LIB = HERE / "library"
CAP = 3.80                      # hard stop below the $4 budget
EMB = "text-embedding-3-small"
M_MINI, M_BIG = "gpt-4.1-mini", "gpt-4.1"
TOPK, FINAL = 30, 5
SITS = json.loads((HERE / "eval" / "situations.json").read_text())
_lock = threading.Lock()
_client = None


def client():
    global _client
    if _client is None:
        _client = v2.get_client()
    return _client


def spend(usd: float, label: str) -> None:
    with _lock:
        p = OUT / "cost.json"
        d = json.loads(p.read_text()) if p.exists() else {"total": 0.0, "by": {}}
        d["total"] = round(d["total"] + usd, 6)
        d["by"][label] = round(d["by"].get(label, 0.0) + usd, 6)
        p.write_text(json.dumps(d, indent=1))
        if d["total"] > CAP:
            raise RuntimeError(f"cost cap reached: ${d['total']:.2f}")


def total() -> float:
    p = OUT / "cost.json"
    return json.loads(p.read_text())["total"] if p.exists() else 0.0


def retry(fn, tries=4):
    for i in range(tries):
        try:
            return fn()
        except Exception as exc:  # noqa: BLE001
            if "cost cap" in str(exc) or i == tries - 1:
                raise
            time.sleep(5 * (i + 1))


def chat(model, system, user, schema=None, name="out", max_tokens=1500):
    rf = {"type": "json_schema", "json_schema": {"name": name, "strict": True, "schema": schema}} if schema else None

    def go():
        kw = dict(model=model, temperature=0, max_completion_tokens=max_tokens, timeout=120,
                  messages=[{"role": "system", "content": system}, {"role": "user", "content": user}])
        if rf:
            kw["response_format"] = rf
        return client().chat.completions.create(**kw)
    r = retry(go)
    u = r.usage
    cached = getattr(getattr(u, "prompt_tokens_details", None), "cached_tokens", 0) or 0
    spend(st.cost_from_usage(model, u.prompt_tokens, u.completion_tokens, cached), f"chat_{model}")
    return json.loads(r.choices[0].message.content) if schema else r.choices[0].message.content


def embed_texts(texts, dims=1536, label="embed"):
    def go():
        return client().embeddings.create(model=EMB, input=texts, dimensions=dims, timeout=120)
    r = retry(go)
    spend(st.cost_from_usage(EMB, prompt_tokens=r.usage.total_tokens), label)
    return [d.embedding for d in sorted(r.data, key=lambda d: d.index)]


# ---------------------------------------------------------------------------------------------
def load_lessons():
    rows = []
    for p in sorted(LIB.glob("*/lessons.jsonl")):
        for line in p.read_text(encoding="utf-8").splitlines():
            if line.strip():
                l = json.loads(line)
                l.pop("embedding", None)
                rows.append(l)
    return rows


def lesson_text(l):
    return "\n".join([str(l.get(k) or "") for k in ("title", "author_argues", "principle", "applies_when")]
                     + [str(q) for q in (l.get("example_questions") or [])]).strip()


def cmd_embed():
    rows = load_lessons()
    texts = [lesson_text(l) for l in rows]
    batches = [texts[i:i + 100] for i in range(0, len(texts), 100)]
    with ThreadPoolExecutor(4) as ex:
        res = list(ex.map(lambda b: embed_texts(b, 1536, "lesson_embed_1536"), batches))
    M = np.array([e for r in res for e in r], dtype=np.float32)
    assert M.shape == (len(rows), 1536), M.shape
    np.save(OUT / "lessons_1536.npy", M)
    (OUT / "lesson_ids.json").write_text(json.dumps([l["lesson_id"] for l in rows]))
    print(M.shape, f"cost so far ${total():.3f}")


QSYS = """You turn a founder's message into a structured query for a knowledge library, the way a careful reader would before looking anything up. Use only what the founder wrote. Fill four fields, each one or two plain sentences:
- stage: the company stage and situation (what exists today: product, customers, money, team, numbers they gave).
- decision: the decision or problem they are facing right now.
- tried: what they have already tried or considered (say "nothing stated" if nothing).
- feeling: what they seem to feel (fear, doubt, pressure, confusion), read from their words."""
QSCHEMA = {"type": "object", "additionalProperties": False, "required": ["stage", "decision", "tried", "feeling"],
           "properties": {k: {"type": "string"} for k in ("stage", "decision", "tried", "feeling")}}


def cmd_queries():
    def one(s):
        q = chat(M_MINI, QSYS, s["text"], QSCHEMA, "query", 400)
        q["text"] = (f"Stage: {q['stage']}\nDecision being faced: {q['decision']}\n"
                     f"What they have tried: {q['tried']}\nWhat they seem to feel: {q['feeling']}")
        return {"id": s["id"], **q}
    with ThreadPoolExecutor(6) as ex:
        out = list(ex.map(one, SITS))
    (OUT / "queries.json").write_text(json.dumps(out, indent=1, ensure_ascii=False))
    print(len(out), f"cost ${total():.3f}")


# ---------------------------------------------------------------------------------------------
STOP = {"the", "a", "of", "and", "how", "i", "built", "this", "an", "to", "in"}


def toks(t):
    t = re.sub(r"[—–-]", " ", t.lower().replace("&", "and")).replace("'", "").replace("’", "")
    return [w for w in re.sub(r"[^a-z0-9 ]", "", t).split() if w not in STOP]


def source_index():
    order = json.loads((HERE / "library_order.json").read_text())
    import v33_lessons as l3
    idx = {}
    for o in order:
        _, author = l3.source_info(o["source_id"], LIB)
        idx[o["source_id"]] = {"title": o["title"], "t": toks(o["title"]), "author": author or "", "pillar": o["pillar"]}
    return idx


def map_old(title, author, idx):
    ct, best = toks(title), None
    atoks = {w for w in toks(author or "") if len(w) >= 4}
    for sid, s in idx.items():
        t = s["t"]
        if not ct or not t:
            continue
        r = difflib.SequenceMatcher(None, " ".join(ct), " ".join(t)).ratio()
        sub = set(ct) <= set(t) or set(t) <= set(ct)
        if r >= 0.85 or (sub and r >= 0.5):
            sa = {w for w in toks(s["author"]) if len(w) >= 4}
            if atoks and sa and not (atoks & sa):
                continue
            if not best or r > best[1]:
                best = (sid, r)
    return best[0] if best else None


def done_real_sources():
    r = st.load(HERE / "library_state.json")["library_run"]["sources"]
    return {s for s, v in r.items() if v.get("status") == "done" and not v.get("smoke")}


def rpc_old(vec, n=400):
    import requests
    from dotenv import dotenv_values
    env = dotenv_values(HERE.parent / ".env")
    url = env["VITE_KNOWLEDGE_SUPABASE_URL"].rstrip("/") + "/rest/v1/rpc/match_wiki_chunks"
    key = env["VITE_KNOWLEDGE_SUPABASE_ANON_KEY"]
    r = requests.post(url, headers={"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"},
                      json={"query_embedding": vec, "match_count": n}, timeout=120)
    r.raise_for_status()
    return r.json()


RSYS = """You choose the knowledge items that would help one specific founder the most. You get the founder's message, a structured reading of it, and numbered candidate items from a library of business books. Pick the 5 best items for THIS founder's decision, best first. Prefer items that speak to the decision they face and what they said; prefer different useful ideas over five items making the same point; ignore items that merely share a keyword, are advertisements, or are about a different situation. Return only the ids of your 5 picks."""
RSCHEMA = {"type": "object", "additionalProperties": False, "required": ["best"],
           "properties": {"best": {"type": "array", "items": {"type": "string"}}}}


def rerank(sit, q, cands, render):
    body = "\n\n".join(f"[c{i + 1}] {render(c)}" for i, c in enumerate(cands))
    user = f"FOUNDER MESSAGE\n{sit['text']}\n\nSTRUCTURED READING\n{q['text']}\n\nCANDIDATES\n{body}"
    out = chat(M_MINI, RSYS, user, RSCHEMA, "rerank", 200)["best"]
    seen, pick = set(), []
    for cid in out:
        m = re.fullmatch(r"c(\d+)", cid.strip())
        if m and 1 <= int(m.group(1)) <= len(cands) and cid not in seen:
            seen.add(cid)
            pick.append(int(m.group(1)) - 1)
    for i in range(len(cands)):             # fill if the model returned fewer than 5 valid ids
        if len(pick) >= FINAL:
            break
        if i not in pick:
            pick.append(i)
    return pick[:FINAL]


def old_render(c):
    return f"{c['title']} — {c['author']}\n{c['key_frameworks'] or ''}"


def lesson_render(l):
    cited = " ".join(p["text"] for p in l["paragraphs"])[:700]
    return (f"{l['title']} — {l['author']}, {l['source_title']} ({l.get('chapter')})\nArgues: {l['author_argues']}\n"
            f"Principle: {l['principle']}\nSource text: {cited}")


_para_cache = {}


def paragraphs_of(sid):
    if sid not in _para_cache:
        _para_cache[sid] = [json.loads(x) for x in (LIB / sid / "paragraphs_v3.2.jsonl").read_text(encoding="utf-8").splitlines() if x.strip()]
    return _para_cache[sid]


def with_context(l):
    """Cited paragraphs plus up to 2 body paragraphs before and after in the same chapter."""
    paras = paragraphs_of(l["source_id"])
    pos = {p["id"]: i for i, p in enumerate(paras)}
    ids = [i for i in l["paragraph_ids"] if i in pos]
    lo, hi = min(pos[i] for i in ids), max(pos[i] for i in ids)
    chap = paras[lo].get("chapter")
    body = lambda p: p.get("kind", "body") == "body" and p.get("chapter") == chap
    before, i = [], lo - 1
    while i >= 0 and len(before) < 2:
        if body(paras[i]):
            before.insert(0, paras[i])
        elif paras[i].get("chapter") != chap:
            break
        i -= 1
    after, i = [], hi + 1
    while i < len(paras) and len(after) < 2:
        if body(paras[i]):
            after.append(paras[i])
        elif paras[i].get("chapter") != chap:
            break
        i += 1
    cited = [p for p in paras[lo:hi + 1] if p["id"] in set(ids)]
    return [{"role": "context", "text": p["text"]} for p in before] + [{"role": "cited", "text": p["text"]} for p in cited] + \
           [{"role": "context", "text": p["text"]} for p in after]


def ngrams(words, n=10):
    return {" ".join(words[i:i + n]) for i in range(len(words) - n + 1)}


def norm_words(t):
    return re.sub(r"[^a-z0-9 ]", " ", t.lower().replace("’", "'").replace("'", "")).split()


def overlaps(lesson, chunk_grams):
    for p in lesson["paragraphs"]:
        w = norm_words(p["text"])
        if len(w) < 10:
            if " ".join(w) and " ".join(w) in chunk_grams.get("_text", ""):
                return True
            continue
        probes = {" ".join(w[:10]), " ".join(w[-10:]), " ".join(w[len(w) // 2 - 5:len(w) // 2 + 5])}
        if probes & chunk_grams["g"]:
            return True
    return False


def cmd_retrieve():
    rows = load_lessons()
    ids = json.loads((OUT / "lesson_ids.json").read_text())
    assert ids == [l["lesson_id"] for l in rows]
    M = np.load(OUT / "lessons_1536.npy")
    M /= np.linalg.norm(M, axis=1, keepdims=True)
    qs = {q["id"]: q for q in json.loads((OUT / "queries.json").read_text())}
    idx = source_index()
    done = done_real_sources()
    by_src = {}
    for i, l in enumerate(rows):
        by_src.setdefault(l["source_id"], []).append(i)
    qv = embed_texts([qs[s["id"]]["text"] for s in SITS], 1536, "query_embed_1536")

    def one(args):
        s, vec = args
        q = qs[s["id"]]
        old = rpc_old(vec, 400)
        for o in old:
            o["_sid"] = map_old(o["title"], o["author"], idx)
        a_c = old[:TOPK]
        a2_c = [o for o in old if o["_sid"] in done][:TOPK]
        v = np.array(vec, dtype=np.float32)
        v /= np.linalg.norm(v)
        sims = M @ v
        top = list(np.argsort(-sims)[:TOPK])
        b_c = [rows[i] | {"_sim": float(sims[i])} for i in top]
        pa, pa2, pb = (rerank(s, q, a_c, old_render), rerank(s, q, a2_c, old_render) if a2_c else [],
                       rerank(s, q, b_c, lesson_render))
        A = [a_c[i] for i in pa]
        A2 = [a2_c[i] for i in pa2]
        B = [b_c[i] for i in pb]
        # version C: A's passages plus lessons whose cited paragraphs overlap the passage text
        C = []
        for o in A:
            attach = []
            sid = o["_sid"]
            if sid and sid in by_src:
                words = norm_words(o["key_frameworks"] or "")
                cg = {"g": ngrams(words), "_text": " ".join(words)}
                hits = [i for i in by_src[sid] if overlaps(rows[i], cg)]
                hits.sort(key=lambda i: -sims[i])
                attach = [rows[i] for i in hits[:3]]
            C.append({"passage": o, "lessons": attach})
        return {"id": s["id"], "A": A, "A2": A2, "B": [dict(l) for l in B], "C": C,
                "n_old_400_in_66_books": len([o for o in old if o["_sid"] in done]), "n_a2_cands": len(a2_c)}

    with ThreadPoolExecutor(5) as ex:
        res = list(ex.map(one, zip(SITS, qv)))
    for r in res:
        for l in r["B"]:
            l["context"] = with_context(l)
    (OUT / "retrieval_final.json").write_text(json.dumps(res, indent=1, ensure_ascii=False))
    ca = sum(1 for r in res for c in r["C"] if c["lessons"])
    print("done; C passages with an attached lesson:", ca, "of", 5 * len(res), f"cost ${total():.3f}")
    print("A2 candidates per situation:", [r["n_a2_cands"] for r in res])


# ---------------------------------------------------------------------------------------------
ASYS = """You write one Learn answer for a founder, using ONLY the retrieved material given. The founder's message and a structured reading come first, then numbered retrieved items. Rules:
- Use nothing outside the retrieved items. Do not add facts, numbers, names or examples that are not in them.
- "author_argues": say what the author argues, in plain words. Name the author and the book exactly as written in the item header. If an exact quote helps, copy it character for character from that item (a continuous passage of at most 40 words, no edits, no ellipses). If no item is relevant to this founder, set "item" to 0, say so in "statement", and leave "quote" empty.
- "connects": how this connects to THIS founder, using their words, numbers and situation. No filler. Never use the phrases "great question", "certainly", "I understand", "absolutely", "of course".
- "do_this": one concrete thing this founder can start within 10 minutes. Binary: they can say tomorrow whether they did it.
Return JSON only."""
ASCHEMA = {"type": "object", "additionalProperties": False, "required": ["author_argues", "connects", "do_this"], "properties": {
    "author_argues": {"type": "object", "additionalProperties": False, "required": ["statement", "quote", "item", "author", "book"], "properties": {
        "statement": {"type": "string"}, "quote": {"type": "string"}, "item": {"type": "integer"},
        "author": {"type": "string"}, "book": {"type": "string"}}},
    "connects": {"type": "string"}, "do_this": {"type": "string"}}}


def render_items(version, r):
    items, texts = [], []
    if version in ("A", "A2"):
        for i, o in enumerate(r[version], 1):
            t = o["key_frameworks"] or ""
            items.append(f"ITEM {i}\nAuthor: {o['author']}\nBook: {o['title']}\nText:\n{t}")
            texts.append({"item": i, "author": o["author"], "book": o["title"], "text": t})
    elif version == "B":
        for i, l in enumerate(r["B"], 1):
            t = "\n\n".join(p["text"] for p in l["context"])
            pages = f"{l['page_start']}-{l['page_end']}" if l.get("page_start") is not None else "n/a"
            items.append(f"ITEM {i}\nAuthor: {l['author']}\nBook: {l['source_title']}\nChapter: {l.get('chapter')}\nPages: {pages}\n"
                         f"Topic of the cited paragraphs: {l['title']}\nText (cited paragraphs with surrounding context):\n{t}")
            texts.append({"item": i, "author": l["author"], "book": l["source_title"], "text": t})
    else:
        for i, c in enumerate(r["C"], 1):
            o = c["passage"]
            t = o["key_frameworks"] or ""
            extra = ""
            for l in c["lessons"]:
                lt = "\n\n".join(p["text"] for p in l["paragraphs"])
                pages = f"{l['page_start']}-{l['page_end']}" if l.get("page_start") is not None else "n/a"
                extra += (f"\nVerified citation: {l['author']}, {l['source_title']}, chapter \"{l.get('chapter')}\", pages {pages}. "
                          f"Topic: {l['title']}. Cited paragraphs:\n{lt}\n")
                t += "\n\n" + lt
            items.append(f"ITEM {i}\nAuthor: {o['author']}\nBook: {o['title']}\nText:\n{o['key_frameworks'] or ''}{extra}")
            texts.append({"item": i, "author": o["author"], "book": o["title"], "text": t})
    return "\n\n".join(items), texts


def cmd_answers():
    qs = {q["id"]: q for q in json.loads((OUT / "queries.json").read_text())}
    ret = json.loads((OUT / "retrieval_final.json").read_text())
    jobs = [(s, r, v) for s, r in zip(SITS, ret) for v in ("A", "A2", "B", "C") if (v != "A2" or r["A2"])]

    def one(j):
        s, r, v = j
        body, texts = render_items(v, r)
        user = f"FOUNDER MESSAGE\n{s['text']}\n\nSTRUCTURED READING\n{qs[s['id']]['text']}\n\nRETRIEVED ITEMS\n{body}"
        cp = OUT / "answers_cache" / f"{s['id']}_{v}.json"
        if cp.exists():
            return json.loads(cp.read_text())
        ans, fallback = None, False
        for suffix in ("", "\n\nIMPORTANT: keep any exact quote under 20 words.", "\n\nIMPORTANT: keep any exact quote under 12 words."):
            try:
                ans = chat(M_BIG, ASYS, user + suffix, ASCHEMA, "answer", 1500)
                fallback = bool(suffix)
                break
            except json.JSONDecodeError:
                continue
        if ans is None:
            raise RuntimeError(f"no valid answer for {s['id']} {v}")
        row = {"id": s["id"], "version": v, "answer": ans, "items": texts, "prompt_chars": len(user), "short_quote_fallback": fallback}
        cp.parent.mkdir(exist_ok=True)
        cp.write_text(json.dumps(row, ensure_ascii=False))
        return row
    with ThreadPoolExecutor(5) as ex:
        res = list(ex.map(one, jobs))
    (OUT / "answers.json").write_text(json.dumps(res, indent=1, ensure_ascii=False))
    print(len(res), "answers", f"cost ${total():.3f}")


# ---------------------------------------------------------------------------------------------
def fold(t):
    t = t.replace("“", '"').replace("”", '"').replace("‘", "'").replace("’", "'").replace("–", "-").replace("—", "-")
    return re.sub(r"\s+", " ", t).strip().lower()


def quotes_in(ans):
    qs = []
    q = ans["author_argues"]["quote"].strip()
    if q:
        qs.append(q)
    for field in (ans["author_argues"]["statement"], ans["connects"], ans["do_this"]):
        for m in re.finditer(r'[“"]([^”"]{20,400})[”"]', field):
            if len(m.group(1).split()) >= 4:
                qs.append(m.group(1))
    return list(dict.fromkeys(qs))


def cmd_check():
    res = json.loads((OUT / "answers.json").read_text())
    out = []
    for a in res:
        alltext = "\n".join(i["text"] for i in a["items"])
        folded = fold(alltext)
        qs = quotes_in(a["answer"])
        strict = [q in alltext for q in qs]
        loose = [fold(q).rstrip(".") in folded for q in qs]
        aa = a["answer"]["author_argues"]
        item = next((i for i in a["items"] if i["item"] == aa["item"]), None)
        auth_ok = bool(item) and bool({w for w in toks(aa["author"]) if len(w) >= 4} & {w for w in toks(item["author"]) if len(w) >= 4})
        book_ok = bool(item) and bool(set(toks(aa["book"])) & set(toks(item["book"])))
        q_in_cited_item = [bool(item) and q in item["text"] for q in qs]
        out.append({"id": a["id"], "version": a["version"], "n_quotes": len(qs), "strict_ok": sum(strict), "loose_ok": sum(loose),
                    "quote_in_cited_item": sum(q_in_cited_item), "no_item": aa["item"] == 0,
                    "author_ok": auth_ok, "book_ok": book_ok, "quotes": qs,
                    "bad": [q for q, ok in zip(qs, strict) if not ok]})
    (OUT / "checks.json").write_text(json.dumps(out, indent=1, ensure_ascii=False))
    for v in ("A", "A2", "B", "C"):
        c = [x for x in out if x["version"] == v]
        n = sum(x["n_quotes"] for x in c)
        print(v, "answers", len(c), "quotes", n, "strict-unverifiable", f"{100 * (n - sum(x['strict_ok'] for x in c)) / max(n, 1):.1f}%",
              "folded-unverifiable", f"{100 * (n - sum(x['loose_ok'] for x in c)) / max(n, 1):.1f}%",
              "answers with no quote", sum(1 for x in c if x["n_quotes"] == 0),
              "author mismatch", sum(1 for x in c if not x["no_item"] and not x["author_ok"]),
              "book mismatch", sum(1 for x in c if not x["no_item"] and not x["book_ok"]))


def cmd_blind():
    res = json.loads((OUT / "answers.json").read_text())
    rnd = random.Random(4242)
    by = {}
    for a in res:
        by.setdefault(a["id"], []).append(a)
    key, files = {}, [[] for _ in range(4)]
    for k, sid in enumerate(sorted(by)):
        items = by[sid][:]
        rnd.shuffle(items)
        sit = next(s for s in SITS if s["id"] == sid)
        entries = []
        for j, a in enumerate(items, 1):
            aid = f"F{sid}-{j}"
            key[aid] = a["version"]
            src = "\n\n".join(f"[{i['item']}] {i['author']}, {i['book']}:\n{i['text'][:3500]}" for i in a["items"])
            ans = a["answer"]
            body = (f"WHAT THE AUTHOR ARGUES ({ans['author_argues']['author']}, {ans['author_argues']['book']}):\n{ans['author_argues']['statement']}\n"
                    f"Quote: {ans['author_argues']['quote'] or '(none)'}\n\nHOW IT CONNECTS TO YOU:\n{ans['connects']}\n\nDO THIS:\n{ans['do_this']}")
            entries.append({"answer_id": aid, "answer": body, "source_excerpts_it_was_written_from": src})
        files[k // 5].append({"situation_id": sid, "founder_message": sit["text"], "answers": entries})
    for n, f in enumerate(files, 1):
        (OUT / f"score_in_{n}.json").write_text(json.dumps(f, indent=1, ensure_ascii=False))
    (OUT / "blind_key_SECRET.json").write_text(json.dumps(key, indent=1))
    print([sum(len(s["answers"]) for s in f) for f in files])


if __name__ == "__main__":
    {"embed": cmd_embed, "queries": cmd_queries, "retrieve": cmd_retrieve, "answers": cmd_answers,
     "check": cmd_check, "blind": cmd_blind}[sys.argv[1]]()
