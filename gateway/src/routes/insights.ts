import type { FastifyInstance } from "fastify";
import type postgres from "postgres";
import { z } from "zod";
import { createRequireOwner } from "../auth/owner.js";
import type { GatewayConfig } from "../config.js";
import {
  decodeSessionCursor,
  decodeUserCursor,
  resolveBucket,
  resolveChannel,
  resolvePageSize,
  resolveRangeId,
  resolveUserId,
} from "../insights/parse.js";
import {
  ownerActivity,
  ownerLatency,
  ownerOverview,
  ownerSessionDetail,
  ownerSessions,
  ownerUsers,
  personalOverview,
  personalSessionDetail,
  personalSessions,
} from "../insights/queries.js";
import { emptySessionList } from "../insights/scope.js";
import {
  getPublishedPersonaById,
  parseOptionalPersonaId,
} from "../personas.js";

type Sql = ReturnType<typeof postgres>;

const sessionIdSchema = z.string().uuid();

const listQuerySchema = z.object({
  range: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.string().optional(),
  user_id: z.string().optional(),
  channel: z.string().optional(),
  bucket: z.string().optional(),
});

async function publishedPersonaPin(
  sql: Sql,
  config: GatewayConfig,
  query: unknown,
): Promise<
  | { ok: true; id: string }
  | { ok: true; id: null }
  | { ok: false; status: 400 | 404 }
> {
  const pin = parseOptionalPersonaId(query, config.PERSONA_ID_QUERY);
  if (!pin.ok) {
    return { ok: false, status: 400 };
  }
  if (typeof pin.id !== "string") {
    return { ok: true, id: null };
  }
  const persona = await getPublishedPersonaById(sql, pin.id);
  if (!persona) {
    return { ok: false, status: 404 };
  }
  return { ok: true, id: persona.id };
}

