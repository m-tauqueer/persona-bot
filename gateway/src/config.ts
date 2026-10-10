import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import { z } from "zod";
import { parseAccessStatus } from "./access/parse.js";
import { validateInsightsConfig } from "./insights/parse.js";
import { parseDeletionStatus } from "./lifecycle/parse.js";
import { validateObserveConfig } from "./observe/fields.js";
import { validateOpsConfig, validateStatusCopy } from "./ops/decision.js";

const requiredPort = z.preprocess(
  (val) => (val === undefined || val === "" ? undefined : val),
  z.coerce.number().int().positive(),
);

const optionalUrl = z.preprocess(
  (val) => (val === undefined || val === "" ? undefined : val),
  z.string().url().optional(),
);

const optionalNonEmpty = z.preprocess(
  (val) => (val === undefined || val === "" ? undefined : val),
  z.string().min(1).optional(),
);

const envFileSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]),
  LOG_LEVEL: z.string().min(1),
  GATEWAY_HOST: z.string().min(1),
  GATEWAY_PORT: requiredPort,
  GATEWAY_PUBLIC_URL: z.string().url(),
  FRONTEND_ORIGIN: z.string().url(),
  CORS_ALLOWED_METHODS: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("GET,HEAD,POST,PUT,PATCH,DELETE"),
  ),
  RATE_LIMIT_ENABLED: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.enum(["true", "false"]).default("true"),
  ),
  RATE_LIMIT_MAX: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.coerce.number().int().positive().default(300),
  ),
  RATE_LIMIT_WINDOW_MS: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.coerce.number().int().positive().default(60000),
  ),
  RATE_LIMIT_REDIS_PREFIX: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("ratelimit:"),
  ),
  RATE_LIMIT_USER_KEY_PREFIX: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("user:"),
  ),
  RATE_LIMIT_IP_KEY_PREFIX: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("ip:"),
  ),
  QUOTA_TURNS_PER_DAY: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.coerce.number().int().nonnegative().default(0),
  ),
  QUOTA_VOICE_MINUTES_PER_DAY: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.coerce.number().nonnegative().default(0),
  ),
  QUOTA_TIMEZONE: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("UTC"),
  ),
  QUOTA_WARN_RATIO: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.coerce.number().min(0).max(1).default(0.8),
  ),
  QUOTA_KIND_TURNS: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("turns"),
  ),
  QUOTA_KIND_MINUTES: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("minutes"),
  ),
  QUOTA_CODE_TURNS: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("quota_turns"),
  ),
  QUOTA_CODE_MINUTES: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("quota_minutes"),
  ),
  QUOTA_ERROR_TURNS: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z
      .string()
      .min(1)
      .default("Daily turn limit reached. Try again after reset_at."),
  ),
  QUOTA_ERROR_MINUTES: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z
      .string()
      .min(1)
      .default("Daily voice-minute limit reached. Try again after reset_at."),
  ),
  QUOTA_LOG_REFUSED: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("quota refused"),
  ),
  QUOTA_LOG_WARN: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("quota warn"),
  ),
  QUOTA_ERROR_INVALID: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("invalid_quota_settings"),
  ),
  QUOTA_ERROR_INVALID_TIMEZONE: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("invalid_quota_timezone"),
  ),
  QUOTA_SOURCE_STORED: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("stored"),
  ),
  QUOTA_SOURCE_ENV: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("env"),
  ),
  WORKER_URL: z.string().url(),
  BYO_LLM_PUBLIC_URL: optionalUrl,
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().url(),
  SESSION_SECRET: z.string().min(16),
  INTERNAL_API_SECRET: z.string().min(16),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  GOOGLE_CALLBACK_URL: z.string().url(),
  GOOGLE_OIDC_DISCOVERY_URL: z.string().url(),
  GOOGLE_SCOPES: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("openid email profile"),
  ),
  GOOGLE_AUTH_PROMPT: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("select_account"),
  ),
  GOOGLE_REQUIRE_EMAIL_VERIFIED: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.enum(["true", "false"]).default("true"),
  ),
  GOOGLE_ID_TOKEN_ISSUERS: optionalNonEmpty,
  GOOGLE_PKCE_METHOD: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("S256"),
  ),
  SESSION_COOKIE_NAME: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("vb_session"),
  ),
  SESSION_COOKIE_PATH: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("/"),
  ),
  SESSION_COOKIE_SAMESITE: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.enum(["lax", "strict", "none"]).default("lax"),
  ),
  SESSION_TTL_SECONDS: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.coerce.number().int().positive().default(604800),
  ),
  SESSION_COOKIE_SECURE: z.preprocess((val) => {
    if (val === undefined || val === "") return undefined;
    return val;
  }, z.enum(["true", "false"]).optional()),
  SESSION_REDIS_KEY_PREFIX: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("session:"),
  ),
  CHAT_ACTIVITY_REDIS_KEY_PREFIX: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("chat-activity:"),
  ),
  CHAT_ACTIVITY_TTL_SECONDS: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.coerce.number().int().positive().default(86400),
  ),
  SESSION_ID_BYTES: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.coerce.number().int().positive().default(32),
  ),
  OAUTH_REDIS_KEY_PREFIX: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("oauth:"),
  ),
  OAUTH_PENDING_TTL_SECONDS: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.coerce.number().int().positive().default(600),
  ),
  OAUTH_TOKEN_BYTES: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.coerce.number().int().positive().default(32),
  ),
  OIDC_DISCOVERY_TTL_SECONDS: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.coerce.number().int().positive().default(3600),
  ),
  OIDC_CLOCK_TOLERANCE_SECONDS: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.coerce.number().int().nonnegative().default(60),
  ),
  OIDC_HTTP_TIMEOUT_MS: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.coerce.number().int().positive().default(10000),
  ),
  WORKER_HTTP_TIMEOUT_MS: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.coerce.number().int().positive().default(120000),
  ),
  WORKER_CLOSING_PASS_PATH: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("/internal/closing-pass"),
  ),
  WORKER_CLOSING_PASS_RETRIES: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.coerce.number().int().nonnegative().default(1),
  ),
  LOG_CLOSING_PASS_FAILED: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("closing_pass_failed"),
  ),
  INTERNAL_SECRET_HEADER: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("x-internal-secret"),
  ),
  CORRELATION_ID_HEADER: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("x-correlation-id"),
  ),
  POST_LOGIN_REDIRECT_URL: optionalUrl,
  WAITLIST_PATH: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("/waitlist"),
  ),
  ACCESS_ME_ACTIVE: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("active"),
  ),
  ACCESS_ME_WAITLISTED: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("waitlisted"),
  ),
  ACCESS_ME_DENIED: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("denied"),
  ),
  ACCESS_ME_REVOKED: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("revoked"),
  ),
  ACCESS_ACTION_APPROVE: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("approve"),
  ),
  ACCESS_ACTION_DENY: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("deny"),
  ),
  ACCESS_ACTION_REVOKE: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("revoke"),
  ),
  ACCESS_QUEUE_DEFAULT_STATUS: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("requested"),
  ),
  ACCESS_BATCH_MAX: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.coerce.number().int().positive().default(100),
  ),
  ACCESS_ERROR_UNAUTHORIZED: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("unauthorized"),
  ),
  ACCESS_ERROR_FORBIDDEN: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("forbidden"),
  ),
  ACCESS_ERROR_INVALID_BATCH: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("invalid_access_batch"),
  ),
  ACCESS_ERROR_OWNER_PROTECTED: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("owner_access_protected"),
  ),
  ACCESS_ERROR_SELF: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("cannot_change_own_access"),
  ),
  ACCESS_ERROR_INVALID_STATUS: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("invalid_access_status"),
  ),
  ACCESS_ME_CONSENT: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("consent"),
  ),
  CONSENT_PATH: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("/consent"),
  ),
  PRIVACY_PATH: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("/privacy"),
  ),
  TERMS_PATH: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("/terms"),
  ),
  DATA_PATH: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("/dashboard/data"),
  ),
  ADMIN_DELETIONS_PATH: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("/admin/deletions"),
  ),
  CONSENT_PRIVACY_VERSION: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("1"),
  ),
  CONSENT_TERMS_VERSION: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("1"),
  ),
  LIFECYCLE_DELETE_CONFIRMATION: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("DELETE MY DATA"),
  ),
  LIFECYCLE_ACTION_REQUEST: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("request"),
  ),
  LIFECYCLE_ACTION_COMPLETE: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("complete"),
  ),
  LIFECYCLE_ACTION_CANCEL: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("cancel"),
  ),
  LIFECYCLE_QUEUE_DEFAULT_STATUS: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("pending"),
  ),
  LIFECYCLE_BATCH_MAX: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.coerce.number().int().positive().default(100),
  ),
  RETENTION_SESSION_DAYS: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.coerce.number().int().nonnegative().default(365),
  ),
  RETENTION_SWEEP_SECONDS: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.coerce.number().int().nonnegative().default(0),
  ),
  LIFECYCLE_EXPORT_FILENAME: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("voice-bot-export.json"),
  ),
  LIFECYCLE_ERROR_CONFIRMATION: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("confirmation_mismatch"),
  ),
  LIFECYCLE_ERROR_INVALID_ACTION: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("invalid_deletion_action"),
  ),
  LIFECYCLE_ERROR_INVALID_STATUS: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("invalid_deletion_status"),
  ),
  LIFECYCLE_ERROR_INVALID_TRANSITION: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("invalid_deletion_transition"),
  ),
  LIFECYCLE_ERROR_PURGE_INCOMPLETE: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z
      .string()
      .min(1)
      .default(
        "Your memories could not be erased yet, so nothing was deleted. Please try again.",
      ),
  ),
  LIFECYCLE_ERROR_VERSION: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("consent_version_mismatch"),
  ),
  LIFECYCLE_ERROR_ACCEPTED: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("consent_not_accepted"),
  ),
  LIFECYCLE_ERROR_OWNER_PROTECTED: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("owner_delete_protected"),
  ),
  LIFECYCLE_ERROR_UNKNOWN: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("unknown_deletion_request"),
  ),
  OPS_SERVICE_GATEWAY: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("gateway"),
  ),
  OPS_SERVICE_WORKER: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("worker"),
  ),
  OPS_RECORD_CODES: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z
      .string()
      .min(1)
      .default(
        "engram_unavailable,deepgram_unavailable,think_failed,database_unavailable,speaking_llm_failed,record_lost,fish_unavailable,fish_key_missing,fish_voice_missing,fish_unauthorized,fish_payment",
      ),
  ),
  OPS_FORCE_CODE: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("ops_forced"),
  ),
  OPS_FORCE_MESSAGE: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("Forced dependency failure for the watch probe."),
  ),
  OPS_LIST_LIMIT: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.coerce.number().int().positive().default(20),
  ),
  OPS_HEALTH_OK: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("ok"),
  ),
  OPS_HEALTH_FAIL: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("fail"),
  ),
  OPS_HEALTH_POSTGRES: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("postgres"),
  ),
  OPS_HEALTH_REDIS: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("redis"),
  ),
  OPS_HEALTH_WORKER: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("worker"),
  ),
  OPS_HEALTH_TIMEOUT_MS: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.coerce.number().int().positive().default(2000),
  ),
  OPS_LOG_EVENT: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("ops event"),
  ),
  STATUS_PATH: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("/status"),
  ),
  STATUS_API_PATH: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("/api/status"),
  ),
  STATUS_OVERALL_OK: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("operational"),
  ),
  STATUS_OVERALL_FAIL: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("disrupted"),
  ),
  STATUS_OVERALL_OK_LABEL: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("All systems operational"),
  ),
  STATUS_OVERALL_FAIL_LABEL: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("Some systems are disrupted"),
  ),
  STATUS_COMPONENT_OK: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("Operational"),
  ),
  STATUS_COMPONENT_FAIL: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("Disrupted"),
  ),
  STATUS_COMPONENT_LABELS: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z
      .string()
      .min(1)
      .default("postgres|Conversation record;redis|Live calls;worker|Persona"),
  ),
  OWNER_EMAILS: z.preprocess(
    (val) => (val === undefined ? "" : val),
    z.string(),
  ),
  ADMIN_INGEST_MAX_BYTES: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.coerce.number().int().positive().default(8388608),
  ),
  ADMIN_FISH_CLONE_MAX_BYTES: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.coerce.number().int().positive().default(10485760),
  ),
  INSIGHTS_PAGE_SIZE: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.coerce.number().int().positive().default(50),
  ),
  INSIGHTS_MAX_PAGE_SIZE: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.coerce.number().int().positive().default(200),
  ),
  INSIGHTS_RANGES: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("today,7d,30d"),
  ),
  INSIGHTS_DEFAULT_RANGE: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("7d"),
  ),
  INSIGHTS_RANGE_WINDOWS: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("today:calendar,7d:7,30d:30"),
  ),
  INSIGHTS_CALENDAR_WINDOW_SPEC: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("calendar"),
  ),
  INSIGHTS_TIMEZONE: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("UTC"),
  ),
  INSIGHTS_ACTIVITY_BUCKETS: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("hour,day"),
  ),
  INSIGHTS_DEFAULT_BUCKET: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("day"),
  ),
  INSIGHTS_ERROR_REASONS: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("server_error,retryable_read,brain_error"),
  ),
  INSIGHTS_BRAIN_MODE_UNRECORDED: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("unrecorded"),
  ),
  INSIGHTS_BRAIN_MODE_MIXED: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("mixed"),
  ),
  INSIGHTS_FIRST_WORD_COLUMNS: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("brain_ms,reframe_first_token_ms"),
  ),
  INSIGHTS_FIRST_WORD_REQUIRED_COLUMN: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("reframe_first_token_ms"),
  ),
  INSIGHTS_LATENCY_STAGES: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z
      .string()
      .min(1)
      .default("stt_ms,brain_ms,reframe_first_token_ms,tts_first_byte_ms"),
  ),
  LATENCY_BUDGET_FIRST_WORD_MS: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.coerce.number().int().positive().default(4000),
  ),
  LATENCY_BUDGET_P90_MS: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.coerce.number().int().positive().default(8000),
  ),
  LATENCY_BUDGET_WINDOW_HOURS: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.coerce.number().int().positive().default(24),
  ),
  LATENCY_BUDGET_BY_BRAIN_MODE: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z
      .string()
      .min(1)
      .default(
        '{"retrieve":{"p50":4000,"p90":8000},"chat":{"p50":20000,"p90":30000}}',
      ),
  ),
  LOG_TURN_FIELDS: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z
      .string()
      .min(1)
      .default(
        "correlation_id,session_id,turn_ids,action,reasons,brain_ms,reframe_ms,reframe_first_token_ms,brain_mode,recorded,retrieve_hits,retrieve_hits_grounded,retrieve_hits_dropped,retrieve_hits_shared,retrieve_hits_shared_grounded,retrieve_hits_shared_dropped,retrieve_hits_private,retrieve_hits_private_grounded,retrieve_hits_private_dropped,member_authenticated,engram_credential,retrieve_scope,retrieve_scope_reason",
      ),
  ),
  LOG_TURN_EVENT: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("turn"),
  ),
  VOICE_NOTICE_KIND_TRACE: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("trace"),
  ),
  VOICE_NOTICE_TRACE_CODE: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("turn_traced"),
  ),
  VOICE_NOTICE_TRACE_MESSAGE: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("Turn recorded."),
  ),
  INSIGHTS_ERROR_INVALID_RANGE: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("invalid range"),
  ),
  INSIGHTS_ERROR_INVALID_CURSOR: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("invalid cursor"),
  ),
  INSIGHTS_ERROR_INVALID_BUCKET: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("invalid bucket"),
  ),
  INSIGHTS_ERROR_INVALID_CHANNEL: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("invalid channel"),
  ),
  INSIGHTS_ERROR_INVALID_USER: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("invalid user_id"),
  ),
  INSIGHTS_ERROR_INVALID_LIMIT: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("invalid limit"),
  ),
  INSIGHTS_ERROR_NOT_FOUND: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("session not found"),
  ),
  PERSONA_ID_QUERY: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("persona_id"),
  ),
  PERSONA_VOICE_TTS_KEY: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("tts_voice"),
  ),
  PERSONA_VOICE_FISH_KEY: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("fish_voice"),
  ),
  PERSONA_VOICE_PROVIDER_KEY: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("voice_provider"),
  ),
  PERSONA_VOICE_PROVIDER_AURA: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("aura"),
  ),
  PERSONA_VOICE_PROVIDER_FISH: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("fish"),
  ),
  FISH_API_KEY: optionalNonEmpty,
  FISH_API_BASE_URL: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().url().default("https://api.fish.audio"),
  ),
  FISH_TTS_MODEL: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("s2.1-pro-free"),
  ),
  FISH_TTS_FORMAT: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("pcm"),
  ),
  FISH_TTS_SAMPLE_RATE: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.coerce.number().int().positive().default(24000),
  ),
  FISH_TTS_LATENCY: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("balanced"),
  ),
  FISH_TTS_LIVE_PATH: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("/v1/tts/live"),
  ),
  FISH_TTS_TIMEOUT_MS: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.coerce.number().int().positive().default(60000),
  ),
  FISH_AUTH_HEADER: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("Authorization"),
  ),
  FISH_AUTH_SCHEME: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("Bearer"),
  ),
  FISH_MODEL_HEADER: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("model"),
  ),
  FISH_WS_EVENT_START: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("start"),
  ),
  FISH_WS_EVENT_TEXT: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("text"),
  ),
  FISH_WS_EVENT_FLUSH: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("flush"),
  ),
  FISH_WS_EVENT_STOP: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("stop"),
  ),
  FISH_WS_EVENT_AUDIO: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("audio"),
  ),
  FISH_WS_EVENT_FINISH: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("finish"),
  ),
  FISH_WS_FINISH_REASON_ERROR: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("error"),
  ),
  FISH_PROBE_TEXT: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("Hello from the live voice check."),
  ),
  FISH_PROBE_REFERENCE_ID: optionalNonEmpty,
  DEEPGRAM_LISTEN_WSS_URL: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().url().default("wss://api.deepgram.com/v1/listen"),
  ),
  DEEPGRAM_AUDIO_INPUT_CHANNELS: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.coerce.number().int().positive().default(1),
  ),
  // Silence Listen VAD needs before speech_final. UtteranceEnd below is the
  // fallback that carries an echoey room, so this can stay short.
  DEEPGRAM_LISTEN_ENDPOINTING_MS: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.coerce.number().int().positive().default(600),
  ),
  // How long the user must keep producing words, while the persona is still
  // speaking, before the persona stops. Not a VAD click and not the first
  // word: sustained speech. Thinking still waits for the utterance to end.
  VOICE_BARGE_IN_HOLD_MS: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.coerce.number().int().positive().default(500),
  ),
  DEEPGRAM_LISTEN_UTTERANCE_END_MS: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.coerce.number().int().positive().default(1000),
  ),
  DEEPGRAM_LISTEN_INTERIM_RESULTS: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.enum(["true", "false"]).default("true"),
  ),
  DEEPGRAM_LISTEN_VAD_EVENTS: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.enum(["true", "false"]).default("true"),
  ),
  DEEPGRAM_LISTEN_PUNCTUATE: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.enum(["true", "false"]).default("true"),
  ),
  DEEPGRAM_LISTEN_SMART_FORMAT: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.enum(["true", "false"]).default("true"),
  ),
  DEEPGRAM_LISTEN_MSG_RESULTS: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("Results"),
  ),
  DEEPGRAM_LISTEN_MSG_SPEECH_STARTED: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("SpeechStarted"),
  ),
  DEEPGRAM_LISTEN_MSG_UTTERANCE_END: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("UtteranceEnd"),
  ),
  MEMORY_PANEL_ENABLED: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.enum(["true", "false"]).default("true"),
  ),
  MEMORY_PANEL_DISABLED: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("memory panel is off"),
  ),
  MEMORY_PANEL_NO_PERSONA: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("session not found"),
  ),
  MEMORY_REF_POOL_KEY: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("pool"),
  ),
  MEMORY_REF_POOL_PERSONA: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("persona"),
  ),
  MEMORY_REF_POOL_CALLER: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("caller"),
  ),
  ENGRAM_PERSONA_ID: optionalNonEmpty,
  AZURE_STORAGE_ACCOUNT: optionalNonEmpty,
  AZURE_STORAGE_KEY: optionalNonEmpty,
  AZURE_BLOB_CONTAINER: optionalNonEmpty,
  AZURE_BLOB_ENDPOINT: optionalUrl,
  DEEPGRAM_API_KEY: optionalNonEmpty,
  DEEPGRAM_API_BASE_URL: optionalUrl,
  DEEPGRAM_STT_MODEL: optionalNonEmpty,
  DEEPGRAM_STT_LANGUAGE: optionalNonEmpty,
  DEEPGRAM_TTS_VOICE: optionalNonEmpty,
  DEEPGRAM_AGENT_WSS_URL: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().url().default("wss://agent.deepgram.com/v1/agent/converse"),
  ),
  DEEPGRAM_AGENT_AUTH_HEADER: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("Authorization"),
  ),
  DEEPGRAM_AGENT_AUTH_SCHEME: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("Token"),
  ),
  DEEPGRAM_AUDIO_INPUT_ENCODING: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("linear16"),
  ),
  DEEPGRAM_AUDIO_INPUT_SAMPLE_RATE: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.coerce.number().int().positive().default(16000),
  ),
  DEEPGRAM_AUDIO_OUTPUT_ENCODING: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("linear16"),
  ),
  DEEPGRAM_AUDIO_OUTPUT_SAMPLE_RATE: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.coerce.number().int().positive().default(24000),
  ),
  DEEPGRAM_AUDIO_OUTPUT_CONTAINER: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("none"),
  ),
  DEEPGRAM_LISTEN_PROVIDER_TYPE: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("deepgram"),
  ),
  DEEPGRAM_LISTEN_PROVIDER_VERSION: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("v1"),
  ),
  DEEPGRAM_THINK_PROVIDER_TYPE: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("open_ai"),
  ),
  DEEPGRAM_THINK_MODEL: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("gpt-4o-mini"),
  ),
  DEEPGRAM_THINK_PROMPT: optionalNonEmpty,
  DEEPGRAM_SPEAK_PROVIDER_TYPE: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("deepgram"),
  ),
  DEEPGRAM_SPEAK_PROVIDER_VERSION: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("v1"),
  ),
  DEEPGRAM_AGENT_GREETING: optionalNonEmpty,
  DEEPGRAM_MSG_WELCOME: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("Welcome"),
  ),
  DEEPGRAM_MSG_SETTINGS: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("Settings"),
  ),
  DEEPGRAM_MSG_SETTINGS_APPLIED: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("SettingsApplied"),
  ),
  DEEPGRAM_MSG_ERROR: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("Error"),
  ),
  DEEPGRAM_MSG_WARNING: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("Warning"),
  ),
  DEEPGRAM_MSG_INJECT_USER: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("InjectUserMessage"),
  ),
  DEEPGRAM_MSG_CONVERSATION_TEXT: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("ConversationText"),
  ),
  VOICE_TRANSCRIPT_USER_ROLE: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("user"),
  ),
  VOICE_TRANSCRIPT_ASSISTANT_ROLE: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("assistant"),
  ),
  DEEPGRAM_MSG_USER_STARTED: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("UserStartedSpeaking"),
  ),
  DEEPGRAM_MSG_AGENT_THINKING: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("AgentThinking"),
  ),
  DEEPGRAM_MSG_AGENT_AUDIO_DONE: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("AgentAudioDone"),
  ),
  DEEPGRAM_MSG_LATENCY_REPORT: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("LatencyReport"),
  ),
  DEEPGRAM_LATENCY_STT_FIELD: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("stt_latency"),
  ),
  DEEPGRAM_LATENCY_TTS_FIELD: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("tts_latency"),
  ),
  VOICE_LATENCY_TO_MS: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.coerce.number().positive().default(1000),
  ),
  DEEPGRAM_MSG_KEEP_ALIVE: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("KeepAlive"),
  ),
  DEEPGRAM_KEEP_ALIVE_INTERVAL_MS: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.coerce.number().int().positive().default(8000),
  ),
  DEEPGRAM_AGENT_HANDSHAKE_TIMEOUT_MS: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.coerce.number().int().positive().default(20000),
  ),
  DEEPGRAM_RECONNECT_ATTEMPTS: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.coerce.number().int().nonnegative().default(1),
  ),
  DEEPGRAM_RECONNECT_BACKOFF_MS: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.coerce.number().int().nonnegative().default(750),
  ),
  DEEPGRAM_RECONNECT_ON_CODES: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z
      .string()
      .min(1)
      .default(
        "INTERNAL_SERVER_ERROR,CLIENT_MESSAGE_TIMEOUT,FAILED_TO_START_LISTENING,ASR_CONNECTION_CLOSED,ASR_DRIVER_TIMEOUT,SERVER_GOING_AWAY",
      ),
  ),
  DEEPGRAM_THINK_FATAL_CODES: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("FAILED_TO_THINK"),
  ),
  REDIS_COMMAND_TIMEOUT_MS: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.coerce.number().int().positive().default(500),
  ),
  VOICE_NOTICE_REDIS_CHANNEL: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("voice-notice"),
  ),
  FAILURE_CODE_ENGRAM: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("engram_unavailable"),
  ),
  FAILURE_CODE_SPEAKING_LLM: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("speaking_llm_failed"),
  ),
  FAILURE_CODE_RECORD: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("record_lost"),
  ),
  FAILURE_CODE_DEEPGRAM: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("deepgram_unavailable"),
  ),
  FAILURE_CODE_BLOB: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("audio_not_stored"),
  ),
  FAILURE_CODE_REDIS: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("call_state_degraded"),
  ),
  FAILURE_CODE_RECONNECTING: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("voice_reconnecting"),
  ),
  FAILURE_CODE_RECONNECTED: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("voice_reconnected"),
  ),
  FAILURE_CODE_DATABASE: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("database_unavailable"),
  ),
  FAILURE_CODE_THINK: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("think_failed"),
  ),
  FAILURE_CODE_FISH: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("fish_unavailable"),
  ),
  FAILURE_CODE_FISH_KEY_MISSING: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("fish_key_missing"),
  ),
  FAILURE_CODE_FISH_VOICE_MISSING: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("fish_voice_missing"),
  ),
  FAILURE_CODE_FISH_UNAUTHORIZED: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("fish_unauthorized"),
  ),
  FAILURE_CODE_FISH_PAYMENT: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("fish_payment"),
  ),
  FAILURE_CODE_VOICE_PROVIDER: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("voice_provider"),
  ),
  FAILURE_MESSAGE_ENGRAM: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z
      .string()
      .min(1)
      .default(
        "The persona's memory is unavailable. Nothing was invented in its place.",
      ),
  ),
  FAILURE_MESSAGE_SPEAKING_LLM: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z
      .string()
      .min(1)
      .default(
        "The reply stopped early. You heard only the words that were produced.",
      ),
  ),
  FAILURE_MESSAGE_RECORD: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z
      .string()
      .min(1)
      .default(
        "The reply was delivered but the conversation record could not be saved.",
      ),
  ),
  FAILURE_MESSAGE_DEEPGRAM: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("The voice connection could not be restored."),
  ),
  FAILURE_MESSAGE_BLOB: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z
      .string()
      .min(1)
      .default("Call audio is not being stored. The conversation continues."),
  ),
  FAILURE_MESSAGE_REDIS: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z
      .string()
      .min(1)
      .default(
        "Call state is running without the cache. The conversation continues.",
      ),
  ),
  FAILURE_MESSAGE_RECONNECTING: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("The voice connection dropped. Reconnecting…"),
  ),
  FAILURE_MESSAGE_RECONNECTED: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("Voice connection restored."),
  ),
  FAILURE_MESSAGE_DATABASE: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z
      .string()
      .min(1)
      .default(
        "The conversation record is unavailable. This turn could not start.",
      ),
  ),
  FAILURE_MESSAGE_THINK: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z
      .string()
      .min(1)
      .default("The persona could not answer. The call has ended."),
  ),
  FAILURE_MESSAGE_FISH: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z
      .string()
      .min(1)
      .default("The cloned voice could not speak. The call has ended."),
  ),
  FAILURE_MESSAGE_FISH_KEY_MISSING: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("Fish API key is not set"),
  ),
  FAILURE_MESSAGE_FISH_VOICE_MISSING: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z
      .string()
      .min(1)
      .default("This persona is set to Fish Audio but has no Fish voice id."),
  ),
  FAILURE_MESSAGE_FISH_UNAUTHORIZED: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("Fish rejected the API key"),
  ),
  FAILURE_MESSAGE_FISH_PAYMENT: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("Fish has no remaining API credits"),
  ),
  FAILURE_MESSAGE_VOICE_PROVIDER: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("voice provider is not a configured choice"),
  ),
  FAILURE_MESSAGE_UNKNOWN: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("Something went wrong."),
  ),
  FAILURE_FATAL_CODES: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z
      .string()
      .min(1)
      .default(
        "engram_unavailable,deepgram_unavailable,think_failed,database_unavailable,fish_unavailable,fish_key_missing,fish_voice_missing,fish_unauthorized,fish_payment,voice_provider",
      ),
  ),
  BYO_LLM_CHAT_COMPLETIONS_PATH: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("/v1/chat/completions"),
  ),
  BYO_LLM_APP_USER_HEADER: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("x-app-user-id"),
  ),
  BYO_LLM_ENGRAM_USER_HEADER: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("x-engram-user-id"),
  ),
  BYO_LLM_PERSONA_HEADER: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("x-persona-id"),
  ),
  BYO_LLM_SESSION_HEADER: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("x-session-id"),
  ),
  BYO_LLM_USER_ROLE: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("user"),
  ),
  BYO_LLM_SSE_DONE: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("[DONE]"),
  ),
  BYO_LLM_SSE_DATA_PREFIX: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("data:"),
  ),
  BYO_LLM_ENDPOINT_EXTRA_HEADERS: z.preprocess((val) => {
    if (val === undefined || val === "") {
      return undefined;
    }
    if (typeof val !== "string") {
      return val;
    }
    try {
      return JSON.parse(val) as unknown;
    } catch {
      return val;
    }
  }, z.record(z.string().min(1), z.string()).optional()),
  VOICE_WS_PATH: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("/ws/voice"),
  ),
  VOICE_REDIS_KEY_PREFIX: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("voice-call:"),
  ),
  VOICE_REDIS_TTL_SECONDS: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.coerce.number().int().positive().default(3600),
  ),
  VOICE_PENDING_LATENCY_MAX: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.coerce.number().int().positive().default(8),
  ),
  VOICE_AUDIO_PERSIST_ENABLED: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.enum(["true", "false"]).default("true"),
  ),
  VOICE_AUDIO_FORMAT: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("wav"),
  ),
  VOICE_AUDIO_CONTENT_TYPE: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("audio/wav"),
  ),
  VOICE_AUDIO_BITS_PER_SAMPLE: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.coerce.number().int().positive().default(16),
  ),
  VOICE_AUDIO_MAX_BYTES: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.coerce.number().int().positive().default(16777216),
  ),
  AZURE_BLOB_KEY_PREFIX: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("voice/"),
  ),
  VOICE_CLIENT_READY_TYPE: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("voice.ready"),
  ),
  VOICE_CLIENT_ERROR_TYPE: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("voice.error"),
  ),
  // No preprocess: undefined takes the default, an explicit empty value means
  // suppress nothing.
  VOICE_SUPPRESSED_WARNING_CODES: z.string().default("SLOW_THINK_REQUEST"),
  VOICE_CLIENT_WARNING_TYPE: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("voice.warning"),
  ),
  VOICE_CLIENT_AGENT_EVENT_TYPE: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("voice.agent"),
  ),
  DEEPGRAM_SPEAK_PATH: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("/v1/speak"),
  ),
  VOICE_CALL_PROBE_FIRST_TEXT: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.string().min(1).default("Hello. What are you working on at the moment?"),
  ),
  VOICE_CALL_PROBE_INTERRUPT_TEXT: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z
      .string()
      .min(1)
      .default("Sorry to cut in. Could you tell me that again more briefly?"),
  ),
  VOICE_CALL_PROBE_INTERRUPT_DELAY_MS: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.coerce.number().int().positive().default(1500),
  ),
  VOICE_CALL_PROBE_SILENCE_WINDOW_MS: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.coerce.number().int().positive().default(1500),
  ),
  VOICE_CALL_PROBE_RESUME_BYTES: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.coerce.number().int().positive().default(16000),
  ),
  VOICE_PROBE_FRAME_MS: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.coerce.number().int().positive().default(20),
  ),
  VOICE_PROBE_SETTLE_MS: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.coerce.number().int().positive().default(5000),
  ),
  VOICE_INJECT_TIMEOUT_MS: z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    z.coerce.number().int().positive().default(180000),
  ),
  VOICE_INJECT_TEXT: optionalNonEmpty,
});

