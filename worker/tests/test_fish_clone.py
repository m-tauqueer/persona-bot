from __future__ import annotations

from types import SimpleNamespace

import httpx
import pytest

from worker.fish.accept import clip_allowed, parse_allowlist
from worker.fish.clone import HttpFishClone
from worker.fish.errors import FishCloneError


def test_clip_allowlist_uses_configured_types_and_suffixes() -> None:
    types = parse_allowlist("audio/wav,audio/mpeg")
    suffixes = parse_allowlist(".wav,.mp3")
    assert clip_allowed(
        filename="a.WAV",
        content_type="",
        content_types=types,
        suffixes=suffixes,
    )
    assert clip_allowed(
        filename="x.bin",
        content_type="audio/mpeg",
        content_types=types,
        suffixes=suffixes,
    )
    assert not clip_allowed(
        filename="notes.txt",
        content_type="text/plain",
        content_types=types,
        suffixes=suffixes,
    )


def test_http_clone_maps_payment_and_missing_key(
    settings,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    loaded = settings.model_copy(update={"fish_api_key": None})
    client = HttpFishClone(loaded)
    with pytest.raises(FishCloneError) as missing:
        client.create(
            title="Ada",
            audio=b"xx",
            filename="a.wav",
            content_type="audio/wav",
        )
    assert missing.value.reason == "fish_key_missing"

    paid = settings.model_copy(update={"fish_api_key": "k"})

    def payment(*_args: object, **_kwargs: object) -> SimpleNamespace:
        return SimpleNamespace(status_code=402, json=lambda: {})

    monkeypatch.setattr(httpx, "post", payment)
    with pytest.raises(FishCloneError) as caught:
        HttpFishClone(paid).create(
            title="Ada",
            audio=b"xx",
            filename="a.wav",
            content_type="audio/wav",
        )
    assert caught.value.status == 402
    assert caught.value.reason == "fish_payment"


def test_http_clone_maps_unauthorized(
    settings,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    paid = settings.model_copy(update={"fish_api_key": "k"})

    def unauthorized(*_args: object, **_kwargs: object) -> SimpleNamespace:
        return SimpleNamespace(status_code=401, json=lambda: {})

    monkeypatch.setattr(httpx, "post", unauthorized)
    with pytest.raises(FishCloneError) as caught:
        HttpFishClone(paid).create(
            title="Ada",
            audio=b"xx",
            filename="a.wav",
            content_type="audio/wav",
        )
    assert caught.value.status == 401
    assert caught.value.reason == "fish_unauthorized"


def test_http_clone_returns_id(settings, monkeypatch: pytest.MonkeyPatch) -> None:
    paid = settings.model_copy(update={"fish_api_key": "k"})

    def ok(*_args: object, **_kwargs: object) -> SimpleNamespace:
        return SimpleNamespace(
            status_code=200,
            json=lambda: {"_id": "fish-new", "state": "trained"},
        )

    monkeypatch.setattr(httpx, "post", ok)
    cloned = HttpFishClone(paid).create(
        title="Ada",
        audio=b"xx",
        filename="a.wav",
        content_type="audio/wav",
    )
    assert cloned.voice_id == "fish-new"
    assert cloned.state == "trained"


def test_http_clone_maps_network_and_bad_payload(
    settings,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    paid = settings.model_copy(update={"fish_api_key": "k"})

    def boom(*_args: object, **_kwargs: object) -> object:
        raise httpx.ConnectError("offline")

    monkeypatch.setattr(httpx, "post", boom)
    with pytest.raises(FishCloneError) as network:
        HttpFishClone(paid).create(
            title="Ada",
            audio=b"xx",
            filename="a.wav",
            content_type="audio/wav",
        )
    assert network.value.reason == "fish_clone_failed"

    def server_error(*_args: object, **_kwargs: object) -> SimpleNamespace:
        return SimpleNamespace(status_code=500, json=lambda: {})

    monkeypatch.setattr(httpx, "post", server_error)
    with pytest.raises(FishCloneError) as failed:
        HttpFishClone(paid).create(
            title="Ada",
            audio=b"xx",
            filename="a.wav",
            content_type="audio/wav",
        )
    assert failed.value.reason == "fish_clone_failed"

    def bad_json(*_args: object, **_kwargs: object) -> SimpleNamespace:
        def explode() -> object:
            raise ValueError("no json")

        return SimpleNamespace(status_code=200, json=explode)

    monkeypatch.setattr(httpx, "post", bad_json)
    with pytest.raises(FishCloneError) as parsed:
        HttpFishClone(paid).create(
            title="Ada",
            audio=b"xx",
            filename="a.wav",
            content_type="audio/wav",
        )
    assert parsed.value.reason == "fish_clone_failed"

    def no_id(*_args: object, **_kwargs: object) -> SimpleNamespace:
        return SimpleNamespace(status_code=200, json=lambda: {"state": "trained"})

    monkeypatch.setattr(httpx, "post", no_id)
    with pytest.raises(FishCloneError) as missing_id:
        HttpFishClone(paid).create(
            title="Ada",
            audio=b"xx",
            filename="a.wav",
            content_type="audio/wav",
        )
    assert missing_id.value.reason == "fish_clone_failed"
