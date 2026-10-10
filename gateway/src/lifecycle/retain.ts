import type { FastifyBaseLogger } from "fastify";
import type postgres from "postgres";
import type { GatewayConfig } from "../config.js";
import { deleteAudioBlobs } from "./blobs.js";

type Sql = ReturnType<typeof postgres>;

export async function applySessionRetention(
  sql: Sql,
  config: GatewayConfig,
  log: FastifyBaseLogger,
): Promise<{ sessions: number }> {
  if (config.RETENTION_SESSION_DAYS <= 0) {
    return { sessions: 0 };
  }
  const expired = await sql<{ id: string }[]>`
    SELECT id
    FROM sessions
    WHERE ended_at IS NOT NULL
      AND ended_at <= clock_timestamp() - (${config.RETENTION_SESSION_DAYS} * interval '1 day')
  `;
  if (expired.length === 0) {
    return { sessions: 0 };
  }
  const ids = expired.map((row) => row.id);
  const audio = await sql<{ blob_url: string }[]>`
    SELECT a.blob_url
    FROM audio_assets a
    INNER JOIN turns t ON t.id = a.turn_id
    WHERE t.session_id IN ${sql(ids)}
  `;
  await deleteAudioBlobs(
    config,
    audio.map((row) => row.blob_url),
    log,
  );
  const deleted = await sql`
    DELETE FROM sessions
    WHERE id IN ${sql(ids)}
    RETURNING id
  `;
  return { sessions: deleted.length };
}
