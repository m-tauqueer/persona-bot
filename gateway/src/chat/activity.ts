import type { Redis } from "ioredis";
import type { GatewayConfig } from "../config.js";

export async function touchChatActivity(
  redis: Redis,
  config: GatewayConfig,
  sessionId: string,
): Promise<void> {
  await redis.set(
    `${config.CHAT_ACTIVITY_REDIS_KEY_PREFIX}${sessionId}`,
    String(Date.now()),
    "EX",
    config.CHAT_ACTIVITY_TTL_SECONDS,
  );
}
