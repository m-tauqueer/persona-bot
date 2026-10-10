import type postgres from "postgres";
import { type GatewayConfig, isOwnerEmail } from "../config.js";
import { asJsonArray, asJsonValue } from "../json.js";
import { TURN_SPEAKER } from "../schema.js";
import {
  type LatencyColumn,
  type SessionCursor,
  type UserCursor,
  encodeSessionCursor,
  encodeUserCursor,
  parseLatencyColumns,
  parseList,
  parseRangeWindows,
} from "./parse.js";
import {
  sessionDetailPublishedOnly,
  sessionDetailScope,
  sessionListScope,
} from "./scope.js";
import type {
  ActivitySeries,
  BudgetModeRow,
  InsightsUserList,
  LatencyByBrainMode,
  LatencyReport,
  LatestTrace,
  OwnerOverview,
  PersonalOverview,
  SessionDetail,
  SessionList,
  SessionListItem,
  SessionTurn,
  StagePercentiles,
  TurnAudio,
  TurnLatency,
} from "./types.js";

type Sql = ReturnType<typeof postgres>;

function rangeWindow(config: GatewayConfig, rangeId: string) {
  const windows = parseRangeWindows(
    config.INSIGHTS_RANGE_WINDOWS,
    config.INSIGHTS_CALENDAR_WINDOW_SPEC,
  );
  const window = windows.get(rangeId);
  if (!window) {
    throw new Error(`insights range window missing for ${rangeId}`);
  }
  return window;
}

function sessionInRange(sql: Sql, config: GatewayConfig, rangeId: string) {
  const window = rangeWindow(config, rangeId);
  if (window.kind === "calendar") {
    return sql`(
      s.started_at >= (
        date_trunc(
          'day',
          timezone(${config.INSIGHTS_TIMEZONE}, clock_timestamp())
        ) AT TIME ZONE ${config.INSIGHTS_TIMEZONE}
      )
    )`;
  }
  return sql`(
    s.started_at >= clock_timestamp() - (${window.days} * interval '1 day')
  )`;
}

function latencyIdent(sql: Sql, column: LatencyColumn) {
  switch (column) {
    case "stt_ms":
      return sql`l.stt_ms`;
    case "brain_ms":
      return sql`l.brain_ms`;
    case "reframe_ms":
      return sql`l.reframe_ms`;
    case "reframe_first_token_ms":
      return sql`l.reframe_first_token_ms`;
    case "tts_first_byte_ms":
      return sql`l.tts_first_byte_ms`;
    case "total_ms":
      return sql`l.total_ms`;
  }
}

function firstWordExpr(sql: Sql, config: GatewayConfig) {
  const columns = parseLatencyColumns(config.INSIGHTS_FIRST_WORD_COLUMNS);
  const parts = columns.map(
    (column) => sql`COALESCE(${latencyIdent(sql, column)}, 0)`,
  );
  return parts.reduce((left, right) => sql`(${left} + ${right})`);
}

function firstWordPresent(sql: Sql, config: GatewayConfig) {
  return sql`${latencyIdent(
    sql,
    config.INSIGHTS_FIRST_WORD_REQUIRED_COLUMN as LatencyColumn,
  )} IS NOT NULL`;
}

function errorTurnFilter(sql: Sql, config: GatewayConfig) {
  const reasons = parseList(config.INSIGHTS_ERROR_REASONS);
  return sql`(
    t.speaker = ${TURN_SPEAKER.USER}
    AND t.controller_reasons IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM jsonb_array_elements_text(t.controller_reasons) AS reason
      WHERE reason = ANY(${reasons})
    )
  )`;
}

function sessionBrainMode(sql: Sql, config: GatewayConfig) {
  return sql`
    CASE
      WHEN count(DISTINCT t.brain_mode) FILTER (WHERE t.brain_mode IS NOT NULL) = 0
        THEN ${config.INSIGHTS_BRAIN_MODE_UNRECORDED}
      WHEN count(DISTINCT t.brain_mode) FILTER (WHERE t.brain_mode IS NOT NULL) = 1
        THEN min(t.brain_mode) FILTER (WHERE t.brain_mode IS NOT NULL)
      ELSE ${config.INSIGHTS_BRAIN_MODE_MIXED}
    END
  `;
}

