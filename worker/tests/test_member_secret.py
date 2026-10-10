from __future__ import annotations

import base64

import pytest
from pydantic import ValidationError

from worker.config import WorkerSettings
from worker.engram.member_secret import (
    MEMBER_SECRET_KEY_BYTES,
    MemberSecretError,
    decrypt_member_secret,
    encrypt_member_secret,
)


def _key(fill: bytes) -> bytes:
    return fill * MEMBER_SECRET_KEY_BYTES


def test_round_trip() -> None:
    key = _key(b"a")
    blob = encrypt_member_secret("correct-horse-battery", key=key)
    assert decrypt_member_secret(blob, key=key) == "correct-horse-battery"


def test_wrong_key_fails_loudly() -> None:
    plaintext = "correct-horse-battery"
    blob = encrypt_member_secret(plaintext, key=_key(b"a"))
    with pytest.raises(MemberSecretError, match="decrypt failed") as caught:
        decrypt_member_secret(blob, key=_key(b"b"))
    assert plaintext not in str(caught.value)
    assert blob not in str(caught.value)


def test_two_encryptions_of_the_same_plaintext_differ() -> None:
    key = _key(b"a")
    first = encrypt_member_secret("same-secret", key=key)
    second = encrypt_member_secret("same-secret", key=key)
    assert first != second
    assert decrypt_member_secret(first, key=key) == "same-secret"
    assert decrypt_member_secret(second, key=key) == "same-secret"


def test_truncated_ciphertext_fails_loudly() -> None:
    blob = base64.b64encode(b"short").decode("ascii")
    with pytest.raises(MemberSecretError, match="truncated"):
        decrypt_member_secret(blob, key=_key(b"a"))


def test_wrong_length_raw_key_fails_before_aes() -> None:
    with pytest.raises(MemberSecretError, match="32 bytes"):
        encrypt_member_secret("x", key=b"short")
    with pytest.raises(MemberSecretError, match="32 bytes"):
        decrypt_member_secret("YQ==", key=b"short")


def test_boot_refuses_malformed_key_when_session_auth_is_true(
    settings: WorkerSettings,
) -> None:
    kwargs = settings.model_dump()
    kwargs["engram_member_session_auth"] = True
    kwargs["engram_member_secret_key"] = "not-valid-base64!!!"
    with pytest.raises(ValidationError) as caught:
        WorkerSettings(_env_file=None, **kwargs)
    text = str(caught.value)
    assert "ENGRAM_MEMBER_SECRET_KEY" in text


def test_boot_refuses_wrong_length_key_when_session_auth_is_true(
    settings: WorkerSettings,
) -> None:
    kwargs = settings.model_dump()
    kwargs["engram_member_session_auth"] = True
    kwargs["engram_member_secret_key"] = base64.b64encode(b"short").decode("ascii")
    with pytest.raises(ValidationError) as caught:
        WorkerSettings(_env_file=None, **kwargs)
    text = str(caught.value)
    assert "ENGRAM_MEMBER_SECRET_KEY" in text
    assert "32 bytes" in text


def test_boot_refuses_missing_key_when_session_auth_is_true(
    settings: WorkerSettings,
) -> None:
    kwargs = settings.model_dump()
    kwargs["engram_member_session_auth"] = True
    kwargs["engram_member_secret_key"] = None
    with pytest.raises(ValidationError) as caught:
        WorkerSettings(_env_file=None, **kwargs)
    text = str(caught.value)
    assert "ENGRAM_MEMBER_SESSION_AUTH" in text
    assert "ENGRAM_MEMBER_SECRET_KEY" in text


def test_boot_tolerates_missing_key_when_session_auth_is_false(
    settings: WorkerSettings,
) -> None:
    kwargs = settings.model_dump()
    kwargs["engram_member_session_auth"] = False
    kwargs["engram_member_secret_key"] = None
    loaded = WorkerSettings(_env_file=None, **kwargs)
    assert loaded.engram_member_session_auth is False
    assert loaded.engram_member_secret_key is None


def test_boot_accepts_valid_key_when_session_auth_is_true(
    settings: WorkerSettings,
) -> None:
    kwargs = settings.model_dump()
    kwargs["engram_member_session_auth"] = True
    loaded = WorkerSettings(_env_file=None, **kwargs)
    assert loaded.engram_member_session_auth is True
    assert loaded.engram_member_secret_key == settings.engram_member_secret_key
