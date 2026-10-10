import type { Redis } from "ioredis";
import { z } from "zod";
import type { GatewayConfig } from "../config.js";
import { type JsonObject, asJsonValue } from "../json.js";

const pendingLatencySchema = z.object({
  stt_ms: z.number().int().nullable(),
  tts_first_byte_ms: z.number().int().nullable(),
  report: z.record(z.string(), z.unknown()),
});

export type PendingLatency = {
  stt_ms: number | null;
  tts_first_byte_ms: number | null;
  report: JsonObject;
};

const callStateSchema = z.object({
  request_id: z.string().nullable(),
  session_id: z.string().uuid(),
  barge_in: z.boolean(),
  pending_latency: z.array(pendingLatencySchema).default([]),
});

export type VoiceCallState = Omit<
  z.infer<typeof callStateSchema>,
  "pending_latency"
> & { pending_latency: PendingLatency[] };

function callKey(config: GatewayConfig, sessionId: string): string {
  return `${config.VOICE_REDIS_KEY_PREFIX}${sessionId}`;
}

export async function writeVoiceCallState(
  redis: Redis,
  config: GatewayConfig,
  state: VoiceCallState,
): Promise<void> {
  await redis.set(
    callKey(config, state.session_id),
    JSON.stringify(state),
    "EX",
    config.VOICE_REDIS_TTL_SECONDS,
  );
}

export async function readVoiceCallState(
  redis: Redis,
  config: GatewayConfig,
  sessionId: string,
): Promise<VoiceCallState | null> {
  const raw = await redis.get(callKey(config, sessionId));
  if (!raw) {
    return null;
  }
  try {
    const parsed = callStateSchema.safeParse(JSON.parse(raw) as unknown);
    if (!parsed.success) {
      return null;
    }
    return {
      ...parsed.data,
      pending_latency: parsed.data.pending_latency.map((item) => ({
        stt_ms: item.stt_ms,
        tts_first_byte_ms: item.tts_first_byte_ms,
        report: asJsonValue(item.report) as JsonObject,
      })),
    };
  } catch {
    return null;
  }
}

export async function setVoiceBargeIn(
  redis: Redis,
  config: GatewayConfig,
  sessionId: string,
  bargeIn: boolean,
): Promise<void> {
  const current = await readVoiceCallState(redis, config, sessionId);
  if (!current) {
    return;
  }
  await writeVoiceCallState(redis, config, { ...current, barge_in: bargeIn });
}

/** Reports that arrived before their turn row existed, kept in arrival order. */
export async function setPendingLatency(
  redis: Redis,
  config: GatewayConfig,
  sessionId: string,
  pending: PendingLatency[],
): Promise<void> {
  const current = await readVoiceCallState(redis, config, sessionId);
  if (!current) {
    return;
  }
  await writeVoiceCallState(redis, config, {
    ...current,
    pending_latency: pending.slice(-config.VOICE_PENDING_LATENCY_MAX),
  });
}

export async function clearVoiceCallState(
  redis: Redis,
  config: GatewayConfig,
  sessionId: string,
): Promise<void> {
  await redis.del(callKey(config, sessionId));
}
