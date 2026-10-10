/**
 * Failure taxonomy and reconnect rules. No live services: codes, messages,
 * fatal vs warning, and Deepgram reconnect membership all come from config.
 */
import { loadGatewayConfig } from "../config.js";
import {
  deepgramRecoveryAction,
  failureMessage,
  isDeepgramThinkFatal,
  isFatalFailure,
  parseCodeList,
  shouldReconnectDeepgram,
  voiceFailurePayload,
} from "./failures.js";
import { parseVoiceNotice } from "./notices.js";
import { redisQuiet } from "./redisSafe.js";

let failed = 0;

function check(name: string, ok: boolean, detail = ""): void {
  if (ok) {
    console.log(`${name}=ok${detail ? ` ${detail}` : ""}`);
    return;
  }
  console.error(`${name}=FAIL${detail ? ` ${detail}` : ""}`);
  failed += 1;
}

const config = loadGatewayConfig();

check("fatal_engram", isFatalFailure(config, config.FAILURE_CODE_ENGRAM));
check("fatal_deepgram", isFatalFailure(config, config.FAILURE_CODE_DEEPGRAM));
check("fatal_fish", isFatalFailure(config, config.FAILURE_CODE_FISH));
check(
  "fatal_fish_key_missing",
  isFatalFailure(config, config.FAILURE_CODE_FISH_KEY_MISSING),
);
check(
  "fatal_fish_voice_missing",
  isFatalFailure(config, config.FAILURE_CODE_FISH_VOICE_MISSING),
);
check(
  "fatal_fish_unauthorized",
  isFatalFailure(config, config.FAILURE_CODE_FISH_UNAUTHORIZED),
);
check(
  "fatal_fish_payment",
  isFatalFailure(config, config.FAILURE_CODE_FISH_PAYMENT),
);
check(
  "fatal_voice_provider",
  isFatalFailure(config, config.FAILURE_CODE_VOICE_PROVIDER),
);
check(
  "warning_record_not_fatal",
  !isFatalFailure(config, config.FAILURE_CODE_RECORD),
);
check(
  "warning_speaking_llm_not_fatal",
  !isFatalFailure(config, config.FAILURE_CODE_SPEAKING_LLM),
);
check(
  "warning_redis_not_fatal",
  !isFatalFailure(config, config.FAILURE_CODE_REDIS),
);
check(
  "warning_blob_not_fatal",
  !isFatalFailure(config, config.FAILURE_CODE_BLOB),
);

check("reconnect_on_unexpected_close", shouldReconnectDeepgram(config, null));
check(
  "reconnect_on_listed_code",
  shouldReconnectDeepgram(config, "SERVER_GOING_AWAY"),
);
check("think_fatal_listed", isDeepgramThinkFatal(config, "FAILED_TO_THINK"));
check(
  "unknown_deepgram_code_no_reconnect",
  !shouldReconnectDeepgram(config, "INVALID_SETTINGS"),
);
check(
  "recover_unexpected_close",
  deepgramRecoveryAction(config, null) === "reconnect",
);
check(
  "recover_listed_code",
  deepgramRecoveryAction(config, "SERVER_GOING_AWAY") === "reconnect",
);
check(
  "recover_think_fatal",
  deepgramRecoveryAction(config, "FAILED_TO_THINK") === "think",
);
check(
  "recover_unknown_code",
  deepgramRecoveryAction(config, "INVALID_SETTINGS") === "end",
);
check(
  "think_wins_over_reconnect_list",
  deepgramRecoveryAction(
    {
      ...config,
      DEEPGRAM_RECONNECT_ON_CODES: "FAILED_TO_THINK,SERVER_GOING_AWAY",
    },
    "FAILED_TO_THINK",
  ) === "think",
);
check(
  "zero_attempts_does_not_reconnect",
  deepgramRecoveryAction(
    { ...config, DEEPGRAM_RECONNECT_ATTEMPTS: 0 },
    "SERVER_GOING_AWAY",
  ) === "end",
);

const engram = voiceFailurePayload(config, config.FAILURE_CODE_ENGRAM);
check(
  "engram_payload_is_error",
  engram.type === config.VOICE_CLIENT_ERROR_TYPE,
);
check("engram_payload_message", engram.error === config.FAILURE_MESSAGE_ENGRAM);

const record = voiceFailurePayload(config, config.FAILURE_CODE_RECORD);
check(
  "record_payload_is_warning",
  record.type === config.VOICE_CLIENT_WARNING_TYPE,
);
check(
  "record_payload_message",
  record.warning === config.FAILURE_MESSAGE_RECORD,
);

check(
  "message_unknown_falls_back",
  failureMessage(config, "not-a-real-code") === config.FAILURE_MESSAGE_UNKNOWN,
);

const listed = parseCodeList(config.FAILURE_FATAL_CODES);
check("fatal_list_has_engram", listed.has(config.FAILURE_CODE_ENGRAM));
check("fatal_list_omits_record", !listed.has(config.FAILURE_CODE_RECORD));

check("reconnect_attempts_configured", config.DEEPGRAM_RECONNECT_ATTEMPTS >= 0);
check(
  "reconnect_backoff_configured",
  config.DEEPGRAM_RECONNECT_BACKOFF_MS >= 0,
);

const notice = parseVoiceNotice({
  session_id: "11111111-1111-1111-1111-111111111111",
  code: config.FAILURE_CODE_ENGRAM,
  message: config.FAILURE_MESSAGE_ENGRAM,
});
check("notice_shape_accepted", notice !== null);

const traced = parseVoiceNotice({
  session_id: "11111111-1111-1111-1111-111111111111",
  code: config.VOICE_NOTICE_TRACE_CODE,
  message: config.VOICE_NOTICE_TRACE_MESSAGE,
  kind: config.VOICE_NOTICE_KIND_TRACE,
  correlation_id: "11111111-1111-1111-1111-111111111111",
  turn_ids: ["11111111-1111-1111-1111-111111111111"],
});
check("trace_notice_shape_accepted", traced !== null);
check(
  "trace_is_not_fatal",
  !isFatalFailure(config, config.VOICE_NOTICE_TRACE_CODE),
);

const rejected = parseVoiceNotice({
  session_id: "not-a-uuid",
  code: config.FAILURE_CODE_ENGRAM,
  message: config.FAILURE_MESSAGE_ENGRAM,
});
check("notice_shape_rejects_bad_session", rejected === null);

const quietLog = {
  error() {},
  info() {},
  warn() {},
} as unknown as import("fastify").FastifyBaseLogger;

const hung = await redisQuiet(
  quietLog,
  { ...config, REDIS_COMMAND_TIMEOUT_MS: 50 },
  "hang",
  null,
  () => new Promise<string>(() => {}),
);
check("redis_timeout_does_not_throw", hung === null);

if (failed) {
  console.error(`FAIL: ${failed} check(s)`);
  process.exit(1);
}
console.log("PROBE_OK");
