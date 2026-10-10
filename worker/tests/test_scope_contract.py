from typing import Any

from worker.config import WorkerSettings
from worker.engram.scope_contract import (
    check_allowed_kinds,
    check_scope_echo,
    evaluate_measured_table,
    run_scope_contract,
    scope_contract_skip_reason,
)

ORG = "100912164da2419885314c9fdb5358b7"
PERSONA = "3a07018eb5c2483ab80f07e90488b5f4"
MEMBER = "07b2b9f777c9446b86c5d593a374cc80"

SHARED = f"{ORG}:{PERSONA}"
OWN_PRIVATE = f"{ORG}:{PERSONA}:{MEMBER}"


def _payload(*, scope: str, tenants: list[str], results: list[str]) -> dict[str, Any]:
    return {
        "scope": scope,
        "tenants": tenants,
        "results": [{"tenant": tenant, "text": "x"} for tenant in results],
    }


def test_skip_without_keys_or_probe_persona(settings: WorkerSettings) -> None:
    settings.engram_api_key = None
    settings.engram_org_id = None
    settings.probe_persona_id = None
    assert scope_contract_skip_reason(settings) == "Engram is not configured"
    code, message = run_scope_contract(settings)
    assert code == 0
    assert message.startswith("scope_contract=SKIP")

    settings.engram_api_key = "egm_test"
    settings.engram_org_id = ORG
    settings.probe_persona_id = None
    assert scope_contract_skip_reason(settings) == "PROBE_PERSONA_ID is unset"
    code, message = run_scope_contract(settings)
    assert code == 0
    assert "PROBE_PERSONA_ID" in message


def test_scope_echo_and_kinds_read_labelled_tenants() -> None:
    shared = _payload(scope="shared", tenants=[SHARED], results=[SHARED])
    assert check_scope_echo(shared, "shared") is None
    assert check_allowed_kinds(shared, {"shared"}) is None
    mixed = _payload(
        scope="both",
        tenants=[SHARED, OWN_PRIVATE],
        results=[SHARED, OWN_PRIVATE],
    )
    assert check_allowed_kinds(mixed, {"shared", "private"}) is None
    leaked = _payload(scope="shared", tenants=[SHARED], results=[OWN_PRIVATE])
    assert check_allowed_kinds(leaked, {"shared"}) is not None


def test_measured_table_accepts_empty_pools() -> None:
    failures = evaluate_measured_table(
        query_only=(200, {"scope": "shared", "tenants": [SHARED], "results": []}),
        both_with_user=(200, {"scope": "both", "tenants": [SHARED], "results": []}),
        user_id_only=(200, {"scope": "both", "tenants": [], "results": []}),
        private_only=(200, {"scope": "private", "tenants": [], "results": []}),
        shared_with_user=(422, {"detail": "user_id is meaningless for scope='shared'"}),
        unknown_field=(422, {"detail": "extra_forbidden"}),
    )
    assert failures == []


def test_measured_table_rejects_wrong_scope_and_status() -> None:
    failures = evaluate_measured_table(
        query_only=(200, {"scope": "both", "tenants": [SHARED], "results": []}),
        both_with_user=(200, {"scope": "both", "tenants": [SHARED], "results": []}),
        user_id_only=(200, {"scope": "both", "tenants": [], "results": []}),
        private_only=(200, {"scope": "private", "tenants": [], "results": []}),
        shared_with_user=(200, {"scope": "shared", "tenants": [], "results": []}),
        unknown_field=(200, {"scope": "shared", "tenants": [], "results": []}),
    )
    assert any("query_only" in item for item in failures)
    assert any("shared_with_user" in item for item in failures)
    assert any("unknown_field" in item for item in failures)


def test_run_posts_read_only_bodies_and_refuses_facing_persona(
    settings: WorkerSettings,
) -> None:
    settings.engram_api_key = "egm_test"
    settings.engram_org_id = ORG
    settings.probe_persona_id = "local-probe"
    posted: list[dict[str, Any]] = []

    def poster(
        _client: object,
        persona_id: str,
        body: dict[str, Any],
    ) -> tuple[int, dict[str, Any]]:
        posted.append({"persona_id": persona_id, "body": body})
        scope = body.get("scope")
        if "not_a_retrieve_field" in body:
            return 422, {"detail": "extra_forbidden"}
        if scope == "shared" and "user_id" in body:
            return 422, {"detail": "user_id is meaningless for scope='shared'"}
        if scope == "private":
            return 200, {"scope": "private", "tenants": [], "results": []}
        if scope == "both" or "user_id" in body:
            return 200, {
                "scope": "both",
                "tenants": [SHARED, OWN_PRIVATE],
                "results": [
                    {"tenant": SHARED, "text": "taught"},
                    {"tenant": OWN_PRIVATE, "text": "said"},
                ],
            }
        return 200, {"scope": "shared", "tenants": [SHARED], "results": []}

    code, message = run_scope_contract(
        settings,
        poster=poster,
        persona_id=PERSONA,
        caller_user_id=MEMBER,
        facing_persona_id="other",
    )
    assert code == 0, message
    assert message == "scope_contract=ok"
    assert len(posted) == 6
    assert all(item["persona_id"] == PERSONA for item in posted)
    assert all("converse" not in item["body"] for item in posted)
    assert all("teach" not in item["body"] for item in posted)

    code, message = run_scope_contract(
        settings,
        poster=poster,
        persona_id=PERSONA,
        caller_user_id=MEMBER,
        facing_persona_id=PERSONA,
    )
    assert code == 1
    assert "member-facing" in message
