import type { FastifyBaseLogger } from "fastify";
import type postgres from "postgres";
import type { GatewayConfig } from "../config.js";
import {
  type OpsEventInput,
  opsRecordCodes,
  parseOpsService,
  shouldRecordOpsCode,
} from "./decision.js";
import { insertOpsEvent } from "./store.js";

type Sql = ReturnType<typeof postgres>;

export async function recordOpsEvent(
  sql: Sql,
  config: GatewayConfig,
  log: FastifyBaseLogger,
  event: OpsEventInput,
  options: { force?: boolean } = {},
): Promise<void> {
  const service = parseOpsService(event.service);
  if (!service) {
    return;
  }
  if (
    !options.force &&
    !shouldRecordOpsCode(event.code, opsRecordCodes(config.OPS_RECORD_CODES))
  ) {
    return;
  }
  try {
    await insertOpsEvent(sql, { ...event, service });
  } catch (error) {
    log.warn({ err: error, code: event.code }, config.OPS_LOG_EVENT);
  }
}

export function noteOpsFailure(
  sql: Sql,
  config: GatewayConfig,
  log: FastifyBaseLogger,
  code: string,
  extra: { message: string; correlationId?: string | null },
): void {
  const service = parseOpsService(config.OPS_SERVICE_GATEWAY);
  if (!service) {
    return;
  }
  void recordOpsEvent(sql, config, log, {
    service,
    code,
    message: extra.message,
    correlationId: extra.correlationId,
  });
}
