import type postgres from "postgres";

type Sql = ReturnType<typeof postgres>;

export async function listUserAudioUrls(
  sql: Sql,
  userId: string,
): Promise<string[]> {
  const rows = await sql<{ blob_url: string }[]>`
    SELECT a.blob_url
    FROM audio_assets a
    INNER JOIN turns t ON t.id = a.turn_id
    INNER JOIN sessions s ON s.id = t.session_id
    WHERE s.user_id = ${userId}
  `;
  return rows.map((row) => row.blob_url);
}

export async function listPersonaAudioUrls(
  sql: Sql,
  personaId: string,
): Promise<string[]> {
  const rows = await sql<{ blob_url: string }[]>`
    SELECT a.blob_url
    FROM audio_assets a
    INNER JOIN turns t ON t.id = a.turn_id
    INNER JOIN sessions s ON s.id = t.session_id
    WHERE s.persona_id = ${personaId}
  `;
  return rows.map((row) => row.blob_url);
}

export async function wipeMemberRows(
  sql: Sql,
  userId: string,
): Promise<{ sessions: number }> {
  return sql.begin(async (tx) => {
    const deleted = await tx`
      DELETE FROM sessions
      WHERE user_id = ${userId}
      RETURNING id
    `;
    await tx`
      DELETE FROM subscriptions
      WHERE user_id = ${userId}
    `;
    // Engram cannot reissue this password. Clearing the ciphertext is the
    // degrade-to-shared-only signal if the user row somehow survives; the
    // following DELETE removes the row for a completed erase.
    await tx`
      UPDATE users
      SET engram_member_secret = NULL
      WHERE id = ${userId}
    `;
    await tx`
      DELETE FROM users
      WHERE id = ${userId}
    `;
    return { sessions: deleted.length };
  });
}
