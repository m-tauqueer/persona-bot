export type QuotaLimits = {
  turnsPerDay: number;
  voiceMinutesPerDay: number;
  timezone: string;
  warnRatio: number;
};

export type QuotaEnv = {
  QUOTA_TURNS_PER_DAY: number;
  QUOTA_VOICE_MINUTES_PER_DAY: number;
  QUOTA_TIMEZONE: string;
  QUOTA_WARN_RATIO: number;
};

export function isValidQuotaTimezone(timezone: string): boolean {
  if (timezone.length === 0) {
    return false;
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

export function envQuotaLimits(config: QuotaEnv): QuotaLimits {
  return {
    turnsPerDay: config.QUOTA_TURNS_PER_DAY,
    voiceMinutesPerDay: config.QUOTA_VOICE_MINUTES_PER_DAY,
    timezone: config.QUOTA_TIMEZONE,
    warnRatio: config.QUOTA_WARN_RATIO,
  };
}

export function resolveQuotaLimits(
  stored: QuotaLimits | null,
  fallback: QuotaLimits,
): QuotaLimits {
  return stored ?? fallback;
}

export type ParseQuotaBodyResult =
  | { ok: true; limits: QuotaLimits }
  | { ok: false; reason: "invalid" | "timezone" };

export function parseQuotaSettingsBody(raw: unknown): ParseQuotaBodyResult {
  if (!raw || typeof raw !== "object") {
    return { ok: false, reason: "invalid" };
  }
  const body = raw as Record<string, unknown>;
  const turns = body.turns_per_day;
  const minutes = body.voice_minutes_per_day;
  const timezone = body.timezone;
  const ratio = body.warn_ratio;
  if (typeof turns !== "number" || !Number.isInteger(turns) || turns < 0) {
    return { ok: false, reason: "invalid" };
  }
  if (typeof minutes !== "number" || !Number.isFinite(minutes) || minutes < 0) {
    return { ok: false, reason: "invalid" };
  }
  if (typeof timezone !== "string" || timezone.trim().length === 0) {
    return { ok: false, reason: "invalid" };
  }
  if (
    typeof ratio !== "number" ||
    !Number.isFinite(ratio) ||
    ratio < 0 ||
    ratio > 1
  ) {
    return { ok: false, reason: "invalid" };
  }
  const tz = timezone.trim();
  if (!isValidQuotaTimezone(tz)) {
    return { ok: false, reason: "timezone" };
  }
  return {
    ok: true,
    limits: {
      turnsPerDay: turns,
      voiceMinutesPerDay: minutes,
      timezone: tz,
      warnRatio: ratio,
    },
  };
}

export function quotaSettingsPayload(
  limits: QuotaLimits,
  source: string,
): {
  turns_per_day: number;
  voice_minutes_per_day: number;
  timezone: string;
  warn_ratio: number;
  source: string;
} {
  return {
    turns_per_day: limits.turnsPerDay,
    voice_minutes_per_day: limits.voiceMinutesPerDay,
    timezone: limits.timezone,
    warn_ratio: limits.warnRatio,
    source,
  };
}
