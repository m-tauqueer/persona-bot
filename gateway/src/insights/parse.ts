import { z } from "zod";
import { SESSION_CHANNEL } from "../schema.js";

export const LATENCY_COLUMNS = [
  "stt_ms",
  "brain_ms",
  "reframe_ms",
  "reframe_first_token_ms",
  "tts_first_byte_ms",
  "total_ms",
] as const;

export type LatencyColumn = (typeof LATENCY_COLUMNS)[number];

const latencyColumnSet = new Set<string>(LATENCY_COLUMNS);

export type RangeWindow =
  | { kind: "calendar" }
  | { kind: "duration_days"; days: number };

export type InsightsConfigFields = {
  INSIGHTS_PAGE_SIZE: number;
  INSIGHTS_MAX_PAGE_SIZE: number;
  INSIGHTS_RANGES: string;
  INSIGHTS_DEFAULT_RANGE: string;
  INSIGHTS_RANGE_WINDOWS: string;
  INSIGHTS_CALENDAR_WINDOW_SPEC: string;
  INSIGHTS_TIMEZONE: string;
  INSIGHTS_ACTIVITY_BUCKETS: string;
  INSIGHTS_DEFAULT_BUCKET: string;
  INSIGHTS_ERROR_REASONS: string;
  INSIGHTS_FIRST_WORD_COLUMNS: string;
  INSIGHTS_FIRST_WORD_REQUIRED_COLUMN: string;
  INSIGHTS_LATENCY_STAGES: string;
};

const dayCountSpec = /^(\d+)$/;

