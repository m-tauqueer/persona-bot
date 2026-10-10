from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any


def last_user_text(
    messages: Sequence[Mapping[str, Any]],
    *,
    user_role: str,
    text_part_type: str,
) -> str:
    """Return text from the last message whose role field equals user_role."""
    for message in reversed(messages):
        role = message.get("role")
        if role != user_role:
            continue
        return _content_text(message.get("content"), text_part_type=text_part_type)
    return ""


def _content_text(content: object, *, text_part_type: str) -> str:
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return ""
    parts: list[str] = []
    for item in content:
        if isinstance(item, str):
            parts.append(item)
            continue
        if not isinstance(item, Mapping):
            continue
        if item.get("type") != text_part_type:
            continue
        text = item.get("text")
        if isinstance(text, str):
            parts.append(text)
    return "".join(parts)
