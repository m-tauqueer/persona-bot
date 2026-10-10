from __future__ import annotations

import re

# Engram subscribe `user_id` is at most 32 characters. A hyphenated UUID is 36;
# the same value without hyphens is 32 hex digits, which is what we bind as the
# persona client identity and send on subscribe.
_HYPHENATED_UUID = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-"
    r"[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$",
)


def persona_engine_user_id(user_id: str) -> str:
    if _HYPHENATED_UUID.fullmatch(user_id):
        return user_id.replace("-", "").lower()
    return user_id


def persona_engine_user_ids(user_id: str) -> tuple[str, ...]:
    engine = persona_engine_user_id(user_id)
    if engine == user_id:
        return (user_id,)
    return (engine, user_id)
