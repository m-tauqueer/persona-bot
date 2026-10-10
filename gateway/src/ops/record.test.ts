import { describe, expect, it, vi } from "vitest";
import { OPS_SERVICE } from "../schema.js";
import { testConfig } from "../test/config.js";
import { recordOpsEvent } from "./record.js";

describe("recordOpsEvent", () => {
  const config = testConfig();
  const log = { warn: vi.fn() };

  it("does not insert unlisted codes", async () => {
    const sql = vi.fn(async () => {
      throw new Error("should not insert");
    });
    await recordOpsEvent(sql as never, config, log as never, {
      service: OPS_SERVICE.GATEWAY,
      code: config.FAILURE_CODE_RECONNECTING,
      message: config.FAILURE_MESSAGE_RECONNECTING,
    });
    expect(sql).not.toHaveBeenCalled();
  });

  it("does not insert an unknown service", async () => {
    const sql = vi.fn(async () => {
      throw new Error("should not insert");
    });
    await recordOpsEvent(sql as never, config, log as never, {
      service: "browser" as never,
      code: config.FAILURE_CODE_ENGRAM,
      message: config.FAILURE_MESSAGE_ENGRAM,
    });
    expect(sql).not.toHaveBeenCalled();
  });
});
