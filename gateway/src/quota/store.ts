import type postgres from "postgres";
import type { GatewayConfig } from "../config.js";
import { SESSION_CHANNEL, TURN_SPEAKER } from "../schema.js";
import { firstQuotaHit, quotaShouldWarn } from "./decision.js";
import {
  type QuotaLimits,
  envQuotaLimits,
  resolveQuotaLimits,
} from "./settings.js";

type Sql = ReturnType<typeof postgres>;

export type QuotaUsage = {
  turnsUsed: number;
  minutesUsed: number;
  resetAt: Date;
};

export type QuotaRefusal = {
  error: string;
  code: string;
  reset_at: string;
};

export async function loadQuotaSettings(sql: Sql): Promise<QuotaLimits | null> {
  const rows = await sql<
    {
      turns_per_day: number;
      voice_minutes_per_day: number;
      timezone: string;
      warn_ratio: number;
    }[]
  >`
    SELECT turns_per_day, voice_minutes_per_day, timezone, warn_ratio
    FROM quota_settings
    WHERE singleton
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) {
    return null;
  }
  return {
    turnsPerDay: Number(row.turns_per_day),
    voiceMinutesPerDay: Number(row.voice_minutes_per_day),
    timezone: row.timezone,
    warnRatio: Number(row.warn_ratio),
  };
}

export async function saveQuotaSettings(
  sql: Sql,
  limits: QuotaLimits,
  actorId: string,
): Promise<QuotaLimits> {
  await sql`
    INSERT INTO quota_settings (
      singleton,
      turns_per_day,
      voice_minutes_per_day,
      timezone,
      warn_ratio,
      updated_at,
      updated_by
    ) VALUES (
      true,
      ${limits.turnsPerDay},
      ${limits.voiceMinutesPerDay},
      ${limits.timezone},
      ${limits.warnRatio},
      now(),
      ${actorId}::uuid
    )
    ON CONFLICT (singleton) DO UPDATE SET
      turns_per_day = EXCLUDED.turns_per_day,
      voice_minutes_per_day = EXCLUDED.voice_minutes_per_day,
      timezone = EXCLUDED.timezone,
      warn_ratio = EXCLUDED.warn_ratio,
      updated_at = now(),
      updated_by = EXCLUDED.updated_by
  `;
  return limits;
}

export async function resolveLiveQuotaLimits(
  sql: Sql,
  config: GatewayConfig,
): Promise<QuotaLimits> {
  return resolveQuotaLimits(
    await loadQuotaSettings(sql),
    envQuotaLimits(config),
  );
}

export async function loadQuotaUsage(
  sql: Sql,
  userId: string,
  limits: QuotaLimits,
): Promise<QuotaUsage> {
  const tz = limits.timezone;
  const window = await sql<{ window_start: Date; reset_at: Date }[]>`
    SELECT
      (date_trunc('day', timezone(${tz}, now())) AT TIME ZONE ${tz}) AS window_start,
      (
        date_trunc('day', timezone(${tz}, now())) AT TIME ZONE ${tz}
        + interval '1 day'
      ) AS reset_at
  `;
  const bounds = window[0];
  if (!bounds) {
    throw new Error("quota window query returned no row");
  }
  const start = bounds.window_start;
  const resetAt = bounds.reset_at;
  const turns = await sql<{ turns_used: number }[]>`
    SELECT count(*)::int AS turns_used
    FROM turns t
    INNER JOIN sessions s ON s.id = t.session_id
    WHERE s.user_id = ${userId}
      AND t.speaker = ${TURN_SPEAKER.USER}
      AND t.created_at >= ${start}
      AND t.created_at < ${resetAt}
  `;
  const minutes = await sql<{ minutes_used: number }[]>`
    SELECT COALESCE(
      SUM(
        GREATEST(
          0,
          EXTRACT(
            EPOCH FROM (
              LEAST(COALESCE(s.ended_at, now()), ${resetAt})
              - GREATEST(s.started_at, ${start})
            )
          )
        )
      ),
      0
    ) / 60.0 AS minutes_used
    FROM sessions s
    WHERE s.user_id = ${userId}
      AND s.channel = ${SESSION_CHANNEL.VOICE}
      AND s.started_at < ${resetAt}
      AND COALESCE(s.ended_at, now()) > ${start}
  `;
  return {
    turnsUsed: Number(turns[0]?.turns_used ?? 0),
    minutesUsed: Number(minutes[0]?.minutes_used ?? 0),
    resetAt,
  };
}

export function quotaRefusal(
  config: GatewayConfig,
  usage: QuotaUsage,
  limits: QuotaLimits,
): QuotaRefusal | null {
  const hit = firstQuotaHit({
    turnsUsed: usage.turnsUsed,
    turnsLimit: limits.turnsPerDay,
    turnsKind: config.QUOTA_KIND_TURNS,
    minutesUsed: usage.minutesUsed,
    minutesLimit: limits.voiceMinutesPerDay,
    minutesKind: config.QUOTA_KIND_MINUTES,
  });
  if (!hit) {
    return null;
  }
  const resetAt = usage.resetAt.toISOString();
  if (hit === config.QUOTA_KIND_TURNS) {
    return {
      error: config.QUOTA_ERROR_TURNS,
      code: config.QUOTA_CODE_TURNS,
      reset_at: resetAt,
    };
  }
  return {
    error: config.QUOTA_ERROR_MINUTES,
    code: config.QUOTA_CODE_MINUTES,
    reset_at: resetAt,
  };
}

export function quotaWarnKinds(
  config: GatewayConfig,
  usage: QuotaUsage,
  limits: QuotaLimits,
): string[] {
  const kinds: string[] = [];
  if (quotaShouldWarn(usage.turnsUsed, limits.turnsPerDay, limits.warnRatio)) {
    kinds.push(config.QUOTA_KIND_TURNS);
  }
  if (
    quotaShouldWarn(
      usage.minutesUsed,
      limits.voiceMinutesPerDay,
      limits.warnRatio,
    )
  ) {
    kinds.push(config.QUOTA_KIND_MINUTES);
  }
  return kinds;
}
