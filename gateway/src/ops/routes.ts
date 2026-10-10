import type { FastifyInstance } from "fastify";
import type { Redis } from "ioredis";
import type postgres from "postgres";
import { createRequireOwner } from "../auth/owner.js";
import type { GatewayConfig } from "../config.js";
import { forcedOpsEvent, publicStatusPayload } from "./decision.js";
import { liveOpsHealth } from "./health.js";
import { insertOpsEvent, listOpsEvents } from "./store.js";

type Sql = ReturnType<typeof postgres>;

export async function registerOpsRoutes(
  app: FastifyInstance,
  deps: { config: GatewayConfig; sql: Sql; redis: Redis },
): Promise<void> {
  const { config, sql, redis } = deps;
  const requireOwner = createRequireOwner(config);

  app.get(config.STATUS_API_PATH, async (request) => {
    const health = await liveOpsHealth(config, sql, redis);
    let events: Awaited<ReturnType<typeof listOpsEvents>> = [];
    try {
      events = await listOpsEvents(sql, config.OPS_LIST_LIMIT);
    } catch (error) {
      request.log.warn({ err: error }, config.OPS_LOG_EVENT);
    }
    return publicStatusPayload(config, health, events);
  });

  await app.register(
    async (admin) => {
      admin.addHook("preHandler", requireOwner);

      admin.get("/ops", async (request) => {
        const health = await liveOpsHealth(config, sql, redis);
        let events: Awaited<ReturnType<typeof listOpsEvents>> = [];
        try {
          events = await listOpsEvents(sql, config.OPS_LIST_LIMIT);
        } catch (error) {
          request.log.warn({ err: error }, config.OPS_LOG_EVENT);
        }
        return { health, events };
      });

      admin.post("/ops/force", async (request, reply) => {
        const forced = forcedOpsEvent(config);
        if (!forced) {
          return reply
            .code(500)
            .send({ error: config.FAILURE_MESSAGE_UNKNOWN });
        }
        try {
          const id = await insertOpsEvent(sql, forced);
          const events = await listOpsEvents(sql, config.OPS_LIST_LIMIT);
          const row = events.find((event) => event.id === id);
          if (row) {
            return row;
          }
          return {
            id,
            created_at: new Date().toISOString(),
            service: forced.service,
            code: forced.code,
            message: forced.message,
            correlation_id: null,
          };
        } catch (error) {
          request.log.error({ err: error }, config.OPS_LOG_EVENT);
          return reply.code(503).send({
            error: config.FAILURE_MESSAGE_DATABASE,
            code: config.FAILURE_CODE_DATABASE,
          });
        }
      });
    },
    { prefix: "/api/admin" },
  );
}
