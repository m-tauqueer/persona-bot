import { describe, expect, it } from "vitest";
import { ringAmplitude, ringSourceForPhase } from "./ringAmplitude";

describe("ring amplitude", () => {
  it("uses mic while listening and playback while speaking", () => {
    expect(ringSourceForPhase("listening")).toBe("mic");
    expect(ringSourceForPhase("speaking")).toBe("playback");
    expect(ringSourceForPhase("thinking")).toBe("idle");
    expect(ringSourceForPhase("idle")).toBe("idle");
  });

  it("holds the idle amplitude when not listening or speaking", () => {
    expect(
      ringAmplitude({
        source: "idle",
        level: 1,
        idle: 0.06,
        activeMin: 0.08,
        activeMax: 1,
      }),
    ).toBe(0.06);
  });

  it("maps a signal level between the configured active bounds", () => {
    expect(
      ringAmplitude({
        source: "mic",
        level: 0.5,
        idle: 0.06,
        activeMin: 0.08,
        activeMax: 1,
      }),
    ).toBeCloseTo(0.54);
  });
});