#!/usr/bin/env python3
import argparse
import json
import os
import sys

try:
    from youtube_transcript_api import YouTubeTranscriptApi
    from youtube_transcript_api.proxies import WebshareProxyConfig
except ModuleNotFoundError as exc:
    print(
        "Missing Python dependency: youtube-transcript-api. "
        "Install with `pip install -r requirements.txt`.",
        file=sys.stderr,
    )
    raise SystemExit(1) from exc


def build_api():
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


def transcript_text(transcript):
    return " ".join(entry.text for entry in transcript).strip()


def language_codes(transcripts):
    generated_codes = [
        transcript.language_code
        for transcript in transcripts
        if getattr(transcript, "is_generated", False)
    ]
    all_codes = [transcript.language_code for transcript in transcripts]

    if generated_codes:
        return generated_codes, "auto-generated captions"

    return all_codes, "manual captions"


def fetch_transcript(video_id):
    api = build_api()
    manual_error = None

    try:
        transcript = api.list(video_id).find_manually_created_transcript(["en"]).fetch()
        return transcript, "manual captions"
    except Exception as exc:
        manual_error = exc

    try:
        available = api.list(video_id)
        languages, method = language_codes(available)
        transcript = api.fetch(video_id, languages=languages)
        return transcript, method
    except Exception as exc:
        raise RuntimeError(
            f"manual captions failed: {manual_error}; auto-generated captions failed: {exc}"
        ) from exc


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("video_id")
    args = parser.parse_args()

    try:
        transcript, method = fetch_transcript(args.video_id)
        text = transcript_text(transcript)
        print(
            json.dumps(
                {
                    "video_id": args.video_id,
                    "method": method,
                    "char_count": len(text),
                    "text": text,
                }
            )
        )
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        raise SystemExit(1) from exc


if __name__ == "__main__":
    main()
