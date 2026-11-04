"""Resumable pipeline state for the Axiom library (part A and part B share this).

State lives in knowledge_pilot/library_state.json. Every mutation is a locked
read-modify-write that ends in an atomic replace, so two processes (extraction
and enrichment) can both update it and a crash never leaves a half-written file.

Cost rules: cost is recorded only from usage returned by an API response.
Use cost_from_usage() on the response usage object, then add_cost().
Nothing in this module talks to the network.
"""

from __future__ import annotations

import contextlib
import fcntl
import json
import os
import tempfile
import time
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
DEFAULT_STATE_PATH = HERE / "library_state.json"
DEFAULT_BUDGET_USD = 15.00
SCHEMA_VERSION = 1

STATUSES = (
    "pending", "extracted", "chunked", "qa_passed", "enriched", "embedded", "done",
    "needs_review", "excluded", "duplicate", "unsupported_format",
    "qa_failed_pending_fix",  # non-final: waits in needs_fix_queue.json for a chunker fix and --retry-failed
)
# Statuses a source can only leave deliberately (force), never by a normal rerun.
TERMINAL_STATUSES = ("excluded", "duplicate", "unsupported_format")
# Progress ladder for the happy path. needs_review sits beside qa_passed.
PROGRESS_ORDER = ("pending", "extracted", "chunked", "qa_passed", "enriched", "embedded", "done")

# USD per 1M tokens.
PRICING = {
    "gpt-4.1-mini": {"input": 0.40, "cached_input": 0.10, "output": 1.60},
    "gpt-4.1": {"input": 2.00, "cached_input": 0.50, "output": 8.00},
    "text-embedding-3-small": {"input": 0.02, "cached_input": 0.02, "output": 0.0},
}


class BudgetExhausted(RuntimeError):
    """Raised by refuse_to_start() when the budget cannot cover more spend."""


class UnknownStatus(ValueError):
    pass


def cost_from_usage(model: str, prompt_tokens: int = 0, completion_tokens: int = 0,
                    cached_tokens: int = 0) -> float:
    """USD cost from the usage block an API response returned."""
    if model not in PRICING:
        raise KeyError(f"No pricing configured for model {model!r}")
    p = PRICING[model]
    cached = min(max(cached_tokens or 0, 0), prompt_tokens or 0)
    uncached = max((prompt_tokens or 0) - cached, 0)
    return (uncached * p["input"] + cached * p["cached_input"]
            + (completion_tokens or 0) * p["output"]) / 1_000_000


def _empty_state(budget: float) -> dict[str, Any]:
    return {"version": SCHEMA_VERSION, "budget_usd": budget, "cost_usd_total": 0.0,
            "updated_at": None, "sources": {}}


def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S%z")


def _atomic_write(path: Path, state: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=path.name + ".", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(state, handle, indent=2, ensure_ascii=False, sort_keys=True)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp, path)
    except BaseException:
        with contextlib.suppress(FileNotFoundError):
            os.unlink(tmp)
        raise


def load(path: Path | str | None = None, budget: float = DEFAULT_BUDGET_USD) -> dict[str, Any]:
    """Read state from disk (an empty state if the file does not exist yet)."""
    path = Path(path or DEFAULT_STATE_PATH)
    if not path.exists():
        return _empty_state(budget)
    state = json.loads(path.read_text(encoding="utf-8"))
    state.setdefault("sources", {})
    state.setdefault("budget_usd", budget)
    state.setdefault("cost_usd_total", 0.0)
    return state


def save(state: dict[str, Any], path: Path | str | None = None) -> None:
    """Atomically write a state dict. Prefer the mutators, which also lock."""
    state["cost_usd_total"] = round(sum(s.get("cost_usd", 0.0) for s in state["sources"].values()), 8)
    state["updated_at"] = _now()
    _atomic_write(Path(path or DEFAULT_STATE_PATH), state)


