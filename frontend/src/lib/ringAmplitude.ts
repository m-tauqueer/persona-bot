import type { CallPhase } from "./callPhase";

export type RingLevelSource = "idle" | "mic" | "playback";

export function ringSourceForPhase(phase: CallPhase): RingLevelSource {
  if (phase === "listening") {
    return "mic";
  }
  if (phase === "speaking") {
    return "playback";
  }
  return "idle";
}

export function ringAmplitude(input: {
  source: RingLevelSource;
  level: number;
  idle: number;
  activeMin: number;
  activeMax: number;
}): number {
  if (input.activeMin > input.activeMax) {
    throw new Error("ring active min must be at most active max");
  }
  if (input.source === "idle") {
    return input.idle;
  }
  const unit = Math.min(1, Math.max(0, input.level));
  return input.activeMin + (input.activeMax - input.activeMin) * unit;
}