export function parseList(raw: string): string[] {
  return raw
    .split(/[,\s]+/)
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

export function parseRangeWindows(
  raw: string,
  calendarSpec: string,
): Map<string, RangeWindow> {
  const windows = new Map<string, RangeWindow>();
  for (const entry of parseList(raw)) {
    const splitAt = entry.indexOf(":");
    if (splitAt <= 0 || splitAt === entry.length - 1) {
      throw new Error(`Invalid insights range window: ${entry}`);
    }
    const id = entry.slice(0, splitAt).trim();
    const spec = entry.slice(splitAt + 1).trim();
    if (spec === calendarSpec) {
      windows.set(id, { kind: "calendar" });
      continue;
    }
    const days = spec.match(dayCountSpec);
    if (!days) {
      throw new Error(`Invalid insights range window: ${entry}`);
    }
    windows.set(id, { kind: "duration_days", days: Number(days[1]) });
  }
  return windows;
}

export function allowedValues(raw: string): Set<string> {
  return new Set(parseList(raw));
}

export function parseLatencyColumns(raw: string): LatencyColumn[] {
  const columns: LatencyColumn[] = [];
  for (const name of parseList(raw)) {
    if (!latencyColumnSet.has(name)) {
      throw new Error(`Unknown latency column: ${name}`);
    }
    columns.push(name as LatencyColumn);
  }
  if (columns.length === 0) {
    throw new Error("insights latency columns must not be empty");
  }
  return columns;
}

export function validateInsightsConfig(config: InsightsConfigFields): void {
  if (config.INSIGHTS_PAGE_SIZE > config.INSIGHTS_MAX_PAGE_SIZE) {
    throw new Error(
      "Invalid gateway environment: INSIGHTS_PAGE_SIZE must be <= INSIGHTS_MAX_PAGE_SIZE",
    );
  }
  const ranges = allowedValues(config.INSIGHTS_RANGES);
  if (ranges.size === 0) {
    throw new Error("Invalid gateway environment: INSIGHTS_RANGES is empty");
  }
  if (!ranges.has(config.INSIGHTS_DEFAULT_RANGE)) {
    throw new Error(
      "Invalid gateway environment: INSIGHTS_DEFAULT_RANGE must be listed in INSIGHTS_RANGES",
    );
  }
  const windows = parseRangeWindows(
    config.INSIGHTS_RANGE_WINDOWS,
    config.INSIGHTS_CALENDAR_WINDOW_SPEC,
  );
  for (const id of ranges) {
    if (!windows.has(id)) {
      throw new Error(
        `Invalid gateway environment: INSIGHTS_RANGE_WINDOWS missing ${id}`,
      );
    }
  }
  const buckets = allowedValues(config.INSIGHTS_ACTIVITY_BUCKETS);
  if (!buckets.has(config.INSIGHTS_DEFAULT_BUCKET)) {
    throw new Error(
      "Invalid gateway environment: INSIGHTS_DEFAULT_BUCKET must be listed in INSIGHTS_ACTIVITY_BUCKETS",
    );
  }
  if (parseList(config.INSIGHTS_ERROR_REASONS).length === 0) {
    throw new Error(
      "Invalid gateway environment: INSIGHTS_ERROR_REASONS is empty",
    );
  }
  const firstWord = parseLatencyColumns(config.INSIGHTS_FIRST_WORD_COLUMNS);
  const required = config.INSIGHTS_FIRST_WORD_REQUIRED_COLUMN;
  if (
    !latencyColumnSet.has(required) ||
    !firstWord.includes(required as LatencyColumn)
  ) {
    throw new Error(
      "Invalid gateway environment: INSIGHTS_FIRST_WORD_REQUIRED_COLUMN must be a first-word column",
    );
  }
  parseLatencyColumns(config.INSIGHTS_LATENCY_STAGES);
}

export function resolveRangeId(
  config: InsightsConfigFields,
  raw: string | undefined,
): { ok: true; id: string } | { ok: false } {
  if (raw === undefined || raw === "") {
    return { ok: true, id: config.INSIGHTS_DEFAULT_RANGE };
  }
  if (!allowedValues(config.INSIGHTS_RANGES).has(raw)) {
    return { ok: false };
  }
  return { ok: true, id: raw };
}

export function resolveBucket(
  config: InsightsConfigFields,
  raw: string | undefined,
): { ok: true; id: string } | { ok: false } {
  if (raw === undefined || raw === "") {
    return { ok: true, id: config.INSIGHTS_DEFAULT_BUCKET };
  }
  if (!allowedValues(config.INSIGHTS_ACTIVITY_BUCKETS).has(raw)) {
    return { ok: false };
  }
  return { ok: true, id: raw };
}

export function resolveChannel(
  raw: string | undefined,
): { ok: true; channel: string | null } | { ok: false } {
  if (raw === undefined || raw === "") {
    return { ok: true, channel: null };
  }
  const allowed = new Set<string>(Object.values(SESSION_CHANNEL));
  if (!allowed.has(raw)) {
    return { ok: false };
  }
  return { ok: true, channel: raw };
}

export function resolvePageSize(
  config: InsightsConfigFields,
  raw: string | undefined,
): { ok: true; limit: number } | { ok: false } {
  if (raw === undefined || raw === "") {
    return { ok: true, limit: config.INSIGHTS_PAGE_SIZE };
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return { ok: false };
  }
  return { ok: true, limit: Math.min(parsed, config.INSIGHTS_MAX_PAGE_SIZE) };
}

export function resolveUserId(
  raw: string | undefined,
): { ok: true; userId: string | null } | { ok: false } {
  if (raw === undefined || raw === "") {
    return { ok: true, userId: null };
  }
  const parsed = z.string().uuid().safeParse(raw);
  if (!parsed.success) {
    return { ok: false };
  }
  return { ok: true, userId: parsed.data };
}

const sessionCursorSchema = z.object({
  started_at: z.string().min(1),
  id: z.string().uuid(),
});

export type SessionCursor = {
  startedAt: Date;
  id: string;
};

export function encodeSessionCursor(row: {
  started_at: Date;
  id: string;
}): string {
  return Buffer.from(
    JSON.stringify({
      started_at: row.started_at.toISOString(),
      id: row.id,
    }),
    "utf8",
  ).toString("base64url");
}

export function decodeSessionCursor(raw: string): SessionCursor | null {
  try {
    const parsed = sessionCursorSchema.safeParse(
      JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as unknown,
    );
    if (!parsed.success) {
      return null;
    }
    const startedAt = new Date(parsed.data.started_at);
    if (Number.isNaN(startedAt.getTime())) {
      return null;
    }
    return { startedAt, id: parsed.data.id };
  } catch {
    return null;
  }
}

const userCursorSchema = z.object({
  last_seen_at: z.string().nullable(),
  id: z.string().uuid(),
});

export type UserCursor = {
  lastSeenAt: Date | null;
  id: string;
};

export function encodeUserCursor(row: {
  last_seen_at: Date | null;
  id: string;
}): string {
  return Buffer.from(
    JSON.stringify({
      last_seen_at: row.last_seen_at ? row.last_seen_at.toISOString() : null,
      id: row.id,
    }),
    "utf8",
  ).toString("base64url");
}

export function decodeUserCursor(raw: string): UserCursor | null {
  try {
    const parsed = userCursorSchema.safeParse(
      JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as unknown,
    );
    if (!parsed.success) {
      return null;
    }
    if (parsed.data.last_seen_at === null) {
      return { lastSeenAt: null, id: parsed.data.id };
    }
    const lastSeenAt = new Date(parsed.data.last_seen_at);
    if (Number.isNaN(lastSeenAt.getTime())) {
      return null;
    }
    return { lastSeenAt, id: parsed.data.id };
  } catch {
    return null;
  }
}
