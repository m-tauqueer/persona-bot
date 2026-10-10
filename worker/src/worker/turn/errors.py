from __future__ import annotations

from datetime import datetime


class TurnError(Exception):
    def __init__(
        self,
        message: str,
        *,
        status: int = 500,
        reason: str | None = None,
        code: str | None = None,
        reset_at: datetime | None = None,
    ) -> None:
        super().__init__(message)
        self.status = status
        self.reason = reason
        self.code = code
        self.reset_at = reset_at
