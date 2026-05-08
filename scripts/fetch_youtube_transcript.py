#!/usr/bin/env python3
"""
Fetch YouTube transcripts and write chunked text ready for embedding.

Usage:
    python scripts/fetch_youtube_transcript.py <url_or_id> [<url_or_id> ...]

By default, each video produces one JSONL file at sources/transcripts/<video_id>.jsonl.
Every line is a chunk: {"video_id": "...", "url": "...", "chunk_index": 0, "chunk_count": 5, "text": "..."}

Use --stdout-json for the legacy seed.js pipeline. It accepts exactly one input
and prints one JSON object with {video_id, method, char_count, text}.

Runs locally only - datacenter IPs are blocked by YouTube.
Errors are logged per-video; the batch continues.
"""
import argparse
import json
import os
import re
import sys
import textwrap
from pathlib import Path

try:
    from youtube_transcript_api import YouTubeTranscriptApi
    from youtube_transcript_api.proxies import WebshareProxyConfig
except ModuleNotFoundError as exc:
    print(
        "Missing dependency: youtube-transcript-api. "
        "Install with: pip install youtube-transcript-api",
        file=sys.stderr,
    )
    raise SystemExit(1) from exc

CHUNK_WORDS = 500
OUT_DIR = Path(__file__).parent.parent / "sources" / "transcripts"

VIDEO_ID_RE = re.compile(
    r"(?:youtube\.com/(?:watch\?v=|shorts/|embed/|v/)|youtu\.be/)([A-Za-z0-9_-]{11})"
)


def extract_video_id(raw: str) -> str:
    raw = raw.strip()
    m = VIDEO_ID_RE.search(raw)
    if m:
        return m.group(1)
    if re.fullmatch(r"[A-Za-z0-9_-]{11}", raw):
        return raw
    raise ValueError(f"Cannot extract video ID from: {raw!r}")


def build_api() -> YouTubeTranscriptApi:
    username = os.environ.get("WEBSHARE_PROXY_USERNAME")
    password = os.environ.get("WEBSHARE_PROXY_PASSWORD")
    if username and password:
        return YouTubeTranscriptApi(
            proxy_config=WebshareProxyConfig(
                proxy_username=username,
                proxy_password=password,
            )
        )
    return YouTubeTranscriptApi()


def fetch_transcript(api: YouTubeTranscriptApi, video_id: str):
    try:
        return api.list(video_id).find_manually_created_transcript(["en"]).fetch(), "manual"
    except Exception:
        pass
    try:
        transcript_list = api.list(video_id)
        generated = [t for t in transcript_list if t.is_generated]
        if generated:
            return generated[0].fetch(), "auto-generated"
        all_transcripts = list(transcript_list)
        if all_transcripts:
            return all_transcripts[0].fetch(), "any"
    except Exception:
        pass
    raise RuntimeError(f"No transcript available for {video_id}")


def join_text(transcript) -> str:
    return " ".join(snippet.text for snippet in transcript).strip()


def chunk_text(text: str, chunk_words: int = CHUNK_WORDS) -> list[str]:
    words = text.split()
    if not words:
        return []
    chunks = []
    for i in range(0, len(words), chunk_words):
        chunk = " ".join(words[i : i + chunk_words])
        if chunk:
            chunks.append(chunk)
    return chunks


def transcript_payload(api: YouTubeTranscriptApi, raw_input: str) -> dict:
    video_id = extract_video_id(raw_input)
    transcript, method = fetch_transcript(api, video_id)
    text = join_text(transcript)
    return {
        "video_id": video_id,
        "url": f"https://www.youtube.com/watch?v={video_id}",
        "method": method,
        "char_count": len(text),
        "text": text,
    }


def process_video(api: YouTubeTranscriptApi, raw_input: str) -> bool:
    try:
        video_id = extract_video_id(raw_input)
    except ValueError as exc:
        print(f"[SKIP] {raw_input}: {exc}", file=sys.stderr)
        return False

    print(f"Fetching {video_id} ...", end=" ", flush=True)

    try:
        payload = transcript_payload(api, video_id)
    except Exception as exc:
        print(f"FAILED ({exc})", file=sys.stderr)
        return False

    text = payload["text"]
    if not text:
        print("EMPTY transcript, skipping.", file=sys.stderr)
        return False

    chunks = chunk_text(text)
    chunk_count = len(chunks)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = OUT_DIR / f"{video_id}.jsonl"

    with out_path.open("w", encoding="utf-8") as f:
        for i, chunk in enumerate(chunks):
            record = {
                "video_id": video_id,
                "url": payload["url"],
                "method": payload["method"],
                "chunk_index": i,
                "chunk_count": chunk_count,
                "text": chunk,
            }
            f.write(json.dumps(record, ensure_ascii=False) + "\n")

    print(f"OK - {chunk_count} chunk{'s' if chunk_count != 1 else ''} -> {out_path}")
    return True


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Fetch YouTube transcripts and write embedding-ready JSONL chunks.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=textwrap.dedent("""
            Examples:
              python scripts/fetch_youtube_transcript.py dQw4w9WgXcQ
              python scripts/fetch_youtube_transcript.py https://www.youtube.com/watch?v=dQw4w9WgXcQ
              python scripts/fetch_youtube_transcript.py id1 id2 https://youtu.be/id3
              python scripts/fetch_youtube_transcript.py --stdout-json dQw4w9WgXcQ
        """),
    )
    parser.add_argument("--stdout-json", action="store_true", help="Print one legacy JSON payload to stdout for seed.js")
    parser.add_argument("inputs", nargs="+", metavar="URL_OR_ID", help="YouTube URL or 11-char video ID")
    args = parser.parse_args()

    api = build_api()

    if args.stdout_json:
        if len(args.inputs) != 1:
            print("--stdout-json accepts exactly one URL_OR_ID", file=sys.stderr)
            raise SystemExit(2)
        try:
            payload = transcript_payload(api, args.inputs[0])
            print(json.dumps(payload, ensure_ascii=False))
        except Exception as exc:
            print(str(exc), file=sys.stderr)
            raise SystemExit(1) from exc
        return

    results = [process_video(api, inp) for inp in args.inputs]

    total = len(results)
    ok = sum(results)
    failed = total - ok

    print(f"\nDone: {ok}/{total} succeeded" + (f", {failed} failed" if failed else ""))
    if failed:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
