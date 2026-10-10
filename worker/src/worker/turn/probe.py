"""Two-turn live chat against the worker brain; prints persistence."""

from __future__ import annotations

import sys
from uuid import UUID

from worker.admin.store import connect, write_probe_persona
from worker.config import load_settings
from worker.persistence.sessions import create_session
from worker.schema import SESSION_CHANNEL_TEXT
from worker.turn.errors import TurnError
from worker.turn.service import TurnRunner


def main() -> int:
    settings = load_settings()
    if not settings.probe_persona_id:
        print(f"chat=SKIP {settings.probe_write_skip}")
        print("PROBE_OK")
        return 0
    conn = connect(settings)
    try:
        persona = write_probe_persona(conn, settings)
        if persona is None:
            print(
                "FAIL: PROBE_PERSONA_ID is missing or unpublished locally",
                file=sys.stderr,
            )
            return 1
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, email, engram_user_id
                FROM users
                ORDER BY created_at
                LIMIT 1
                """,
            )
            user = cur.fetchone()
        if user is None:
            print("FAIL: no app user in the database", file=sys.stderr)
            return 1
        session = create_session(
            conn,
            user_id=user["id"],
            persona_id=persona["id"],
            channel=SESSION_CHANNEL_TEXT,
        )
        conn.commit()
        session_id = session["id"]
        print(f"user={user['email']}")
        print(f"session_id={session_id}")
        print(f"persona_id={persona['id']}")
    finally:
        conn.close()

    runner = TurnRunner(settings)
    first = "Please remember that my session token is lantern-7."
    second = "What session token did I just ask you to remember?"
    try:
        one = runner.run(
            app_user_id=UUID(str(user["id"])),
            engram_user_id=user["engram_user_id"],
            persona_id=UUID(str(persona["id"])),
            session_id=UUID(str(session_id)),
            text=first,
        )
        print(f"turn1 action={one.action} reasons={one.reasons}")
        print(f"turn1 reply={one.reply_text!r}")
        print(f"engram_session_id={one.engram_session_id}")
        two = runner.run(
            app_user_id=UUID(str(user["id"])),
            engram_user_id=user["engram_user_id"],
            persona_id=UUID(str(persona["id"])),
            session_id=UUID(str(session_id)),
            text=second,
        )
        print(f"turn2 action={two.action} reasons={two.reasons}")
        print(f"turn2 reply={two.reply_text!r}")
        print(f"engram_session_id={two.engram_session_id}")
    except TurnError as exc:
        print(f"FAIL: {exc} status={exc.status} reason={exc.reason}", file=sys.stderr)
        return 1

    conn = connect(settings)
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT ordinal, speaker, text, controller_action
                FROM turns
                WHERE session_id = %s
                ORDER BY ordinal
                """,
                (str(session_id),),
            )
            turns = list(cur.fetchall())
            cur.execute(
                "SELECT engram_session_id FROM sessions WHERE id = %s",
                (str(session_id),),
            )
            stored = cur.fetchone()
            cur.execute(
                """
                SELECT COUNT(*) AS n FROM memory_refs mr
                JOIN turns t ON t.id = mr.turn_id
                WHERE t.session_id = %s
                """,
                (str(session_id),),
            )
            refs = cur.fetchone()
            cur.execute(
                """
                SELECT COUNT(*) AS n FROM latency_spans ls
                JOIN turns t ON t.id = ls.turn_id
                WHERE t.session_id = %s
                """,
                (str(session_id),),
            )
            spans = cur.fetchone()
    finally:
        conn.close()

    for row in turns:
        print(
            f"row ordinal={row['ordinal']} speaker={row['speaker']} "
            f"action={row['controller_action']} text={row['text']!r}"
        )
    sid = stored["engram_session_id"] if stored else None
    print(f"stored_engram_session_id={sid}")
    print(f"memory_refs={refs['n'] if refs else 0}")
    print(f"latency_spans={spans['n'] if spans else 0}")

    if one.engram_session_id and two.engram_session_id:
        if one.engram_session_id != two.engram_session_id:
            print("FAIL: Engram session id changed across turns", file=sys.stderr)
            return 1
    if sid != two.engram_session_id:
        print("FAIL: stored Engram session id mismatch", file=sys.stderr)
        return 1
    if len(turns) < 2:
        print("FAIL: expected persisted turns", file=sys.stderr)
        return 1
    print("PROBE_OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
