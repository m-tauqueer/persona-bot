import { describe, expect, it } from "vitest";
import { OPS_SERVICE } from "../schema.js";
import { testConfig } from "../test/config.js";
import {
  allHealthOk,
  forcedOpsEvent,
  healthRow,
  opsRecordCodes,
  parseOpsService,
  parseStatusLabels,
  publicStatusPayload,
  shouldRecordOpsCode,
  validateOpsConfig,
  validateStatusCopy,
} from "./decision.js";

describe("ops decision", () => {
  const config = testConfig();

  it("accepts only known service tokens", () => {
    expect(parseOpsService(config.OPS_SERVICE_GATEWAY)).toBe(
      OPS_SERVICE.GATEWAY,
    );
    expect(parseOpsService(config.OPS_SERVICE_WORKER)).toBe(OPS_SERVICE.WORKER);
    expect(parseOpsService("browser")).toBeNull();
  });

  it("records only listed failure codes", () => {
    const codes = opsRecordCodes(config.OPS_RECORD_CODES);
    expect(shouldRecordOpsCode(config.FAILURE_CODE_ENGRAM, codes)).toBe(true);
    expect(shouldRecordOpsCode(config.FAILURE_CODE_DATABASE, codes)).toBe(true);
    expect(shouldRecordOpsCode(config.FAILURE_CODE_RECONNECTING, codes)).toBe(
      false,
    );
    expect(shouldRecordOpsCode(config.FAILURE_CODE_BLOB, codes)).toBe(false);
  });

  it("builds a forced event from config", () => {
    expect(forcedOpsEvent(config)).toEqual({
      service: OPS_SERVICE.GATEWAY,
      code: config.OPS_FORCE_CODE,
      message: config.OPS_FORCE_MESSAGE,
    });
    expect(
      forcedOpsEvent({
        OPS_SERVICE_GATEWAY: "nope",
        OPS_FORCE_CODE: config.OPS_FORCE_CODE,
        OPS_FORCE_MESSAGE: config.OPS_FORCE_MESSAGE,
      }),
    ).toBeNull();
  });

  it("treats health as ok only when every check passed", () => {
    const ok = healthRow(
      config.OPS_HEALTH_POSTGRES,
      true,
      config.OPS_HEALTH_OK,
      config.OPS_HEALTH_FAIL,
    );
    const down = healthRow(
      config.OPS_HEALTH_REDIS,
      false,
      config.OPS_HEALTH_OK,
      config.OPS_HEALTH_FAIL,
    );
    expect(ok.ok).toBe(true);
    expect(ok.status).toBe(config.OPS_HEALTH_OK);
    expect(down.status).toBe(config.OPS_HEALTH_FAIL);
    expect(allHealthOk([ok, down])).toBe(false);
    expect(allHealthOk([ok])).toBe(true);
    expect(allHealthOk([])).toBe(false);
  });

  it("rejects overlapping health names", () => {
    expect(() =>
      validateOpsConfig({
        ...config,
        OPS_HEALTH_REDIS: config.OPS_HEALTH_POSTGRES,
      }),
    ).toThrow(/unique/);
  });

  it("rejects unknown or colliding service and health tokens", () => {
    expect(() =>
      validateOpsConfig({
        ...config,
        OPS_SERVICE_GATEWAY: "browser",
      }),
    ).toThrow(/OPS_SERVICE_GATEWAY/);
    expect(() =>
      validateOpsConfig({
        ...config,
        OPS_SERVICE_WORKER: "browser",
      }),
    ).toThrow(/OPS_SERVICE_WORKER/);
    expect(() =>
      validateOpsConfig({
        ...config,
        OPS_SERVICE_WORKER: config.OPS_SERVICE_GATEWAY,
      }),
    ).toThrow(/must differ/);
    expect(() =>
      validateOpsConfig({
        ...config,
        OPS_HEALTH_FAIL: config.OPS_HEALTH_OK,
      }),
    ).toThrow(/OPS_HEALTH_OK/);
  });
});

