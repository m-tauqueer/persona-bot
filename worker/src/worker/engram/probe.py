"""Live Engram wrapper probe against a dashboard-created persona."""

from __future__ import annotations

import secrets
import sys
from collections.abc import Callable
from typing import Any
from uuid import uuid4

from worker.admin.store import connect, write_probe_persona
from worker.config import WorkerSettings, load_settings
from worker.engram.engram_brain import EngramBrain
from worker.engram.errors import BrainError, ForbiddenError
from worker.engram.factory import create_org_engram
from worker.engram.org_member import SdkOrgRoster
from worker.engram.scope_contract import run_scope_contract
from worker.engram.session import MemberSessionCache
from worker.engram.tenant import is_own_private_pool, private_pool_owner
from worker.engram.user_id import persona_engine_user_id
from worker.lifecycle.gids import memory_rows
from worker.lifecycle.purge import purge_private_pool
from worker.turn.grant import grant_persona_access


def _try(label: str, op: Callable[[], Any]) -> Any:
    try:
        result = op()
        print(f"{label}=ok")
        return result
    except ForbiddenError as exc:
        print(f"{label}=SKIP {exc} status={exc.status}")
        return None


def _labelled_tenant(result: Any) -> str | None:
    """Read a tenant Engram already labelled. Never construct one."""
    if isinstance(result, dict):
        tenant = result.get("tenant")
        if isinstance(tenant, str) and tenant:
            return tenant
        raw = result.get("raw")
        if isinstance(raw, dict):
            tenant = raw.get("tenant")
            if isinstance(tenant, str) and tenant:
                return tenant
    tenant = getattr(result, "tenant", None)
    if isinstance(tenant, str) and tenant:
        return tenant
    raw = getattr(result, "raw", None)
    if isinstance(raw, dict):
        tenant = raw.get("tenant")
        if isinstance(tenant, str) and tenant:
            return tenant
    return None


def _row_mentions(payload: object, marker: str) -> bool:
    for row in memory_rows(payload):
        text = row.get("text")
        if isinstance(text, str) and marker in text:
            return True
    return False


def _probe_member_session(settings: WorkerSettings, write_id: str) -> int:
    """Provision a throwaway member, talk as them, assert pool ownership, clean up."""
    if settings.engram_persona_id and write_id == settings.engram_persona_id:
        print(
            "FAIL: throwaway persona is the member-facing ENGRAM_PERSONA_ID",
            file=sys.stderr,
        )
        return 1
    email = f"cognora-probe-{uuid4().hex[:16]}@gmail.com"
    password = secrets.token_urlsafe(settings.engram_org_member_password_nbytes)
    marker = f"probe-marker-{uuid4().hex}"
    org_client = create_org_engram(settings)
    org_brain = EngramBrain(settings, "")
    roster = SdkOrgRoster(org_client)
    member_id: str | None = None
    member_brain: EngramBrain | None = None
    try:
        member_id = roster.add_member(
            email,
            name=email,
            role=settings.engram_org_member_role,
            password=password,
        )
        granted = grant_persona_access(
            org_brain,
            settings,
            engram_persona_id=write_id,
            engram_user_id=member_id,
        )
        if not granted.subscribed:
            print("FAIL: throwaway member could not subscribe", file=sys.stderr)
            return 1
        cache = MemberSessionCache(settings)
        token = cache.token(
            engram_user_id=member_id,
            email=email,
            password_provider=lambda: password,
        )
        if token is None:
            print("FAIL: auth.login did not mint a token", file=sys.stderr)
            return 1
        member_brain = EngramBrain(settings, member_id, api_key=token)
        spoken = member_brain.chat(write_id, marker)
        tenant = _labelled_tenant(spoken)
        if tenant is None:
            print("FAIL: chat returned no tenant", file=sys.stderr)
            return 1
        owner = private_pool_owner(tenant)
        if owner is None or persona_engine_user_id(owner) != persona_engine_user_id(
            member_id,
        ):
            print(
                "FAIL: chat tenant is not this member's private pool",
                file=sys.stderr,
            )
            return 1
        if not is_own_private_pool(tenant, engram_user_id=member_id):
            print("FAIL: chat tenant failed own-private check", file=sys.stderr)
            return 1
        segments = tenant.split(":")
        if write_id not in segments:
            print(
                "FAIL: chat did not land on the throwaway persona",
                file=sys.stderr,
            )
            return 1
        facing = settings.engram_persona_id
        if facing and facing in segments:
            print(
                "FAIL: chat tenant mentions the member-facing persona",
                file=sys.stderr,
            )
            return 1
        print(f"member_session_tenant={tenant}")
        print("member_session_chat=ok")
        member_brain.converse(
            write_id,
            marker,
            session_id=spoken.session_id,
            speaker=settings.engram_converse_user_speaker,
        )
        found = member_brain.retrieve_scoped(
            write_id,
            marker,
            scope=settings.engram_retrieve_scope_private,
            top_k=settings.engram_retrieve_top_k_private,
        )
        own_hits = [
            hit
            for hit in found.results
            if is_own_private_pool(hit.tenant, engram_user_id=member_id)
        ]
        if not own_hits:
            print(
                "FAIL: retrieve did not return this member's private row",
                file=sys.stderr,
            )
            return 1
        admin = org_client.account.me()
        admin_id = persona_engine_user_id(admin.id)
        admin_page = org_client.personas.user_memories(write_id, admin_id)
        if _row_mentions(admin_page, marker):
            print(
                "FAIL: admin pool received the throwaway member write",
                file=sys.stderr,
            )
            return 1
        print("member_session_admin_pool=ok")
        print("PROBE_MEMBER_SESSION_OK")
        return 0
    except BrainError as exc:
        print(f"FAIL: {exc} status={exc.status}", file=sys.stderr)
        return 1
    except Exception as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        return 1
    finally:
        if member_id is not None:
            try:
                purge_private_pool(
                    settings,
                    engram_user_id=member_id,
                    engram_persona_id=write_id,
                    personas=org_client.personas,
                )
            except Exception:
                pass
            try:
                org_client.members.remove(member_id)
            except Exception:
                pass
        if member_brain is not None:
            member_brain.close()
        org_brain.close()
        roster.close()


