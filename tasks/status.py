#!/usr/bin/env python3
"""Keeps tasks/build_status.json up to date for the "Axiom build" panel.

The build session runs one short command after every step, for example:
  python3 tasks/status.py headline "Building the care check (B2)" --phase Server
  python3 tasks/status.py step B2 doing "12 of 40 cases written"
  python3 tasks/status.py now "Writing the distress check" --why "It runs before any lesson" --how "Tests first"
  python3 tasks/status.py helper builder running "Care classifier"
  python3 tasks/status.py helper builder reported "Care classifier" "40 cases pass"
  python3 tasks/status.py event "B1 finished"
  python3 tasks/status.py spend 0.50 --runs 1
  python3 tasks/status.py tests 41 0 "node --test server"
  python3 tasks/status.py needs add "Approve the first real-model run"
  python3 tasks/status.py needs clear
  python3 tasks/status.py blocker add "Tests fail twice: ..."
  python3 tasks/status.py next "Checkpoint 2: after B9" "Server done"
  python3 tasks/status.py rate waiting 2026-10-27T09:00:00+05:00     (or: rate ok)
  python3 tasks/status.py mode running | paused | complete   (a resume watcher only acts when mode is running)
"""
import argparse, datetime, json, os, sys

PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "build_status.json")
STEPS = [("B0", "Set up the new branch and check what exists"), ("B1", "Server foundation and test fakes"), ("B2", "Care check (distress) and its tests"),
         ("B3", "Sign-up answers and first reading"), ("B4", "Situation and Read"), ("B5", "Learn, citations, pictures, move card"), ("B6", "Move"),
         ("B7", "Report, stories, sharing"), ("B8", "Pushes and scheduler"), ("B9", "Home, History, Settings"),
         ("B10", "Database migrations (written, not applied)"), ("B11", "The Expo app, screen by screen"), ("B12", "Review, walkthrough, final report")]


def now():
    return datetime.datetime.now().astimezone().isoformat(timespec="seconds")


def load():
    try:
        with open(PATH) as f:
            return json.load(f)
    except Exception:
        return {"headline": "Build status", "steps": [{"id": i, "title": t, "state": "todo"} for i, t in STEPS], "helpers": [], "events": [],
                "needs_you": [], "blockers": [], "spend": {"capUsd": 6.0, "usedUsd": 0.0, "runs": 0, "maxRuns": 3}, "rate_limit": {"state": "ok", "resumes_at": None}}


def save(d):
    d["updated"] = now()
    tmp = PATH + ".tmp"
    with open(tmp, "w") as f:
        json.dump(d, f, indent=2)
    os.replace(tmp, PATH)


def event(d, text):
    d.setdefault("events", []).append({"t": now(), "text": text})
    d["events"] = d["events"][-40:]


def main():
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("headline"); a.add_argument("text"); a.add_argument("--phase")
    a = sub.add_parser("step"); a.add_argument("id"); a.add_argument("state", choices=["todo", "doing", "done", "blocked"]); a.add_argument("note", nargs="?", default="")
    a = sub.add_parser("now"); a.add_argument("what"); a.add_argument("--why"); a.add_argument("--how")
    a = sub.add_parser("helper"); a.add_argument("name"); a.add_argument("state", choices=["running", "waiting", "reported", "failed", "remove"]); a.add_argument("task", nargs="?", default=""); a.add_argument("report", nargs="?", default="")
    a = sub.add_parser("event"); a.add_argument("text")
    a = sub.add_parser("spend"); a.add_argument("used", type=float); a.add_argument("--runs", type=int)
    a = sub.add_parser("tests"); a.add_argument("passing", type=int); a.add_argument("failing", type=int); a.add_argument("last", nargs="?", default="")
    a = sub.add_parser("needs"); a.add_argument("action", choices=["add", "clear"]); a.add_argument("text", nargs="?", default="")
    a = sub.add_parser("blocker"); a.add_argument("action", choices=["add", "clear"]); a.add_argument("text", nargs="?", default="")
    a = sub.add_parser("next"); a.add_argument("name"); a.add_argument("note", nargs="?", default="")
    a = sub.add_parser("rate"); a.add_argument("state", choices=["ok", "waiting"]); a.add_argument("resumes_at", nargs="?")
    a = sub.add_parser("mode"); a.add_argument("state", choices=["running", "paused", "complete"])
    args = p.parse_args()
    d = load()
    if args.cmd == "headline":
        d["headline"] = args.text
        if args.phase: d["phase"] = args.phase
    elif args.cmd == "step":
        for s in d.setdefault("steps", []):
            if s["id"] == args.id:
                s["state"] = args.state
                if args.note: s["note"] = args.note
                break
        else:
            sys.exit("unknown step " + args.id)
        event(d, f"{args.id} is {args.state}" + (f": {args.note}" if args.note else ""))
    elif args.cmd == "now":
        d["now"] = {"what": args.what, "since": now()}
        if args.why: d["now"]["why"] = args.why
        if args.how: d["now"]["how"] = args.how
    elif args.cmd == "helper":
        hs = d.setdefault("helpers", [])
        hs[:] = [h for h in hs if h["name"] != args.name]
        if args.state != "remove":
            h = {"name": args.name, "task": args.task, "state": args.state, "since": now()}
            if args.report: h["report"] = args.report
            hs.append(h)
        event(d, f"helper {args.name}: {args.state}" + (f" ({args.report})" if args.report else ""))
    elif args.cmd == "event":
        event(d, args.text)
    elif args.cmd == "spend":
        d.setdefault("spend", {"capUsd": 6.0, "maxRuns": 3, "runs": 0})["usedUsd"] = args.used
        if args.runs is not None: d["spend"]["runs"] = args.runs
    elif args.cmd == "tests":
        d["tests"] = {"passing": args.passing, "failing": args.failing, "last": args.last}
    elif args.cmd in ("needs", "blocker"):
        key = "needs_you" if args.cmd == "needs" else "blockers"
        if args.action == "clear": d[key] = []
        else: d.setdefault(key, []).append(args.text)
    elif args.cmd == "next":
        d["next_stop"] = {"name": args.name, "note": args.note}
    elif args.cmd == "mode":
        d["mode"] = args.state
        event(d, f"build mode: {args.state}")
    elif args.cmd == "rate":
        d["rate_limit"] = {"state": args.state, "resumes_at": args.resumes_at}
        event(d, "usage limit reached: waiting to resume" if args.state == "waiting" else "usage limit over: resumed")
    save(d)


if __name__ == "__main__":
    main()
