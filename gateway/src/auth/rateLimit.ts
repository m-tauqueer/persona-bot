import type { FastifyRequest } from "fastify";
import type { Redis } from "ioredis";
import type { GatewayConfig } from "../config.js";
import { readSessionAppUserId } from "./session.js";

export function rateLimitKey(input: {
  userId: string | null;
  ip: string;
  userPrefix: string;
  ipPrefix: string;
}): string {
  if (input.userId) {
    return `${input.userPrefix}${input.userId}`;
  }
  return `${input.ipPrefix}${input.ip}`;
}

export function rateLimitPluginOptions(
  config: GatewayConfig,
  deps?: { redis: Redis },
) {
  const base = {
    max: config.RATE_LIMIT_MAX,
    timeWindow: config.RATE_LIMIT_WINDOW_MS,
    nameSpace: config.RATE_LIMIT_REDIS_PREFIX,
    skipOnError: true as const,
  };
  if (!deps) {
    return base;
  }
  const redis = deps.redis;
  return {
    ...base,
    keyGenerator: async (request: FastifyRequest) => {
      const userId = await readSessionAppUserId(redis, request, config);
      return rateLimitKey({
        userId,
        ip: request.ip,
        userPrefix: config.RATE_LIMIT_USER_KEY_PREFIX,
        ipPrefix: config.RATE_LIMIT_IP_KEY_PREFIX,
      });
    },
  };
}
