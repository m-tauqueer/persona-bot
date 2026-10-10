import type { GatewayConfig } from "../config.js";

export function parseCodeList(raw: string): Set<string> {
  return new Set(
    raw
      .split(/[,\s]+/)
      .map((value) => value.trim())
      .filter((value) => value.length > 0),
  );
}

export function failureMessages(config: GatewayConfig): Map<string, string> {
  return new Map([
    [config.FAILURE_CODE_ENGRAM, config.FAILURE_MESSAGE_ENGRAM],
    [config.FAILURE_CODE_SPEAKING_LLM, config.FAILURE_MESSAGE_SPEAKING_LLM],
    [config.FAILURE_CODE_RECORD, config.FAILURE_MESSAGE_RECORD],
    [config.FAILURE_CODE_DEEPGRAM, config.FAILURE_MESSAGE_DEEPGRAM],
    [config.FAILURE_CODE_BLOB, config.FAILURE_MESSAGE_BLOB],
    [config.FAILURE_CODE_REDIS, config.FAILURE_MESSAGE_REDIS],
    [config.FAILURE_CODE_RECONNECTING, config.FAILURE_MESSAGE_RECONNECTING],
    [config.FAILURE_CODE_RECONNECTED, config.FAILURE_MESSAGE_RECONNECTED],
    [config.FAILURE_CODE_DATABASE, config.FAILURE_MESSAGE_DATABASE],
    [config.FAILURE_CODE_THINK, config.FAILURE_MESSAGE_THINK],
    [config.FAILURE_CODE_FISH, config.FAILURE_MESSAGE_FISH],
    [
      config.FAILURE_CODE_FISH_KEY_MISSING,
      config.FAILURE_MESSAGE_FISH_KEY_MISSING,
    ],
    [
      config.FAILURE_CODE_FISH_VOICE_MISSING,
      config.FAILURE_MESSAGE_FISH_VOICE_MISSING,
    ],
    [
      config.FAILURE_CODE_FISH_UNAUTHORIZED,
      config.FAILURE_MESSAGE_FISH_UNAUTHORIZED,
    ],
    [config.FAILURE_CODE_FISH_PAYMENT, config.FAILURE_MESSAGE_FISH_PAYMENT],
    [config.FAILURE_CODE_VOICE_PROVIDER, config.FAILURE_MESSAGE_VOICE_PROVIDER],
  ]);
}

export function failureMessage(config: GatewayConfig, code: string): string {
  return failureMessages(config).get(code) ?? config.FAILURE_MESSAGE_UNKNOWN;
}

export function isFatalFailure(config: GatewayConfig, code: string): boolean {
  return parseCodeList(config.FAILURE_FATAL_CODES).has(code);
}

export function shouldReconnectDeepgram(
  config: GatewayConfig,
  code: string | null,
): boolean {
  if (code === null) {
    return true;
  }
  return parseCodeList(config.DEEPGRAM_RECONNECT_ON_CODES).has(code);
}

export type DeepgramRecoveryAction = "think" | "reconnect" | "end";

export function deepgramRecoveryAction(
  config: GatewayConfig,
  code: string | null,
): DeepgramRecoveryAction {
  if (code !== null && isDeepgramThinkFatal(config, code)) {
    return "think";
  }
  if (
    shouldReconnectDeepgram(config, code) &&
    config.DEEPGRAM_RECONNECT_ATTEMPTS > 0
  ) {
    return "reconnect";
  }
  return "end";
}

export function isDeepgramThinkFatal(
  config: GatewayConfig,
  code: string,
): boolean {
  return parseCodeList(config.DEEPGRAM_THINK_FATAL_CODES).has(code);
}

export function voiceFailurePayload(
  config: GatewayConfig,
  code: string,
): Record<string, unknown> {
  const text = failureMessage(config, code);
  if (isFatalFailure(config, code)) {
    return {
      type: config.VOICE_CLIENT_ERROR_TYPE,
      code,
      error: text,
    };
  }
  return {
    type: config.VOICE_CLIENT_WARNING_TYPE,
    code,
    warning: text,
  };
}