export async function registerInsightRoutes(
  app: FastifyInstance,
  deps: { config: GatewayConfig; sql: Sql },
): Promise<void> {
  const { config, sql } = deps;
  const requireOwner = createRequireOwner(config);

  app.get("/api/me/overview", async (request, reply) => {
    const user = request.appUser;
    if (!user) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    return personalOverview(sql, user.id);
  });

  app.get("/api/me/sessions", async (request, reply) => {
    const user = request.appUser;
    if (!user) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const query = listQuerySchema.safeParse(request.query);
    if (!query.success) {
      return reply
        .code(400)
        .send({ error: config.INSIGHTS_ERROR_INVALID_RANGE });
    }
    const range = resolveRangeId(config, query.data.range);
    if (!range.ok) {
      return reply
        .code(400)
        .send({ error: config.INSIGHTS_ERROR_INVALID_RANGE });
    }
    const limit = resolvePageSize(config, query.data.limit);
    if (!limit.ok) {
      return reply
        .code(400)
        .send({ error: config.INSIGHTS_ERROR_INVALID_LIMIT });
    }
    let pin: Awaited<ReturnType<typeof publishedPersonaPin>>;
    try {
      pin = await publishedPersonaPin(sql, config, request.query);
    } catch (error) {
      request.log.error(
        { err: error },
        "personal session persona lookup failed",
      );
      return reply.code(503).send({
        error: config.FAILURE_MESSAGE_DATABASE,
        code: config.FAILURE_CODE_DATABASE,
      });
    }
    if (!pin.ok) {
      return reply
        .code(pin.status)
        .send({ error: config.INSIGHTS_ERROR_NOT_FOUND });
    }
    if (pin.id === null) {
      return emptySessionList(range.id);
    }
    let cursor = null;
    if (query.data.cursor) {
      cursor = decodeSessionCursor(query.data.cursor);
      if (!cursor) {
        return reply
          .code(400)
          .send({ error: config.INSIGHTS_ERROR_INVALID_CURSOR });
      }
    }
    return personalSessions(sql, config, user.id, {
      rangeId: range.id,
      limit: limit.limit,
      cursor,
      personaId: pin.id,
    });
  });

  app.get("/api/me/sessions/:id", async (request, reply) => {
    const user = request.appUser;
    if (!user) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const parsed = sessionIdSchema.safeParse(
      (request.params as { id?: string }).id,
    );
    if (!parsed.success) {
      return reply.code(404).send({ error: config.INSIGHTS_ERROR_NOT_FOUND });
    }
    const detail = await personalSessionDetail(sql, parsed.data, user.id);
    if (!detail) {
      request.log.info(
        { sessionId: parsed.data, userId: user.id },
        "personal session not found",
      );
      return reply.code(404).send({ error: config.INSIGHTS_ERROR_NOT_FOUND });
    }
    return detail;
  });

  await app.register(
    async (admin) => {
      admin.addHook("preHandler", requireOwner);

      admin.get("/overview", async (request, reply) => {
        const query = listQuerySchema.safeParse(request.query);
        if (!query.success) {
          return reply
            .code(400)
            .send({ error: config.INSIGHTS_ERROR_INVALID_RANGE });
        }
        const range = resolveRangeId(config, query.data.range);
        if (!range.ok) {
          return reply
            .code(400)
            .send({ error: config.INSIGHTS_ERROR_INVALID_RANGE });
        }
        return ownerOverview(sql, config, range.id);
      });

      admin.get("/activity", async (request, reply) => {
        const query = listQuerySchema.safeParse(request.query);
        if (!query.success) {
          return reply
            .code(400)
            .send({ error: config.INSIGHTS_ERROR_INVALID_RANGE });
        }
        const range = resolveRangeId(config, query.data.range);
        if (!range.ok) {
          return reply
            .code(400)
            .send({ error: config.INSIGHTS_ERROR_INVALID_RANGE });
        }
        const bucket = resolveBucket(config, query.data.bucket);
        if (!bucket.ok) {
          return reply
            .code(400)
            .send({ error: config.INSIGHTS_ERROR_INVALID_BUCKET });
        }
        return ownerActivity(sql, config, range.id, bucket.id);
      });

      admin.get("/latency", async (request, reply) => {
        const query = listQuerySchema.safeParse(request.query);
        if (!query.success) {
          return reply
            .code(400)
            .send({ error: config.INSIGHTS_ERROR_INVALID_RANGE });
        }
        const range = resolveRangeId(config, query.data.range);
        if (!range.ok) {
          return reply
            .code(400)
            .send({ error: config.INSIGHTS_ERROR_INVALID_RANGE });
        }
        return ownerLatency(sql, config, range.id);
      });

      admin.get("/sessions", async (request, reply) => {
        const query = listQuerySchema.safeParse(request.query);
        if (!query.success) {
          return reply
            .code(400)
            .send({ error: config.INSIGHTS_ERROR_INVALID_RANGE });
        }
        const range = resolveRangeId(config, query.data.range);
        if (!range.ok) {
          return reply
            .code(400)
            .send({ error: config.INSIGHTS_ERROR_INVALID_RANGE });
        }
        const limit = resolvePageSize(config, query.data.limit);
        if (!limit.ok) {
          return reply
            .code(400)
            .send({ error: config.INSIGHTS_ERROR_INVALID_LIMIT });
        }
        const channel = resolveChannel(query.data.channel);
        if (!channel.ok) {
          return reply
            .code(400)
            .send({ error: config.INSIGHTS_ERROR_INVALID_CHANNEL });
        }
        const user = resolveUserId(query.data.user_id);
        if (!user.ok) {
          return reply
            .code(400)
            .send({ error: config.INSIGHTS_ERROR_INVALID_USER });
        }
        let pin: Awaited<ReturnType<typeof publishedPersonaPin>>;
        try {
          pin = await publishedPersonaPin(sql, config, request.query);
        } catch (error) {
          request.log.error(
            { err: error },
            "owner session persona lookup failed",
          );
          return reply.code(503).send({
            error: config.FAILURE_MESSAGE_DATABASE,
            code: config.FAILURE_CODE_DATABASE,
          });
        }
        if (!pin.ok) {
          return reply
            .code(pin.status)
            .send({ error: config.INSIGHTS_ERROR_NOT_FOUND });
        }
        if (pin.id === null) {
          return emptySessionList(range.id);
        }
        let cursor = null;
        if (query.data.cursor) {
          cursor = decodeSessionCursor(query.data.cursor);
          if (!cursor) {
            return reply
              .code(400)
              .send({ error: config.INSIGHTS_ERROR_INVALID_CURSOR });
          }
        }
        return ownerSessions(sql, config, {
          rangeId: range.id,
          limit: limit.limit,
          cursor,
          userId: user.userId,
          channel: channel.channel,
          personaId: pin.id,
        });
      });

      admin.get("/sessions/:id", async (request, reply) => {
        const parsed = sessionIdSchema.safeParse(
          (request.params as { id?: string }).id,
        );
        if (!parsed.success) {
          return reply
            .code(404)
            .send({ error: config.INSIGHTS_ERROR_NOT_FOUND });
        }
        const detail = await ownerSessionDetail(sql, parsed.data);
        if (!detail) {
          return reply
            .code(404)
            .send({ error: config.INSIGHTS_ERROR_NOT_FOUND });
        }
        return detail;
      });

      admin.get("/users", async (request, reply) => {
        const query = listQuerySchema.safeParse(request.query);
        if (!query.success) {
          return reply
            .code(400)
            .send({ error: config.INSIGHTS_ERROR_INVALID_CURSOR });
        }
        const limit = resolvePageSize(config, query.data.limit);
        if (!limit.ok) {
          return reply
            .code(400)
            .send({ error: config.INSIGHTS_ERROR_INVALID_LIMIT });
        }
        let cursor = null;
        if (query.data.cursor) {
          cursor = decodeUserCursor(query.data.cursor);
          if (!cursor) {
            return reply
              .code(400)
              .send({ error: config.INSIGHTS_ERROR_INVALID_CURSOR });
          }
        }
        return ownerUsers(sql, config, { limit: limit.limit, cursor });
      });
    },
    { prefix: "/api/admin" },
  );
}