@contextlib.contextmanager
def _locked(path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)
    lock = path.with_suffix(path.suffix + ".lock")
    with open(lock, "w") as handle:
        fcntl.flock(handle, fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(handle, fcntl.LOCK_UN)


def _entry(state: dict[str, Any], source_id: str) -> dict[str, Any]:
    return state["sources"].setdefault(
        source_id, {"status": "pending", "cost_usd": 0.0, "costs": [], "notes": []})


@contextlib.contextmanager
def transaction(path: Path | str | None = None, budget: float = DEFAULT_BUDGET_USD):
    """Locked read-modify-write. Yields the state dict; saves on clean exit."""
    path = Path(path or DEFAULT_STATE_PATH)
    with _locked(path):
        state = load(path, budget)
        yield state
        save(state, path)


def ensure_source(source_id: str, path: Path | str | None = None, **meta: Any) -> dict[str, Any]:
    """Register a source as pending if unknown. Never changes an existing status."""
    with transaction(path) as state:
        entry = _entry(state, source_id)
        for key, value in meta.items():
            entry.setdefault(key, value)
        return dict(entry)


def get_status(source_id: str, path: Path | str | None = None) -> str:
    return load(path)["sources"].get(source_id, {}).get("status", "pending")


def set_status(source_id: str, status: str, path: Path | str | None = None,
               note: str | None = None, **fields: Any) -> None:
    if status not in STATUSES:
        raise UnknownStatus(f"{status!r} is not one of {STATUSES}")
    with transaction(path) as state:
        entry = _entry(state, source_id)
        entry["status"] = status
        entry["status_updated_at"] = _now()
        if note:
            entry["notes"].append({"at": _now(), "note": note})
        entry.update(fields)


def update_fields(source_id: str, path: Path | str | None = None, **fields: Any) -> None:
    """Record extra per-source fields (counts, flags) without touching the status."""
    with transaction(path) as state:
        _entry(state, source_id).update(fields)


def add_cost(source_id: str, usd: float, purpose: str, path: Path | str | None = None,
             model: str | None = None, usage: dict | None = None) -> float:
    """Record API spend for a source. usd must come from returned usage.

    Returns the new global total. Does not enforce the budget by itself; call
    refuse_to_start() before spending.
    """
    if usd < 0:
        raise ValueError("Cost cannot be negative")
    with transaction(path) as state:
        entry = _entry(state, source_id)
        entry["cost_usd"] = round(entry.get("cost_usd", 0.0) + usd, 8)
        row = {"at": _now(), "purpose": purpose, "usd": round(usd, 8)}
        if model:
            row["model"] = model
        if usage:
            row["usage"] = usage
        entry["costs"].append(row)
        total = round(sum(s.get("cost_usd", 0.0) for s in state["sources"].values()), 8)
        return total


def cost_by_model(source_id: str | None = None, path: Path | str | None = None) -> dict[str, float]:
    """USD per model, from the cost rows (one source, or all sources when source_id is None).
    Rows recorded without a model are grouped under "unknown"."""
    out: dict[str, float] = {}
    for sid, entry in load(path)["sources"].items():
        if source_id is not None and sid != source_id:
            continue
        for row in entry.get("costs", []):
            m = row.get("model") or "unknown"
            out[m] = round(out.get(m, 0.0) + row.get("usd", 0.0), 8)
    return out


def total_cost(path: Path | str | None = None) -> float:
    state = load(path)
    return round(sum(s.get("cost_usd", 0.0) for s in state["sources"].values()), 8)


def budget_remaining(path: Path | str | None = None) -> float:
    state = load(path)
    spent = sum(s.get("cost_usd", 0.0) for s in state["sources"].values())
    return round(state.get("budget_usd", DEFAULT_BUDGET_USD) - spent, 8)


def set_budget(usd: float, path: Path | str | None = None) -> None:
    with transaction(path) as state:
        state["budget_usd"] = float(usd)


def refuse_to_start(estimate_usd: float = 0.0, path: Path | str | None = None) -> None:
    """Raise BudgetExhausted unless the remaining budget covers estimate_usd.

    With estimate 0 this refuses only when nothing at all is left. Call it
    before every paid API call and at the start of every run.
    """
    remaining = budget_remaining(path)
    if remaining <= 0 or remaining < estimate_usd:
        raise BudgetExhausted(
            f"Budget exhausted: ${remaining:.4f} remaining, ${estimate_usd:.4f} needed")


def sources_with_status(*statuses: str, path: Path | str | None = None) -> list[str]:
    return [sid for sid, e in load(path)["sources"].items() if e.get("status") in statuses]


def at_least(source_id: str, status: str, path: Path | str | None = None) -> bool:
    """True when a source has progressed to or beyond status on the happy path."""
    current = get_status(source_id, path)
    if current not in PROGRESS_ORDER or status not in PROGRESS_ORDER:
        return current == status
    return PROGRESS_ORDER.index(current) >= PROGRESS_ORDER.index(status)


def can_start(estimated_usd: float = 0.0, path: Path | str | None = None) -> bool:
    """True when the remaining budget covers estimated_usd (part B's check)."""
    remaining = budget_remaining(path)
    return remaining > 0 and remaining >= estimated_usd
