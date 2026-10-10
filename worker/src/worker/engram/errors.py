from __future__ import annotations


class BrainError(Exception):
    def __init__(
        self,
        message: str,
        *,
        status: int | None = None,
        detail: str | None = None,
    ) -> None:
        super().__init__(message)
        self.status = status
        self.detail = detail


class UnauthorizedError(BrainError):
    """401 — missing or rejected API key."""


class PaymentRequiredError(BrainError):
    """402 — org quota exhausted."""


class ForbiddenError(BrainError):
    """403 — authenticated but not allowed (except chat → NotSubscribedError)."""


class NotSubscribedError(BrainError):
    """403 on chat — caller is not subscribed to the persona."""


class NotFoundError(BrainError):
    """404 — unknown persona or resource."""


class ConflictError(BrainError):
    """409 — conflicting write."""


class ValidationError(BrainError):
    """422 — rejected payload."""


class ServerError(BrainError):
    """5xx — Engram backend failure."""


class RetryableReadError(BrainError):
    """429 / 502 / 503 / 504 after read retries are exhausted."""
