from __future__ import annotations


def confirmation_matches(typed: str, expected: str) -> bool:
    """Exact match after trimming, case-sensitive.

    Destructive owner actions are confirmed by typing the thing's own name, so
    a near miss must not count.
    """
    return bool(expected.strip()) and typed.strip() == expected.strip()
