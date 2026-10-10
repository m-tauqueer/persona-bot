import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { createPostgres } from "./clients.js";
import { repoRootFromHere } from "./config.js";
import {
  ACCESS_STATUS,
  AUDIO_DIRECTION,
  CONTROLLER_ACTION,
  DELETION_STATUS,
  SESSION_CHANNEL,
  SUBSCRIPTION_STATUS,
  TURN_SPEAKER,
} from "./schema.js";

const SCHEMA_SQL_VALUES = [
  ...Object.values(SUBSCRIPTION_STATUS),
  ...Object.values(ACCESS_STATUS),
  ...Object.values(DELETION_STATUS),
  ...Object.values(SESSION_CHANNEL),
  ...Object.values(TURN_SPEAKER),
  ...Object.values(CONTROLLER_ACTION),
  ...Object.values(AUDIO_DIRECTION),
];

export type Sql = ReturnType<typeof createPostgres>;

export type MigrationRun = {
  applied: string[];
  skipped: string[];
  detail: string[];
};

const LEDGER_DDL = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    id text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )
`;

export function migrationsDir(): string {
  return join(repoRootFromHere(), "infra/migrations");
}

export async function listMigrationFiles(dir: string): Promise<string[]> {
  const names = await readdir(dir);
  return names.filter((name) => name.endsWith(".sql")).sort();
}

function assertMigrationsMatchSchema(bodies: string[]): void {
  const combined = bodies.join("\n");
  for (const value of SCHEMA_SQL_VALUES) {
    if (!combined.includes(`'${value}'`)) {
      throw new Error(
        `migrations are missing CHECK value '${value}' from schema.ts`,
      );
    }
  }
}

export async function applyMigrations(sql: Sql): Promise<MigrationRun> {
  const ledger = await sql`
    SELECT 1 AS n
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'schema_migrations'
  `;
  if (ledger.length === 0) {
    await sql.unsafe(LEDGER_DDL);
  }
  const dir = migrationsDir();
  const files = await listMigrationFiles(dir);
  if (files.length === 0) {
    throw new Error(`no .sql files in ${dir}`);
  }
  const bodies = await Promise.all(
    files.map((file) => readFile(join(dir, file), "utf8")),
  );
  assertMigrationsMatchSchema(bodies);
  const applied: string[] = [];
  const skipped: string[] = [];
  const detail: string[] = [];
  for (const [index, file] of files.entries()) {
    const existing = await sql`
      SELECT id FROM schema_migrations WHERE id = ${file}
    `;
    if (existing.length > 0) {
      skipped.push(file);
      detail.push(`${file} (already)`);
      continue;
    }
    const body = bodies[index];
    if (body === undefined) {
      throw new Error(`missing SQL body for ${file}`);
    }
    await sql.begin(async (tx) => {
      await tx.unsafe(body);
      await tx`INSERT INTO schema_migrations (id) VALUES (${file})`;
    });
    applied.push(file);
    detail.push(file);
  }
  return { applied, skipped, detail };
}

export function formatMigrationDetail(run: MigrationRun): string {
  return run.detail.join(", ");
}
