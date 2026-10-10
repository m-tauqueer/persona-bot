import type { FastifyInstance } from "fastify";
import type postgres from "postgres";
import { z } from "zod";
import { nextBatchStatus, parseBatchAction } from "../access/decision.js";
import {
  decodeAccessCursor,
  encodeAccessCursor,
  parseAccessStatus,
} from "../access/parse.js";
import {
  getAccessByIds,
  listAccessRequests,
  updateAccessStatus,
} from "../access/store.js";
import { createRequireOwner } from "../auth/owner.js";
import { type GatewayConfig, isOwnerEmail } from "../config.js";
import { resolvePageSize } from "../insights/parse.js";

type Sql = ReturnType<typeof postgres>;

const listQuerySchema = z.object({
  status: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.string().optional(),
});

export async function registerAccessRoutes(
  app: FastifyInstance,
  deps: { config: GatewayConfig; sql: Sql },
): Promise<void> {
  const { config, sql } = deps;
  const requireOwner = createRequireOwner(config);
  const batchBodySchema = z.object({
    action: z.string().min(1),
    ids: z.array(z.string().uuid()).min(1).max(config.ACCESS_BATCH_MAX),
  });

  await app.register(
    async (admin) => {
      admin.addHook("preHandler", requireOwner);

      admin.get("/access-requests", async (request, reply) => {
        const query = listQuerySchema.safeParse(request.query);
        if (!query.success) {
          return reply
            .code(400)
            .send({ error: config.INSIGHTS_ERROR_INVALID_CURSOR });
        }
        const status = parseAccessStatus(
          query.data.status ?? config.ACCESS_QUEUE_DEFAULT_STATUS,
        );
        if (!status) {
          return reply
            .code(400)
            .send({ error: config.ACCESS_ERROR_INVALID_STATUS });
        }
        const limit = resolvePageSize(config, query.data.limit);
        if (!limit.ok) {
          return reply
            .code(400)
            .send({ error: config.INSIGHTS_ERROR_INVALID_LIMIT });
        }
        let cursor = null;
        if (query.data.cursor) {
          cursor = decodeAccessCursor(query.data.cursor);
          if (!cursor) {
            return reply
              .code(400)
              .send({ error: config.INSIGHTS_ERROR_INVALID_CURSOR });
          }
        }
        const rows = await listAccessRequests(sql, {
          status,
          limit: limit.limit,
          cursor,
        });
        const page = rows.slice(0, limit.limit);
        const extra = rows[limit.limit];
        const last = page[page.length - 1];
        return {
          requests: page.map((row) => ({
            id: row.id,
            email: row.email,
            status: row.status,
            requested_at: row.requestedAt.toISOString(),
            decided_at: row.decidedAt ? row.decidedAt.toISOString() : null,
            user_id: row.userId,
            owner: isOwnerEmail(row.email, config),
          })),
          next_cursor:
            extra && last
              ? encodeAccessCursor({
                  requested_at: last.requestedAt,
                  id: last.id,
                })
              : null,
        };
      });

      admin.post("/access-requests", async (request, reply) => {
        const actor = request.appUser;
        if (!actor) {
          return reply
            .code(401)
            .send({ error: config.ACCESS_ERROR_UNAUTHORIZED });
        }
        const parsed = batchBodySchema.safeParse(request.body);
        if (!parsed.success) {
          return reply
            .code(400)
            .send({ error: config.ACCESS_ERROR_INVALID_BATCH });
        }
        const action = parseBatchAction(parsed.data.action, {
          approve: config.ACCESS_ACTION_APPROVE,
          deny: config.ACCESS_ACTION_DENY,
          revoke: config.ACCESS_ACTION_REVOKE,
        });
        if (!action) {
          return reply
            .code(400)
            .send({ error: config.ACCESS_ERROR_INVALID_BATCH });
        }
        const rows = await getAccessByIds(sql, parsed.data.ids);
        const found = new Map(rows.map((row) => [row.id, row]));
        const updated: string[] = [];
        const errors: { id: string; error: string }[] = [];
        for (const id of parsed.data.ids) {
          const row = found.get(id);
          if (!row) {
            errors.push({ id, error: config.ACCESS_ERROR_INVALID_BATCH });
            continue;
          }
          const result = nextBatchStatus({
            action,
            current: row.status,
            hasUser: row.userId !== null,
            targetIsOwner: isOwnerEmail(row.email, config),
            isSelf: row.userId === actor.id,
          });
          if (!result.ok) {
            const error =
              result.reason === "owner_protected"
                ? config.ACCESS_ERROR_OWNER_PROTECTED
                : result.reason === "self"
                  ? config.ACCESS_ERROR_SELF
                  : config.ACCESS_ERROR_INVALID_BATCH;
            errors.push({ id, error });
            continue;
          }
          await updateAccessStatus(sql, row.id, result.status, actor.id);
          updated.push(id);
        }
        return { updated, errors };
      });
    },
    { prefix: "/api/admin" },
  );
}
