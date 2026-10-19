"""Bulk lesson library on the OpenAI Batch API (gpt-4.1-mini). No database.

  python library_batch.py plan                 # groups, window counts, cost estimate (no spend)
  python library_batch.py run [--max-groups N] # resumable loop; state in library_state.json["library_run"]
  python library_batch.py status
  python library_batch.py checkpoint pass|fail # after the enrichment-checker scores the first 5 core sources
  python library_batch.py spotcheck SOURCE_ID --severe N [--passed M]
  python library_batch.py report

Pipeline per group of a few sources: extract (prompt lessons-v3.3, frozen paragraphs) -> case sweep (sweep-v1)
-> editor (editor-v2.0-mini, one retry round for failed validation) -> embed for dedupe -> dedupe 0.85 ->
embed final (512 dims) -> library/<source_id>/lessons.jsonl + dropped.jsonl. Static instructions come first
in every prompt, outputs use strict JSON schemas. Every batch id is recorded in library_state.json.
"""

from __future__ import annotations

import argparse
import json
import os
import random
import re
import sys
import time
import traceback
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import editor as ed  # noqa: E402
import golden_windows as gw  # noqa: E402
import library_lessons as v2  # noqa: E402
import library_lessons_v3 as l3h  # noqa: E402  (HEAD helpers: dedupe)
import library_state as state  # noqa: E402
import v33_lessons as l3  # noqa: E402  (lessons-v3.3, frozen from f19eafe)
import v33_sweep as sweep  # noqa: E402  (sweep-v1, frozen from f19eafe)

STATE = HERE / "library_state.json"
RUN_DIR = HERE / "bulk_run"
LIB = HERE / "library"
ORDER_PATH = HERE / "library_order.json"
REPORT_PATH = HERE / "LIBRARY_REPORT.md"
LOG_PATH = HERE / "library_run.log"

MODEL = "gpt-4.1-mini"
EMBED_MODEL = "text-embedding-3-small"
EMBED_DIMS = 512
CAP_USD = 40.0
DISCOUNT = 0.5                      # Batch API price factor
EXTRACTION_VERSION = "extraction-v3.2-frozen"
DEDUPE_THRESHOLD = 0.85
MAX_GROUP_SOURCES = 3
MAX_GROUP_WINDOWS = 220
MAX_ACTIVE_GROUPS = 2
MAX_PART_TOKENS = 1_000_000         # estimated input tokens per batch file (stays under enqueued-token limits)
MAX_PART_REQUESTS = 20000
POLL_S = 90
ITEM_ATTEMPTS = 3                   # retries of failed requests
NET_RETRIES = 5
NET_WAIT_S = 60
OUT_TOKENS = {"extract": 1850, "sweep": 600, "edit": 650, "edit_retry": 650, "embed1": 0, "embed2": 0}
CHECKPOINT_SOURCES = 5
SPOT_EVERY = 15
STAGES = ("extract", "sweep", "edit", "edit_retry", "embed1", "embed2")

SCHEMA_WINDOW = None
SCHEMA_EDIT = None


def now() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


def log(msg: str) -> None:
    line = f"{now()} {msg}"
    print(line, flush=True)
    with LOG_PATH.open("a", encoding="utf-8") as fh:
        fh.write(line + "\n")


def schemas():
    global SCHEMA_WINDOW, SCHEMA_EDIT
    if SCHEMA_WINDOW is None:
        from openai.lib._pydantic import to_strict_json_schema
        SCHEMA_WINDOW = {"type": "json_schema", "json_schema": {"name": "window_out", "strict": True,
                                                                "schema": to_strict_json_schema(l3.WindowOutV3)}}
        SCHEMA_EDIT = {"type": "json_schema", "json_schema": {"name": "edit_out", "strict": True,
                                                              "schema": to_strict_json_schema(ed.EditOut)}}
    return SCHEMA_WINDOW, SCHEMA_EDIT


# ---------------------------------------------------------------------------------------------
# State
# ---------------------------------------------------------------------------------------------

def _defaults() -> dict:
    return {"cap_usd": CAP_USD, "groups": {}, "batches": {}, "sources": {}, "checkpoint": {"status": "unset"},
            "cost_per_window": 0.0085, "halt": None, "pid": None, "spot_pending": [], "created": now()}


def rs_get() -> dict:
    return state.load(STATE).get("library_run") or _defaults()


def rs_update(fn):
    with state.transaction(STATE) as st:
        run = st.setdefault("library_run", _defaults())
        for k, v in _defaults().items():
            run.setdefault(k, v)
        return fn(run)


def spent() -> float:
    return state.total_cost(STATE)


def committed(run: dict) -> float:
    return sum(max(0.0, g["est_total"] - g.get("spent", 0.0)) for g in run["groups"].values()
               if g["status"] == "active")


# ---------------------------------------------------------------------------------------------
# Client with network retry
# ---------------------------------------------------------------------------------------------

_client = None


def client():
    global _client
    if _client is None:
        _client = v2.get_client()
    return _client


def net(fn, *a, **kw):
    import openai
    last = None
    for i in range(NET_RETRIES + 1):
        try:
            return fn(*a, **kw)
        except (openai.APIConnectionError, openai.APITimeoutError, openai.InternalServerError) as exc:
            last = exc
            log(f"network error ({type(exc).__name__}); waiting {NET_WAIT_S}s ({i + 1}/{NET_RETRIES})")
            time.sleep(NET_WAIT_S)
    raise RuntimeError(f"network failed {NET_RETRIES}x: {type(last).__name__}")


# ---------------------------------------------------------------------------------------------
# Files
# ---------------------------------------------------------------------------------------------

def read_jsonl(p: Path) -> list[dict]:
    p = Path(p)
    return [json.loads(l) for l in p.read_text(encoding="utf-8").splitlines() if l.strip()] if p.exists() else []


def write_jsonl(p: Path, rows: list[dict]) -> None:
    p = Path(p)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows), encoding="utf-8")


def bulk_dir(sid: str) -> Path:
    d = LIB / sid / "bulk"
    d.mkdir(parents=True, exist_ok=True)
    return d


