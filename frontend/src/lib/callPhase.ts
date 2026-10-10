import type { OrbState, OrbTheme } from "thinking-orbs";
import type { UiCopy } from "./uiCopy";

export type CallPhase =
  | "idle"
  | "starting"
  | "listening"
  | "thinking"
  | "speaking"
  | "reconnecting"
  | "error";

export const CALL_PHASES = [
  "idle",
  "starting",
  "listening",
  "thinking",
  "speaking",
  "reconnecting",
  "error",
] as const satisfies readonly CallPhase[];

export const VOICE_ORB_STATES = [
  "working",
  "searching",
  "solving",
  "listening",
  "connecting",
  "weaving",
  "composing",
  "breathing",
  "shaping",
] as const satisfies readonly OrbState[];

export const VOICE_ORB_THEMES = ["auto", "dark", "light"] as const satisfies readonly OrbTheme[];

export type PhaseOrbConfig = {
  orbConnecting: OrbState;
  orbListening: OrbState;
  orbThinking: OrbState;
  orbSpeaking: OrbState;
  orbReconnecting: OrbState;
};

export function phaseLabel(phase: CallPhase, copy: UiCopy): string {
  if (phase === "starting") {
    return copy.callPhaseConnecting;
  }
  if (phase === "listening") {
    return copy.callPhaseListening;
  }
  if (phase === "thinking") {
    return copy.callPhaseThinking;
  }
  if (phase === "speaking") {
    return copy.callPhaseSpeaking;
  }
  if (phase === "reconnecting") {
    return copy.callPhaseReconnecting;
  }
  if (phase === "error") {
    return copy.callPhaseError;
  }
  return copy.callPhaseIdle;
}

export function orbStateForPhase(
  phase: CallPhase,
  config: PhaseOrbConfig,
): OrbState | null {
  if (phase === "starting") {
    return config.orbConnecting;
  }
  if (phase === "listening") {
    return config.orbListening;
  }
  if (phase === "thinking") {
    return config.orbThinking;
  }
  if (phase === "speaking") {
    return config.orbSpeaking;
  }
  if (phase === "reconnecting") {
    return config.orbReconnecting;
  }
  return null;
}

export function callIsLive(phase: CallPhase): boolean {
  return (
    phase === "listening" ||
    phase === "thinking" ||
    phase === "speaking" ||
    phase === "reconnecting"
  );
}