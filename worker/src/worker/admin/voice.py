from __future__ import annotations

from typing import Any


class VoiceProviderError(ValueError):
    pass


def as_voice_config(raw: object) -> dict[str, Any]:
    if isinstance(raw, dict):
        return dict(raw)
    return {}


def merge_tts_voice(
    voice_config: dict[str, Any],
    *,
    tts_voice: str | None,
    key: str,
) -> dict[str, Any]:
    merged = as_voice_config(voice_config)
    if tts_voice is None:
        return merged
    trimmed = tts_voice.strip()
    if trimmed:
        merged[key] = trimmed
    else:
        merged.pop(key, None)
    return merged


def merge_persona_voices(
    voice_config: dict[str, Any],
    *,
    tts_voice: str | None,
    tts_key: str,
    fish_voice: str | None,
    fish_key: str,
    provider: str | None = None,
    provider_key: str | None = None,
    allowed_providers: frozenset[str] | None = None,
) -> dict[str, Any]:
    merged = merge_tts_voice(voice_config, tts_voice=tts_voice, key=tts_key)
    merged = merge_tts_voice(merged, tts_voice=fish_voice, key=fish_key)
    if provider is None or not provider_key:
        return merged
    trimmed = provider.strip()
    if not trimmed:
        merged.pop(provider_key, None)
        return merged
    if allowed_providers is not None and trimmed not in allowed_providers:
        raise VoiceProviderError("voice_provider")
    merged[provider_key] = trimmed
    return merged