def source_windows(sid: str) -> list[dict]:
    paras, heads, _ = gw.load_source(sid, LIB)
    wins = gw.build_windows(paras, heads)
    out = []
    for k, w in enumerate(wins):
        prev = wins[k - 1] if k > 0 and wins[k - 1][0]["chapter"] == w[0]["chapter"] else []
        out.append({"window_id": f"{sid}_w{k:04d}", "source_id": sid, "chapter": w[0]["chapter"],
                    "sections": sorted({p["section"] for p in w if p.get("section")}),
                    "word_count": sum(p["word_count"] for p in w), "paragraphs": w, "context": prev[-gw.CONTEXT_N:]})
    return out


def _page(p, key):
    return p.get(key) or p.get("page")


def lesson_rows(window: dict, kept: list[dict]) -> list[dict]:
    pm = {p["id"]: p for p in window["paragraphs"]}
    rows = []
    for i, l in enumerate(kept):
        ps = [pm[x] for x in l["paragraph_ids"]]
        pages = [v for p in ps for v in (_page(p, "page_start"), _page(p, "page_end")) if v is not None]
        rows.append({"lesson_id": f"{window['window_id']}_l{i:02d}", "window_id": window["window_id"],
                     "source_id": window["source_id"], "chapter": window["chapter"],
                     "page_start": min(pages) if pages else None, "page_end": max(pages) if pages else None,
                     "prompt_version": l3.PROMPT_VERSION, "model": MODEL, "origin": "extract", **l,
                     "evidence_paragraphs": [{"id": p["id"], "text": p["text"]} for p in ps]})
    return rows


def sweep_rows(r: dict, kept: list[dict]) -> list[dict]:
    pm = {p["id"]: p for p in r["paragraphs"]}
    rows = []
    for i, l in enumerate(kept):
        l["lesson_type"] = "story"
        pages = [pm[x].get(f) for x in l["paragraph_ids"] for f in ("page_start", "page_end")]
        pages = [x for x in pages if x is not None]
        rows.append({"lesson_id": f"{r['window_id']}_l{i:02d}", "window_id": r["parent_window"],
                     "sweep_run": r["window_id"], "source_id": r["source_id"], "chapter": r["chapter"],
                     "prompt_version": sweep.SWEEP_VERSION, "model": MODEL, "origin": "sweep", **l,
                     "page_start": min(pages) if pages else None, "page_end": max(pages) if pages else None,
                     "evidence_paragraphs": [{"id": x, "text": pm[x]["text"]} for x in l["paragraph_ids"]]})
    return rows


def embed_text_dedupe(l: dict) -> str:
    return "\n".join(str(l.get(k) or "") for k in ("title", "principle", "applies_when")).strip()


def embed_text_final(l: dict) -> str:
    return "\n".join([str(l.get(k) or "") for k in ("title", "author_argues", "principle", "applies_when")]
                     + [str(q) for q in (l.get("example_questions") or [])]).strip()


# ---------------------------------------------------------------------------------------------
# Request building per stage
# ---------------------------------------------------------------------------------------------

_extractor = None
_sweeper = None


def extractor():
    global _extractor
    if _extractor is None:
        _extractor = l3.ExtractorV3(None, MODEL, l3.load_examples())
    return _extractor


def sweeper():
    global _sweeper
    if _sweeper is None:
        _sweeper = sweep.SweepExtractor(None, MODEL)
    return _sweeper


def chat_body(system: str, user: str, fmt: dict, max_tokens: int) -> dict:
    return {"model": MODEL, "temperature": 0, "max_completion_tokens": max_tokens,
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
            "response_format": fmt}


def est_tokens(body: dict) -> int:
    if "messages" in body:
        return int(sum(len(m["content"]) for m in body["messages"]) / 3.8) + 200
    return int(len(body["input"]) / 3.8) + 10


def build_requests(group: dict, stage: str) -> list[dict]:
    """Requests for one stage: [{item, sid, body | None, cached: content|None, key}]."""
    fw, fe = schemas()
    reqs: list[dict] = []
    cache = l3.read_cache(l3.CACHE_PATH) if stage in ("extract", "sweep") else {}
    for sid in group["active"]:
        d = bulk_dir(sid)
        if stage == "extract":
            ex = extractor()
            for w in read_jsonl(d / "windows.jsonl"):
                user = ex.user_prompt(w)
                key = l3.cache_key(MODEL, ex.system, user, l3.PROMPT_VERSION)
                cached = json.dumps({"lessons": cache[key]["lessons"]}) if key in cache else None
                reqs.append({"item": w["window_id"], "sid": sid, "key": key, "cached": cached,
                             "body": None if cached else chat_body(ex.system, user, fw, l3.MAX_COMPLETION_TOKENS)})
        elif stage == "sweep":
            sx = sweeper()
            for r in read_jsonl(d / "sweep_runs.jsonl"):
                user = sx.user_prompt(r)
                key = l3.cache_key(MODEL, sx.system, user, sx.prompt_version)
                cached = json.dumps({"lessons": cache[key]["lessons"]}) if key in cache else None
                reqs.append({"item": r["window_id"], "sid": sid, "key": key, "cached": cached,
                             "body": None if cached else chat_body(sx.system, user, fw, l3.MAX_COMPLETION_TOKENS)})
        elif stage in ("edit", "edit_retry"):
            lessons = {l["lesson_id"]: l for l in read_jsonl(d / "merged.jsonl")}
            retry = json.loads((d / "edit_retry.json").read_text()) if stage == "edit_retry" else {}
            for lid, l in lessons.items():
                if stage == "edit_retry" and lid not in retry:
                    continue
                user = ed.render_user(l, LIB) + (("\n\nYOUR PREVIOUS REWRITE FAILED THESE CHECKS: " + "; ".join(retry[lid])
                                                  + ". Rewrite again, fixing exactly these, or drop the lesson.")
                                                 if stage == "edit_retry" else "")
                reqs.append({"item": lid, "sid": sid, "key": None, "cached": None,
                             "body": chat_body(ed.SYSTEM_PROMPT, user, fe, 3000)})
        elif stage in ("embed1", "embed2"):
            rows = read_jsonl(d / ("edited.jsonl" if stage == "embed1" else "survivors.jsonl"))
            fn = embed_text_dedupe if stage == "embed1" else embed_text_final
            for l in rows:
                reqs.append({"item": l["lesson_id"], "sid": sid, "key": None, "cached": None,
                             "body": {"model": EMBED_MODEL, "input": fn(l), "dimensions": EMBED_DIMS}})
    return reqs


