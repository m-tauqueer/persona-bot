import type postgres from "postgres";
import { DELETION_STATUS, type DeletionStatus } from "../schema.js";
import type { StoredConsent } from "./decision.js";
import { parseDeletionStatus } from "./parse.js";

type Sql = ReturnType<typeof postgres>;

export async function getConsent(
  sql: Sql,
  googleSub: string,
): Promise<StoredConsent | null> {
  const rows = await sql<{ privacy_version: string; terms_version: string }[]>`
    SELECT privacy_version, terms_version
    FROM consents
    WHERE google_sub = ${googleSub}
  `;
  const row = rows[0];
  if (!row) {
    return null;
  }
  return {
    privacyVersion: row.privacy_version,
    termsVersion: row.terms_version,
  };
}

export async function upsertConsent(
  sql: Sql,
  input: {
    googleSub: string;
    privacyVersion: string;
    termsVersion: string;
  },
): Promise<void> {
  await sql`
    INSERT INTO consents (
      google_sub,
      privacy_version,
      terms_version,
      accepted_at,
      cookie_notice_at
    )
    VALUES (
      ${input.googleSub},
      ${input.privacyVersion},
      ${input.termsVersion},
      now(),
      now()
    )
    ON CONFLICT (google_sub) DO UPDATE
    SET
      privacy_version = EXCLUDED.privacy_version,
      terms_version = EXCLUDED.terms_version,
      accepted_at = now(),
      cookie_notice_at = now()
  `;
}

export type DeletionRequestRow = {
  id: string;
  userId: string | null;
  googleSub: string;
  email: string;
  status: DeletionStatus;
  requestedAt: Date;
  completedAt: Date | null;
};

type DeletionSqlRow = {
  id: string;
  user_id: string | null;
  google_sub: string;
  email: string;
  status: string;
  requested_at: Date;
  completed_at: Date | null;
};

function mapDeletion(row: DeletionSqlRow): DeletionRequestRow | null {
  const status = parseDeletionStatus(row.status);
  if (!status) {
    return null;
  }
  return {
    id: row.id,
    userId: row.user_id,
    googleSub: row.google_sub,
    email: row.email,
    status,
    requestedAt: row.requested_at,
    completedAt: row.completed_at,
  };
}

export async function getPendingDeletionForUser(
  sql: Sql,
  userId: string,
): Promise<DeletionRequestRow | null> {
  const rows = await sql<DeletionSqlRow[]>`
    SELECT id, user_id, google_sub, email, status, requested_at, completed_at
    FROM deletion_requests
    WHERE user_id = ${userId}
      AND status = ${DELETION_STATUS.PENDING}
    ORDER BY requested_at DESC
    LIMIT 1
  `;
  return rows[0] ? mapDeletion(rows[0]) : null;
}

export async function insertDeletionRequest(
  sql: Sql,
  input: {
    userId: string;
    googleSub: string;
    email: string;
    requestedBy: string;
  },
): Promise<DeletionRequestRow> {
  const rows = await sql<DeletionSqlRow[]>`
    INSERT INTO deletion_requests (
      user_id,
      google_sub,
      email,
      status,
      requested_by
    )
    VALUES (
      ${input.userId},
      ${input.googleSub},
      ${input.email},
      ${DELETION_STATUS.PENDING},
      ${input.requestedBy}
    )
    RETURNING id, user_id, google_sub, email, status, requested_at, completed_at
  `;
  const mapped = rows[0] ? mapDeletion(rows[0]) : null;
  if (!mapped) {
    throw new Error("deletion request insert returned no row");
  }
  return mapped;
}

export async function listDeletionRequests(
  sql: Sql,
  args: {
    status: DeletionStatus;
    limit: number;
    cursor: { requestedAt: Date; id: string } | null;
  },
): Promise<DeletionRequestRow[]> {
  const cursorFilter = args.cursor
    ? sql`AND (requested_at, id) < (${args.cursor.requestedAt}, ${args.cursor.id}::uuid)`
    : sql``;
  const rows = await sql<DeletionSqlRow[]>`
    SELECT id, user_id, google_sub, email, status, requested_at, completed_at
    FROM deletion_requests
    WHERE status = ${args.status}
      ${cursorFilter}
    ORDER BY requested_at DESC, id DESC
    LIMIT ${args.limit + 1}
  `;
  return rows.flatMap((row) => {
    const mapped = mapDeletion(row);
    return mapped ? [mapped] : [];
  });
}

export async function getDeletionByIds(
  sql: Sql,
  ids: string[],
): Promise<DeletionRequestRow[]> {
  if (ids.length === 0) {
    return [];
  }
  const rows = await sql<DeletionSqlRow[]>`
    SELECT id, user_id, google_sub, email, status, requested_at, completed_at
    FROM deletion_requests
    WHERE id IN ${sql(ids)}
  `;
  return rows.flatMap((row) => {
    const mapped = mapDeletion(row);
    return mapped ? [mapped] : [];
  });
}

export async function markDeletionCompleted(
  sql: Sql,
  id: string,
  completedBy: string,
): Promise<void> {
  await sql`
    UPDATE deletion_requests
    SET
      status = ${DELETION_STATUS.COMPLETED},
      completed_at = now(),
      completed_by = ${completedBy}
    WHERE id = ${id}
  `;
}

export async function markDeletionCancelled(
  sql: Sql,
  id: string,
  completedBy: string,
): Promise<void> {
  await sql`
    UPDATE deletion_requests
    SET
      status = ${DELETION_STATUS.CANCELLED},
      cancelled_at = now(),
      completed_by = ${completedBy}
    WHERE id = ${id}
  `;
}
