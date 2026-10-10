import type postgres from "postgres";
import type { GatewayConfig } from "../config.js";
import { type JsonObject, asJsonValue } from "../json.js";

type Sql = ReturnType<typeof postgres>;

export type VoiceLatency = {
  sttMs: number | null;
  ttsFirstByteMs: number | null;
  report: JsonObject;
};

function toMs(raw: unknown, scale: number): number | null {
  const value =
    typeof raw === "number"
      ? raw
      : typeof raw === "string" && raw.length > 0
        ? Number(raw)
        : Number.NaN;
  if (!Number.isFinite(value)) {
    return null;
  }
  return Math.round(value * scale);
}

export function latencyFieldMs(
  event: Record<string, unknown>,
  field: string,
  scale: number,
): number | null {
  return toMs(event[field], scale);
}

/** Every field the transport reports is optional, so keep the whole report. */
export function readVoiceLatency(
  event: Record<string, unknown>,
  config: GatewayConfig,
): VoiceLatency {
  const report: JsonObject = {};
  for (const [key, value] of Object.entries(event)) {
    if (key === "type") {
      continue;
    }
    const ms = toMs(value, config.VOICE_LATENCY_TO_MS);
    report[key] = ms === null ? asJsonValue(value) : ms;
  }
  return {
    sttMs: latencyFieldMs(
      event,
      config.DEEPGRAM_LATENCY_STT_FIELD,
      config.VOICE_LATENCY_TO_MS,
    ),
    ttsFirstByteMs: latencyFieldMs(
      event,
      config.DEEPGRAM_LATENCY_TTS_FIELD,
      config.VOICE_LATENCY_TO_MS,
    ),
    report,
  };
}

/**
 * Attach a report to the oldest turn in this session that has not been given
 * one. Reports arrive in turn order, so this matches them up even when a turn
 * is still being written as the next report lands.
 */
export async function applyVoiceLatency(
  sql: Sql,
  sessionId: string,
  latency: VoiceLatency,
): Promise<string | null> {
  const rows = await sql<{ turn_id: string }[]>`
    UPDATE latency_spans ls
    SET
      stt_ms = COALESCE(${latency.sttMs}, ls.stt_ms),
      tts_first_byte_ms = COALESCE(
        ${latency.ttsFirstByteMs},
        ls.tts_first_byte_ms
      ),
      transport_latency = ${sql.json(latency.report)}
    WHERE ls.turn_id = (
      SELECT ls2.turn_id
      FROM latency_spans ls2
      INNER JOIN turns t2 ON t2.id = ls2.turn_id
      WHERE t2.session_id = ${sessionId}
        AND ls2.transport_latency IS NULL
      ORDER BY t2.ordinal ASC
      LIMIT 1
    )
    RETURNING ls.turn_id
  `;
  return rows[0]?.turn_id ?? null;
}