def est_cost(stage: str, body: dict) -> float:
    if "messages" in body:
        return state.cost_from_usage(MODEL, est_tokens(body), OUT_TOKENS[stage]) * DISCOUNT
    return state.cost_from_usage(EMBED_MODEL, est_tokens(body)) * DISCOUNT


# ---------------------------------------------------------------------------------------------
# Batch submission, polling, consumption
# ---------------------------------------------------------------------------------------------

def gdir(gid: str) -> Path:
    d = RUN_DIR / gid
    d.mkdir(parents=True, exist_ok=True)
    return d


def make_parts(gid: str, stage: str, attempt: int, reqs: list[dict]) -> list[dict]:
    """Split pending requests into batch files; cached items go straight into the results file."""
    d = gdir(gid)
    res_path = d / f"{stage}_results.jsonl"
    with res_path.open("a", encoding="utf-8") as fh:
        for r in reqs:
            if r["cached"]:
                fh.write(json.dumps({"item": r["item"], "sid": r["sid"], "content": r["cached"], "usage": None,
                                     "cached": True, "key": r["key"]}) + "\n")
    todo = [r for r in reqs if r["body"]]
    parts, cur, tok, n = [], [], 0, 0
    path_idx = 0

    def flush():
        nonlocal cur, tok, path_idx
        if not cur:
            return
        endpoint = "/v1/chat/completions" if "messages" in cur[0]["body"] else "/v1/embeddings"
        base = d / f"{stage}_a{attempt}_p{path_idx}"
        lines, mp = [], {}
        for i, r in enumerate(cur):
            cid = f"r{i:06d}"
            mp[cid] = {"item": r["item"], "sid": r["sid"], "key": r["key"]}
            lines.append({"custom_id": cid, "method": "POST", "url": endpoint, "body": r["body"]})
        write_jsonl(base.with_suffix(".jsonl"), lines)
        base.with_suffix(".map.json").write_text(json.dumps(mp), encoding="utf-8")
        parts.append({"file": str(base.with_suffix(".jsonl")), "map": str(base.with_suffix(".map.json")),
                      "endpoint": endpoint, "n": len(cur), "tokens": tok, "batch_id": None, "status": "new",
                      "attempt": attempt, "est_usd": round(sum(est_cost(stage, r["body"]) for r in cur), 5)})
        path_idx += 1
        cur, tok = [], 0

    for r in todo:
        t = est_tokens(r["body"])
        if cur and (tok + t > MAX_PART_TOKENS or len(cur) >= MAX_PART_REQUESTS):
            flush()
        cur.append(r)
        tok += t
    flush()
    return parts


def submit_part(gid: str, stage: str, part: dict) -> bool:
    """Returns True when submitted. A token-limit rejection defers the part (False)."""
    import openai
    if spent() + part["est_usd"] > rs_get()["cap_usd"]:
        raise state.BudgetExhausted(f"cap would be exceeded by batch of ${part['est_usd']:.2f}")
    with open(part["file"], "rb") as fh:
        f = net(client().files.create, file=fh, purpose="batch")
    try:
        b = net(client().batches.create, input_file_id=f.id, endpoint=part["endpoint"], completion_window="24h",
                metadata={"group": gid, "stage": stage})
    except openai.BadRequestError as exc:
        msg = str(exc)
        if "token_limit" in msg or "enqueued" in msg.lower() or "limit" in msg.lower():
            log(f"{gid}/{stage}: submission deferred (queue limit): {msg[:160]}")
            return False
        raise
    part.update(batch_id=b.id, status="submitted", input_file_id=f.id, submitted_at=now())

    def reg(run):
        run["batches"][b.id] = {"group": gid, "stage": stage, "n": part["n"], "est_usd": part["est_usd"],
                                "status": b.status, "submitted_at": part["submitted_at"],
                                "sources": run["groups"][gid]["sources"]}
    rs_update(reg)
    log(f"{gid}/{stage}: submitted batch {b.id} ({part['n']} requests, est ${part['est_usd']:.2f})")
    return True


