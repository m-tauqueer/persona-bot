import { describe, expect, it } from "vitest";
import { orbStateForPhase, phaseLabel, type PhaseOrbConfig } from "./callPhase";
import { loadUiCopy } from "./uiCopy";

const orbs: PhaseOrbConfig = {
  orbConnecting: "working",
  orbListening: "listening",
  orbThinking: "working",
  orbSpeaking: "composing",
  orbReconnecting: "working",
};

describe("call phase UI", () => {
  it("maps live phases to configured orb states and hides idle and error", () => {
    expect(orbStateForPhase("starting", orbs)).toBe("working");
    expect(orbStateForPhase("listening", orbs)).toBe("listening");
    expect(orbStateForPhase("thinking", orbs)).toBe("working");
    expect(orbStateForPhase("speaking", orbs)).toBe("composing");
    expect(orbStateForPhase("reconnecting", orbs)).toBe("working");
    expect(orbStateForPhase("idle", orbs)).toBeNull();
    expect(orbStateForPhase("error", orbs)).toBeNull();
  });

  it("uses config copy for each phase label", () => {
    const copy = loadUiCopy();
    expect(phaseLabel("listening", copy)).toBe(copy.callPhaseListening);
    expect(phaseLabel("thinking", copy)).toBe(copy.callPhaseThinking);
    expect(phaseLabel("idle", copy)).toBe(copy.callPhaseIdle);
  });
});