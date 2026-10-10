import type postgres from "postgres";
import type { GatewayConfig } from "../config.js";
import type { JsonObject } from "../json.js";
import { TURN_SPEAKER, type TurnSpeaker } from "../schema.js";

type Sql = ReturnType<typeof postgres>;

/**
 * Attach metadata to the oldest turn of this speaker that has none. Turns and
 * transport utterances are both in order, so they line up without guessing.
 */
async function attachMeta(
  sql: Sql,
  sessionId: string,
  speaker: TurnSpeaker,
  column: "stt_meta" | "tts_meta",
  meta: JsonObject,
): Promise<string | null> {
  const rows = await sql<{ id: string }[]>`
    UPDATE turns
    SET ${sql(column)} = ${sql.json(meta)}
    WHERE id = (
      SELECT t.id
      FROM turns t
      WHERE t.session_id = ${sessionId}
        AND t.speaker = ${speaker}
        AND t.${sql(column)} IS NULL
      ORDER BY t.ordinal ASC
      LIMIT 1
    )
    RETURNING id
  `;
  return rows[0]?.id ?? null;
}

export function sttMeta(
  config: GatewayConfig,
  transcript: string,
  requestId: string | null,
): JsonObject {
  return {
    model: config.DEEPGRAM_STT_MODEL ?? null,
    language: config.DEEPGRAM_STT_LANGUAGE ?? null,
    encoding: config.DEEPGRAM_AUDIO_INPUT_ENCODING,
    sample_rate: config.DEEPGRAM_AUDIO_INPUT_SAMPLE_RATE,
    request_id: requestId,
    transcript,
  };
}

export function ttsMeta(
  config: GatewayConfig,
  audio: { bytes: number; durationMs: number; interrupted: boolean },
  requestId: string | null,
  voice?: string,
): JsonObject {
  return {
    voice: voice ?? config.DEEPGRAM_TTS_VOICE ?? null,
    encoding: config.DEEPGRAM_AUDIO_OUTPUT_ENCODING,
    sample_rate: config.DEEPGRAM_AUDIO_OUTPUT_SAMPLE_RATE,
    container: config.DEEPGRAM_AUDIO_OUTPUT_CONTAINER,
    request_id: requestId,
    audio_bytes: audio.bytes,
    duration_ms: audio.durationMs,
    interrupted: audio.interrupted,
  };
}

export function recordSttMeta(
  sql: Sql,
  sessionId: string,
  meta: JsonObject,
): Promise<string | null> {
  return attachMeta(sql, sessionId, TURN_SPEAKER.USER, "stt_meta", meta);
}

export function recordTtsMeta(
  sql: Sql,
  sessionId: string,
  meta: JsonObject,
): Promise<string | null> {
  return attachMeta(sql, sessionId, TURN_SPEAKER.PERSONA, "tts_meta", meta);
}

export async function endVoiceSession(
  sql: Sql,
  sessionId: string,
): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    UPDATE sessions
    SET ended_at = now()
    WHERE id = ${sessionId} AND ended_at IS NULL
    RETURNING id
  `;
  return rows.length > 0;
}
