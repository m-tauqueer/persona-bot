import pytest
from pydantic import ValidationError

from worker.config import WorkerSettings


def test_boot_refuses_chat_while_member_session_auth_is_false(
    settings: WorkerSettings,
) -> None:
    kwargs = settings.model_dump()
    kwargs["brain_mode"] = "chat"
    kwargs["engram_member_session_auth"] = False
    with pytest.raises(ValidationError) as caught:
        WorkerSettings(_env_file=None, **kwargs)
    text = str(caught.value)
    assert "BRAIN_MODE" in text
    assert "ENGRAM_MEMBER_SESSION_AUTH" in text


def test_boot_accepts_retrieve_while_member_session_auth_is_false(
    settings: WorkerSettings,
) -> None:
    kwargs = settings.model_dump()
    kwargs["brain_mode"] = "retrieve"
    kwargs["engram_member_session_auth"] = False
    kwargs["engram_member_secret_key"] = None
    loaded = WorkerSettings(_env_file=None, **kwargs)
    assert loaded.brain_mode == "retrieve"
    assert loaded.engram_member_session_auth is False
    assert loaded.engram_member_secret_key is None


def test_retrieve_scope_settings_load_and_version_path_must_be_absolute(
    settings: WorkerSettings,
) -> None:
    loaded = WorkerSettings(_env_file=None, **settings.model_dump())
    assert loaded.engram_api_version_path == "/v1"
    assert loaded.engram_retrieve_scope_shared == "shared"
    assert loaded.engram_retrieve_scope_private == "private"
    assert loaded.engram_retrieve_scope_both == "both"
    assert loaded.engram_retrieve_top_k_shared == 25
    assert loaded.engram_retrieve_top_k_private == 25
    assert loaded.answer_payload_persona_memories_key == "persona_memories"
    assert loaded.answer_payload_caller_memories_key == "caller_memories"
    assert loaded.memory_ref_pool_key == "pool"
    assert loaded.memory_ref_pool_persona == "persona"
    assert loaded.memory_ref_pool_caller == "caller"
    assert loaded.engram_scope_router_enabled is False
    assert loaded.engram_scope_router_timeout_seconds == 1.5
    assert loaded.answer_temperature == 0.0
    assert loaded.caller_fact_stamp_enabled is True
    assert loaded.caller_fact_stamp_template == " (stated {date})"
    assert loaded.engram_scope_router_workers == 4
    assert loaded.engram_scope_router_scope_key == "scope"
    assert loaded.engram_scope_router_reason_key == "reason"
    assert loaded.engram_scope_router_reason_shared == "persona_directed"
    assert loaded.engram_scope_router_reason_private == "self_directed"
    assert loaded.engram_scope_router_reason_both == "ambiguous"
    assert loaded.reframe_history_turns == 24
    assert loaded.engram_writeback_reason_paused == "private_write_paused"
    assert loaded.engram_writeback_reason_unauthenticated == "unauthenticated"
    assert loaded.log_engram_writeback == "engram_writeback"
    assert loaded.caller_fact_reason_empty == "empty"
    assert loaded.caller_fact_reason_extracted == "extracted"
    assert loaded.caller_fact_prefix == "The caller"
    assert loaded.caller_fact_timeout_seconds == 15.0
    assert loaded.caller_fact_max_facts == 8
    assert loaded.caller_fact_closing_max_turns == 200
    assert loaded.caller_fact_closing_max_bytes == 48000
    assert loaded.caller_fact_closing_retries == 1
    assert loaded.internal_closing_path == "/internal/closing-pass"
    assert loaded.admin_error_forget_private_confirmation == (
        "type the persona handle exactly to forget that private pool"
    )
    assert loaded.admin_error_user_missing == (
        "no signed-in user matches that identifier"
    )
    assert loaded.admin_error_engram_user_missing == (
        "that member has no Engram user id"
    )
    assert "retrieve_scope" in loaded.log_turn_fields
    assert "retrieve_scope_reason" in loaded.log_turn_fields
    kwargs = settings.model_dump()
    kwargs["engram_api_version_path"] = "v1"
    with pytest.raises(ValidationError) as caught:
        WorkerSettings(_env_file=None, **kwargs)
    assert "ENGRAM_API_VERSION_PATH" in str(caught.value)