function asIso(value: Date | string | null): string | null {
  if (value === null) {
    return null;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function asCount(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function asPercentile(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function asReasonList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}

export async function personalOverview(
  sql: Sql,
  userId: string,
): Promise<PersonalOverview> {
  const [row] = await sql<
    {
      sessions: number;
      turns: number;
      last_activity_at: Date | null;
      last_session_id: string | null;
    }[]
  >`
    SELECT
      (SELECT count(*)::int FROM sessions s WHERE s.user_id = ${userId}) AS sessions,
      (
        SELECT count(*)::int
        FROM turns t
        INNER JOIN sessions s ON s.id = t.session_id
        WHERE s.user_id = ${userId}
      ) AS turns,
      (
        SELECT max(s.started_at)
        FROM sessions s
        WHERE s.user_id = ${userId}
      ) AS last_activity_at,
      (
        SELECT s.id
        FROM sessions s
        WHERE s.user_id = ${userId}
        ORDER BY s.started_at DESC, s.id DESC
        LIMIT 1
      ) AS last_session_id
  `;
  return {
    sessions: asCount(row?.sessions),
    turns: asCount(row?.turns),
    last_activity_at: asIso(row?.last_activity_at ?? null),
    last_session_id: row?.last_session_id ?? null,
  };
}

export async function ownerOverview(
  sql: Sql,
  config: GatewayConfig,
  rangeId: string,
): Promise<OwnerOverview> {
  const inRange = sessionInRange(sql, config, rangeId);
  const firstWord = firstWordExpr(sql, config);
  const spoke = firstWordPresent(sql, config);
  const errored = errorTurnFilter(sql, config);
  const [counts] = await sql<
    {
      sessions: number;
      turns: number;
      active_users: number;
      median_first_word_ms: number | null;
      p90_first_word_ms: number | null;
      user_turns: number;
      error_turns: number;
    }[]
  >`
    SELECT
      (SELECT count(*)::int FROM sessions s WHERE ${inRange}) AS sessions,
      (
        SELECT count(*)::int
        FROM turns t
        INNER JOIN sessions s ON s.id = t.session_id
        WHERE ${inRange}
      ) AS turns,
      (
        SELECT count(DISTINCT s.user_id)::int
        FROM sessions s
        WHERE ${inRange}
      ) AS active_users,
      (
        SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY ${firstWord})
        FROM latency_spans l
        INNER JOIN turns t ON t.id = l.turn_id
        INNER JOIN sessions s ON s.id = t.session_id
        WHERE ${inRange} AND ${spoke}
      ) AS median_first_word_ms,
      (
        SELECT percentile_cont(0.9) WITHIN GROUP (ORDER BY ${firstWord})
        FROM latency_spans l
        INNER JOIN turns t ON t.id = l.turn_id
        INNER JOIN sessions s ON s.id = t.session_id
        WHERE ${inRange} AND ${spoke}
      ) AS p90_first_word_ms,
      (
        SELECT count(*)::int
        FROM turns t
        INNER JOIN sessions s ON s.id = t.session_id
        WHERE ${inRange} AND t.speaker = ${TURN_SPEAKER.USER}
      ) AS user_turns,
      (
        SELECT count(*)::int
        FROM turns t
        INNER JOIN sessions s ON s.id = t.session_id
        WHERE ${inRange} AND ${errored}
      ) AS error_turns
  `;
  const split = await sql<{ brain_mode: string; turns: number }[]>`
    SELECT
      COALESCE(t.brain_mode, ${config.INSIGHTS_BRAIN_MODE_UNRECORDED}) AS brain_mode,
      count(*)::int AS turns
    FROM turns t
    INNER JOIN sessions s ON s.id = t.session_id
    WHERE ${inRange}
    GROUP BY 1
    ORDER BY 1
  `;
  const userTurns = asCount(counts?.user_turns);
  const errorTurns = asCount(counts?.error_turns);
  return {
    range: rangeId,
    sessions: asCount(counts?.sessions),
    turns: asCount(counts?.turns),
    active_users: asCount(counts?.active_users),
    median_first_word_ms: asPercentile(counts?.median_first_word_ms),
    p90_first_word_ms: asPercentile(counts?.p90_first_word_ms),
    error_rate: userTurns === 0 ? 0 : errorTurns / userTurns,
    brain_mode_split: split.map((row) => ({
      brain_mode: row.brain_mode,
      turns: asCount(row.turns),
    })),
    latency_budget_first_word_ms: config.LATENCY_BUDGET_FIRST_WORD_MS,
  };
}

type SessionListRow = {
  id: string;
  user_id: string;
  user_email: string;
  channel: string;
  started_at: Date;
  ended_at: Date | null;
  duration_ms: number | null;
  turn_count: number;
  brain_mode: string;
};

function mapSessionListItem(row: SessionListRow): SessionListItem {
  return {
    id: row.id,
    user_id: row.user_id,
    user_email: row.user_email,
    channel: row.channel,
    started_at: asIso(row.started_at) ?? row.started_at.toISOString(),
    ended_at: asIso(row.ended_at),
    duration_ms: row.duration_ms === null ? null : asCount(row.duration_ms),
    turn_count: asCount(row.turn_count),
    ended: row.ended_at !== null,
    brain_mode: row.brain_mode,
  };
}

async function listSessions(
  sql: Sql,
  config: GatewayConfig,
  args: {
    rangeId: string;
    limit: number;
    cursor: SessionCursor | null;
    userId: string | null;
    channel: string | null;
    scopeUserId: string | null;
    personaId: string;
  },
): Promise<SessionList> {
  const inRange = sessionInRange(sql, config, args.rangeId);
  const ownerScope = args.scopeUserId
    ? sql`AND s.user_id = ${args.scopeUserId}`
    : sql``;
  const userFilter = args.userId ? sql`AND s.user_id = ${args.userId}` : sql``;
  const channelFilter = args.channel
    ? sql`AND s.channel = ${args.channel}`
    : sql``;
  const personaFilter = sql`AND s.persona_id = ${args.personaId}`;
  const cursorFilter = args.cursor
    ? sql`AND (s.started_at, s.id) < (${args.cursor.startedAt}, ${args.cursor.id}::uuid)`
    : sql``;
  const brainMode = sessionBrainMode(sql, config);
  const rows = await sql<SessionListRow[]>`
    SELECT
      s.id,
      s.user_id,
      u.email AS user_email,
      s.channel,
      s.started_at,
      s.ended_at,
      CASE
        WHEN s.ended_at IS NULL THEN NULL
        ELSE (EXTRACT(EPOCH FROM (s.ended_at - s.started_at)) * 1000)::bigint
      END AS duration_ms,
      count(t.id)::int AS turn_count,
      ${brainMode} AS brain_mode
    FROM sessions s
    INNER JOIN users u ON u.id = s.user_id
    LEFT JOIN turns t ON t.session_id = s.id
    WHERE ${inRange}
      ${ownerScope}
      ${userFilter}
      ${channelFilter}
      ${personaFilter}
      ${cursorFilter}
    GROUP BY s.id, u.email
    ORDER BY s.started_at DESC, s.id DESC
    LIMIT ${args.limit + 1}
  `;
  const page = rows.slice(0, args.limit);
  const extra = rows[args.limit];
  const last = page[page.length - 1];
  return {
    range: args.rangeId,
    sessions: page.map(mapSessionListItem),
    next_cursor: extra && last ? encodeSessionCursor(last) : null,
  };
}

export async function personalSessions(
  sql: Sql,
  config: GatewayConfig,
  userId: string,
  args: {
    rangeId: string;
    limit: number;
    cursor: SessionCursor | null;
    personaId: string;
  },
): Promise<SessionList> {
  return listSessions(sql, config, {
    ...args,
    channel: null,
    ...sessionListScope({ viewerUserId: userId, ownerView: false }),
  });
}

export async function ownerSessions(
  sql: Sql,
  config: GatewayConfig,
  args: {
    rangeId: string;
    limit: number;
    cursor: SessionCursor | null;
    userId: string | null;
    channel: string | null;
    personaId: string;
  },
): Promise<SessionList> {
  return listSessions(sql, config, {
    ...args,
    ...sessionListScope({
      viewerUserId: "",
      ownerView: true,
      filterUserId: args.userId,
    }),
  });
}

function mapLatency(row: {
  stt_ms: number | null;
  brain_ms: number | null;
  reframe_ms: number | null;
  reframe_first_token_ms: number | null;
  tts_first_byte_ms: number | null;
  total_ms: number | null;
  transport_latency: unknown;
}): TurnLatency | null {
  if (
    row.stt_ms === null &&
    row.brain_ms === null &&
    row.reframe_ms === null &&
    row.reframe_first_token_ms === null &&
    row.tts_first_byte_ms === null &&
    row.total_ms === null &&
    row.transport_latency === null
  ) {
    return null;
  }
  return {
    stt_ms: row.stt_ms,
    brain_ms: row.brain_ms,
    reframe_ms: row.reframe_ms,
    reframe_first_token_ms: row.reframe_first_token_ms,
    tts_first_byte_ms: row.tts_first_byte_ms,
    total_ms: row.total_ms,
    transport_latency: asJsonValue(row.transport_latency),
  };
}

async function sessionDetail(
  sql: Sql,
  sessionId: string,
  scopeUserId: string | null,
  publishedOnly: boolean,
): Promise<SessionDetail | null> {
  const ownerScope = scopeUserId ? sql`AND s.user_id = ${scopeUserId}` : sql``;
  const publishedScope = publishedOnly
    ? sql`AND EXISTS (
        SELECT 1 FROM personas p
        WHERE p.id = s.persona_id AND p.published = true
      )`
    : sql``;
  const [session] = await sql<
    {
      id: string;
      user_id: string;
      user_email: string;
      persona_id: string;
      engram_session_id: string | null;
      channel: string;
      started_at: Date;
      ended_at: Date | null;
    }[]
  >`
    SELECT
      s.id,
      s.user_id,
      u.email AS user_email,
      s.persona_id,
      s.engram_session_id,
      s.channel,
      s.started_at,
      s.ended_at
    FROM sessions s
    INNER JOIN users u ON u.id = s.user_id
    WHERE s.id = ${sessionId}
      ${ownerScope}
      ${publishedScope}
  `;
  if (!session) {
    return null;
  }
  const turns = await sql<
    {
      id: string;
      ordinal: number;
      speaker: string;
      text: string;
      messages: unknown;
      controller_action: string | null;
      controller_reasons: unknown;
      stt_meta: unknown;
      tts_meta: unknown;
      brain_mode: string | null;
      correlation_id: string | null;
      created_at: Date;
      stt_ms: number | null;
      brain_ms: number | null;
      reframe_ms: number | null;
      reframe_first_token_ms: number | null;
      tts_first_byte_ms: number | null;
      total_ms: number | null;
      transport_latency: unknown;
      memories_used: unknown;
      memory_session_id: string | null;
    }[]
  >`
    SELECT
      t.id,
      t.ordinal,
      t.speaker,
      t.text,
      t.messages,
      t.controller_action,
      t.controller_reasons,
      t.stt_meta,
      t.tts_meta,
      t.brain_mode,
      t.correlation_id,
      t.created_at,
      l.stt_ms,
      l.brain_ms,
      l.reframe_ms,
      l.reframe_first_token_ms,
      l.tts_first_byte_ms,
      l.total_ms,
      l.transport_latency,
      m.memories_used,
      m.engram_session_id AS memory_session_id
    FROM turns t
    INNER JOIN sessions s ON s.id = t.session_id
    LEFT JOIN latency_spans l ON l.turn_id = t.id
    LEFT JOIN memory_refs m ON m.turn_id = t.id
    WHERE t.session_id = ${sessionId}
      ${ownerScope}
    ORDER BY t.ordinal
  `;
  const audioRows = await sql<
    {
      turn_id: string;
      direction: string;
      blob_url: string;
      duration_ms: number | null;
      format: string | null;
      size_bytes: number | null;
    }[]
  >`
    SELECT a.turn_id, a.direction, a.blob_url, a.duration_ms, a.format, a.size_bytes
    FROM audio_assets a
    INNER JOIN turns t ON t.id = a.turn_id
    INNER JOIN sessions s ON s.id = t.session_id
    WHERE t.session_id = ${sessionId}
      ${ownerScope}
    ORDER BY t.ordinal, a.direction
  `;
  const audioByTurn = new Map<string, TurnAudio[]>();
  for (const row of audioRows) {
    const list = audioByTurn.get(row.turn_id) ?? [];
    list.push({
      direction: row.direction,
      blob_url: row.blob_url,
      duration_ms: row.duration_ms,
      format: row.format,
      size_bytes: row.size_bytes === null ? null : asCount(row.size_bytes),
    });
    audioByTurn.set(row.turn_id, list);
  }
  const mapped: SessionTurn[] = turns.map((row) => ({
    id: row.id,
    ordinal: row.ordinal,
    speaker: row.speaker,
    text: row.text,
    messages: asJsonArray(row.messages),
    controller_action: row.controller_action,
    controller_reasons: asReasonList(row.controller_reasons),
    stt_meta: asJsonValue(row.stt_meta),
    tts_meta: asJsonValue(row.tts_meta),
    brain_mode: row.brain_mode,
    correlation_id: row.correlation_id,
    created_at: asIso(row.created_at) ?? row.created_at.toISOString(),
    latency: mapLatency(row),
    memory:
      row.memory_session_id === null
        ? null
        : {
            memories_used: asJsonArray(row.memories_used),
            engram_session_id: row.memory_session_id,
          },
    audio: audioByTurn.get(row.id) ?? [],
  }));
  return {
    id: session.id,
    user_id: session.user_id,
    user_email: session.user_email,
    persona_id: session.persona_id,
    engram_session_id: session.engram_session_id,
    channel: session.channel,
    started_at: asIso(session.started_at) ?? session.started_at.toISOString(),
    ended_at: asIso(session.ended_at),
    turns: mapped,
  };
}

export async function personalSessionDetail(
  sql: Sql,
  sessionId: string,
  userId: string,
): Promise<SessionDetail | null> {
  return sessionDetail(
    sql,
    sessionId,
    sessionDetailScope(false, userId),
    sessionDetailPublishedOnly(false),
  );
}

export async function ownerSessionDetail(
  sql: Sql,
  sessionId: string,
): Promise<SessionDetail | null> {
  return sessionDetail(
    sql,
    sessionId,
    sessionDetailScope(true, ""),
    sessionDetailPublishedOnly(true),
  );
}

export async function ownerActivity(
  sql: Sql,
  config: GatewayConfig,
  rangeId: string,
  bucket: string,
): Promise<ActivitySeries> {
  const inRange = sessionInRange(sql, config, rangeId);
  const rows = await sql<
    { bucket_start: Date; sessions: number; turns: number }[]
  >`
    SELECT
      (
        date_trunc(
          ${bucket},
          timezone(${config.INSIGHTS_TIMEZONE}, s.started_at)
        ) AT TIME ZONE ${config.INSIGHTS_TIMEZONE}
      ) AS bucket_start,
      count(DISTINCT s.id)::int AS sessions,
      count(t.id)::int AS turns
    FROM sessions s
    LEFT JOIN turns t ON t.session_id = s.id
    WHERE ${inRange}
    GROUP BY 1
    ORDER BY 1
  `;
  return {
    range: rangeId,
    bucket,
    points: rows.map((row) => ({
      bucket_start: asIso(row.bucket_start) ?? row.bucket_start.toISOString(),
      sessions: asCount(row.sessions),
      turns: asCount(row.turns),
    })),
  };
}

function mapStages(
  row: Record<string, unknown>,
  stages: LatencyColumn[],
): StagePercentiles[] {
  return stages.map((stage) => ({
    stage,
    p50: asPercentile(row[`${stage}_p50`]),
    p90: asPercentile(row[`${stage}_p90`]),
  }));
}

function joinSql(
  sql: Sql,
  fragments: readonly postgres.Fragment[],
): postgres.Fragment {
  const [first, ...rest] = fragments;
  if (!first) {
    throw new Error("insights select fragments must not be empty");
  }
  return rest.reduce((left, right) => sql`${left}, ${right}`, first);
}

export async function ownerLatency(
  sql: Sql,
  config: GatewayConfig,
  rangeId: string,
): Promise<LatencyReport> {
  const inRange = sessionInRange(sql, config, rangeId);
  const firstWord = firstWordExpr(sql, config);
  const spoke = firstWordPresent(sql, config);
  const stages = parseLatencyColumns(config.INSIGHTS_LATENCY_STAGES);
  const stageSelect = joinSql(
    sql,
    stages.flatMap((stage) => [
      sql`percentile_cont(0.5) WITHIN GROUP (ORDER BY ${latencyIdent(sql, stage)})
      FILTER (WHERE ${latencyIdent(sql, stage)} IS NOT NULL) AS ${sql(`${stage}_p50`)}`,
      sql`percentile_cont(0.9) WITHIN GROUP (ORDER BY ${latencyIdent(sql, stage)})
      FILTER (WHERE ${latencyIdent(sql, stage)} IS NOT NULL) AS ${sql(`${stage}_p90`)}`,
    ]),
  );
  const [overall] = await sql<Record<string, unknown>[]>`
    SELECT
      percentile_cont(0.5) WITHIN GROUP (ORDER BY ${firstWord})
        FILTER (WHERE ${spoke}) AS first_word_p50,
      percentile_cont(0.9) WITHIN GROUP (ORDER BY ${firstWord})
        FILTER (WHERE ${spoke}) AS first_word_p90,
      ${stageSelect}
    FROM latency_spans l
    INNER JOIN turns t ON t.id = l.turn_id
    INNER JOIN sessions s ON s.id = t.session_id
    WHERE ${inRange}
  `;
  const byMode = await sql<Record<string, unknown>[]>`
    SELECT
      COALESCE(t.brain_mode, ${config.INSIGHTS_BRAIN_MODE_UNRECORDED}) AS brain_mode,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY ${firstWord})
        FILTER (WHERE ${spoke}) AS first_word_p50,
      percentile_cont(0.9) WITHIN GROUP (ORDER BY ${firstWord})
        FILTER (WHERE ${spoke}) AS first_word_p90,
      ${stageSelect}
    FROM latency_spans l
    INNER JOIN turns t ON t.id = l.turn_id
    INNER JOIN sessions s ON s.id = t.session_id
    WHERE ${inRange}
    GROUP BY 1
    ORDER BY 1
  `;
  const by_brain_mode: LatencyByBrainMode[] = byMode.map((row) => ({
    brain_mode: String(row.brain_mode),
    first_word: {
      p50: asPercentile(row.first_word_p50),
      p90: asPercentile(row.first_word_p90),
    },
    stages: mapStages(row, stages),
  }));
  return {
    range: rangeId,
    budget_first_word_ms: config.LATENCY_BUDGET_FIRST_WORD_MS,
    first_word: {
      p50: asPercentile(overall?.first_word_p50),
      p90: asPercentile(overall?.first_word_p90),
    },
    stages: overall ? mapStages(overall, stages) : [],
    by_brain_mode,
  };
}

export async function ownerUsers(
  sql: Sql,
  config: GatewayConfig,
  args: { limit: number; cursor: UserCursor | null },
): Promise<InsightsUserList> {
  const cursorTs = args.cursor?.lastSeenAt ?? null;
  const cursorFilter = args.cursor
    ? sql`AND (
        COALESCE(last_seen.last_seen_at, '-infinity'::timestamptz),
        u.id
      ) < (
        COALESCE(${cursorTs}, '-infinity'::timestamptz),
        ${args.cursor.id}::uuid
      )`
    : sql``;
  const rows = await sql<
    {
      id: string;
      email: string;
      created_at: Date;
      session_count: number;
      last_seen_at: Date | null;
      subscription_status: string | null;
      access_request_id: string | null;
      access_status: string | null;
    }[]
  >`
    SELECT
      u.id,
      u.email,
      u.created_at,
      COALESCE(counts.session_count, 0)::int AS session_count,
      last_seen.last_seen_at,
      sub.status AS subscription_status,
      access.id AS access_request_id,
      access.status AS access_status
    FROM users u
    LEFT JOIN LATERAL (
      SELECT count(*)::int AS session_count
      FROM sessions s
      WHERE s.user_id = u.id
    ) counts ON true
    LEFT JOIN LATERAL (
      SELECT max(s.started_at) AS last_seen_at
      FROM sessions s
      WHERE s.user_id = u.id
    ) last_seen ON true
    LEFT JOIN LATERAL (
      SELECT sub.status
      FROM subscriptions sub
      WHERE sub.user_id = u.id
      ORDER BY sub.created_at DESC
      LIMIT 1
    ) sub ON true
    LEFT JOIN access_requests access ON access.google_sub = u.google_sub
    WHERE true
      ${cursorFilter}
    ORDER BY
      COALESCE(last_seen.last_seen_at, '-infinity'::timestamptz) DESC,
      u.id DESC
    LIMIT ${args.limit + 1}
  `;
  const page = rows.slice(0, args.limit);
  const extra = rows[args.limit];
  const last = page[page.length - 1];
  return {
    users: page.map((row) => ({
      id: row.id,
      email: row.email,
      created_at: asIso(row.created_at) ?? row.created_at.toISOString(),
      session_count: asCount(row.session_count),
      last_seen_at: asIso(row.last_seen_at),
      subscription_status: row.subscription_status,
      access_request_id: row.access_request_id,
      access_status: row.access_status,
      owner: isOwnerEmail(row.email, config),
    })),
    next_cursor: extra && last ? encodeUserCursor(last) : null,
  };
}

export async function budgetByBrainMode(
  sql: Sql,
  config: GatewayConfig,
): Promise<BudgetModeRow[]> {
  const firstWord = firstWordExpr(sql, config);
  const spoke = firstWordPresent(sql, config);
  const hours = config.LATENCY_BUDGET_WINDOW_HOURS;
  const rows = await sql<
    {
      brain_mode: string;
      samples: number;
      p50: number | null;
      p90: number | null;
    }[]
  >`
    SELECT
      COALESCE(t.brain_mode, ${config.INSIGHTS_BRAIN_MODE_UNRECORDED}) AS brain_mode,
      count(*)::int AS samples,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY ${firstWord}) AS p50,
      percentile_cont(0.9) WITHIN GROUP (ORDER BY ${firstWord}) AS p90
    FROM latency_spans l
    INNER JOIN turns t ON t.id = l.turn_id
    WHERE t.created_at >= clock_timestamp() - (${hours} * interval '1 hour')
      AND ${spoke}
    GROUP BY 1
    ORDER BY 1
  `;
  return rows.map((row) => ({
    brain_mode: row.brain_mode,
    samples: asCount(row.samples),
    p50: asPercentile(row.p50),
    p90: asPercentile(row.p90),
  }));
}

export async function latestTracedTurn(sql: Sql): Promise<LatestTrace | null> {
  const [row] = await sql<
    {
      id: string;
      correlation_id: string;
      session_id: string;
      created_at: Date;
    }[]
  >`
    SELECT t.id, t.correlation_id, t.session_id, t.created_at
    FROM turns t
    WHERE t.correlation_id IS NOT NULL
    ORDER BY t.created_at DESC, t.id DESC
    LIMIT 1
  `;
  if (!row) {
    return null;
  }
  return {
    turn_id: row.id,
    correlation_id: row.correlation_id,
    session_id: row.session_id,
    created_at: asIso(row.created_at) ?? row.created_at.toISOString(),
  };
}
