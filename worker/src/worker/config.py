from __future__ import annotations

import os
from pathlib import Path
from typing import Literal
from zoneinfo import ZoneInfo

from pydantic import Field, HttpUrl, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


def env_file_path() -> Path:
    override = os.environ.get("ENV_FILE")
    if override:
        return Path(override)
    return Path(__file__).resolve().parents[3] / ".env"


def _empty_to_none(value: str | None) -> str | None:
    if value is None:
        return None
    stripped = value.strip()
    return stripped or None


class WorkerSettings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=env_file_path(),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    node_env: Literal["development", "production", "test"]
    log_level: str
    worker_host: str
    worker_port: int = Field(gt=0)
    database_url: str = Field(min_length=1)
    redis_url: str | None = None
    voice_notice_redis_channel: str = Field(default="voice-notice", min_length=1)
    redis_command_timeout_ms: int = Field(default=500, gt=0)
    quota_turns_per_day: int = Field(default=0, ge=0)
    quota_voice_minutes_per_day: float = Field(default=0, ge=0)
    quota_timezone: str = Field(default="UTC", min_length=1)
    quota_warn_ratio: float = Field(default=0.8, ge=0, le=1)
    quota_kind_turns: str = Field(default="turns", min_length=1)
    quota_kind_minutes: str = Field(default="minutes", min_length=1)
    quota_code_turns: str = Field(default="quota_turns", min_length=1)
    quota_code_minutes: str = Field(default="quota_minutes", min_length=1)
    quota_error_turns: str = Field(
        default="Daily turn limit reached. Try again after reset_at.",
        min_length=1,
    )
    quota_error_minutes: str = Field(
        default="Daily voice-minute limit reached. Try again after reset_at.",
        min_length=1,
    )
    quota_log_refused: str = Field(default="quota refused", min_length=1)
    quota_log_warn: str = Field(default="quota warn", min_length=1)
    owner_emails: str = Field(default="")
    internal_api_secret: str = Field(min_length=16)
    rate_limit_enabled: bool = Field(default=True)
    rate_limit_redis_prefix: str = Field(default="ratelimit:", min_length=1)
    internal_auth_max_failures: int = Field(default=20, gt=0)
    internal_auth_failure_window_seconds: int = Field(default=60, gt=0)
    failure_code_engram: str = Field(default="engram_unavailable", min_length=1)
    failure_code_speaking_llm: str = Field(
        default="speaking_llm_failed",
        min_length=1,
    )
    failure_code_record: str = Field(default="record_lost", min_length=1)
    failure_code_database: str = Field(
        default="database_unavailable",
        min_length=1,
    )
    failure_message_engram: str = Field(
        default=(
            "The persona's memory is unavailable. "
            "Nothing was invented in its place."
        ),
        min_length=1,
    )
    failure_message_speaking_llm: str = Field(
        default=(
            "The reply stopped early. "
            "You heard only the words that were produced."
        ),
        min_length=1,
    )
    failure_message_record: str = Field(
        default=(
            "The reply was delivered but the conversation record "
            "could not be saved."
        ),
        min_length=1,
    )
    failure_message_database: str = Field(
        default=(
            "The conversation record is unavailable. "
            "This turn could not start."
        ),
        min_length=1,
    )
    ops_service_worker: str = Field(default="worker", min_length=1)
    ops_record_codes: str = Field(
        default=(
            "engram_unavailable,deepgram_unavailable,think_failed,"
            "database_unavailable,speaking_llm_failed,record_lost"
        ),
        min_length=1,
    )
    ops_log_event: str = Field(default="ops event", min_length=1)
    internal_secret_header: str = Field(default="x-internal-secret")
    worker_openapi_enabled: bool = Field(default=False)
    correlation_id_header: str = Field(default="x-correlation-id")
    log_turn_fields: str = Field(
        default=(
            "correlation_id,session_id,turn_ids,action,reasons,"
            "brain_ms,reframe_ms,reframe_first_token_ms,brain_mode,recorded,"
            "retrieve_hits,retrieve_hits_grounded,retrieve_hits_dropped,"
            "retrieve_hits_shared,retrieve_hits_shared_grounded,"
            "retrieve_hits_shared_dropped,retrieve_hits_private,"
            "retrieve_hits_private_grounded,retrieve_hits_private_dropped,"
            "member_authenticated,engram_credential,"
            "retrieve_scope,retrieve_scope_reason"
        ),
        min_length=1,
    )
    log_turn_event: str = Field(default="turn", min_length=1)
    log_subscribe_forbidden: str = Field(
        default="subscribe_forbidden",
        min_length=1,
    )
    log_subscribe_failed: str = Field(default="subscribe_failed", min_length=1)
    log_engram_join_failed: str = Field(default="engram_join_failed", min_length=1)
    log_engram_join_skipped: str = Field(default="engram_join_skipped", min_length=1)
    log_engram_credential_unavailable: str = Field(
        default="engram_credential_unavailable",
        min_length=1,
    )
    log_engram_writeback_skipped: str = Field(
        default="engram_writeback_skipped",
        min_length=1,
    )
    log_retrieve_grounded_event: str = Field(
        default="retrieve grounded",
        min_length=1,
    )
    engram_credential_member: str = Field(default="member", min_length=1)
    engram_credential_org: str = Field(default="org", min_length=1)
    failure_message_engram_join: str = Field(
        default=(
            "Could not join this member to the persona memory workspace. "
            "The turn did not run."
        ),
        min_length=1,
    )
    failure_code_engram_join: str = Field(default="engram_join_failed", min_length=1)
    engram_org_member_role: str = Field(default="member", min_length=1)
    engram_org_member_password_nbytes: int = Field(default=24, ge=8)
    engram_org_join_skip_email_prefix: str = Field(default="probe-", min_length=1)
    engram_org_join_skip_email_domain: str = Field(
        default="example.test",
        min_length=1,
    )
    voice_notice_kind_trace: str = Field(default="trace", min_length=1)
    voice_notice_trace_code: str = Field(default="turn_traced", min_length=1)
    voice_notice_trace_message: str = Field(default="Turn recorded.", min_length=1)
    engram_logs_limit: int = Field(default=50, gt=0)
    engram_log_result_denied: str = Field(default="denied", min_length=1)
    engram_log_result_error: str = Field(default="error", min_length=1)
    lifecycle_memory_page_size: int = Field(default=50, gt=0)
    engram_api_key: str | None = None
    engram_org_id: str | None = None
    engram_base_url: HttpUrl | None = None
    engram_timeout_seconds: int = Field(default=120, gt=0)
    engram_message_join: str = Field(default=" ")
    engram_read_max_retries: int = Field(default=2, ge=0)
    engram_client_cache_size: int = Field(default=8, gt=0)
    # "retrieve" reads memory and lets the answer model compose the reply.
    # Sitting transcript stays in Postgres; Engram private is not converse-written.
    # "chat" lets Engram compose it, which costs about ten more seconds a turn.
    brain_mode: Literal["chat", "retrieve"] = "retrieve"
    # When true, member turns authenticate as that member (session token).
    # Leave false until that credential path exists. False is containment:
    # private write-back is off and BRAIN_MODE=chat cannot boot, so we stop
    # growing the API key owner's private pool. See docs/ENGRAM.md §2.3.
    engram_member_session_auth: bool = False
    # 32 random bytes, base64. Encrypts each member's Engram password at rest.
    # Empty is unset. Required when ENGRAM_MEMBER_SESSION_AUTH is true. Never
    # used to derive a password — rotating this re-encrypts stored ciphertext.
    engram_member_secret_key: str | None = None
    # Refresh a member session token this long before expires_in elapses.
    engram_member_token_refresh_skew_seconds: int = Field(default=1800, ge=0)
    engram_retrieve_top_k: int = Field(default=25, gt=0)
    # Prefix the SDK discovers from /config. Our own scoped retrieve posts
    # need it explicitly. Unknown scope values must reach Engram (422).
    engram_api_version_path: str = Field(default="/v1", min_length=1)
    engram_retrieve_scope_shared: str = Field(default="shared", min_length=1)
    engram_retrieve_scope_private: str = Field(default="private", min_length=1)
    engram_retrieve_scope_both: str = Field(default="both", min_length=1)
    engram_retrieve_top_k_shared: int = Field(default=25, gt=0)
    engram_retrieve_top_k_private: int = Field(default=25, gt=0)
    memory_panel_query: str = Field(min_length=1)
    memory_panel_top_k: int = Field(default=25, gt=0)
    # Gates the off-path write worker. That worker extracts caller facts and
    # writes them as private text. It does not converse the sitting. Degraded
    # members never write regardless of this flag.
    engram_converse_writeback: bool = Field(default=True)
    engram_writeback_workers: int = Field(default=2, gt=0)
    engram_writeback_reason_paused: str = Field(
        default="private_write_paused",
        min_length=1,
    )
    engram_writeback_reason_unauthenticated: str = Field(
        default="unauthenticated",
        min_length=1,
    )
    log_engram_writeback: str = Field(default="engram_writeback", min_length=1)
    engram_writeback_reason_claim_failed: str = Field(
        default="claim_failed",
        min_length=1,
    )
    engram_writeback_reason_write_failed: str = Field(
        default="write_failed",
        min_length=1,
    )
    # Off the reply path. Empty model uses OPENAI_MODEL.
    caller_fact_model: str | None = None
    caller_fact_timeout_seconds: float = Field(default=15.0, gt=0)
    caller_fact_temperature: float = Field(default=0.0, ge=0, le=2)
    caller_fact_max_tokens: int = Field(default=256, gt=0)
    caller_fact_max_facts: int = Field(default=8, gt=0)
    caller_fact_system_prompt: str | None = None
    # The hang-up sweep runs the same extractor with a different brief: the
    # per-turn pass already recorded each exchange, so closing only catches
    # what needed the whole sitting to see.
    caller_fact_closing_system_prompt: str | None = None
    caller_fact_prefix: str = Field(default="The caller", min_length=1)
    # Private rows are append-only, so a corrected fact never removes the
    # stale one. The date travels in the row so the answerer can prefer the
    # newer of two conflicting caller memories.
    caller_fact_stamp_enabled: bool = Field(default=True)
    caller_fact_stamp_template: str = Field(
        default=" (stated {date})",
        min_length=1,
    )
    caller_fact_stamp_date_format: str = Field(default="%Y-%m-%d", min_length=1)
    caller_fact_payload_history_key: str = Field(default="history", min_length=1)
    caller_fact_payload_user_turn_key: str = Field(
        default="user_turn",
        min_length=1,
    )
    caller_fact_payload_persona_reply_key: str = Field(
        default="persona_reply",
        min_length=1,
    )
    caller_fact_payload_facts_key: str = Field(
        default="caller_facts",
        min_length=1,
    )
    caller_fact_payload_speaker_key: str = Field(default="speaker", min_length=1)
    caller_fact_payload_text_key: str = Field(default="text", min_length=1)
    caller_fact_response_format_type: str = Field(
        default="json_object",
        min_length=1,
    )
    caller_fact_reason_empty: str = Field(default="empty", min_length=1)
    caller_fact_reason_extracted: str = Field(default="extracted", min_length=1)
    caller_fact_reason_timeout: str = Field(default="timeout", min_length=1)
    caller_fact_reason_error: str = Field(default="error", min_length=1)
    caller_fact_reason_unrecognised: str = Field(
        default="unrecognised",
        min_length=1,
    )
    # Hang-up safety net. Same extractor, full sitting, size-capped. Off the
    # client path. One extra extract attempt on worker fault; never dump.
    caller_fact_closing_max_turns: int = Field(default=200, gt=0)
    caller_fact_closing_max_bytes: int = Field(default=48000, gt=0)
    caller_fact_closing_retries: int = Field(default=1, ge=0)
    internal_closing_path: str = Field(
        default="/internal/closing-pass",
        min_length=1,
    )
    log_engram_closing: str = Field(default="engram_closing", min_length=1)
    caller_fact_closing_reason_missing: str = Field(
        default="missing",
        min_length=1,
    )
    caller_fact_closing_reason_not_ended: str = Field(
        default="not_ended",
        min_length=1,
    )
    caller_fact_closing_reason_already: str = Field(
        default="already",
        min_length=1,
    )
    # Reads sit on the path to first word, so they get a pool of their own
    # rather than sharing the write-back one. Each turn submits a single
    # private read; the shared read runs on the calling thread.
    engram_retrieve_workers: int = Field(default=4, gt=0)
    # Scope classifier. Runs beside the two retrieves, never in front of
    # them. Timeout, error, or an unrecognised value falls open to both
    # pools. Off until the owner turns it on — fail-open is the default
    # path either way.
    engram_scope_router_enabled: bool = Field(default=False)
    engram_scope_router_model: str | None = None
    engram_scope_router_timeout_seconds: float = Field(default=1.5, gt=0)
    engram_scope_router_system_prompt: str | None = None
    engram_scope_router_workers: int = Field(default=4, gt=0)
    engram_scope_router_temperature: float = Field(default=0.0, ge=0, le=2)
    engram_scope_router_max_tokens: int = Field(default=64, gt=0)
    engram_scope_router_scope_key: str = Field(default="scope", min_length=1)
    engram_scope_router_reason_key: str = Field(default="reason", min_length=1)
    engram_scope_router_question_key: str = Field(default="question", min_length=1)
    engram_scope_router_response_format_type: str = Field(
        default="json_object",
        min_length=1,
    )
    engram_scope_router_reason_shared: str = Field(
        default="persona_directed",
        min_length=1,
    )
    engram_scope_router_reason_private: str = Field(
        default="self_directed",
        min_length=1,
    )
    engram_scope_router_reason_both: str = Field(
        default="ambiguous",
        min_length=1,
    )
    engram_scope_router_reason_timeout: str = Field(
        default="timeout",
        min_length=1,
    )
    engram_scope_router_reason_error: str = Field(
        default="error",
        min_length=1,
    )
    engram_scope_router_reason_unrecognised: str = Field(
        default="unrecognised",
        min_length=1,
    )
    engram_scope_router_reason_disabled: str = Field(
        default="disabled",
        min_length=1,
    )
    engram_scope_router_reason_unauthenticated: str = Field(
        default="unauthenticated",
        min_length=1,
    )
    engram_converse_user_speaker: str = Field(default="user", min_length=1)
    engram_converse_persona_speaker: str = Field(default="persona", min_length=1)
    engram_persona_id: str | None = None
    # Local personas.id of a throwaway persona. Write-capable probes require
    # this and skip when it is unset, so they never write a member-facing pool.
    probe_persona_id: str | None = None
    probe_write_skip: str = Field(
        default=(
            "PROBE_PERSONA_ID is unset; skipping writes so a member-facing "
            "persona is not used."
        ),
        min_length=1,
    )
    probe_chat_mode_skip: str = Field(
        default=(
            "BRAIN_MODE=chat refused while ENGRAM_MEMBER_SESSION_AUTH is false."
        ),
        min_length=1,
    )
    persona_error_not_found: str = Field(default="persona not found", min_length=1)
    admin_error_persona_pin_required: str = Field(
        default="persona_id is required when several personas exist",
        min_length=1,
    )
    admin_error_create_forbidden: str = Field(
        default="Engram refused create; record a dashboard persona id instead",
        min_length=1,
    )
    # Destroy is confirmed by typing the persona's own handle, so the owner
    # cannot wipe the wrong one with a phrase they already have in the clipboard.
    admin_error_destroy_confirmation: str = Field(
        default="type the persona handle exactly to destroy it",
        min_length=1,
    )
    admin_error_forget_private_confirmation: str = Field(
        default=(
            "type the persona handle exactly to forget that private pool"
        ),
        min_length=1,
    )
    admin_error_user_missing: str = Field(
        default="no signed-in user matches that identifier",
        min_length=1,
    )
    admin_error_engram_user_missing: str = Field(
        default="that member has no Engram user id",
        min_length=1,
    )
    persona_voice_tts_key: str = Field(default="tts_voice", min_length=1)
    persona_voice_fish_key: str = Field(default="fish_voice", min_length=1)
    persona_voice_provider_key: str = Field(
        default="voice_provider",
        min_length=1,
    )
    persona_voice_provider_aura: str = Field(default="aura", min_length=1)
    persona_voice_provider_fish: str = Field(default="fish", min_length=1)
    admin_error_voice_provider: str = Field(
        default="voice provider is not a configured choice",
        min_length=1,
    )
    fish_api_key: str | None = None
    fish_api_base_url: str = Field(
        default="https://api.fish.audio",
        min_length=1,
    )
    fish_tts_model: str = Field(default="s2.1-pro-free", min_length=1)
    fish_tts_format: str = Field(default="pcm", min_length=1)
    fish_tts_sample_rate: int = Field(default=24000, gt=0)
    fish_tts_latency: str = Field(default="balanced", min_length=1)
    fish_clone_type: str = Field(default="tts", min_length=1)
    fish_clone_train_mode: str = Field(default="fast", min_length=1)
    fish_clone_visibility: str = Field(default="private", min_length=1)
    fish_clone_enhance: bool = Field(default=True)
    fish_clone_ready_state: str = Field(default="trained", min_length=1)
    fish_clone_timeout_seconds: float = Field(default=60, gt=0)
    admin_fish_clone_max_bytes: int = Field(default=10485760, gt=0)
    fish_clone_content_types: str = Field(
        default="audio/wav,audio/mpeg,audio/mp4,audio/ogg,audio/webm,audio/x-wav",
        min_length=1,
    )
    fish_clone_suffixes: str = Field(
        default=".wav,.mp3,.m4a,.opus,.webm,.ogg",
        min_length=1,
    )
    admin_error_fish_key_missing: str = Field(
        default="Fish API key is not set",
        min_length=1,
    )
    admin_error_fish_unauthorized: str = Field(
        default="Fish rejected the API key",
        min_length=1,
    )
    admin_error_fish_payment: str = Field(
        default="Fish has no remaining API credits",
        min_length=1,
    )
    admin_error_fish_clone_failed: str = Field(
        default="Fish could not clone that clip",
        min_length=1,
    )
    admin_error_fish_untrained: str = Field(
        default="Fish has not finished training that voice",
        min_length=1,
    )
    admin_error_fish_clip_type: str = Field(
        default="clip type is not allowed",
        min_length=1,
    )
    admin_error_fish_clip_empty: str = Field(
        default="clip is empty",
        min_length=1,
    )
    db_pool_min_size: int = Field(default=1, ge=0)
    db_pool_max_size: int = Field(default=8, gt=0)
    db_pool_timeout_seconds: float = Field(default=10, gt=0)
    db_pool_max_idle_seconds: float = Field(default=300, gt=0)
    admin_ingest_max_bytes: int = Field(default=8388608, gt=0)
    openai_api_key: str | None = None
    openai_model: str = Field(default="gpt-4o-mini")
    openai_base_url: str | None = None
    openai_api_base_url: str | None = None
    reframe_history_turns: int = Field(default=24, ge=0)
    reframe_temperature: float = Field(default=0.2, ge=0, le=2)
    reframe_max_tokens: int = Field(default=256, gt=0)
    reframe_timeout_seconds: float = Field(default=30, gt=0)
    reframe_stream_enabled: bool = Field(default=True)
    reframe_system_prompt: str | None = None
    answer_system_prompt: str | None = None
    answer_temperature: float = Field(default=0, ge=0, le=2)
    answer_max_tokens: int = Field(default=320, gt=0)
    answer_payload_persona_memories_key: str = Field(
        default="persona_memories",
        min_length=1,
    )
    answer_payload_caller_memories_key: str = Field(
        default="caller_memories",
        min_length=1,
    )
    # The persona's own name and description. Under BRAIN_MODE=chat Engram
    # composes the reply and already grounds on these; on the retrieve path we
    # compose, so without them the persona cannot answer "what is your name?"
    # from anything but a memory that happens to state it in the first person.
    answer_payload_persona_identity_key: str = Field(
        default="persona_identity",
        min_length=1,
    )
    persona_identity_name_key: str = Field(default="name", min_length=1)
    persona_identity_description_key: str = Field(
        default="description",
        min_length=1,
    )
    answer_payload_history_key: str = Field(default="history", min_length=1)
    answer_payload_question_key: str = Field(default="question", min_length=1)
    answer_payload_voice_config_key: str = Field(
        default="voice_config",
        min_length=1,
    )
    memory_ref_pool_key: str = Field(default="pool", min_length=1)
    memory_ref_pool_persona: str = Field(default="persona", min_length=1)
    memory_ref_pool_caller: str = Field(default="caller", min_length=1)
    byo_llm_chat_completions_path: str = Field(
        default="/v1/chat/completions",
        min_length=1,
    )
    byo_llm_app_user_header: str = Field(default="x-app-user-id", min_length=1)
    byo_llm_engram_user_header: str = Field(
        default="x-engram-user-id",
        min_length=1,
    )
    byo_llm_persona_header: str = Field(default="x-persona-id", min_length=1)
    byo_llm_session_header: str = Field(default="x-session-id", min_length=1)
    byo_llm_user_role: str = Field(default="user", min_length=1)
    byo_llm_assistant_role: str = Field(default="assistant", min_length=1)
    byo_llm_text_part_type: str = Field(default="text", min_length=1)
    byo_llm_completion_object: str = Field(
        default="chat.completion",
        min_length=1,
    )
    byo_llm_chunk_object: str = Field(
        default="chat.completion.chunk",
        min_length=1,
    )
    byo_llm_finish_reason: str = Field(default="stop", min_length=1)
    byo_llm_completion_id_prefix: str = Field(default="chatcmpl-", min_length=1)
    byo_llm_sse_done: str = Field(default="[DONE]", min_length=1)
    byo_llm_sse_media_type: str = Field(
        default="text/event-stream",
        min_length=1,
    )

    @field_validator("internal_secret_header", mode="before")
    @classmethod
    def default_internal_header(cls, value: object) -> object:
        if isinstance(value, str) and value.strip() == "":
            return "x-internal-secret"
        return value

    @field_validator("correlation_id_header", mode="before")
    @classmethod
    def default_correlation_header(cls, value: object) -> object:
        if isinstance(value, str) and value.strip() == "":
            return "x-correlation-id"
        return value

    @field_validator("quota_timezone")
    @classmethod
    def quota_timezone_known(cls, value: str) -> str:
        ZoneInfo(value)
        return value

    @field_validator("log_turn_fields")
    @classmethod
    def turn_fields_required(cls, value: str) -> str:
        fields = {
            item.strip()
            for item in value.replace("\n", ",").split(",")
            if item.strip()
        }
        if "correlation_id" not in fields or "session_id" not in fields:
            raise ValueError(
                "LOG_TURN_FIELDS must include correlation_id and session_id",
            )
        return value

    @field_validator(
        "engram_api_key",
        "engram_org_id",
        "engram_persona_id",
        "engram_member_secret_key",
        "probe_persona_id",
        "openai_api_key",
        "fish_api_key",
        "openai_base_url",
        "openai_api_base_url",
        "reframe_system_prompt",
        "answer_system_prompt",
        "caller_fact_system_prompt",
        "caller_fact_closing_system_prompt",
        "engram_scope_router_model",
        "engram_scope_router_system_prompt",
        "redis_url",
        mode="before",
    )
    @classmethod
    def blank_optional(cls, value: object) -> object:
        if not isinstance(value, str):
            return value
        return _empty_to_none(value)

    @field_validator("engram_base_url", mode="before")
    @classmethod
    def blank_engram_url(cls, value: object) -> object:
        if not isinstance(value, str):
            return value
        return _empty_to_none(value)

    @field_validator("engram_message_join", mode="before")
    @classmethod
    def default_message_join(cls, value: object) -> object:
        if value is None:
            return " "
        if isinstance(value, str) and value == "":
            return " "
        return value

    @field_validator("openai_model", mode="before")
    @classmethod
    def default_openai_model(cls, value: object) -> object:
        if value is None:
            return "gpt-4o-mini"
        if isinstance(value, str) and value.strip() == "":
            return "gpt-4o-mini"
        return value

    @field_validator("ops_service_worker")
    @classmethod
    def ops_service_is_known(cls, value: str) -> str:
        if value not in {"gateway", "worker"}:
            raise ValueError("OPS_SERVICE_WORKER must be gateway or worker")
        return value

    @field_validator("byo_llm_chat_completions_path")
    @classmethod
    def completions_path_absolute(cls, value: str) -> str:
        if not value.startswith("/"):
            raise ValueError("BYO_LLM_CHAT_COMPLETIONS_PATH must start with /")
        return value

    @field_validator("engram_api_version_path")
    @classmethod
    def engram_version_path_absolute(cls, value: str) -> str:
        if not value.startswith("/"):
            raise ValueError("ENGRAM_API_VERSION_PATH must start with /")
        return value

    @field_validator("internal_closing_path")
    @classmethod
    def closing_path_absolute(cls, value: str) -> str:
        if not value.startswith("/") or value.startswith("//"):
            raise ValueError("INTERNAL_CLOSING_PATH must start with /")
        return value

    @model_validator(mode="after")
    def distinct_answer_and_memory_ref_keys(self) -> WorkerSettings:
        payload = {
            self.answer_payload_persona_memories_key,
            self.answer_payload_caller_memories_key,
            self.answer_payload_persona_identity_key,
            self.answer_payload_history_key,
            self.answer_payload_question_key,
            self.answer_payload_voice_config_key,
        }
        if len(payload) != 6:
            raise ValueError(
                "ANSWER_PAYLOAD_PERSONA_MEMORIES_KEY, "
                "ANSWER_PAYLOAD_CALLER_MEMORIES_KEY, "
                "ANSWER_PAYLOAD_PERSONA_IDENTITY_KEY, "
                "ANSWER_PAYLOAD_HISTORY_KEY, ANSWER_PAYLOAD_QUESTION_KEY, and "
                "ANSWER_PAYLOAD_VOICE_CONFIG_KEY must be distinct"
            )
        if self.persona_identity_name_key == self.persona_identity_description_key:
            raise ValueError(
                "PERSONA_IDENTITY_NAME_KEY must differ from "
                "PERSONA_IDENTITY_DESCRIPTION_KEY"
            )
        if self.memory_ref_pool_persona == self.memory_ref_pool_caller:
            raise ValueError(
                "MEMORY_REF_POOL_PERSONA must differ from MEMORY_REF_POOL_CALLER"
            )
        writeback_reasons = {
            self.engram_writeback_reason_paused,
            self.engram_writeback_reason_unauthenticated,
            self.engram_writeback_reason_claim_failed,
            self.engram_writeback_reason_write_failed,
        }
        if len(writeback_reasons) != 4:
            raise ValueError(
                "ENGRAM_WRITEBACK reason codes must be distinct"
            )
        return self

    @model_validator(mode="after")
    def distinct_caller_fact_keys(self) -> WorkerSettings:
        payload = {
            self.caller_fact_payload_history_key,
            self.caller_fact_payload_user_turn_key,
            self.caller_fact_payload_persona_reply_key,
            self.caller_fact_payload_facts_key,
            self.caller_fact_payload_speaker_key,
            self.caller_fact_payload_text_key,
        }
        if len(payload) != 6:
            raise ValueError(
                "CALLER_FACT_PAYLOAD_HISTORY_KEY, "
                "CALLER_FACT_PAYLOAD_USER_TURN_KEY, "
                "CALLER_FACT_PAYLOAD_PERSONA_REPLY_KEY, "
                "CALLER_FACT_PAYLOAD_FACTS_KEY, "
                "CALLER_FACT_PAYLOAD_SPEAKER_KEY, and "
                "CALLER_FACT_PAYLOAD_TEXT_KEY must be distinct"
            )
        reasons = {
            self.caller_fact_reason_empty,
            self.caller_fact_reason_extracted,
            self.caller_fact_reason_timeout,
            self.caller_fact_reason_error,
            self.caller_fact_reason_unrecognised,
        }
        if len(reasons) != 5:
            raise ValueError("CALLER_FACT reason codes must be distinct")
        closing = {
            self.caller_fact_closing_reason_missing,
            self.caller_fact_closing_reason_not_ended,
            self.caller_fact_closing_reason_already,
        }
        if len(closing) != 3:
            raise ValueError("CALLER_FACT_CLOSING reason codes must be distinct")
        if (
            self.caller_fact_stamp_enabled
            and "{date}" not in self.caller_fact_stamp_template
        ):
            raise ValueError(
                "CALLER_FACT_STAMP_TEMPLATE must contain {date} when stamping is on"
            )
        return self

    @model_validator(mode="after")
    def distinct_scope_router_keys(self) -> WorkerSettings:
        payload = {
            self.engram_scope_router_scope_key,
            self.engram_scope_router_reason_key,
            self.engram_scope_router_question_key,
        }
        if len(payload) != 3:
            raise ValueError(
                "ENGRAM_SCOPE_ROUTER_SCOPE_KEY, "
                "ENGRAM_SCOPE_ROUTER_REASON_KEY, and "
                "ENGRAM_SCOPE_ROUTER_QUESTION_KEY must be distinct"
            )
        reasons = {
            self.engram_scope_router_reason_shared,
            self.engram_scope_router_reason_private,
            self.engram_scope_router_reason_both,
            self.engram_scope_router_reason_timeout,
            self.engram_scope_router_reason_error,
            self.engram_scope_router_reason_unrecognised,
            self.engram_scope_router_reason_disabled,
            self.engram_scope_router_reason_unauthenticated,
        }
        if len(reasons) != 8:
            raise ValueError(
                "ENGRAM_SCOPE_ROUTER reason codes must be distinct"
            )
        scopes = {
            self.engram_retrieve_scope_shared,
            self.engram_retrieve_scope_private,
            self.engram_retrieve_scope_both,
        }
        if len(scopes) != 3:
            raise ValueError(
                "ENGRAM_RETRIEVE_SCOPE_SHARED, ENGRAM_RETRIEVE_SCOPE_PRIVATE, "
                "and ENGRAM_RETRIEVE_SCOPE_BOTH must be distinct"
            )
        return self

    @model_validator(mode="after")
    def distinct_persona_voice_keys(self) -> WorkerSettings:
        keys = {
            self.persona_voice_tts_key,
            self.persona_voice_fish_key,
            self.persona_voice_provider_key,
        }
        if len(keys) != 3:
            raise ValueError(
                "PERSONA_VOICE_TTS_KEY, PERSONA_VOICE_FISH_KEY, and "
                "PERSONA_VOICE_PROVIDER_KEY must be distinct"
            )
        if self.persona_voice_provider_aura == self.persona_voice_provider_fish:
            raise ValueError(
                "PERSONA_VOICE_PROVIDER_AURA must differ from "
                "PERSONA_VOICE_PROVIDER_FISH"
            )
        return self

    @model_validator(mode="after")
    def refuse_chat_without_member_session_auth(self) -> WorkerSettings:
        if self.brain_mode == "chat" and not self.engram_member_session_auth:
            raise ValueError(
                "BRAIN_MODE=chat is refused while ENGRAM_MEMBER_SESSION_AUTH is "
                "false: personas.chat writes the authenticated caller's private "
                "pool, and without per-member session auth that caller is the "
                "API key owner (see docs/ENGRAM.md §2.3)."
            )
        return self

    @model_validator(mode="after")
    def require_member_secret_key_when_session_auth(self) -> WorkerSettings:
        from worker.engram.member_secret import (
            MemberSecretError,
            decode_member_secret_key,
        )

        raw = self.engram_member_secret_key
        if raw is not None:
            try:
                decode_member_secret_key(raw)
            except MemberSecretError as exc:
                raise ValueError(str(exc)) from exc
        if self.engram_member_session_auth and raw is None:
            raise ValueError(
                "ENGRAM_MEMBER_SESSION_AUTH is true but ENGRAM_MEMBER_SECRET_KEY "
                "is missing. Set it to 32 random bytes, base64-encoded. "
                "Empty means unset."
            )
        return self


def load_settings() -> WorkerSettings:
    try:
        return WorkerSettings()
    except Exception as exc:
        raise RuntimeError(f"Invalid worker environment: {exc}") from exc
