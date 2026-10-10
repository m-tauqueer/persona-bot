import { CALL_PHASES, type CallPhase } from "./callPhase";

const PHASES = new Set<string>(CALL_PHASES);

export function parseCallPhases(
  raw: string,
  name: string,
): ReadonlySet<CallPhase> {
  const phases = new Set<CallPhase>();
  for (const entry of raw.split(/[,\s]+/)) {
    const trimmed = entry.trim();
    if (trimmed.length === 0) {
      continue;
    }
    if (!PHASES.has(trimmed)) {
      throw new Error(`${name} has unknown phase: ${trimmed}`);
    }
    phases.add(trimmed as CallPhase);
  }
  if (phases.size === 0) {
    throw new Error(`${name} is empty`);
  }
  return phases;
}

export function swarmHearTarget(
  phase: CallPhase,
  hearing: ReadonlySet<CallPhase>,
): number {
  return hearing.has(phase) ? 1 : 0;
}

export function expApproach(
  current: number,
  target: number,
  dtMs: number,
  tauMs: number,
): number {
  if (tauMs <= 0) {
    return target;
  }
  if (dtMs <= 0) {
    return current;
  }
  return current + (target - current) * (1 - Math.exp(-dtMs / tauMs));
}
