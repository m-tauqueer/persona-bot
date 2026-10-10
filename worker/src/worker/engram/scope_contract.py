"""Read-only check of Engram retrieve scope (backend 0.5.0).

Posts to the persona retrieve endpoint. Never writes. Never uses a
member-facing persona. Tenant strings are read off the response, never built.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from engram_sdk import _common as sdk_common
from engram_sdk.errors import EngramAPIError, EngramError

from worker.admin.store import connect, write_probe_persona
from worker.config import WorkerSettings
from worker.engram.factory import create_org_engram
from worker.engram.tenant import is_shared_pool, private_pool_owner
from worker.engram.user_id import persona_engine_user_id

RetrievePoster = Callable[[Any, str, dict[str, Any]], tuple[int, dict[str, Any]]]

_SCOPE_SHARED = "shared"
_SCOPE_PRIVATE = "private"
_SCOPE_BOTH = "both"
_UNKNOWN_FIELD = "not_a_retrieve_field"


def scope_contract_skip_reason(settings: WorkerSettings) -> str | None:
    if not settings.engram_api_key or not settings.engram_org_id:
        return "Engram is not configured"
    if not settings.probe_persona_id:
        return "PROBE_PERSONA_ID is unset"
    return None


def _labelled_tenants(payload: dict[str, Any]) -> list[str]:
    found: list[str] = []
    named = payload.get("tenants")
    if isinstance(named, list):
        for item in named:
            if isinstance(item, str) and item:
                found.append(item)
    rows = payload.get("results")
    if isinstance(rows, list):
        for row in rows:
            if not isinstance(row, dict):
                continue
            tenant = row.get("tenant")
            if isinstance(tenant, str) and tenant:
                found.append(tenant)
    return found


def _row_tenants(payload: dict[str, Any]) -> list[str]:
    rows = payload.get("results")
    if not isinstance(rows, list):
        return []
    found: list[str] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        tenant = row.get("tenant")
        if isinstance(tenant, str) and tenant:
            found.append(tenant)
    return found


def _kind(tenant: str) -> str | None:
    if is_shared_pool(tenant):
        return "shared"
    if private_pool_owner(tenant) is not None:
        return "private"
    return None


def _kinds(tenants: list[str]) -> set[str]:
    return {kind for tenant in tenants if (kind := _kind(tenant)) is not None}


def check_scope_echo(
    payload: dict[str, Any],
    expected: str,
) -> str | None:
    scope = payload.get("scope")
    if scope != expected:
        return f"scope echo wanted {expected!r}, got {scope!r}"
    return None


def check_allowed_kinds(
    payload: dict[str, Any],
    allowed: set[str],
) -> str | None:
    tenants = _labelled_tenants(payload)
    kinds = _kinds(tenants)
    unexpected = kinds - allowed
    if unexpected:
        return f"unexpected pool kinds {sorted(unexpected)} (allowed {sorted(allowed)})"
    rows = _row_tenants(payload)
    row_kinds = _kinds(rows)
    extra = row_kinds - allowed
    if extra:
        return f"result rows included {sorted(extra)} (allowed {sorted(allowed)})"
    return None


def check_status(status: int, expected: int) -> str | None:
    if status != expected:
        return f"status wanted {expected}, got {status}"
    return None


def post_persona_retrieve(
    client: Any,
    persona_id: str,
    body: dict[str, Any],
) -> tuple[int, dict[str, Any]]:
    path = sdk_common.org_path(client._org, "personas", persona_id, "retrieve")
    try:
        payload = client._call("POST", path, body=body)
    except EngramAPIError as exc:
        detail = exc.detail if isinstance(exc.detail, str) else str(exc.detail)
        return exc.status, {"detail": detail}
    except EngramError as exc:
        return 0, {"detail": str(exc)}
    if not isinstance(payload, dict):
        return 200, {"value": payload}
    return 200, payload


def _query_body(settings: WorkerSettings, extra: dict[str, Any]) -> dict[str, Any]:
    body: dict[str, Any] = {
        "query": settings.memory_panel_query,
        "top_k": settings.engram_retrieve_top_k,
    }
    body.update(extra)
    return body


def evaluate_measured_table(
    *,
    query_only: tuple[int, dict[str, Any]],
    both_with_user: tuple[int, dict[str, Any]],
    user_id_only: tuple[int, dict[str, Any]],
    private_only: tuple[int, dict[str, Any]],
    shared_with_user: tuple[int, dict[str, Any]],
    unknown_field: tuple[int, dict[str, Any]],
) -> list[str]:
    failures: list[str] = []

    def named(label: str, err: str | None) -> None:
        if err:
            failures.append(f"{label}: {err}")

    status, payload = query_only
    named("query_only", check_status(status, 200))
    named("query_only", check_scope_echo(payload, _SCOPE_SHARED))
    named("query_only", check_allowed_kinds(payload, {_SCOPE_SHARED}))

    status, payload = both_with_user
    named("both_with_user", check_status(status, 200))
    named("both_with_user", check_scope_echo(payload, _SCOPE_BOTH))
    named(
        "both_with_user",
        check_allowed_kinds(payload, {_SCOPE_SHARED, _SCOPE_PRIVATE}),
    )

    status, payload = user_id_only
    named("user_id_only", check_status(status, 200))
    named("user_id_only", check_scope_echo(payload, _SCOPE_BOTH))
    named(
        "user_id_only",
        check_allowed_kinds(payload, {_SCOPE_SHARED, _SCOPE_PRIVATE}),
    )

    status, payload = private_only
    named("private_only", check_status(status, 200))
    named("private_only", check_scope_echo(payload, _SCOPE_PRIVATE))
    named("private_only", check_allowed_kinds(payload, {_SCOPE_PRIVATE}))

    status, payload = shared_with_user
    named("shared_with_user", check_status(status, 422))

    status, payload = unknown_field
    named("unknown_field", check_status(status, 422))

    return failures


def run_scope_contract(
    settings: WorkerSettings,
    *,
    poster: RetrievePoster | None = None,
    persona_id: str | None = None,
    caller_user_id: str | None = None,
    facing_persona_id: str | None = None,
) -> tuple[int, str]:
    """Return (exit_code, message). 0 is skip or pass. Never writes."""
    skip = scope_contract_skip_reason(settings)
    if skip:
        return 0, f"scope_contract=SKIP {skip}"
    if persona_id is None:
        conn = connect(settings)
        try:
            row = write_probe_persona(conn, settings)
        finally:
            conn.close()
        if row is None:
            return 1, "FAIL: PROBE_PERSONA_ID is missing or unpublished locally"
        write_id = row.get("engram_persona_id")
        if not isinstance(write_id, str) or not write_id:
            return 1, "FAIL: throwaway persona is missing Engram id"
        persona_id = write_id
    facing = (
        facing_persona_id
        if facing_persona_id is not None
        else settings.engram_persona_id
    )
    if facing and persona_id == facing:
        return 1, "FAIL: throwaway persona is the member-facing ENGRAM_PERSONA_ID"

    client: Any = None
    owns_client = False
    try:
        if poster is None:
            client = create_org_engram(settings)
            owns_client = True
            post: RetrievePoster = post_persona_retrieve
        else:
            post = poster

        if caller_user_id is None:
            if not owns_client:
                return 1, (
                    "FAIL: caller_user_id is required when posting without a client"
                )
            me = client.account.me()
            caller_user_id = persona_engine_user_id(me.id)

        query = _query_body(settings, {})
        both = _query_body(
            settings,
            {"scope": _SCOPE_BOTH, "user_id": caller_user_id},
        )
        user_only = _query_body(settings, {"user_id": caller_user_id})
        private = _query_body(settings, {"scope": _SCOPE_PRIVATE})
        shared_user = _query_body(
            settings,
            {"scope": _SCOPE_SHARED, "user_id": caller_user_id},
        )
        unknown = _query_body(settings, {_UNKNOWN_FIELD: True})

        failures = evaluate_measured_table(
            query_only=post(client, persona_id, query),
            both_with_user=post(client, persona_id, both),
            user_id_only=post(client, persona_id, user_only),
            private_only=post(client, persona_id, private),
            shared_with_user=post(client, persona_id, shared_user),
            unknown_field=post(client, persona_id, unknown),
        )
        if failures:
            return 1, "FAIL: " + "; ".join(failures)
        return 0, "scope_contract=ok"
    finally:
        if owns_client and client is not None:
            closer = getattr(client, "close", None)
            if closer is not None:
                closer()
