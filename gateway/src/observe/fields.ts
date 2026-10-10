import type { GatewayConfig } from "../config.js";
import { parseList } from "../insights/parse.js";

export type ModeBudget = {
  p50: number;
  p90: number;
};

export function turnLogFields(
  config: GatewayConfig,
  fields: Record<string, unknown>,
): Record<string, unknown> {
  const allowed = new Set(parseList(config.LOG_TURN_FIELDS));
  const picked: Record<string, unknown> = {};
  for (const key of allowed) {
    if (Object.hasOwn(fields, key) && fields[key] !== undefined) {
      picked[key] = fields[key];
    }
  }
  return picked;
}

export function parseModeBudgets(raw: string): Map<string, ModeBudget> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new Error(
      "Invalid gateway environment: LATENCY_BUDGET_BY_BRAIN_MODE must be JSON",
    );
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(
      "Invalid gateway environment: LATENCY_BUDGET_BY_BRAIN_MODE must be an object",
    );
  }
  const budgets = new Map<string, ModeBudget>();
  for (const [mode, value] of Object.entries(parsed)) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(
        `Invalid gateway environment: LATENCY_BUDGET_BY_BRAIN_MODE.${mode} must be an object`,
      );
    }
    const row = value as { p50?: unknown; p90?: unknown };
    if (
      typeof row.p50 !== "number" ||
      typeof row.p90 !== "number" ||
      !Number.isFinite(row.p50) ||
      !Number.isFinite(row.p90) ||
      row.p50 <= 0 ||
      row.p90 <= 0
    ) {
      throw new Error(
        `Invalid gateway environment: LATENCY_BUDGET_BY_BRAIN_MODE.${mode} needs positive p50 and p90`,
      );
    }
    budgets.set(mode, { p50: row.p50, p90: row.p90 });
  }
  return budgets;
}

export function budgetForMode(
  config: GatewayConfig,
  brainMode: string,
): ModeBudget {
  const mapped = parseModeBudgets(config.LATENCY_BUDGET_BY_BRAIN_MODE).get(
    brainMode,
  );
  if (mapped) {
    return mapped;
  }
  return {
    p50: config.LATENCY_BUDGET_FIRST_WORD_MS,
    p90: config.LATENCY_BUDGET_P90_MS,
  };
}

export function validateObserveConfig(config: {
  LOG_TURN_FIELDS: string;
  LATENCY_BUDGET_P90_MS: number;
  LATENCY_BUDGET_FIRST_WORD_MS: number;
  LATENCY_BUDGET_WINDOW_HOURS: number;
  LATENCY_BUDGET_BY_BRAIN_MODE: string;
}): void {
  const fields = parseList(config.LOG_TURN_FIELDS);
  if (fields.length === 0) {
    throw new Error("Invalid gateway environment: LOG_TURN_FIELDS is empty");
  }
  if (!fields.includes("correlation_id") || !fields.includes("session_id")) {
    throw new Error(
      "Invalid gateway environment: LOG_TURN_FIELDS must include correlation_id and session_id",
    );
  }
  if (config.LATENCY_BUDGET_WINDOW_HOURS <= 0) {
    throw new Error(
      "Invalid gateway environment: LATENCY_BUDGET_WINDOW_HOURS must be positive",
    );
  }
  if (config.LATENCY_BUDGET_P90_MS <= 0) {
    throw new Error(
      "Invalid gateway environment: LATENCY_BUDGET_P90_MS must be positive",
    );
  }
  if (config.LATENCY_BUDGET_FIRST_WORD_MS <= 0) {
    throw new Error(
      "Invalid gateway environment: LATENCY_BUDGET_FIRST_WORD_MS must be positive",
    );
  }
  parseModeBudgets(config.LATENCY_BUDGET_BY_BRAIN_MODE);
}
