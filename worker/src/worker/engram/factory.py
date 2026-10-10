from __future__ import annotations

from engram_sdk import EngramClient

from worker.config import WorkerSettings
from worker.engram.user_id import persona_engine_user_id


def _client(
    settings: WorkerSettings,
    user_id: str,
    *,
    api_key: str,
) -> EngramClient:
    if (
        not settings.engram_org_id
        or settings.engram_base_url is None
    ):
        raise RuntimeError(
            "Engram is not configured (ENGRAM_API_KEY, ENGRAM_ORG_ID, ENGRAM_BASE_URL)",
        )
    # max_retries=0: write retries are never delegated to the SDK.
    return EngramClient(
        settings.engram_org_id,
        persona_engine_user_id(user_id),
        api_key=api_key,
        base_url=str(settings.engram_base_url),
        timeout=float(settings.engram_timeout_seconds),
        max_retries=0,
    )


def create_engram(settings: WorkerSettings, user_id: str) -> EngramClient:
    if not settings.engram_api_key:
        raise RuntimeError(
            "Engram is not configured (ENGRAM_API_KEY, ENGRAM_ORG_ID, ENGRAM_BASE_URL)",
        )
    return _client(settings, user_id, api_key=settings.engram_api_key)


def create_org_engram(settings: WorkerSettings) -> EngramClient:
    """Org-scoped client (`EngramClient(org)`, user_id defaults to empty).

    Used for `insights.logs` (`GET /orgs/{org}/logs`). Never a three-segment
    persona tenant. Always the org API key — never a member session token.
    """
    return create_engram(settings, "")


def create_member_engram(
    settings: WorkerSettings,
    user_id: str,
    *,
    api_key: str,
) -> EngramClient:
    """Client authenticated as this member. ``api_key`` is their session JWT.

    Never pass the org key here. A missing token is a missing client, not a
    fallback to the key owner.
    """
    if not api_key:
        raise RuntimeError("member Engram client requires a session token")
    if not settings.engram_org_id or settings.engram_base_url is None:
        raise RuntimeError(
            "Engram is not configured (ENGRAM_API_KEY, ENGRAM_ORG_ID, ENGRAM_BASE_URL)",
        )
    return _client(settings, user_id, api_key=api_key)
