import { describe, expect, it } from "vitest";
import { testConfig } from "../test/config.js";
import {
  decodeSessionCursor,
  decodeUserCursor,
  encodeSessionCursor,
  encodeUserCursor,
  parseLatencyColumns,
  parseList,
  parseRangeWindows,
  resolveBucket,
  resolveChannel,
  resolvePageSize,
  resolveRangeId,
  resolveUserId,
  validateInsightsConfig,
} from "./parse.js";

describe("insights parse", () => {
  const config = testConfig();

  it("splits and trims lists", () => {
    expect(parseList("today, 7d\n30d")).toEqual(["today", "7d", "30d"]);
  });

  it("parses calendar and day-count windows", () => {
    const windows = parseRangeWindows("today:calendar,7d:7", "calendar");
    expect(windows.get("today")).toEqual({ kind: "calendar" });
    expect(windows.get("7d")).toEqual({ kind: "duration_days", days: 7 });
  });

  it("rejects a broken window spec", () => {
    expect(() => parseRangeWindows("today", "calendar")).toThrow(
      /Invalid insights range window/,
    );
  });

  it("defaults and rejects unknown ranges", () => {
    expect(resolveRangeId(config, undefined)).toEqual({
      ok: true,
      id: config.INSIGHTS_DEFAULT_RANGE,
    });
    expect(resolveRangeId(config, "nope")).toEqual({ ok: false });
  });

  it("defaults and rejects unknown buckets", () => {
    expect(resolveBucket(config, "")).toEqual({
      ok: true,
      id: config.INSIGHTS_DEFAULT_BUCKET,
    });
    expect(resolveBucket(config, "week")).toEqual({ ok: false });
  });

  it("accepts configured channels only", () => {
    expect(resolveChannel(undefined)).toEqual({ ok: true, channel: null });
    expect(resolveChannel("text")).toEqual({ ok: true, channel: "text" });
    expect(resolveChannel("sms")).toEqual({ ok: false });
  });

  it("caps page size at the configured max", () => {
    expect(resolvePageSize(config, undefined)).toEqual({
      ok: true,
      limit: config.INSIGHTS_PAGE_SIZE,
    });
    expect(resolvePageSize(config, "0")).toEqual({ ok: false });
    expect(
      resolvePageSize(config, String(config.INSIGHTS_MAX_PAGE_SIZE + 50)),
    ).toEqual({
      ok: true,
      limit: config.INSIGHTS_MAX_PAGE_SIZE,
    });
  });

  it("accepts a uuid user filter", () => {
    const id = "11111111-1111-1111-1111-111111111111";
    expect(resolveUserId(undefined)).toEqual({ ok: true, userId: null });
    expect(resolveUserId(id)).toEqual({ ok: true, userId: id });
    expect(resolveUserId("not-a-uuid")).toEqual({ ok: false });
  });

  it("round-trips session and user cursors", () => {
    const started = new Date("2026-01-02T03:04:05.000Z");
    const session = encodeSessionCursor({
      started_at: started,
      id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    });
    expect(decodeSessionCursor(session)).toEqual({
      startedAt: started,
      id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    });
    expect(decodeSessionCursor("%%%")).toBeNull();

    const seen = encodeUserCursor({
      last_seen_at: started,
      id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    });
    expect(decodeUserCursor(seen)?.id).toBe(
      "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    );
    const never = encodeUserCursor({
      last_seen_at: null,
      id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    });
    expect(decodeUserCursor(never)).toEqual({
      lastSeenAt: null,
      id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    });
  });

  it("rejects a page size larger than max at boot", () => {
    expect(() =>
      validateInsightsConfig({
        ...config,
        INSIGHTS_PAGE_SIZE: config.INSIGHTS_MAX_PAGE_SIZE + 1,
      }),
    ).toThrow(/INSIGHTS_PAGE_SIZE/);
  });

  it("parses known latency columns only", () => {
    expect(parseLatencyColumns("brain_ms, total_ms")).toEqual([
      "brain_ms",
      "total_ms",
    ]);
    expect(() => parseLatencyColumns("nope")).toThrow(/Unknown latency column/);
    expect(() => parseLatencyColumns("")).toThrow(/must not be empty/);
  });

  it("rejects an invalid default range or empty reasons", () => {
    expect(() =>
      validateInsightsConfig({ ...config, INSIGHTS_DEFAULT_RANGE: "nope" }),
    ).toThrow(/INSIGHTS_DEFAULT_RANGE/);
    expect(() =>
      validateInsightsConfig({ ...config, INSIGHTS_ERROR_REASONS: "" }),
    ).toThrow(/INSIGHTS_ERROR_REASONS/);
  });
});