def consume_part(gid: str, stage: str, part: dict, b) -> None:
    """Download output; append successes to the stage results file; account cost per source."""
    d = gdir(gid)
    mp = json.loads(Path(part["map"]).read_text())
    ok_count = 0
    cost_by_sid: dict[str, dict] = {}
    out_rows = []
    err_samples = []
    if b.output_file_id:
        text = net(client().files.content, b.output_file_id).text
        for line in text.splitlines():
            if not line.strip():
                continue
            r = json.loads(line)
            meta = mp.get(r["custom_id"])
            resp = (r.get("response") or {})
            body = resp.get("body") or {}
            if not meta or resp.get("status_code") != 200 or r.get("error"):
                if len(err_samples) < 3:
                    err_samples.append(str((body.get("error") or r.get("error")))[:200])
                continue
            usage = body.get("usage") or {}
            if part["endpoint"].endswith("embeddings"):
                content = json.dumps([round(x, 6) for x in body["data"][0]["embedding"]])
                nums = {"prompt_tokens": usage.get("prompt_tokens") or usage.get("total_tokens") or 0}
                usd = state.cost_from_usage(EMBED_MODEL, **nums) * DISCOUNT
                model = EMBED_MODEL
            else:
                ch = body["choices"][0]
                if ch.get("finish_reason") != "stop" or (ch["message"].get("refusal")):
                    # truncated or refused: charge it, retry it
                    nums = {"prompt_tokens": usage.get("prompt_tokens", 0), "completion_tokens": usage.get("completion_tokens", 0),
                            "cached_tokens": (usage.get("prompt_tokens_details") or {}).get("cached_tokens", 0)}
                    acc = cost_by_sid.setdefault(meta["sid"], {"usd": 0.0, "pt": 0, "ct": 0})
                    acc["usd"] += state.cost_from_usage(MODEL, **nums) * DISCOUNT
                    acc["pt"] += nums["prompt_tokens"]; acc["ct"] += nums["completion_tokens"]
                    if len(err_samples) < 3:
                        err_samples.append(f"finish_reason={ch.get('finish_reason')}")
                    continue
                content = ch["message"]["content"]
                nums = {"prompt_tokens": usage.get("prompt_tokens", 0), "completion_tokens": usage.get("completion_tokens", 0),
                        "cached_tokens": (usage.get("prompt_tokens_details") or {}).get("cached_tokens", 0)}
                usd = state.cost_from_usage(MODEL, **nums) * DISCOUNT
                model = MODEL
            acc = cost_by_sid.setdefault(meta["sid"], {"usd": 0.0, "pt": 0, "ct": 0})
            acc["usd"] += usd; acc["pt"] += nums.get("prompt_tokens", 0); acc["ct"] += nums.get("completion_tokens", 0)
            out_rows.append({"item": meta["item"], "sid": meta["sid"], "content": content, "usage": nums,
                             "cost_usd": round(usd, 8), "key": meta.get("key"), "cached": False})
            ok_count += 1
    with (d / f"{stage}_results.jsonl").open("a", encoding="utf-8") as fh:
        for r in out_rows:
            fh.write(json.dumps(r) + "\n")
    total_usd = 0.0
    for sid, acc in cost_by_sid.items():
        state.add_cost(sid, acc["usd"], f"bulk_{stage}", STATE, model=EMBED_MODEL if stage.startswith("embed") else MODEL,
                       usage={"prompt_tokens": acc["pt"], "completion_tokens": acc["ct"], "batch": b.id})
        total_usd += acc["usd"]
    part.update(status="done", ok=ok_count, errors=err_samples, cost_usd=round(total_usd, 6))

    def upd(run):
        run["batches"][b.id].update(status="completed", ok=ok_count, requests=part["n"], cost_usd=round(total_usd, 6))
        run["groups"][gid]["spent"] = round(run["groups"][gid].get("spent", 0.0) + total_usd, 6)
        for sid, acc in cost_by_sid.items():
            s = run["sources"].setdefault(sid, {})
            s["cost_usd"] = round(s.get("cost_usd", 0.0) + acc["usd"], 6)
    rs_update(upd)
    log(f"{gid}/{stage}: batch {b.id} completed {ok_count}/{part['n']} ok, ${total_usd:.4f}")


def poll_part(gid: str, stage: str, part: dict) -> None:
    b = net(client().batches.retrieve, part["batch_id"])
    if b.status in ("completed",):
        consume_part(gid, stage, part, b)
    elif b.status in ("failed", "expired", "cancelled"):
        errs = []
        try:
            errs = [str(e.message)[:160] for e in (b.errors.data if b.errors else [])][:3]
        except Exception:
            pass
        if b.output_file_id:
            consume_part(gid, stage, part, b)   # partial results on expiry
        part.update(status="done", ok=part.get("ok", 0), errors=errs or [b.status])
        rs_update(lambda run: run["batches"][b.id].update(status=b.status, errors=errs))
        log(f"{gid}/{stage}: batch {b.id} {b.status} {errs}")
    else:
        rs_update(lambda run: run["batches"][b.id].update(status=b.status))


# ---------------------------------------------------------------------------------------------
# Stage finalizers (pure local processing)
# ---------------------------------------------------------------------------------------------

def results_by_item(gid: str, stage: str) -> dict[str, dict]:
    out = {}
    for r in read_jsonl(gdir(gid) / f"{stage}_results.jsonl"):
        out[r["item"]] = r
    return out


def parse_window_out(content: str) -> list[dict]:
    return [l.model_dump() for l in l3.WindowOutV3.model_validate_json(content).lessons]


def missing_items(gid: str, stage: str, reqs_all: list[dict]) -> list[dict]:
    """Requests with no usable result (absent, or content that does not parse)."""
    res = results_by_item(gid, stage)
    bad = []
    for r in reqs_all:
        x = res.get(r["item"])
        if not x:
            bad.append(r)
            continue
        try:
            if stage in ("extract", "sweep"):
                parse_window_out(x["content"])
            elif stage in ("edit", "edit_retry"):
                ed.EditOut.model_validate_json(x["content"])
            else:
                json.loads(x["content"])
        except Exception:
            bad.append(r)
    return bad


def append_lesson_cache(stage: str, res: dict) -> None:
    rows = []
    for x in res.values():
        if x.get("cached") or not x.get("key"):
            continue
        try:
            lessons = parse_window_out(x["content"])
        except Exception:
            continue
        rows.append({"key": x["key"], "window_id": x["item"], "model": MODEL,
                     "prompt_version": l3.PROMPT_VERSION if stage == "extract" else sweep.SWEEP_VERSION,
                     "usage": x["usage"], "cost_usd": x["cost_usd"], "lessons": lessons})
    if rows:
        with l3.CACHE_PATH.open("a", encoding="utf-8") as fh:
            for r in rows:
                fh.write(json.dumps(r, ensure_ascii=False) + "\n")


def fail_source(sid: str, reason: str) -> None:
    def f(run):
        s = run["sources"].setdefault(sid, {})
        s.update(status="failed", failed_reason=reason)
    rs_update(f)
    log(f"source failed: {sid}: {reason}")


