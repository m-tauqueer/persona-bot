import type postgres from "postgres";
import type { OpsEventInput } from "./decision.js";
import { parseOpsService } from "./decision.js";

type Sql = ReturnType<typeof postgres>;

export type OpsEventRow = {
  id: string;
  created_at: string;
  service: string;
  code: string;
  message: string;
  correlation_id: string | null;
};

type OpsEventSqlRow = {
  id: string;
  created_at: Date;
  service: string;
  code: string;
  message: string;
  correlation_id: string | null;
};

function mapEvent(row: OpsEventSqlRow): OpsEventRow | null {
  if (!parseOpsService(row.service)) {
    return null;
  }
  return {
    id: row.id,
    created_at: row.created_at.toISOString(),
    service: row.service,
    code: row.code,
    message: row.message,
    correlation_id: row.correlation_id,
  };
}

export async function insertOpsEvent(
  sql: Sql,
  event: OpsEventInput,
): Promise<string> {
  const rows = await sql<{ id: string }[]>`
    INSERT INTO ops_events (service, code, message, correlation_id)
    VALUES (
      ${event.service},
      ${event.code},
      ${event.message},
      ${event.correlationId ?? null}
    )
    RETURNING id
  `;
  const id = rows[0]?.id;
  if (!id) {
    throw new Error("ops event insert returned no row");
  }
  return id;
}

export async function listOpsEvents(
  sql: Sql,
  limit: number,
): Promise<OpsEventRow[]> {
  const rows = await sql<OpsEventSqlRow[]>`
    SELECT id, created_at, service, code, message, correlation_id
    FROM ops_events
    ORDER BY created_at DESC, id DESC
    LIMIT ${limit}
  `;
  return rows.flatMap((row) => {
    const mapped = mapEvent(row);
    return mapped ? [mapped] : [];
  });
}
