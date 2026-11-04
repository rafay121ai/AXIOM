#!/usr/bin/env python3
"""One-off read-only MAIN export. Requires python-dotenv and certifi; never logs keys."""

import hashlib
import json
import os
import ssl
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, HTTPSHandler, Request, build_opener

import certifi
from dotenv import dotenv_values


ENV_PATH = Path("/Users/rafayessani/AXIOM/.env")
OUTPUT = Path("/Users/rafayessani/AXIOM-backups/2026-10-13/main")
TABLES = {"wiki_chunks": 31371, "wiki_sources": 250}
PAGE_SIZE = 500


class NoRedirects(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise RuntimeError("Redirect refused to protect credentials")


class Reader:
    def __init__(self):
        env = dotenv_values(ENV_PATH, interpolate=False)
        self.base = (env.get("VITE_SUPABASE_URL") or "").rstrip("/")
        key = env.get("SUPABASE_SERVICE_ROLE_KEY")
        parsed = urlsplit(self.base)
        if (parsed.scheme != "https" or not parsed.hostname or parsed.username
                or parsed.password or parsed.query or parsed.fragment or parsed.path):
            raise RuntimeError("Invalid MAIN project URL configuration")
        if not key:
            raise RuntimeError("Missing service role key configuration")
        self.headers = {"apikey": key, "Authorization": "Bearer " + key,
                        "Accept": "application/json", "Accept-Profile": "public"}
        self.opener = build_opener(NoRedirects(), HTTPSHandler(context=ssl.create_default_context(cafile=certifi.where())))

    def read(self, table, parameters, method="GET", count=False):
        if table not in TABLES or method not in {"GET", "HEAD"}:
            raise RuntimeError("Only approved read operations are allowed")
        headers = dict(self.headers)
        if count:
            headers["Prefer"] = "count=exact"
        request = Request(self.base + "/rest/v1/" + table + "?" + urlencode(parameters),
                          headers=headers, method=method)
        try:
            with self.opener.open(request, timeout=35) as response:
                body = response.read() if method == "GET" else b""
                return body, response.headers
        except HTTPError as error:
            status = error.code
            error.close()
            raise RuntimeError(f"Read failed for {table}: HTTP {status}; response suppressed") from None
        except Exception:
            raise RuntimeError(f"Read failed for {table}; connection details suppressed") from None

    def count(self, table):
        _, headers = self.read(table, {"select": "*", "limit": 1}, method="HEAD", count=True)
        total = headers.get("Content-Range", "").rsplit("/", 1)[-1]
        if not total.isdigit():
            raise RuntimeError(f"Exact live count unavailable for {table}")
        return int(total)


def exclusive_file(path):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    return os.fdopen(fd, "w", encoding="utf-8", newline="\n")


def export_table(reader, table):
    before = reader.count(table)
    print(f"{table}: live count before export = {before}", flush=True)
    destination = OUTPUT / f"{table}.jsonl"
    seen = set()
    columns = None
    last_id = None
    digest = hashlib.sha256()
    embedding_nonnull = 0
    with exclusive_file(destination) as handle:
        while True:
            parameters = {"select": "*", "order": "id.asc", "limit": PAGE_SIZE}
            if last_id is not None:
                parameters["id"] = "gt." + last_id
            body, _ = reader.read(table, parameters)
            rows = json.loads(body)
            if not isinstance(rows, list):
                raise RuntimeError(f"Unexpected page format for {table}")
            if not rows:
                break
            for row in rows:
                if not isinstance(row, dict) or not isinstance(row.get("id"), str):
                    raise RuntimeError(f"Invalid row identity in {table}")
                row_id = row["id"]
                if row_id in seen or (last_id is not None and row_id <= last_id):
                    raise RuntimeError(f"Duplicate or unordered ID in {table}")
                if columns is None:
                    columns = sorted(row)
                    if table == "wiki_chunks" and "embedding" not in row:
                        raise RuntimeError("Embedding column missing from wiki_chunks response")
                if sorted(row) != columns:
                    raise RuntimeError(f"Column set changed while exporting {table}")
                line = json.dumps(row, ensure_ascii=False, separators=(",", ":"), allow_nan=False) + "\n"
                handle.write(line)
                digest.update(line.encode("utf-8"))
                seen.add(row_id)
                last_id = row_id
                embedding_nonnull += row.get("embedding") is not None
            handle.flush()
            if len(seen) % 5000 < len(rows):
                print(f"{table}: exported {len(seen)} rows", flush=True)
        handle.flush()
        os.fsync(handle.fileno())
    after = reader.count(table)
    matches = before == len(seen) == after
    result = {"file": str(destination), "rows": len(seen), "live_before": before,
              "live_after": after, "counts_match": matches,
              "approximate_expected": TABLES[table], "delta_from_approximate": len(seen) - TABLES[table],
              "columns": columns or [], "sha256": digest.hexdigest(),
              "bytes": destination.stat().st_size}
    if table == "wiki_chunks":
        result["nonnull_embeddings"] = embedding_nonnull
    print(f"{table}.jsonl: {len(seen)} rows; live before/after {before}/{after}; match={matches}", flush=True)
    return result


def main():
    reader = Reader()
    OUTPUT.mkdir(parents=True, exist_ok=True, mode=0o700)
    names = [f"{table}.jsonl" for table in TABLES] + ["export_manifest.json"]
    if any((OUTPUT / name).exists() for name in names):
        raise RuntimeError("An export destination already exists; nothing will be overwritten or deleted")
    results = {table: export_table(reader, table) for table in TABLES}
    manifest = {"completed_at_utc": datetime.now(timezone.utc).isoformat(),
                "read_only": True, "select": "*", "tables": results,
                "snapshot_note": "Separate paged REST reads are not a transactional snapshot. Equal counts do not detect concurrent in-place updates."}
    with exclusive_file(OUTPUT / "export_manifest.json") as handle:
        json.dump(manifest, handle, indent=2)
        handle.write("\n")
    if not all(result["counts_match"] for result in results.values()):
        raise RuntimeError("Export counts differ from live counts; files preserved for inspection")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        message = str(error) if type(error) is RuntimeError else type(error).__name__
        print("Export stopped: " + message + ". Existing files are preserved.", file=sys.stderr)
        raise SystemExit(1) from None