def finalize_stage(group: dict, stage: str) -> str | None:
    """Process a completed stage for every active source; return the next stage (None when all done)."""
    gid = group["id"]
    res = results_by_item(gid, stage)
    if stage not in ("embed1", "embed2"):
        good = {}
        for k, x in res.items():
            try:
                (parse_window_out if stage in ("extract", "sweep") else ed.EditOut.model_validate_json)(x["content"])
                good[k] = x
            except Exception:
                pass
        res = good
    if stage in ("extract", "sweep"):
        append_lesson_cache(stage, res)
    for sid in list(group["active"]):
        d = bulk_dir(sid)
        if stage == "extract":
            wins = read_jsonl(d / "windows.jsonl")
            lessons, dropped, failed = [], [], []
            for w in wins:
                x = res.get(w["window_id"])
                if not x:
                    failed.append(w["window_id"])
                    continue
                kept, drops = l3.validate_all(parse_window_out(x["content"]), w)
                lessons += lesson_rows(w, kept)
                dropped += [{"stage": "validation", **dr} for dr in drops]
            if len(failed) > max(2, int(0.02 * len(wins))):
                group["active"].remove(sid)
                fail_source(sid, f"{len(failed)} extraction windows failed after {ITEM_ATTEMPTS} attempts (e.g. {failed[0]})")
                continue
            dropped += [{"stage": "extract_window_failed", "window_id": f, "reasons": [f"failed after {ITEM_ATTEMPTS} attempts"],
                         "lesson": None} for f in failed]
            write_jsonl(d / "lessons_raw.jsonl", lessons)
            write_jsonl(d / "dropped_validation.jsonl", dropped)
            runs = [r for w in wins for r in sweep.build_run_windows(w, lessons)]
            write_jsonl(d / "sweep_runs.jsonl", runs)
        elif stage == "sweep":
            raw = read_jsonl(d / "lessons_raw.jsonl")
            runs = read_jsonl(d / "sweep_runs.jsonl")
            sw, dropped = [], read_jsonl(d / "dropped_validation.jsonl")
            for r in runs:
                x = res.get(r["window_id"])
                if not x:
                    dropped.append({"stage": "sweep", "window_id": r["window_id"], "reasons": ["call_failed"], "lesson": None})
                    continue
                kept, drops = l3.validate_all(parse_window_out(x["content"]), r)
                sw += sweep_rows(r, kept)
                dropped += [{"stage": "validation", **dr} for dr in drops]
            merged, trimmed = trim_per_window(raw + sw, EDITOR_MAX_PER_WINDOW)
            dropped += [{"stage": "trimmed_before_editor", "lesson_id": l["lesson_id"], "title": l.get("title"),
                         "reason": f"outside the {EDITOR_MAX_PER_WINDOW} most specific lessons of its window", "lesson": l}
                        for l in trimmed]
            write_jsonl(d / "merged.jsonl", merged)
            write_jsonl(d / "dropped_validation.jsonl", dropped)
        elif stage == "edit":
            lessons = {l["lesson_id"]: l for l in read_jsonl(d / "merged.jsonl")}
            decisions, retry = {}, {}
            for lid, l in lessons.items():
                x = res.get(lid)
                if not x:
                    decisions[lid] = {"verdict": "drop", "drop_reason": "editor_call_failed"}
                    continue
                out = ed.EditOut.model_validate_json(x["content"])
                r = ed.Editor._result(l, out, [])
                if r["verdict"] == "keep":
                    probs = ed.validate_edit(l, r["fields"], LIB) + ed.attribution_problems(r)
                    if probs:
                        retry[lid] = probs
                        r["problems"] = probs
                decisions[lid] = r
            (d / "edit_decisions.json").write_text(json.dumps(decisions, ensure_ascii=False), encoding="utf-8")
            (d / "edit_retry.json").write_text(json.dumps(retry), encoding="utf-8")
        elif stage == "edit_retry":
            lessons = {l["lesson_id"]: l for l in read_jsonl(d / "merged.jsonl")}
            decisions = json.loads((d / "edit_decisions.json").read_text())
            retry = json.loads((d / "edit_retry.json").read_text())
            for lid, probs in retry.items():
                x = res.get(lid)
                if not x:
                    decisions[lid] = {"verdict": "drop", "drop_reason": "editor_retry_call_failed: " + "; ".join(probs)}
                    continue
                out = ed.EditOut.model_validate_json(x["content"])
                r = ed.Editor._result(lessons[lid], out, probs)
                if r["verdict"] == "keep":
                    p2 = ed.validate_edit(lessons[lid], r["fields"], LIB) + ed.attribution_problems(r)
                    if p2:
                        r.update(verdict="drop", drop_reason="rewrite_failed_validation: " + "; ".join(p2), problems=probs + p2)
                decisions[lid] = r
            (d / "edit_decisions.json").write_text(json.dumps(decisions, ensure_ascii=False), encoding="utf-8")
        if stage in ("edit", "edit_retry") and not (stage == "edit" and json.loads((d / "edit_retry.json").read_text())):
            lessons = read_jsonl(d / "merged.jsonl")
            decisions = json.loads((d / "edit_decisions.json").read_text())
            kept, dropped = [], read_jsonl(d / "dropped_validation.jsonl")
            for l in lessons:
                r = decisions[l["lesson_id"]]
                if r["verdict"] == "keep":
                    kept.append(ed.apply_edit(l, r))
                else:
                    dropped.append({"stage": "editor", "lesson_id": l["lesson_id"], "title": l.get("title"),
                                    "reason": r["drop_reason"], "lesson": l})
            write_jsonl(d / "edited.jsonl", kept)
            write_jsonl(d / "dropped_validation.jsonl", dropped)
        if stage == "embed1":
            kept = read_jsonl(d / "edited.jsonl")
            emb = []
            for l in kept:
                x = res.get(l["lesson_id"])
                emb.append(json.loads(x["content"]))
            cands = [{"window_id": l.get("window_id"), "lesson": l} for l in kept]
            surv, merges = l3h.dedupe(cands, emb, DEDUPE_THRESHOLD) if kept else ([], [])
            surv_rows = [c["lesson"] for c in surv]
            survivors = {l["lesson_id"] for l in surv_rows}
            dropped = read_jsonl(d / "dropped_validation.jsonl")
            for l in kept:
                if l["lesson_id"] not in survivors:
                    dropped.append({"stage": "dedupe", "lesson_id": l["lesson_id"], "title": l.get("title"),
                                    "reason": f"duplicate at {DEDUPE_THRESHOLD}", "lesson": l})
            write_jsonl(d / "survivors.jsonl", surv_rows)
            write_jsonl(d / "dropped_validation.jsonl", dropped)
            (d / "dedupe_merges.json").write_text(json.dumps(merges, indent=1, ensure_ascii=False), encoding="utf-8")
        if stage == "embed2":
            save_source(sid, res)
            group["active"].remove(sid)
    # next stage
    if stage == "extract":
        nxt = "sweep"
    elif stage == "sweep":
        nxt = "edit"
    elif stage == "edit":
        nxt = "edit_retry" if any(json.loads((bulk_dir(s) / "edit_retry.json").read_text()) for s in group["active"]) else "embed1"
    elif stage == "edit_retry":
        nxt = "embed1"
    elif stage == "embed1":
        nxt = "embed2"
    else:
        nxt = None
    return nxt if group["active"] else None


