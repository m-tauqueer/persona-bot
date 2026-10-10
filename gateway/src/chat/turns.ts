import type postgres from "postgres";

type Sql = ReturnType<typeof postgres>;

export type TranscriptTurn = {
  ordinal: number;
  speaker: string;
  text: string;
};

export async function listTurnsForUser(
  sql: Sql,
  sessionId: string,
  userId: string,
): Promise<TranscriptTurn[] | null> {
  const owned = await sql<{ id: string }[]>`
    SELECT id
    FROM sessions
    WHERE id = ${sessionId}
      AND user_id = ${userId}
  `;
  if (!owned[0]) {
    return null;
  }
  const rows = await sql<TranscriptTurn[]>`
    SELECT ordinal, speaker, text
    FROM turns
    WHERE session_id = ${sessionId}
    ORDER BY ordinal
  `;
  return rows;
}
