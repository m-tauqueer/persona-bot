import type { FastifyBaseLogger } from "fastify";
import type postgres from "postgres";
import { callWorker } from "../clients/worker.js";
import type { GatewayConfig } from "../config.js";
import { endVoiceSession } from "../voice/record.js";

type Sql = ReturnType<typeof postgres>;

export function promoteEndedSitting(
  config: GatewayConfig,
  log: FastifyBaseLogger,
  sessionId: string,
  appUserId: string,
): void {
  void postClosingPass(config, log, sessionId, appUserId);
}

async function postClosingPass(
  config: GatewayConfig,
  log: FastifyBaseLogger,
  sessionId: string,
  appUserId: string,
): Promise<void> {
  const body = JSON.stringify({
    session_id: sessionId,
    app_user_id: appUserId,
  });
  const attempt = () =>
    callWorker(config, config.WORKER_CLOSING_PASS_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
  const attempts = config.WORKER_CLOSING_PASS_RETRIES + 1;
  for (let pass = 0; pass < attempts; pass += 1) {
    const last = pass === attempts - 1;
    try {
      const response = await attempt();
      if (response.ok) {
        return;
      }
      if (last) {
        log.warn(
          { sessionId, status: response.status },
          config.LOG_CLOSING_PASS_FAILED,
        );
      }
    } catch (error: unknown) {
      log.warn({ err: error, sessionId }, config.LOG_CLOSING_PASS_FAILED);
      if (last) {
        return;
      }
    }
  }
}

export async function endSitting(
  sql: Sql,
  config: GatewayConfig,
  log: FastifyBaseLogger,
  sessionId: string,
  appUserId: string,
  onLost?: () => void,
): Promise<boolean> {
  try {
    const ended = await endVoiceSession(sql, sessionId);
    promoteEndedSitting(config, log, sessionId, appUserId);
    return ended;
  } catch (error: unknown) {
    log.error({ err: error, sessionId }, "voice session not closed");
    onLost?.();
    return false;
  }
}
