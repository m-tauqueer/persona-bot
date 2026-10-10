from __future__ import annotations


def parse_allowlist(raw: str) -> frozenset[str]:
    return frozenset(part.strip().lower() for part in raw.split(",") if part.strip())


def clip_allowed(
    *,
    filename: str,
    content_type: str,
    content_types: frozenset[str],
    suffixes: frozenset[str],
) -> bool:
    ctype = content_type.strip().lower()
    if ctype and ctype in content_types:
        return True
    name = filename.strip().lower()
    return any(name.endswith(suffix) for suffix in suffixes if suffix)
