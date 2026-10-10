from __future__ import annotations


class ReframeError(Exception):
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


class ReframeUnavailableError(ReframeError):
    """The reframe LLM is not configured or could not be reached."""


class ReframeEmptyInputError(ReframeError):
    """No Engram reply bubbles were provided."""


class ReframeEmptyOutputError(ReframeError):
    """The model returned no spoken text."""