def test_answer_payload_keys_must_be_distinct(settings: WorkerSettings) -> None:
    kwargs = settings.model_dump()
    kwargs["answer_payload_persona_memories_key"] = "memories"
    kwargs["answer_payload_caller_memories_key"] = "memories"
    with pytest.raises(ValidationError) as caught:
        WorkerSettings(_env_file=None, **kwargs)
    assert "ANSWER_PAYLOAD" in str(caught.value)


def test_scope_router_keys_and_reason_codes_must_be_distinct(
    settings: WorkerSettings,
) -> None:
    kwargs = settings.model_dump()
    kwargs["engram_scope_router_scope_key"] = "scope"
    kwargs["engram_scope_router_reason_key"] = "scope"
    with pytest.raises(ValidationError) as caught:
        WorkerSettings(_env_file=None, **kwargs)
    assert "ENGRAM_SCOPE_ROUTER_SCOPE_KEY" in str(caught.value)
    kwargs = settings.model_dump()
    kwargs["engram_scope_router_reason_timeout"] = "error"
    kwargs["engram_scope_router_reason_error"] = "error"
    with pytest.raises(ValidationError) as caught:
        WorkerSettings(_env_file=None, **kwargs)
    assert "reason codes" in str(caught.value)
    kwargs = settings.model_dump()
    kwargs["engram_retrieve_scope_shared"] = "both"
    kwargs["engram_retrieve_scope_both"] = "both"
    with pytest.raises(ValidationError) as caught:
        WorkerSettings(_env_file=None, **kwargs)
    assert "ENGRAM_RETRIEVE_SCOPE" in str(caught.value)
    kwargs = settings.model_dump()
    kwargs["engram_writeback_reason_paused"] = "same"
    kwargs["engram_writeback_reason_unauthenticated"] = "same"
    with pytest.raises(ValidationError) as caught:
        WorkerSettings(_env_file=None, **kwargs)
    assert "ENGRAM_WRITEBACK reason codes" in str(caught.value)
    kwargs = settings.model_dump()
    kwargs["caller_fact_payload_history_key"] = "same"
    kwargs["caller_fact_payload_facts_key"] = "same"
    with pytest.raises(ValidationError) as caught:
        WorkerSettings(_env_file=None, **kwargs)
    assert "CALLER_FACT_PAYLOAD" in str(caught.value)
    kwargs = settings.model_dump()
    kwargs["caller_fact_reason_empty"] = "error"
    kwargs["caller_fact_reason_error"] = "error"
    with pytest.raises(ValidationError) as caught:
        WorkerSettings(_env_file=None, **kwargs)
    assert "CALLER_FACT reason codes" in str(caught.value)
    kwargs = settings.model_dump()
    kwargs["caller_fact_closing_reason_missing"] = "already"
    kwargs["caller_fact_closing_reason_already"] = "already"
    with pytest.raises(ValidationError) as caught:
        WorkerSettings(_env_file=None, **kwargs)
    assert "CALLER_FACT_CLOSING reason codes" in str(caught.value)
    kwargs = settings.model_dump()
    kwargs["internal_closing_path"] = "internal/closing-pass"
    with pytest.raises(ValidationError) as caught:
        WorkerSettings(_env_file=None, **kwargs)
    assert "INTERNAL_CLOSING_PATH" in str(caught.value)


def test_boot_allows_missing_fish_key_and_refuses_shared_voice_keys(
    settings: WorkerSettings,
) -> None:
    kwargs = settings.model_dump()
    kwargs["fish_api_key"] = None
    loaded = WorkerSettings(_env_file=None, **kwargs)
    assert loaded.fish_api_key is None
    assert loaded.persona_voice_tts_key == "tts_voice"
    assert loaded.persona_voice_fish_key == "fish_voice"
    assert loaded.persona_voice_provider_key == "voice_provider"
    assert loaded.fish_clone_train_mode == "fast"
    assert loaded.fish_clone_visibility == "private"
    assert loaded.admin_fish_clone_max_bytes == 10485760
    kwargs["persona_voice_tts_key"] = "voice"
    kwargs["persona_voice_fish_key"] = "voice"
    with pytest.raises(ValidationError) as caught:
        WorkerSettings(_env_file=None, **kwargs)
    assert "PERSONA_VOICE_FISH_KEY" in str(caught.value)
