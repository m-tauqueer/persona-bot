import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import { SUBSCRIPTION_STATUS } from "../schema.js";
import type { AppUser } from "./types.js";

type Sql = ReturnType<typeof postgres>;

const HYPHENATED_UUID =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

type UserRow = {
  id: string;
  google_sub: string;
  email: string;
  engram_user_id: string;
};

/** Engram subscribe `user_id` max is 32 characters; uuid hex is 32. */
export function personaEngineUserId(appUserId: string): string {
  if (HYPHENATED_UUID.test(appUserId)) {
    return appUserId.replaceAll("-", "").toLowerCase();
  }
  return appUserId;
}

function mapUser(row: UserRow): AppUser {
  return {
    id: row.id,
    googleSub: row.google_sub,
    email: row.email,
    engramUserId: row.engram_user_id,
  };
}

export async function upsertGoogleUser(
  sql: Sql,
  identity: { sub: string; email: string },
): Promise<AppUser> {
  const id = randomUUID();
  const rows = await sql<UserRow[]>`
    INSERT INTO users (id, google_sub, email, engram_user_id)
    VALUES (${id}, ${identity.sub}, ${identity.email}, ${personaEngineUserId(id)})
    ON CONFLICT (google_sub) DO UPDATE
    SET email = EXCLUDED.email, updated_at = now()
    RETURNING id, google_sub, email, engram_user_id
  `;
  const row = rows[0];
  if (!row) {
    throw new Error("user upsert returned no row");
  }
  return mapUser(row);
}

export async function getUserById(
  sql: Sql,
  id: string,
): Promise<AppUser | null> {
  const rows = await sql<UserRow[]>`
    SELECT id, google_sub, email, engram_user_id
    FROM users
    WHERE id = ${id}
  `;
  return rows[0] ? mapUser(rows[0]) : null;
}

export async function getUserByGoogleSub(
  sql: Sql,
  googleSub: string,
): Promise<AppUser | null> {
  const rows = await sql<UserRow[]>`
    SELECT id, google_sub, email, engram_user_id
    FROM users
    WHERE google_sub = ${googleSub}
  `;
  return rows[0] ? mapUser(rows[0]) : null;
}

export async function findPersonaIdByEngramId(
  sql: Sql,
  engramPersonaId: string,
): Promise<string | null> {
  const rows = await sql<{ id: string }[]>`
    SELECT id
    FROM personas
    WHERE engram_persona_id = ${engramPersonaId}
  `;
  return rows[0]?.id ?? null;
}

export async function hasActiveSubscription(
  sql: Sql,
  userId: string,
  personaId: string,
): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    SELECT id
    FROM subscriptions
    WHERE user_id = ${userId}
      AND persona_id = ${personaId}
      AND status = ${SUBSCRIPTION_STATUS.ACTIVE}
  `;
  return rows.length > 0;
}

export async function upsertActiveSubscription(
  sql: Sql,
  userId: string,
  personaId: string,
): Promise<void> {
  await sql`
    INSERT INTO subscriptions (user_id, persona_id, status)
    VALUES (${userId}, ${personaId}, ${SUBSCRIPTION_STATUS.ACTIVE})
    ON CONFLICT (user_id, persona_id) DO UPDATE
    SET status = ${SUBSCRIPTION_STATUS.ACTIVE}
  `;
}