EDITOR_MAX_PER_WINDOW = 5


def trim_per_window(lessons: list[dict], k: int) -> tuple[list[dict], list[dict]]:
    """Keep the k most specific lessons per window (extraction and sweep lessons together); order is preserved."""
    by: dict[str, list[int]] = {}
    for i, l in enumerate(lessons):
        by.setdefault(l["window_id"], []).append(i)
    drop = set()
    for idxs in by.values():
        if len(idxs) > k:
            ranked = sorted(idxs, key=lambda i: (tuple(-x for x in l3h.specificity(lessons[i])), i))
            drop.update(ranked[k:])
    return [l for i, l in enumerate(lessons) if i not in drop], [l for i, l in enumerate(lessons) if i in drop]


def book_info(sid: str) -> tuple[str | None, str | None]:
    return l3.source_info(sid, LIB)


def save_source(sid: str, emb_res: dict) -> None:
    d = bulk_dir(sid)
    title, author = book_info(sid)
    rows = []
    for l in read_jsonl(d / "survivors.jsonl"):
        x = emb_res.get(l["lesson_id"])
        if not x:
            continue
        rows.append({
            "lesson_id": l["lesson_id"], "source_id": sid, "source_title": title, "author": author,
            "chapter": l.get("chapter"), "page_start": l.get("page_start"), "page_end": l.get("page_end"),
            "paragraph_ids": l["paragraph_ids"],
            "paragraphs": l["evidence_paragraphs"],
            "title": l["title"], "author_argues": l["author_argues"], "principle": l["principle"],
            "evidence": l.get("evidence"), "caveat": l.get("caveat"), "short_quote": l.get("short_quote"),
            "applies_when": l["applies_when"], "example_questions": l["example_questions"],
            "lesson_type": l.get("lesson_type"), "pillars": l.get("pillars") or [], "origin": l.get("origin"),
            "window_id": l.get("window_id"),
            "extraction_version": EXTRACTION_VERSION, "prompt_version": l.get("prompt_version"),
            "editor_version": l.get("editor_version"), "model": MODEL,
            "embedding": json.loads(x["content"]), "embedding_model": EMBED_MODEL, "embedding_dims": EMBED_DIMS,
        })
    out = LIB / sid
    write_jsonl(out / "lessons.jsonl", rows)
    dropped = read_jsonl(d / "dropped_validation.jsonl")
    write_jsonl(out / "dropped.jsonl", dropped)
    words = sum(w["word_count"] for w in read_jsonl(d / "windows.jsonl"))
    by = {}
    for x in dropped:
        by[x["stage"]] = by.get(x["stage"], 0) + 1

    def f(run):
        s = run["sources"].setdefault(sid, {})
        s.update(status="done", kept=len(rows), dropped=len(dropped), dropped_by_stage=by, words=words,
                 per_1k=round(len(rows) / words * 1000, 2) if words else None, finished=now())
    rs_update(f)
    log(f"source done: {sid}: kept {len(rows)}, dropped {len(dropped)} {by}")
    after_source_done(sid)


# ---------------------------------------------------------------------------------------------
# Checkpoint and spot checks
# ---------------------------------------------------------------------------------------------

def sample_rows(sids: list[str], n: int, seed: int) -> list[dict]:
    pool = []
    for sid in sids:
        for l in read_jsonl(LIB / sid / "lessons.jsonl"):
            pool.append({"id": l["lesson_id"], "status": "kept", "source": l["source_title"], "chapter": l["chapter"],
                         "card": {k: l[k] for k in ("title", "author_argues", "principle", "applies_when", "evidence",
                                                    "caveat", "short_quote", "example_questions")},
                         "paragraphs": l["paragraphs"]})
    random.Random(seed).shuffle(pool)
    return pool[:n]


def after_source_done(sid: str) -> None:
    run = rs_get()
    done = [s for s, v in run["sources"].items() if v.get("status") == "done" and not v.get("smoke")]
    core_done = [s for s in done if run["sources"][s].get("core")]
    out = HERE / "checks"
    out.mkdir(exist_ok=True)
    if run["checkpoint"]["status"] == "unset" and len(core_done) >= CHECKPOINT_SOURCES:
        first5 = sorted(core_done, key=lambda s: run["sources"][s].get("finished", ""))[:CHECKPOINT_SOURCES]
        write_jsonl(out / "checkpoint_sample.jsonl", sample_rows(first5, 20, 7))
        rs_update(lambda r: r["checkpoint"].update(status="needed", sources=first5, sample=str(out / "checkpoint_sample.jsonl")))
        log(f"QUALITY CHECKPOINT needed: {out / 'checkpoint_sample.jsonl'}")
    if len(done) % SPOT_EVERY == 0 and len(done) > 0:
        p = out / f"spot_{len(done):03d}_{sid[-40:]}.jsonl"
        write_jsonl(p, sample_rows([sid], 10, len(done)))
        rs_update(lambda r: r["spot_pending"].append({"source_id": sid, "file": str(p), "done_count": len(done)}))
        log(f"spot check queued for {sid}: {p}")


# ---------------------------------------------------------------------------------------------
# Groups and main loop
# ---------------------------------------------------------------------------------------------

ONLY: set[str] = set()


def load_order(full: bool = True) -> list[dict]:
    o = json.loads(ORDER_PATH.read_text())
    if ONLY and not full:
        o = [x for x in o if x['source_id'] in ONLY]
    scope = rs_get().get("scope") or {}
    if scope and not full:
        o = [x for x in o if (not scope.get("core_only") or x["is_core"]) and x["type"] in scope.get("types", [x["type"]])]
    return o


def source_stats(sid: str) -> tuple[int, int]:
    ws = source_windows(sid)
    return len(ws), sum(w["word_count"] for w in ws)


