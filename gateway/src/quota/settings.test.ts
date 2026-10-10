import { describe, expect, it } from "vitest";
import {
  envQuotaLimits,
  parseQuotaSettingsBody,
  quotaSettingsPayload,
  resolveQuotaLimits,
} from "./settings.js";

const fallback = {
  turnsPerDay: 200,
  voiceMinutesPerDay: 60,
  timezone: "UTC",
  warnRatio: 0.8,
};

describe("quota settings", () => {
  it("uses env when nothing is stored", () => {
    expect(resolveQuotaLimits(null, fallback)).toEqual(fallback);
  });

  it("uses the stored row when present", () => {
    const stored = {
      turnsPerDay: 1,
      voiceMinutesPerDay: 0,
      timezone: "Asia/Kolkata",
      warnRatio: 0.5,
    };
    expect(resolveQuotaLimits(stored, fallback)).toEqual(stored);
  });

  it("reads env fallbacks", () => {
    expect(
      envQuotaLimits({
        QUOTA_TURNS_PER_DAY: 10,
        QUOTA_VOICE_MINUTES_PER_DAY: 5,
        QUOTA_TIMEZONE: "UTC",
        QUOTA_WARN_RATIO: 0.9,
      }),
    ).toEqual({
      turnsPerDay: 10,
      voiceMinutesPerDay: 5,
      timezone: "UTC",
      warnRatio: 0.9,
    });
  });

  it("accepts a valid save body", () => {
    expect(
      parseQuotaSettingsBody({
        turns_per_day: 1,
        voice_minutes_per_day: 0,
        timezone: "UTC",
        warn_ratio: 0.8,
      }),
    ).toEqual({
      ok: true,
      limits: {
        turnsPerDay: 1,
        voiceMinutesPerDay: 0,
        timezone: "UTC",
        warnRatio: 0.8,
      },
    });
  });

  it("rejects a bad timezone separately", () => {
    expect(
      parseQuotaSettingsBody({
        turns_per_day: 1,
        voice_minutes_per_day: 0,
        timezone: "Not/AZone",
        warn_ratio: 0.8,
      }),
    ).toEqual({ ok: false, reason: "timezone" });
  });

  it("rejects a fractional turn cap", () => {
    expect(
      parseQuotaSettingsBody({
        turns_per_day: 1.5,
        voice_minutes_per_day: 0,
        timezone: "UTC",
        warn_ratio: 0.8,
      }),
    ).toEqual({ ok: false, reason: "invalid" });
  });

  it("rejects a warn ratio outside 0-1", () => {
    expect(
      parseQuotaSettingsBody({
        turns_per_day: 1,
        voice_minutes_per_day: 0,
        timezone: "UTC",
        warn_ratio: 1.2,
      }),
    ).toEqual({ ok: false, reason: "invalid" });
  });

  it("serializes the public payload", () => {
    expect(quotaSettingsPayload(fallback, "stored")).toEqual({
      turns_per_day: 200,
      voice_minutes_per_day: 60,
      timezone: "UTC",
      warn_ratio: 0.8,
      source: "stored",
    });
  });
});
