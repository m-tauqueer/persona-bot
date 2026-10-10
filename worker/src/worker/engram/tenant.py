from __future__ import annotations

from worker.engram.user_id import persona_engine_user_id

# Engram pools under a persona: `{org}:{persona}` is shared knowledge the owner
# taught, `{org}:{persona}:{user}` is one member's own history. We read these
# off retrieve rows and never build them (see docs/ENGRAM.md).
_SHARED_TENANT_SEGMENTS = 2
_PRIVATE_TENANT_SEGMENTS = 3
_TENANT_SEPARATOR = ":"


def private_pool_owner(tenant: str | None) -> str | None:
    """Return the member a private pool belongs to, or None for shared pools."""
    if not tenant:
        return None
    parts = tenant.split(_TENANT_SEPARATOR)
    if len(parts) != _PRIVATE_TENANT_SEGMENTS:
        return None
    owner = parts[-1].strip()
    return persona_engine_user_id(owner) if owner else None


def is_own_private_pool(tenant: str | None, *, engram_user_id: str) -> bool:
    """True when this row came from that member's own private pool."""
    owner = private_pool_owner(tenant)
    if owner is None:
        return False
    return owner == persona_engine_user_id(engram_user_id)


def is_shared_pool(tenant: str | None) -> bool:
    """True when this row is owner-taught shared knowledge for the persona."""
    if not tenant:
        return False
    parts = tenant.split(_TENANT_SEPARATOR)
    if len(parts) != _SHARED_TENANT_SEGMENTS:
        return False
    return all(part.strip() for part in parts)


def may_ground(
    tenant: str | None,
    *,
    engram_user_id: str,
    member_authenticated: bool,
) -> bool:
    """True when this retrieve row may ground a reply for this member.

    Shared rows are who the persona is — every subscriber may hear them.

    A private row grounds only when it belongs to the acting member *and* we
    reached Engram as that member. Without per-member session auth the caller
    is the API key owner, so the only private pool retrieve can return is that
    owner's — and under one shared key that pool holds every member's turns.
    It matches `is_own_private_pool` for whoever signs in as the key owner,
    which is exactly the account that must not be handed everyone's memory.
    See docs/ENGRAM.md §2.3.

    Missing or malformed tenants fail closed: never ground what we cannot place.
    """
    if is_shared_pool(tenant):
        return True
    if not member_authenticated:
        return False
    return is_own_private_pool(tenant, engram_user_id=engram_user_id)