export type GatewayConfig = z.infer<typeof envFileSchema>;

export function repoRootFromHere(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, "../..");
}

function loadEnvFile(): void {
  const explicit = process.env.ENV_FILE;
  const candidates = [
    ...(explicit ? [explicit] : []),
    resolve(process.cwd(), ".env"),
    resolve(repoRootFromHere(), ".env"),
  ];
  for (const path of candidates) {
    if (existsSync(path)) {
      loadDotenv({ path, override: false });
      return;
    }
  }
}

export function loadGatewayConfig(
  raw: NodeJS.ProcessEnv = process.env,
): GatewayConfig {
  loadEnvFile();
  const parsed = envFileSchema.safeParse(raw);
  if (!parsed.success) {
    const msg = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid gateway environment: ${msg}`);
  }
  const callback = new URL(parsed.data.GOOGLE_CALLBACK_URL);
  const publicUrl = new URL(parsed.data.GATEWAY_PUBLIC_URL);
  if (callback.origin !== publicUrl.origin) {
    throw new Error(
      "Invalid gateway environment: GOOGLE_CALLBACK_URL origin must match GATEWAY_PUBLIC_URL",
    );
  }
  if (
    parsed.data.SESSION_COOKIE_SAMESITE === "none" &&
    !sessionCookieSecure(parsed.data)
  ) {
    throw new Error(
      "Invalid gateway environment: SESSION_COOKIE_SAMESITE=none requires a secure cookie",
    );
  }
  try {
    validateInsightsConfig(parsed.data);
    validateObserveConfig(parsed.data);
    validateAccessConfig(parsed.data);
    validateQuotaConfig(parsed.data);
    validateLifecycleConfig(parsed.data);
    validateOpsConfig(parsed.data);
    validateStatusCopy(parsed.data);
    validateStatusApiPath(parsed.data);
    validatePersonaVoiceKeys(parsed.data);
    if (
      parsed.data.MEMORY_REF_POOL_PERSONA === parsed.data.MEMORY_REF_POOL_CALLER
    ) {
      throw new Error(
        "MEMORY_REF_POOL_PERSONA must differ from MEMORY_REF_POOL_CALLER",
      );
    }
    if (
      !parsed.data.WORKER_CLOSING_PASS_PATH.startsWith("/") ||
      parsed.data.WORKER_CLOSING_PASS_PATH.startsWith("//")
    ) {
      throw new Error("WORKER_CLOSING_PASS_PATH must start with /");
    }
  } catch (error) {
    throw new Error(
      error instanceof Error ? error.message : "Invalid insights environment",
    );
  }
  return parsed.data;
}

export function validatePersonaVoiceKeys(config: GatewayConfig): void {
  if (config.PERSONA_VOICE_FISH_KEY === config.PERSONA_VOICE_TTS_KEY) {
    throw new Error(
      "PERSONA_VOICE_FISH_KEY must differ from PERSONA_VOICE_TTS_KEY",
    );
  }
  const keys = [
    config.PERSONA_VOICE_TTS_KEY,
    config.PERSONA_VOICE_FISH_KEY,
    config.PERSONA_VOICE_PROVIDER_KEY,
  ];
  if (new Set(keys).size !== keys.length) {
    throw new Error(
      "PERSONA_VOICE_TTS_KEY, PERSONA_VOICE_FISH_KEY, and PERSONA_VOICE_PROVIDER_KEY must be distinct",
    );
  }
  if (
    config.PERSONA_VOICE_PROVIDER_AURA === config.PERSONA_VOICE_PROVIDER_FISH
  ) {
    throw new Error(
      "PERSONA_VOICE_PROVIDER_AURA must differ from PERSONA_VOICE_PROVIDER_FISH",
    );
  }
}

export function validateAccessConfig(config: GatewayConfig): void {
  const path = frontendPathRedirect(config, config.WAITLIST_PATH);
  if (!path || path !== config.WAITLIST_PATH) {
    throw new Error(
      "WAITLIST_PATH must be a same-origin absolute path with no query",
    );
  }
  const labels = [
    config.ACCESS_ME_ACTIVE,
    config.ACCESS_ME_WAITLISTED,
    config.ACCESS_ME_DENIED,
    config.ACCESS_ME_REVOKED,
    config.ACCESS_ME_CONSENT,
  ];
  if (new Set(labels).size !== labels.length) {
    throw new Error("access /api/me labels must be unique");
  }
  const actions = [
    config.ACCESS_ACTION_APPROVE,
    config.ACCESS_ACTION_DENY,
    config.ACCESS_ACTION_REVOKE,
  ];
  if (new Set(actions).size !== actions.length) {
    throw new Error("access batch actions must be unique");
  }
  if (!parseAccessStatus(config.ACCESS_QUEUE_DEFAULT_STATUS)) {
    throw new Error(
      "ACCESS_QUEUE_DEFAULT_STATUS must be a known access status",
    );
  }
}

export function waitlistRedirectUrl(config: GatewayConfig): string {
  return new URL(config.WAITLIST_PATH, config.FRONTEND_ORIGIN).toString();
}

export function consentRedirectUrl(config: GatewayConfig): string {
  return new URL(config.CONSENT_PATH, config.FRONTEND_ORIGIN).toString();
}

export function validateLifecycleConfig(config: GatewayConfig): void {
  const paths = [
    config.CONSENT_PATH,
    config.PRIVACY_PATH,
    config.TERMS_PATH,
    config.DATA_PATH,
    config.ADMIN_DELETIONS_PATH,
    config.WAITLIST_PATH,
    config.STATUS_PATH,
  ];
  if (new Set(paths).size !== paths.length) {
    throw new Error("lifecycle and waitlist paths must be unique");
  }
  for (const path of paths) {
    const redirected = frontendPathRedirect(config, path);
    if (!redirected || redirected !== path) {
      throw new Error(
        "lifecycle paths must be same-origin absolute paths with no query",
      );
    }
  }
  const actions = [
    config.LIFECYCLE_ACTION_REQUEST,
    config.LIFECYCLE_ACTION_COMPLETE,
    config.LIFECYCLE_ACTION_CANCEL,
  ];
  if (new Set(actions).size !== actions.length) {
    throw new Error("lifecycle deletion actions must be unique");
  }
  if (!parseDeletionStatus(config.LIFECYCLE_QUEUE_DEFAULT_STATUS)) {
    throw new Error(
      "LIFECYCLE_QUEUE_DEFAULT_STATUS must be a known deletion status",
    );
  }
}

export function validateStatusApiPath(config: GatewayConfig): void {
  const redirected = frontendPathRedirect(config, config.STATUS_API_PATH);
  if (!redirected || redirected !== config.STATUS_API_PATH) {
    throw new Error(
      "STATUS_API_PATH must be a same-origin absolute path with no query",
    );
  }
  if (
    !config.STATUS_API_PATH.startsWith("/api/") ||
    config.STATUS_API_PATH.startsWith("/api/admin")
  ) {
    throw new Error("STATUS_API_PATH must be a public /api path");
  }
}

export function validateQuotaConfig(config: GatewayConfig): void {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: config.QUOTA_TIMEZONE });
  } catch {
    throw new Error("QUOTA_TIMEZONE must be a valid IANA timezone");
  }
  if (config.QUOTA_KIND_TURNS === config.QUOTA_KIND_MINUTES) {
    throw new Error("quota kind tokens must be unique");
  }
  if (config.QUOTA_CODE_TURNS === config.QUOTA_CODE_MINUTES) {
    throw new Error("quota codes must be unique");
  }
}

export function sessionCookieSecure(config: GatewayConfig): boolean {
  if (config.SESSION_COOKIE_SECURE === "true") {
    return true;
  }
  if (config.SESSION_COOKIE_SECURE === "false") {
    return false;
  }
  return config.NODE_ENV === "production";
}

export function googleCallbackPath(config: GatewayConfig): string {
  return new URL(config.GOOGLE_CALLBACK_URL).pathname;
}

export function postLoginRedirectUrl(config: GatewayConfig): string {
  return config.POST_LOGIN_REDIRECT_URL ?? config.FRONTEND_ORIGIN;
}

export function frontendPathRedirect(
  config: GatewayConfig,
  raw: string | undefined,
): string | undefined {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) {
    return undefined;
  }
  const resolved = new URL(raw, config.FRONTEND_ORIGIN);
  if (resolved.origin !== new URL(config.FRONTEND_ORIGIN).origin) {
    return undefined;
  }
  return `${resolved.pathname}${resolved.search}`;
}

export function googleIdTokenIssuers(
  config: GatewayConfig,
  discoveryIssuer: string,
): string[] {
  if (config.GOOGLE_ID_TOKEN_ISSUERS) {
    const issuers = config.GOOGLE_ID_TOKEN_ISSUERS.split(/\s+/).filter(
      (value) => value.length > 0,
    );
    if (issuers.length > 0) {
      return issuers;
    }
  }
  return [discoveryIssuer];
}

export function corsAllowedMethods(config: GatewayConfig): string[] {
  return config.CORS_ALLOWED_METHODS.split(/[,\s]+/)
    .map((value) => value.trim().toUpperCase())
    .filter((value) => value.length > 0);
}

export function rateLimitEnabled(config: GatewayConfig): boolean {
  return config.RATE_LIMIT_ENABLED === "true";
}

export function ownerEmails(config: GatewayConfig): Set<string> {
  return new Set(
    config.OWNER_EMAILS.split(/[,\s]+/)
      .map((value) => value.trim().toLowerCase())
      .filter((value) => value.length > 0),
  );
}

export function isOwnerEmail(email: string, config: GatewayConfig): boolean {
  return ownerEmails(config).has(email.trim().toLowerCase());
}

export function voiceSocketReady(config: GatewayConfig): string | null {
  if (!config.DEEPGRAM_API_KEY) {
    return "DEEPGRAM_API_KEY is not set";
  }
  if (!config.DEEPGRAM_STT_MODEL) {
    return "DEEPGRAM_STT_MODEL is not set";
  }
  if (!config.DEEPGRAM_STT_LANGUAGE) {
    return "DEEPGRAM_STT_LANGUAGE is not set";
  }
  if (!config.VOICE_WS_PATH.startsWith("/")) {
    return "VOICE_WS_PATH must start with /";
  }
  if (!config.BYO_LLM_CHAT_COMPLETIONS_PATH.startsWith("/")) {
    return "BYO_LLM_CHAT_COMPLETIONS_PATH must start with /";
  }
  if (!config.FISH_TTS_LIVE_PATH.startsWith("/")) {
    return "FISH_TTS_LIVE_PATH must start with /";
  }
  return null;
}

export function voiceCallReady(config: GatewayConfig): string | null {
  const shared = voiceSocketReady(config);
  if (shared) {
    return shared;
  }
  if (!config.BYO_LLM_PUBLIC_URL) {
    return "BYO_LLM_PUBLIC_URL is not set";
  }
  if (!config.DEEPGRAM_TTS_VOICE) {
    return "DEEPGRAM_TTS_VOICE is not set";
  }
  return null;
}

export function voiceFishReady(config: GatewayConfig): string | null {
  const shared = voiceSocketReady(config);
  if (shared) {
    return shared;
  }
  if (!config.FISH_API_KEY) {
    return config.FAILURE_MESSAGE_FISH_KEY_MISSING;
  }
  return null;
}

export function thinkEndpointUrl(config: GatewayConfig): string {
  const base = config.BYO_LLM_PUBLIC_URL;
  if (!base) {
    throw new Error("BYO_LLM_PUBLIC_URL is not set");
  }
  return new URL(config.BYO_LLM_CHAT_COMPLETIONS_PATH, `${base}/`).toString();
}

export function internalThinkUrl(config: GatewayConfig): string {
  return new URL(
    config.BYO_LLM_CHAT_COMPLETIONS_PATH,
    `${config.WORKER_URL.replace(/\/$/, "")}/`,
  ).toString();
}

export function fishLiveUrl(config: GatewayConfig): string {
  const http = new URL(config.FISH_API_BASE_URL);
  const protocol = http.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${http.host}${config.FISH_TTS_LIVE_PATH}`;
}

export function deepgramListenUrl(config: GatewayConfig): string {
  const url = new URL(config.DEEPGRAM_LISTEN_WSS_URL);
  url.searchParams.set("model", config.DEEPGRAM_STT_MODEL ?? "");
  url.searchParams.set("language", config.DEEPGRAM_STT_LANGUAGE ?? "");
  url.searchParams.set("encoding", config.DEEPGRAM_AUDIO_INPUT_ENCODING);
  url.searchParams.set(
    "sample_rate",
    String(config.DEEPGRAM_AUDIO_INPUT_SAMPLE_RATE),
  );
  url.searchParams.set(
    "channels",
    String(config.DEEPGRAM_AUDIO_INPUT_CHANNELS),
  );
  url.searchParams.set(
    "interim_results",
    config.DEEPGRAM_LISTEN_INTERIM_RESULTS,
  );
  url.searchParams.set(
    "endpointing",
    String(config.DEEPGRAM_LISTEN_ENDPOINTING_MS),
  );
  url.searchParams.set(
    "utterance_end_ms",
    String(config.DEEPGRAM_LISTEN_UTTERANCE_END_MS),
  );
  url.searchParams.set("vad_events", config.DEEPGRAM_LISTEN_VAD_EVENTS);
  url.searchParams.set("punctuate", config.DEEPGRAM_LISTEN_PUNCTUATE);
  url.searchParams.set("smart_format", config.DEEPGRAM_LISTEN_SMART_FORMAT);
  return url.toString();
}

export function thinkEndpointHeaders(
  config: GatewayConfig,
  identity: {
    appUserId: string;
    engramUserId: string;
    personaId: string;
    sessionId: string;
  },
): Record<string, string> {
  return {
    ...(config.BYO_LLM_ENDPOINT_EXTRA_HEADERS ?? {}),
    [config.INTERNAL_SECRET_HEADER]: config.INTERNAL_API_SECRET,
    [config.BYO_LLM_APP_USER_HEADER]: identity.appUserId,
    [config.BYO_LLM_ENGRAM_USER_HEADER]: identity.engramUserId,
    [config.BYO_LLM_PERSONA_HEADER]: identity.personaId,
    [config.BYO_LLM_SESSION_HEADER]: identity.sessionId,
  };
}

export function clientVoiceWsUrl(
  config: GatewayConfig,
  personaId?: string,
): string {
  const base = new URL(config.GATEWAY_PUBLIC_URL);
  const protocol = base.protocol === "https:" ? "wss:" : "ws:";
  const url = new URL(`${protocol}//${base.host}${config.VOICE_WS_PATH}`);
  if (personaId) {
    url.searchParams.set(config.PERSONA_ID_QUERY, personaId);
  }
  return url.toString();
}

export function readPersonaIdQuery(
  query: unknown,
  config: GatewayConfig,
): unknown {
  if (typeof query !== "object" || query === null || Array.isArray(query)) {
    return undefined;
  }
  return (query as Record<string, unknown>)[config.PERSONA_ID_QUERY];
}

export function voiceTunnelCommand(config: GatewayConfig): string {
  const worker = new URL(config.WORKER_URL);
  const port = worker.port || (worker.protocol === "https:" ? "443" : "80");
  return `ngrok http ${port}`;
}

export function deepgramAuthHeaderValue(config: GatewayConfig): string {
  return `${config.DEEPGRAM_AGENT_AUTH_SCHEME} ${config.DEEPGRAM_API_KEY}`;
}

export function voiceAudioPersistEnabled(config: GatewayConfig): boolean {
  return config.VOICE_AUDIO_PERSIST_ENABLED === "true";
}

export function voiceAudioReady(config: GatewayConfig): string | null {
  if (!voiceAudioPersistEnabled(config)) {
    return null;
  }
  if (!config.AZURE_STORAGE_ACCOUNT) {
    return "AZURE_STORAGE_ACCOUNT is not set";
  }
  if (!config.AZURE_STORAGE_KEY) {
    return "AZURE_STORAGE_KEY is not set";
  }
  if (!config.AZURE_BLOB_CONTAINER) {
    return "AZURE_BLOB_CONTAINER is not set";
  }
  return null;
}

export function suppressedWarningCodes(config: GatewayConfig): Set<string> {
  return new Set(
    config.VOICE_SUPPRESSED_WARNING_CODES.split(/[,\s]+/)
      .map((value) => value.trim())
      .filter((value) => value.length > 0),
  );
}
