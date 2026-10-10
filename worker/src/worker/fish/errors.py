from __future__ import annotations


class FishCloneError(Exception):
    def __init__(
        self,
        message: str,
        *,
        status: int,
        reason: str,
    ) -> None:
        super().__init__(message)
        self.status = status
        self.reason = reason
