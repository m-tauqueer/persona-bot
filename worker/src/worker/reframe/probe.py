"""Live reframe probe: canned Engram bubbles + voice rules -> spoken text."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from worker.config import load_settings
from worker.reframe.errors import ReframeError
from worker.reframe.reframer import Reframer
from worker.reframe.types import HistoryTurn

_DEFAULT_FIXTURE = Path(__file__).with_name("probe_fixture.json")


def _history(raw: object) -> list[HistoryTurn]:
    if not isinstance(raw, list):
        raise ValueError("fixture history must be a list")
    turns: list[HistoryTurn] = []
    for item in raw:
        if not isinstance(item, dict):
            raise ValueError("fixture history items must be objects")
        speaker = item.get("speaker")
        text = item.get("text")
        if not isinstance(speaker, str) or not isinstance(text, str):
            raise ValueError("fixture history items need speaker and text strings")
        turns.append(HistoryTurn(speaker=speaker, text=text))
    return turns


def _messages(raw: object) -> list[str]:
    if not isinstance(raw, list) or not all(isinstance(item, str) for item in raw):
        raise ValueError("fixture messages must be a list of strings")
    return raw


def _voice_config(raw: object) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raise ValueError("fixture voice_config must be an object")
    return raw


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Reframe a canned Engram reply")
    parser.add_argument(
        "--fixture",
        type=Path,
        default=_DEFAULT_FIXTURE,
        help="JSON with messages, history, and voice_config",
    )
    args = parser.parse_args(argv)
    try:
        fixture = json.loads(args.fixture.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        print(f"FAIL: cannot read fixture: {exc}", file=sys.stderr)
        return 1
    if not isinstance(fixture, dict):
        print("FAIL: fixture must be a JSON object", file=sys.stderr)
        return 1
    try:
        messages = _messages(fixture.get("messages"))
        history = _history(fixture.get("history", []))
        voice_config = _voice_config(fixture.get("voice_config", {}))
    except ValueError as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        return 1

    print(f"messages={messages!r}")
    print(f"history={[(turn.speaker, turn.text) for turn in history]!r}")
    print(f"voice_config={voice_config!r}")
    sys.stdout.flush()

    try:
        spoken = Reframer(load_settings()).reframe(messages, history, voice_config)
    except ReframeError as exc:
        print(f"FAIL: {exc} status={exc.status}", file=sys.stderr)
        return 1
    except Exception as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        return 1

    print(f"reframe={spoken!r}")
    print("PROBE_OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