def plan_groups(order: list[dict], run: dict) -> list[list[str]]:
    groups, cur, win = [], [], 0
    for o in order:
        sid = o["source_id"]
        if run["sources"].get(sid, {}).get("status") in ("done", "failed", "queued", "active"):
            continue
        n = run["sources"].get(sid, {}).get("windows") or source_stats(sid)[0]
        if cur and (len(cur) >= MAX_GROUP_SOURCES or win + n > MAX_GROUP_WINDOWS):
            groups.append(cur)
            cur, win = [], 0
        cur.append(sid)
        win += n
    if cur:
        groups.append(cur)
    return groups


def init_sources() -> None:
    order = load_order()

    def f(run):
        for o in order:
            s = run["sources"].setdefault(o["source_id"], {})
            s.setdefault("status", "pending")
            s.update(title=o["title"], pillar=o["pillar"], core=o["is_core"], type=o["type"])
            if "windows" not in s:
                pass
    rs_update(f)


def start_group(sids: list[str]) -> str | None:
    run = rs_get()
    wins = {sid: source_stats(sid) for sid in sids}
    n_win = sum(w[0] for w in wins.values())
    est = n_win * run["cost_per_window"]
    if spent() + committed(run) + est > run["cap_usd"]:
        rs_update(lambda r: r.update(halt=f"budget: next group needs ~${est:.2f}, spent ${spent():.2f} + committed ${committed(run):.2f} of ${run['cap_usd']:.2f}"))
        log("HALT: " + rs_get()["halt"])
        return None
    gid = f"g{len(run['groups']) + 1:03d}"
    for sid in sids:
        wl = source_windows(sid)
        d = bulk_dir(sid)
        write_jsonl(d / "windows.jsonl", wl)

    def f(run):
        run["groups"][gid] = {"id": gid, "sources": sids, "active": list(sids), "stage": "extract", "attempt": 0,
                              "parts": [], "status": "active", "est_total": round(est, 4), "spent": 0.0, "created": now(),
                              "windows": n_win}
        for sid in sids:
            run["sources"][sid].update(status="active", group=gid, windows=wins[sid][0], words=wins[sid][1])
    rs_update(f)
    log(f"{gid}: started with {sids} ({n_win} windows, est ${est:.2f})")
    return gid


def save_group(gid: str, group: dict) -> None:
    group.pop("all_reqs", None)

    def w(run):
        group["spent"] = run["groups"][gid].get("spent", 0.0)
        run["groups"][gid] = group
    rs_update(w)


def tick_group(gid: str) -> None:
    run = rs_get()
    group = run["groups"][gid]
    if group["status"] != "active":
        return
    stage = group["stage"]
    if not group["parts"] and not group.get("started_stage"):
        reqs = build_requests(group, stage)
        gdir(gid)
        group["all_reqs"] = None
        if group["attempt"] == 0:
            (gdir(gid) / f"{stage}_results.jsonl").write_text("") if not (gdir(gid) / f"{stage}_results.jsonl").exists() else None
        group["parts"] = make_parts(gid, stage, group["attempt"], reqs)
        group["started_stage"] = True
        save_group(gid, group)
    for part in group["parts"]:
        if part["status"] == "new":
            try:
                ok = submit_part(gid, stage, part)
                save_group(gid, group)
                if not ok:
                    break
            except state.BudgetExhausted as exc:
                group["status"] = "halted"
                rs_update(lambda r: r.update(halt=str(exc)))
                log(f"{gid}: HALT {exc}")
                break
        elif part["status"] == "submitted":
            poll_part(gid, stage, part)
            save_group(gid, group)
    if group["status"] == "active" and group.get("started_stage") and all(p["status"] == "done" for p in group["parts"]):
        reqs_all = build_requests(group, stage)
        bad = missing_items(gid, stage, reqs_all)
        if bad and group["attempt"] + 1 < ITEM_ATTEMPTS:
            group["attempt"] += 1
            log(f"{gid}/{stage}: retrying {len(bad)} failed requests (attempt {group['attempt'] + 1}/{ITEM_ATTEMPTS})")
            group["parts"] = make_parts(gid, stage, group["attempt"], bad)
        else:
            nxt = finalize_stage(group, stage)
            group.update(parts=[], started_stage=False, attempt=0)
            if nxt is None:
                group["status"] = "done"
                group["finished"] = now()
                n_win = group["windows"]
                if n_win and group["spent"]:
                    cpw = group["spent"] / n_win
                    rs_update(lambda r: r.update(cost_per_window=round(0.5 * r["cost_per_window"] + 0.5 * cpw * 1.1, 6)))
                log(f"{gid}: finished (${group['spent']:.2f} for {n_win} windows)")
            else:
                group["stage"] = nxt
                log(f"{gid}: -> {nxt}")
    save_group(gid, group)
    write_report()


def run_loop(max_groups: int | None) -> int:
    init_sources()
    rs_update(lambda r: r.update(pid=os.getpid(), halt=None))
    started = 0
    while True:
        run = rs_get()
        active = [g for g in run["groups"].values() if g["status"] == "active"]
        for g in active:
            try:
                tick_group(g["id"])
            except state.BudgetExhausted as exc:
                rs_update(lambda r: r.update(halt=str(exc)))
            except Exception as exc:  # noqa: BLE001
                log(f"{g['id']}: ERROR {type(exc).__name__}: {exc}\n{traceback.format_exc()[-600:]}")
                time.sleep(NET_WAIT_S)
        run = rs_get()
        active = [g for g in run["groups"].values() if g["status"] == "active"]
        ck = run["checkpoint"]["status"]
        can_start = (len(active) < MAX_ACTIVE_GROUPS and not run.get("halt") and ck in ("unset", "pass")
                     and (max_groups is None or started < max_groups))
        # do not start more core groups than needed for the checkpoint until it passes
        if can_start and ck == "unset":
            core_in_play = [s for s, v in run["sources"].items() if v.get("core") and not v.get("smoke") and v.get("status") in ("active", "done")]
            if len(core_in_play) >= CHECKPOINT_SOURCES:
                can_start = False
        if can_start:
            nxt = plan_groups(load_order(full=False), run)
            if nxt:
                if start_group(nxt[0]):
                    started += 1
                    continue
            elif not active:
                log("all sources processed")
                break
        if not active and not can_start:
            if ck == "needed" and not run.get("halt"):
                pass            # waiting for the enrichment-checker verdict; keep the process alive
            else:
                log(f"idle: checkpoint={ck} halt={run.get('halt')}")
                break
        time.sleep(POLL_S)
    write_report()
    rs_update(lambda r: r.update(pid=None))
    return 0


