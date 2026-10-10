import type postgres from "postgres";
import { ACCESS_STATUS, type AccessStatus } from "../schema.js";
import { parseAccessStatus } from "./parse.js";

type Sql = ReturnType<typeof postgres>;

export type AccessRequestRow = {
  id: string;
  googleSub: string;
  email: string;
  status: AccessStatus;
  requestedAt: Date;
  decidedAt: Date | null;
  userId: string | null;
};

type AccessSqlRow = {
  id: string;
  google_sub: string;
  email: string;
  status: string;
  requested_at: Date;
  decided_at: Date | null;
  user_id: string | null;
};

function mapRow(row: AccessSqlRow): AccessRequestRow | null {
  const status = parseAccessStatus(row.status);
  if (!status) {
    return null;
  }
  return {
    id: row.id,
    googleSub: row.google_sub,
    email: row.email,
    status,
    requestedAt: row.requested_at,
    decidedAt: row.decided_at,
    userId: row.user_id,
  };
}

export async function getAccessByGoogleSub(
  sql: Sql,
  googleSub: string,
): Promise<AccessRequestRow | null> {
  const rows = await sql<AccessSqlRow[]>`
    SELECT
      ar.id,
      ar.google_sub,
      ar.email,
      ar.status,
      ar.requested_at,
      ar.decided_at,
      u.id AS user_id
    FROM access_requests ar
    LEFT JOIN users u ON u.google_sub = ar.google_sub
    WHERE ar.google_sub = ${googleSub}
  `;
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function upsertWaitlistRequest(
  sql: Sql,
  identity: { sub: string; email: string },
): Promise<AccessRequestRow> {
  await sql`
    INSERT INTO access_requests (google_sub, email, status, requested_at)
    VALUES (
      ${identity.sub},
      ${identity.email},
      ${ACCESS_STATUS.REQUESTED},
      now()
    )
    ON CONFLICT (google_sub) DO UPDATE
    SET
      email = EXCLUDED.email,
      requested_at = CASE
        WHEN access_requests.status = ${ACCESS_STATUS.REQUESTED}
        THEN now()
        ELSE access_requests.requested_at
      END,
      updated_at = now()
    WHERE access_requests.status = ${ACCESS_STATUS.REQUESTED}
  `;
  const existing = await getAccessByGoogleSub(sql, identity.sub);
  if (existing) {
    return existing;
  }
  throw new Error("waitlist upsert returned no row");
}

export async function upsertActiveAccess(
  sql: Sql,
  identity: { sub: string; email: string },
  decidedBy: string,
): Promise<void> {
  await sql`
    INSERT INTO access_requests (
      google_sub,
      email,
      status,
      requested_at,
      decided_at,
      decided_by
    )
    VALUES (
      ${identity.sub},
      ${identity.email},
      ${ACCESS_STATUS.ACTIVE},
      now(),
      now(),
      ${decidedBy}
    )
    ON CONFLICT (google_sub) DO UPDATE
    SET
      email = EXCLUDED.email,
      status = ${ACCESS_STATUS.ACTIVE},
      decided_at = now(),
      decided_by = ${decidedBy},
      updated_at = now()
  `;
}

export async function listAccessRequests(
  sql: Sql,
  args: {
    status: AccessStatus;
    limit: number;
    cursor: { requestedAt: Date; id: string } | null;
  },
): Promise<AccessRequestRow[]> {
  const cursorFilter = args.cursor
    ? sql`AND (ar.requested_at, ar.id) < (${args.cursor.requestedAt}, ${args.cursor.id}::uuid)`
    : sql``;
  const rows = await sql<AccessSqlRow[]>`
    SELECT
      ar.id,
      ar.google_sub,
      ar.email,
      ar.status,
      ar.requested_at,
      ar.decided_at,
      u.id AS user_id
    FROM access_requests ar
    LEFT JOIN users u ON u.google_sub = ar.google_sub
    WHERE ar.status = ${args.status}
      ${cursorFilter}
    ORDER BY ar.requested_at DESC, ar.id DESC
    LIMIT ${args.limit + 1}
  `;
  return rows.flatMap((row) => {
    const mapped = mapRow(row);
    return mapped ? [mapped] : [];
  });
}

export async function getAccessByIds(
  sql: Sql,
  ids: string[],
): Promise<AccessRequestRow[]> {
  if (ids.length === 0) {
    return [];
  }
  const rows = await sql<AccessSqlRow[]>`
    SELECT
      ar.id,
      ar.google_sub,
      ar.email,
      ar.status,
      ar.requested_at,
      ar.decided_at,
      u.id AS user_id
    FROM access_requests ar
    LEFT JOIN users u ON u.google_sub = ar.google_sub
    WHERE ar.id IN ${sql(ids)}
  `;
  return rows.flatMap((row) => {
    const mapped = mapRow(row);
    return mapped ? [mapped] : [];
  });
}

export async function updateAccessStatus(
  sql: Sql,
  id: string,
  status: AccessStatus,
  decidedBy: string,
): Promise<void> {
  await sql`
    UPDATE access_requests
    SET
      status = ${status},
      decided_at = now(),
      decided_by = ${decidedBy},
      updated_at = now()
    WHERE id = ${id}
  `;
}
