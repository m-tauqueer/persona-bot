from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from worker.admin.errors import AdminError
from worker.admin.service import PersonaAdmin
from worker.config import load_settings


def _voice_config(raw: str | None) -> dict[str, Any]:
    if raw is None or raw == "":
        return {}
    parsed = json.loads(raw)
    if not isinstance(parsed, dict):
        raise AdminError(
            "voice_config must be a JSON object",
            reason="invalid_voice_config",
        )
    return parsed


def _print(payload: Any) -> None:
    print(json.dumps(payload, indent=2, default=str))


def _add_persona_id(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--persona-id",
        help="local persona UUID when more than one row exists",
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m worker.admin")
    sub = parser.add_subparsers(dest="command", required=True)

    create = sub.add_parser(
        "create-persona",
        help="record a dashboard persona locally, or try Engram create",
    )
    create.add_argument("--engram-persona-id")
    create.add_argument("--handle")
    create.add_argument("--display-name")
    create.add_argument("--description")
    create.add_argument("--voice-config")
    create.add_argument("--tts-voice")
    create.add_argument("--fish-voice")
    create.add_argument(
        "--create-remote",
        action="store_true",
        help="call Engram create (fails if the key cannot manage the org)",
    )

    teach = sub.add_parser("teach")
    teach.add_argument("--text", required=True)
    _add_persona_id(teach)

    answer = sub.add_parser("answer")
    answer.add_argument("--question-key", required=True)
    answer.add_argument("--text", required=True)
    _add_persona_id(answer)

    questions = sub.add_parser("list-questions")
    _add_persona_id(questions)

    ingest = sub.add_parser("ingest-doc")
    ingest.add_argument("--path", required=True)
    _add_persona_id(ingest)

    subscribe = sub.add_parser("subscribe")
    subscribe.add_argument(
        "--user",
        required=True,
        help="email, app user id, or Engram user id",
    )
    _add_persona_id(subscribe)

    publish = sub.add_parser("publish")
    publish.add_argument(
        "--published",
        required=True,
        choices=("true", "false"),
        help="local catalog visibility; does not call Engram delete",
    )
    _add_persona_id(publish)

    destroy = sub.add_parser(
        "destroy",
        help="wipe Engram pools for a persona and delete its local rows",
    )
    destroy.add_argument(
        "--confirm",
        required=True,
        help="the persona handle, typed exactly",
    )
    _add_persona_id(destroy)

    show = sub.add_parser("show")
    _add_persona_id(show)

    list_private = sub.add_parser(
        "list-private",
        help="list one member's private memories for one persona",
    )
    list_private.add_argument(
        "--user",
        required=True,
        help="email, app user id, or Engram user id",
    )
    _add_persona_id(list_private)

    forget_private = sub.add_parser(
        "forget-private",
        help=(
            "forget one member's private pool for one persona; "
            "does not destroy the persona"
        ),
    )
    forget_private.add_argument(
        "--user",
        required=True,
        help="email, app user id, or Engram user id",
    )
    forget_private.add_argument(
        "--confirm",
        required=True,
        help="the persona handle, typed exactly",
    )
    _add_persona_id(forget_private)

    args = parser.parse_args(argv)
    settings = load_settings()
    admin = PersonaAdmin(settings)
    pin = getattr(args, "persona_id", None)

    try:
        if args.command == "create-persona":
            voice = _voice_config(args.voice_config)
            if args.create_remote:
                if not args.display_name or not args.handle:
                    raise AdminError(
                        "create-remote requires --display-name and --handle",
                        reason="missing_fields",
                    )
                _print(
                    admin.create_remote(
                        name=args.display_name,
                        handle=args.handle,
                        description=args.description or "",
                        voice_config=voice,
                        tts_voice=args.tts_voice,
                        fish_voice=args.fish_voice,
                    ),
                )
                return 0
            persona_id = args.engram_persona_id or admin.seed_persona_id()
            if not persona_id:
                raise AdminError(
                    "pass --engram-persona-id "
                    "(ENGRAM_PERSONA_ID only seeds an empty catalog)",
                    reason="missing_persona_id",
                )
            _print(
                admin.register(
                    engram_persona_id=persona_id,
                    handle=args.handle,
                    display_name=args.display_name,
                    description=args.description,
                    voice_config=voice,
                    tts_voice=args.tts_voice,
                    fish_voice=args.fish_voice,
                ),
            )
            return 0
        if args.command == "teach":
            _print(admin.teach(args.text, persona_id=pin))
            return 0
        if args.command == "answer":
            _print(admin.answer(args.question_key, args.text, persona_id=pin))
            return 0
        if args.command == "list-questions":
            _print(admin.questions(persona_id=pin))
            return 0
        if args.command == "ingest-doc":
            path = Path(args.path)
            if not path.is_file():
                raise AdminError("ingest path is not a file", reason="missing_file")
            _print(admin.ingest_document(path, persona_id=pin))
            return 0
        if args.command == "subscribe":
            _print(
                admin.subscribe(
                    args.user,
                    persona_id=pin,
                ),
            )
            return 0
        if args.command == "publish":
            _print(
                admin.publish(
                    published=args.published == "true",
                    persona_id=pin,
                ),
            )
            return 0
        if args.command == "destroy":
            _print(admin.destroy(confirmation=args.confirm, persona_id=pin))
            return 0
        if args.command == "show":
            _print(admin.show(pin))
            return 0
        if args.command == "list-private":
            _print(admin.list_private(args.user, persona_id=pin))
            return 0
        if args.command == "forget-private":
            _print(
                admin.forget_private(
                    args.user,
                    confirmation=args.confirm,
                    persona_id=pin,
                ),
            )
            return 0
    except AdminError as exc:
        print(json.dumps({"error": str(exc), "reason": exc.reason}), file=sys.stderr)
        return 1
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