# ---------------------------------------------------------------------------------------------
# Report
# ---------------------------------------------------------------------------------------------

def write_report() -> None:
    run = rs_get()
    order = load_order()
    st = state.load(STATE)
    S = run["sources"]
    done = [s for s, v in S.items() if v.get("status") == "done"]
    lessons = sum(S[s].get("kept", 0) for s in done)
    pend = [f"{b} ({v['stage']})" for b, v in run["batches"].items() if v.get("status") not in ("completed", "failed", "expired", "cancelled")]
    run_spend = sum(v.get("cost_usd", 0.0) for v in S.values())
    lines = ["# Library Report", "", f"Last updated: {now()}", "",
             f"- Sources done: {len(done)} of {len(order)}",
             f"- Lessons total: {lessons}",
             f"- OpenAI spend: ${spent():.2f} of ${run['cap_usd']:.2f} cap (this bulk run: ${run_spend:.2f}; earlier pilot work: ${spent() - run_spend:.2f})",
             f"- Pending batch ids: {', '.join(pend) if pend else 'none'}",
             f"- Quality checkpoint: {run['checkpoint']['status']}",
             f"- Run halt: {run.get('halt') or 'none'}", "",
             "## Sources", "",
             "| Title | Pillar | Core | Status | Kept | Dropped | Per 1,000 words | Cost | Spot check |",
             "|---|---|---|---|---|---|---|---|---|"]
    for o in order:
        v = S.get(o["source_id"], {})
        g = run["groups"].get(v.get("group", ""), {})
        status = v.get("status", "pending")
        sc = run.get("scope") or {}
        if status == "pending" and sc and not ((not sc.get("core_only") or o["is_core"]) and o["type"] in sc.get("types", [o["type"]])):
            status = "deferred (out of scope)"
        if status == "active":
            status = f"active ({g.get('stage')})"
        lines.append(f"| {o['title']} | {o['pillar']} | {'yes' if o['is_core'] else 'no'} | {status} | "
                     f"{v.get('kept', '')} | {v.get('dropped', '')} | {v.get('per_1k', '')} | "
                     f"${v.get('cost_usd', 0.0):.2f} | {v.get('spot_check', '')} |")
    failed = [(s, v) for s, v in S.items() if v.get("status") == "failed"]
    lines += ["", "## Failed sources", ""]
    lines += [f"- {S[s].get('title', s)}: {v.get('failed_reason')}" for s, v in failed] or ["None."]
    lines += ["", "## Excluded sources", ""]
    lines += excluded_lines()
    REPORT_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")


def excluded_lines() -> list[str]:
    m = json.loads((HERE / "library_manifest.json").read_text())
    rep = (HERE / "EXTRACTION_REPORT.md").read_text()
    stat = dict(re.findall(r"^\| (\S+) \| (\w+) \|", rep, re.M))
    out = []
    for s in m["sources"]:
        if s.get("duplicate_of"):
            out.append(f"- {s['title']}: duplicate of {s['duplicate_of']}")
        elif stat.get(s["source_id"], "ok") != "ok":
            out.append(f"- {s['title']}: {stat[s['source_id']]} (no usable text layer or paragraphs)")
    return out or ["None."]


# ---------------------------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------------------------

def cmd_plan() -> None:
    init_sources()
    run = rs_get()
    order = load_order()
    tot_w = tot_words = 0
    for o in order:
        n, w = source_stats(o["source_id"])
        tot_w += n
        tot_words += w
    est = tot_w * run["cost_per_window"]
    core = sum(1 for o in order if o["is_core"])
    print(f"{len(order)} sources ({core} core), {tot_w} windows, {tot_words} words")
    print(f"estimate at ${run['cost_per_window']}/window: ${est:.2f}; spent so far ${spent():.2f}; cap ${run['cap_usd']:.2f}; "
          f"windows affordable ~{int((run['cap_usd'] - spent()) / run['cost_per_window'])}")
    print("groups (first 5):", plan_groups(order, run)[:5])


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sp = ap.add_subparsers(dest="cmd", required=True)
    sp.add_parser("plan")
    r = sp.add_parser("run"); r.add_argument("--max-groups", type=int); r.add_argument("--only", nargs="*")
    sp.add_parser("status")
    sp.add_parser("report")
    c = sp.add_parser("checkpoint"); c.add_argument("result", choices=["pass", "fail"]); c.add_argument("--note", default="")
    s = sp.add_parser("spotcheck"); s.add_argument("source_id"); s.add_argument("--severe", type=int, required=True)
    s.add_argument("--passed", type=int, default=None)
    a = ap.parse_args(argv)
    if a.cmd == "plan":
        cmd_plan()
    elif a.cmd == "run":
        ONLY.update(a.only or [])
        return run_loop(a.max_groups)
    elif a.cmd == "status":
        run = rs_get()
        print(json.dumps({"groups": {k: {x: v[x] for x in ("sources", "stage", "status", "spent")} for k, v in run["groups"].items()},
                          "checkpoint": run["checkpoint"], "halt": run.get("halt"), "spent": spent(), "pid": run.get("pid")}, indent=1))
    elif a.cmd == "report":
        write_report()
    elif a.cmd == "checkpoint":
        rs_update(lambda run: run["checkpoint"].update(status=a.result, note=a.note, decided=now()))
        write_report()
    elif a.cmd == "spotcheck":
        def f(run):
            run["sources"][a.source_id]["spot_check"] = f"{a.severe} severe" + (f", {a.passed}/10 pass" if a.passed is not None else "")
            run["spot_pending"] = [x for x in run["spot_pending"] if x["source_id"] != a.source_id]
            if a.severe > 3:
                run["halt"] = f"spot check failed: {a.source_id} has {a.severe} severe"
        rs_update(f)
        write_report()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
