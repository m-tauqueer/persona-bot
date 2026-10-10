from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from worker.api.internal_auth import require_internal_secret
from worker.config import WorkerSettings

_AUTH_FAIL = "worker.api.internal_auth.register_auth_failure"


def _request(secret: str | None, host: str = "10.0.0.8"):
    headers = {}
    if secret is not None:
        headers["x-internal-secret"] = secret
    return SimpleNamespace(
        headers=headers,
        client=SimpleNamespace(host=host),
    )


def test_accepts_the_configured_secret(
    settings: WorkerSettings,
    monkeypatch,
) -> None:
    monkeypatch.setattr(_AUTH_FAIL, lambda *_: False)
    guard = require_internal_secret(settings)
    guard(_request(settings.internal_api_secret))


def test_wrong_secret_is_401(settings: WorkerSettings, monkeypatch) -> None:
    monkeypatch.setattr(_AUTH_FAIL, lambda *_: False)
    guard = require_internal_secret(settings)
    with pytest.raises(HTTPException) as caught:
        guard(_request("wrong-secret-value"))
    assert caught.value.status_code == 401


def test_missing_secret_is_401(settings: WorkerSettings, monkeypatch) -> None:
    monkeypatch.setattr(_AUTH_FAIL, lambda *_: False)
    guard = require_internal_secret(settings)
    with pytest.raises(HTTPException) as caught:
        guard(_request(None))
    assert caught.value.status_code == 401


def test_throttle_becomes_429(settings: WorkerSettings, monkeypatch) -> None:
    monkeypatch.setattr(_AUTH_FAIL, lambda *_: True)
    guard = require_internal_secret(settings)
    with pytest.raises(HTTPException) as caught:
        guard(_request("guess"))
    assert caught.value.status_code == 429