describe("public status", () => {
  const config = testConfig();
  const checkedAt = new Date("2026-09-07T03:22:00.000Z");

  it("accepts default component labels", () => {
    expect(() => validateStatusCopy(config)).not.toThrow();
  });

  it("rejects colliding status tokens and unknown labels", () => {
    expect(() =>
      validateStatusCopy({
        ...config,
        STATUS_OVERALL_FAIL: config.STATUS_OVERALL_OK,
      }),
    ).toThrow(/STATUS_OVERALL_OK/);
    expect(() =>
      validateStatusCopy({
        ...config,
        STATUS_COMPONENT_FAIL: config.STATUS_COMPONENT_OK,
      }),
    ).toThrow(/STATUS_COMPONENT_OK/);
    expect(() =>
      validateStatusCopy({
        ...config,
        STATUS_COMPONENT_LABELS: `${config.OPS_HEALTH_POSTGRES}|History;${config.OPS_HEALTH_REDIS}|Calls`,
      }),
    ).toThrow(/missing/);
    expect(() =>
      validateStatusCopy({
        ...config,
        STATUS_COMPONENT_LABELS: `${config.STATUS_COMPONENT_LABELS};blob|Audio`,
      }),
    ).toThrow(/unknown/);
  });

  it("maps live health to public copy and drops probe rows", () => {
    const ok = healthRow(
      config.OPS_HEALTH_POSTGRES,
      true,
      config.OPS_HEALTH_OK,
      config.OPS_HEALTH_FAIL,
    );
    const down = healthRow(
      config.OPS_HEALTH_REDIS,
      false,
      config.OPS_HEALTH_OK,
      config.OPS_HEALTH_FAIL,
    );
    const worker = healthRow(
      config.OPS_HEALTH_WORKER,
      true,
      config.OPS_HEALTH_OK,
      config.OPS_HEALTH_FAIL,
    );
    const payload = publicStatusPayload(
      config,
      [ok, down, worker],
      [
        {
          id: "force",
          created_at: "2026-09-07T03:12:04.000Z",
          code: config.OPS_FORCE_CODE,
          message: config.OPS_FORCE_MESSAGE,
        },
        {
          id: "real",
          created_at: "2026-09-07T03:10:00.000Z",
          code: config.FAILURE_CODE_ENGRAM,
          message: config.FAILURE_MESSAGE_ENGRAM,
        },
      ],
      checkedAt,
    );
    expect(payload.checked_at).toBe(checkedAt.toISOString());
    expect(payload.overall.ok).toBe(false);
    expect(payload.overall.status).toBe(config.STATUS_OVERALL_FAIL);
    expect(payload.overall.label).toBe(config.STATUS_OVERALL_FAIL_LABEL);
    const labels = parseStatusLabels(config.STATUS_COMPONENT_LABELS);
    expect(payload.components.map((row) => row.label)).toEqual([
      labels.get(config.OPS_HEALTH_POSTGRES),
      labels.get(config.OPS_HEALTH_REDIS),
      labels.get(config.OPS_HEALTH_WORKER),
    ]);
    expect(payload.components[1]).toEqual({
      label: labels.get(config.OPS_HEALTH_REDIS),
      ok: false,
      status: config.STATUS_COMPONENT_FAIL,
    });
    expect(payload.incidents).toEqual([
      {
        id: "real",
        at: "2026-09-07T03:10:00.000Z",
        title: config.FAILURE_MESSAGE_ENGRAM,
      },
    ]);
  });

  it("reports operational when every check passed", () => {
    const rows = [
      config.OPS_HEALTH_POSTGRES,
      config.OPS_HEALTH_REDIS,
      config.OPS_HEALTH_WORKER,
    ].map((name) =>
      healthRow(name, true, config.OPS_HEALTH_OK, config.OPS_HEALTH_FAIL),
    );
    const payload = publicStatusPayload(config, rows, [], checkedAt);
    expect(payload.overall.ok).toBe(true);
    expect(payload.overall.label).toBe(config.STATUS_OVERALL_OK_LABEL);
    expect(payload.incidents).toEqual([]);
  });
});
