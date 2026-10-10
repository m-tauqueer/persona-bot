from __future__ import annotations


class AdminError(Exception):
    def __init__(
        self,
        message: str,
        *,
        status: int = 400,
        reason: str | None = None,
    ) -> None:
        super().__init__(message)
        self.status = status
        self.reason = reason
