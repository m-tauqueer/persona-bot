import type { FastifyBaseLogger } from "fastify";
import type { GatewayConfig } from "../config.js";

export class RedisCommandTimeoutError extends Error {
  constructor(ms: number) {
    super(`redis command timed out after ${ms}ms`);
    this.name = "RedisCommandTimeoutError";
  }
}

export async function withRedisTimeout<T>(
  work: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timer: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new RedisCommandTimeoutError(timeoutMs));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

export async function redisQuiet<T>(
  log: FastifyBaseLogger,
  config: GatewayConfig,
  label: string,
  sessionId: string | null,
  work: () => Promise<T>,
): Promise<T | null> {
  try {
    return await withRedisTimeout(work(), config.REDIS_COMMAND_TIMEOUT_MS);
  } catch (error) {
    log.error({ err: error, sessionId, label }, "redis call-state failed");
    return null;
  }
}