def main() -> int:
    settings = load_settings()
    if not settings.engram_api_key or not settings.engram_org_id:
        print("engram=SKIP Engram is not configured")
        print("PROBE_OK")
        return 0
    persona_id = settings.engram_persona_id
    if not persona_id:
        print(
            "FAIL: set ENGRAM_PERSONA_ID to the dashboard-created persona",
            file=sys.stderr,
        )
        return 1
    brain = EngramBrain(settings, "")
    try:
        persona = brain.get_persona(persona_id)
        print(f"persona_id={persona.id}")
        print(f"persona_handle={persona.handle}")
        print(f"persona_tenant={persona.tenant}")
        _try("questions", lambda: brain.questions(persona.id))
        _try(
            "retrieve",
            lambda: brain.retrieve(persona.id, "who are you"),
        )
        code, message = run_scope_contract(settings)
        print(message)
        if code != 0:
            return code
        if not settings.probe_persona_id:
            print(f"chat=SKIP {settings.probe_write_skip}")
            print("member_session=SKIP PROBE_PERSONA_ID is unset")
            print("PROBE_OK")
            return 0
        conn = connect(settings)
        try:
            write_row = write_probe_persona(conn, settings)
        finally:
            conn.close()
        if write_row is None:
            print(
                "FAIL: PROBE_PERSONA_ID is missing or unpublished locally",
                file=sys.stderr,
            )
            return 1
        write_id = write_row["engram_persona_id"]
        if not isinstance(write_id, str) or not write_id:
            print("FAIL: throwaway persona is missing Engram id", file=sys.stderr)
            return 1
        outcome = brain.chat(write_id, "Who are you?")
        print(f"session_id={outcome.session_id}")
        print(f"brain_ms={outcome.brain_ms}")
        print(f"messages={outcome.messages!r}")
        print(f"text={outcome.text!r}")
        print(f"memories_used_count={len(outcome.memories_used)}")
        if not outcome.messages:
            print("FAIL: chat returned no messages", file=sys.stderr)
            return 1
        if not outcome.session_id:
            print("FAIL: chat did not return session_id", file=sys.stderr)
            return 1
        chat_tenant = _labelled_tenant(outcome)
        if chat_tenant is not None and write_id not in chat_tenant.split(":"):
            print(
                "FAIL: org-key chat did not land on the throwaway persona",
                file=sys.stderr,
            )
            return 1
        print("org_key_chat_throwaway=ok")
        return _probe_member_session(settings, write_id)
    except BrainError as exc:
        print(f"FAIL: {exc} status={exc.status}", file=sys.stderr)
        return 1
    except Exception as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        return 1
    finally:
        brain.close()


if __name__ == "__main__":
    raise SystemExit(main())
