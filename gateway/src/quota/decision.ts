export function quotaLimitActive(limit: number): boolean {
  return limit > 0;
}

export function quotaExceeded(used: number, limit: number): boolean {
  return quotaLimitActive(limit) && used >= limit;
}

export function quotaShouldWarn(
  used: number,
  limit: number,
  ratio: number,
): boolean {
  return quotaLimitActive(limit) && ratio > 0 && used >= limit * ratio;
}

export function quotaAppliesToCaller(owner: boolean): boolean {
  return !owner;
}

export function firstQuotaHit(input: {
  turnsUsed: number;
  turnsLimit: number;
  turnsKind: string;
  minutesUsed: number;
  minutesLimit: number;
  minutesKind: string;
}): string | null {
  if (quotaExceeded(input.turnsUsed, input.turnsLimit)) {
    return input.turnsKind;
  }
  if (quotaExceeded(input.minutesUsed, input.minutesLimit)) {
    return input.minutesKind;
  }
  return null;
}
