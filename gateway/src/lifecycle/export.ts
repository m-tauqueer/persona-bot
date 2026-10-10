import type postgres from "postgres";
import { asJsonArray } from "../json.js";

type Sql = ReturnType<typeof postgres>;

export async function loadMemberArchive(sql: Sql, userId: string) {
  const [user] = await sql<
    {
      id: string;
      email: string;
      created_at: Date;
    }[]
  >`
    SELECT id, email, created_at
    FROM users
    WHERE id = ${userId}
  `;
  if (!user) {
    return null;
  }
  const [consent] = await sql<
    {
      privacy_version: string;
      terms_version: string;
      accepted_at: Date;
      cookie_notice_at: Date | null;
    }[]
  >`
    SELECT c.privacy_version, c.terms_version, c.accepted_at, c.cookie_notice_at
    FROM consents c
    INNER JOIN users u ON u.google_sub = c.google_sub
    WHERE u.id = ${userId}
  `;
  const sessions = await sql<
    {
      id: string;
      persona_id: string;
      engram_session_id: string | null;
      channel: string;
      started_at: Date;
      ended_at: Date | null;
    }[]
  >`
    SELECT id, persona_id, engram_session_id, channel, started_at, ended_at
    FROM sessions
    WHERE user_id = ${userId}
    ORDER BY started_at
  `;
  const sessionIds = sessions.map((session) => session.id);
  const turns =
    sessionIds.length === 0
      ? []
      : await sql<
          {
            id: string;
            session_id: string;
            ordinal: number;
            speaker: string;
            text: string;
            created_at: Date;
            brain_mode: string | null;
            correlation_id: string | null;
          }[]
        >`
          SELECT
            id,
            session_id,
            ordinal,
            speaker,
            text,
            created_at,
            brain_mode,
            correlation_id
          FROM turns
          WHERE session_id IN ${sql(sessionIds)}
          ORDER BY session_id, ordinal
        `;
  const audio =
    sessionIds.length === 0
      ? []
      : await sql<{ turn_id: string; direction: string; blob_url: string }[]>`
          SELECT a.turn_id, a.direction, a.blob_url
          FROM audio_assets a
          INNER JOIN turns t ON t.id = a.turn_id
          WHERE t.session_id IN ${sql(sessionIds)}
        `;
  const memoryRefs =
    sessionIds.length === 0
      ? []
      : await sql<
          {
            turn_id: string;
            memories_used: unknown;
            engram_session_id: string;
          }[]
        >`
          SELECT m.turn_id, m.memories_used, m.engram_session_id
          FROM memory_refs m
          INNER JOIN turns t ON t.id = m.turn_id
          WHERE t.session_id IN ${sql(sessionIds)}
        `;
  return {
    exported_at: new Date().toISOString(),
    user: {
      id: user.id,
      email: user.email,
      created_at: user.created_at.toISOString(),
    },
    consent: consent
      ? {
          privacy_version: consent.privacy_version,
          terms_version: consent.terms_version,
          accepted_at: consent.accepted_at.toISOString(),
          cookie_notice_at: consent.cookie_notice_at?.toISOString() ?? null,
        }
      : null,
    sessions: sessions.map((session) => ({
      id: session.id,
      persona_id: session.persona_id,
      engram_session_id: session.engram_session_id,
      channel: session.channel,
      started_at: session.started_at.toISOString(),
      ended_at: session.ended_at?.toISOString() ?? null,
    })),
    turns: turns.map((turn) => ({
      id: turn.id,
      session_id: turn.session_id,
      ordinal: turn.ordinal,
      speaker: turn.speaker,
      text: turn.text,
      created_at: turn.created_at.toISOString(),
      brain_mode: turn.brain_mode,
      correlation_id: turn.correlation_id,
    })),
    audio: audio.map((asset) => ({
      turn_id: asset.turn_id,
      direction: asset.direction,
      blob_url: asset.blob_url,
    })),
    memory_refs: memoryRefs.map((ref) => ({
      turn_id: ref.turn_id,
      memories_used: asJsonArray(ref.memories_used),
      engram_session_id: ref.engram_session_id,
    })),
  };
}
