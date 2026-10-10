import type { FastifyBaseLogger } from "fastify";
import type { Redis } from "ioredis";
import { z } from "zod";
import type { GatewayConfig } from "../config.js";

const noticeSchema = z.object({
  session_id: z.string().uuid(),
  code: z.string().min(1),
  message: z.string().min(1),
  kind: z.string().min(1).optional(),
  correlation_id: z.string().uuid().optional(),
  turn_ids: z.array(z.string().uuid()).optional(),
});

export type VoiceNotice = z.infer<typeof noticeSchema>;

export function parseVoiceNotice(value: unknown): VoiceNotice | null {
  const parsed = noticeSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export type VoiceNoticeHandler = (notice: VoiceNotice) => void;

export type VoiceNoticeHub = {
  watch: (sessionId: string, handler: VoiceNoticeHandler) => () => void;
  close: () => Promise<void>;
};

export function createVoiceNoticeHub(
  redis: Redis,
  config: GatewayConfig,
  log: FastifyBaseLogger,
): VoiceNoticeHub {
  const listeners = new Map<string, Set<VoiceNoticeHandler>>();
  const subscriber = redis.duplicate();
  let closed = false;

  subscriber.on("error", (error) => {
    log.error({ err: error }, "redis notice subscriber error");
  });

  void subscriber
    .subscribe(config.VOICE_NOTICE_REDIS_CHANNEL)
    .then(() => {
      log.info(
        { channel: config.VOICE_NOTICE_REDIS_CHANNEL },
        "voice notices subscribed",
      );
    })
    .catch((error: unknown) => {
      log.error({ err: error }, "voice notices not subscribed");
    });

  subscriber.on("message", (channel, raw) => {
    if (channel !== config.VOICE_NOTICE_REDIS_CHANNEL) {
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      log.warn("voice notice was not json");
      return;
    }
    const notice = parseVoiceNotice(parsed);
    if (!notice) {
      log.warn("voice notice rejected");
      return;
    }
    const handlers = listeners.get(notice.session_id);
    if (!handlers) {
      return;
    }
    for (const handler of handlers) {
      handler(notice);
    }
  });

  return {
    watch(sessionId, handler) {
      const existing = listeners.get(sessionId) ?? new Set();
      existing.add(handler);
      listeners.set(sessionId, existing);
      return () => {
        const current = listeners.get(sessionId);
        if (!current) {
          return;
        }
        current.delete(handler);
        if (current.size === 0) {
          listeners.delete(sessionId);
        }
      };
    },
    async close() {
      if (closed) {
        return;
      }
      closed = true;
      listeners.clear();
      try {
        await subscriber.quit();
      } catch (error) {
        log.error({ err: error }, "redis notice subscriber close failed");
        subscriber.disconnect();
      }
    },
  };
}
