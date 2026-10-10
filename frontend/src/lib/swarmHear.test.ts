import { describe, expect, it } from "vitest";
import { expApproach, parseCallPhases, swarmHearTarget } from "./swarmHear";

describe("swarm hear mix", () => {
  it("reads hearing phases from a configured list", () => {
    const hearing = parseCallPhases("listening", "VITE_VOICE_SWARM_HEARING_PHASES");
    expect(swarmHearTarget("listening", hearing)).toBe(1);
    expect(swarmHearTarget("idle", hearing)).toBe(0);
    expect(swarmHearTarget("speaking", hearing)).toBe(0);
    expect(swarmHearTarget("thinking", hearing)).toBe(0);
  });

  it("rejects an empty or unknown phase list", () => {
    expect(() => parseCallPhases("   ", "VITE_VOICE_SWARM_HEARING_PHASES")).toThrow(
      /empty/,
    );
    expect(() =>
      parseCallPhases("listening,shouting", "VITE_VOICE_SWARM_HEARING_PHASES"),
    ).toThrow(/unknown phase/);
  });

  it("eases toward the target over the configured time constant", () => {
    expect(expApproach(0, 1, 0, 900)).toBe(0);
    expect(expApproach(0, 1, 900, 0)).toBe(1);
    expect(expApproach(0, 1, 900, 900)).toBeCloseTo(1 - Math.exp(-1), 6);
  });
});
