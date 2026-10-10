import { afterEach, describe, expect, it, vi } from "vitest";
import { callWorker } from "../clients/worker.js";
import { testConfig } from "../test/config.js";
import { endVoiceSession } from "../voice/record.js";
import { endSitting, promoteEndedSitting } from "./closingPass.js";

vi.mock("../clients/worker.js", () => ({
  callWorker: vi.fn(),
}));

vi.mock("../voice/record.js", () => ({
  endVoiceSession: vi.fn(),
}));

const sessionId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const userId = "11111111-1111-1111-1111-111111111111";

function mockLog() {
  return {
    warn: vi.fn(),
    error: vi.fn(),
  };
}

describe("promoteEndedSitting", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("posts once when the worker accepts", async () => {
    vi.mocked(callWorker).mockResolvedValue(
      new Response(null, { status: 202 }),
    );
    promoteEndedSitting(testConfig(), mockLog() as never, sessionId, userId);
    await vi.waitFor(() => {
      expect(callWorker).toHaveBeenCalledTimes(1);
    });
    expect(vi.mocked(callWorker).mock.calls[0]?.[1]).toBe(
      "/internal/closing-pass",
    );
  });

  it("retries once after a worker fault", async () => {
    vi.mocked(callWorker)
      .mockRejectedValueOnce(new Error("down"))
      .mockResolvedValueOnce(new Response(null, { status: 202 }));
    const log = mockLog();
    promoteEndedSitting(testConfig(), log as never, sessionId, userId);
    await vi.waitFor(() => {
      expect(callWorker).toHaveBeenCalledTimes(2);
    });
    expect(log.warn).toHaveBeenCalled();
  });
});

describe("endSitting", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("sets ended_at then fires the closing pass even if already ended", async () => {
    vi.mocked(endVoiceSession).mockResolvedValue(false);
    vi.mocked(callWorker).mockResolvedValue(
      new Response(null, { status: 202 }),
    );
    const ended = await endSitting(
      {} as never,
      testConfig(),
      mockLog() as never,
      sessionId,
      userId,
    );
    expect(ended).toBe(false);
    expect(endVoiceSession).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => {
      expect(callWorker).toHaveBeenCalledTimes(1);
    });
  });

  it("does not fire the job when the sit-down write fails", async () => {
    vi.mocked(endVoiceSession).mockRejectedValue(new Error("db"));
    const onLost = vi.fn();
    const log = mockLog();
    const ended = await endSitting(
      {} as never,
      testConfig(),
      log as never,
      sessionId,
      userId,
      onLost,
    );
    expect(ended).toBe(false);
    expect(onLost).toHaveBeenCalledTimes(1);
    expect(callWorker).not.toHaveBeenCalled();
  });
});
