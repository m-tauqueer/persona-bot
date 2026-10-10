"""Encrypt the Engram member password at rest. The key never leaves the worker."""

from __future__ import annotations

import base64
import os

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

# AES-256-GCM. 32-byte key from ENGRAM_MEMBER_SECRET_KEY (base64). 12-byte
# nonce is the AES-GCM standard; a new nonce is drawn per record and never
# reused. Tag is 16 bytes, appended by AESGCM.encrypt.
MEMBER_SECRET_KEY_BYTES = 32
GCM_NONCE_BYTES = 12
GCM_TAG_BYTES = 16


class MemberSecretError(Exception):
    """Encrypt or decrypt failed. Messages never include plaintext or ciphertext."""


def decode_member_secret_key(value: str) -> bytes:
    try:
        raw = base64.b64decode(value, validate=True)
    except Exception as exc:
        raise MemberSecretError(
            "ENGRAM_MEMBER_SECRET_KEY is not valid base64",
        ) from exc
    if len(raw) != MEMBER_SECRET_KEY_BYTES:
        raise MemberSecretError(
            "ENGRAM_MEMBER_SECRET_KEY must decode to 32 bytes",
        )
    return raw


def ciphertext_for_password(password: str | None, *, key: bytes | None) -> str | None:
    """Encrypt a proven password, or None when we hold no credential / no key."""
    if password is None or key is None:
        return None
    try:
        return encrypt_member_secret(password, key=key)
    except MemberSecretError:
        return None


def encrypt_member_secret(plaintext: str, *, key: bytes) -> str:
    if len(key) != MEMBER_SECRET_KEY_BYTES:
        raise MemberSecretError(
            "ENGRAM_MEMBER_SECRET_KEY must decode to 32 bytes",
        )
    nonce = os.urandom(GCM_NONCE_BYTES)
    packed = nonce + AESGCM(key).encrypt(nonce, plaintext.encode("utf-8"), None)
    return base64.b64encode(packed).decode("ascii")


def decrypt_member_secret(blob: str, *, key: bytes) -> str:
    if len(key) != MEMBER_SECRET_KEY_BYTES:
        raise MemberSecretError(
            "ENGRAM_MEMBER_SECRET_KEY must decode to 32 bytes",
        )
    try:
        packed = base64.b64decode(blob, validate=True)
    except Exception as exc:
        raise MemberSecretError("member secret ciphertext is not valid base64") from exc
    minimum = GCM_NONCE_BYTES + GCM_TAG_BYTES
    if len(packed) < minimum:
        raise MemberSecretError("member secret ciphertext is truncated")
    nonce = packed[:GCM_NONCE_BYTES]
    ciphertext = packed[GCM_NONCE_BYTES:]
    try:
        return AESGCM(key).decrypt(nonce, ciphertext, None).decode("utf-8")
    except (InvalidTag, UnicodeDecodeError, ValueError) as exc:
        raise MemberSecretError("member secret decrypt failed") from exc
