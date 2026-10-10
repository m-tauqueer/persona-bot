import type { Redis } from "ioredis";
import type postgres from "postgres";
import type { GatewayConfig } from "../config.js";
import { withRedisTimeout } from "../voice/redisSafe.js";
import { type OpsHealthRow, healthRow } from "./decision.js";

type Sql = ReturnType<typeof postgres>;

async function withOpsTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return withRedisTimeout(work, ms);
}

async function postgresOk(sql: Sql, timeoutMs: number): Promise<boolean> {
  try {
    const rows = await withOpsTimeout(
      sql<{ n: number }[]>`select 1 as n`,
      timeoutMs,
    );
    return rows[0]?.n === 1;
  } catch {
    return false;
  }
}

async function redisOk(redis: Redis, timeoutMs: number): Promise<boolean> {
  try {
    const pong = await withRedisTimeout(redis.ping(), timeoutMs);
    return pong === "PONG";
  } catch {
    return false;
  }
}

async function workerOk(config: GatewayConfig): Promise<boolean> {
  const url = `${config.WORKER_URL.replace(/\/$/, "")}/health`;
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(config.OPS_HEALTH_TIMEOUT_MS),
    });
    if (!response.ok) {
      return false;
    }
    const body = (await response.json()) as { ok?: unknown };
    return body.ok === true;
  } catch {
    return false;
  }
}

export async function liveOpsHealth(
  config: GatewayConfig,
  sql: Sql,
  redis: Redis,
): Promise<OpsHealthRow[]> {
  const timeoutMs = config.OPS_HEALTH_TIMEOUT_MS;
  const [postgres, redisHealth, worker] = await Promise.all([
    postgresOk(sql, timeoutMs),
    redisOk(redis, timeoutMs),
    workerOk(config),
  ]);
  return [
    healthRow(
      config.OPS_HEALTH_POSTGRES,
      postgres,
      config.OPS_HEALTH_OK,
      config.OPS_HEALTH_FAIL,
    ),
    healthRow(
      config.OPS_HEALTH_REDIS,
      redisHealth,
      config.OPS_HEALTH_OK,
      config.OPS_HEALTH_FAIL,
    ),
    healthRow(
      config.OPS_HEALTH_WORKER,
      worker,
      config.OPS_HEALTH_OK,
      config.OPS_HEALTH_FAIL,
    ),
  ];
}
