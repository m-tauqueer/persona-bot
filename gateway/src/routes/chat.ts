import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Redis } from "ioredis";
import type postgres from "postgres";
import { z } from "zod";
import { touchChatActivity } from "../chat/activity.js";
import { promoteEndedSitting } from "../chat/closingPass.js";
import {
  createTextSession,
  endSessionForUser,
  getSessionForUser,
} from "../chat/sessions.js";
import { listTurnsForUser } from "../chat/turns.js";
import { callWorker, memberFacingBody } from "../clients/worker.js";
import { type GatewayConfig, isOwnerEmail } from "../config.js";
import { turnLogFields } from "../observe/fields.js";
import { noteOpsFailure } from "../ops/record.js";
import {
  type CatalogPersona,
  getPublishedPersonaById,
  parseOptionalPersonaId,
  personaPublicPayload,
} from "../personas.js";
import { quotaAppliesToCaller } from "../quota/decision.js";
import {
  type QuotaUsage,
  loadQuotaUsage,
  quotaRefusal,
  quotaWarnKinds,
  resolveLiveQuotaLimits,
} from "../quota/store.js";
import { redisQuiet } from "../voice/redisSafe.js";

type Sql = ReturnType<typeof postgres>;

function chatQuerySchema() {
  return z.object({
    session_id: z.string().uuid().optional(),
  });
}

function chatBodySchema() {
  return z.object({
    text: z.string().min(1),
    session_id: z.string().uuid().optional(),
    correlation_id: z.string().uuid().optional(),
  });
}

function chatEndBodySchema() {
  return z.object({
    session_id: z.string().uuid(),
  });
}

function parseWorkerBody(text: string): unknown {
  let body: unknown = null;
  if (text.length > 0) {
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      body = { error: "worker_error" };
    }
  }
  if (body && typeof body === "object" && "detail" in body) {
    const detail = (body as { detail: unknown }).detail;
    if (detail && typeof detail === "object") {
      body = detail;
    } else if (typeof detail === "string") {
      body = { error: detail };
    }
  }
  return body;
}

function sendDatabaseUnavailable(
  reply: FastifyReply,
  request: FastifyRequest,
  sql: Sql,
  config: GatewayConfig,
) {
  noteOpsFailure(sql, config, request.log, config.FAILURE_CODE_DATABASE, {
    message: config.FAILURE_MESSAGE_DATABASE,
  });
  return reply.code(503).send({
    error: config.FAILURE_MESSAGE_DATABASE,
    code: config.FAILURE_CODE_DATABASE,
  });
}

function notFound(config: GatewayConfig) {
  return { error: config.INSIGHTS_ERROR_NOT_FOUND };
}

async function publishedForSession(
  sql: Sql,
  personaId: string,
): Promise<CatalogPersona | null> {
  return getPublishedPersonaById(sql, personaId);
}

export async function registerChatRoutes(
  app: FastifyInstance,
  deps: { config: GatewayConfig; sql: Sql; redis: Redis },
): Promise<void> {
  const { config, sql, redis } = deps;

  app.get("/api/chat", async (request, reply) => {
    const user = request.appUser;
    if (!user) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const parsed = chatQuerySchema().safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid query" });
    }
    const pin = parseOptionalPersonaId(request.query, config.PERSONA_ID_QUERY);
    if (!pin.ok) {
      return reply.code(400).send({ error: "invalid query" });
    }
    const sessionId = parsed.data.session_id;
    const personaId = pin.id;

    try {
      if (sessionId) {
        const session = await getSessionForUser(sql, sessionId, user.id);
        if (!session) {
          request.log.info(
            { sessionId, userId: user.id },
            "chat session not found",
          );
          return reply.code(404).send(notFound(config));
        }
        const persona = await publishedForSession(sql, session.personaId);
        if (!persona) {
          request.log.info(
            { sessionId, userId: user.id },
            "chat session not found",
          );
          return reply.code(404).send(notFound(config));
        }
        const turns = await listTurnsForUser(sql, sessionId, user.id);
        if (turns === null) {
          request.log.info(
            { sessionId, userId: user.id },
            "chat session not found",
          );
          return reply.code(404).send(notFound(config));
        }
        return {
          persona: personaPublicPayload(persona),
          session_id: sessionId,
          turns,
        };
      }

      if (typeof personaId === "string") {
        const persona = await getPublishedPersonaById(sql, personaId);
        if (!persona) {
          return reply.code(404).send(notFound(config));
        }
        return { persona: personaPublicPayload(persona), turns: [] as const };
      }

      return reply.code(404).send(notFound(config));
    } catch (error) {
      request.log.error({ err: error }, "chat lookup failed");
      return sendDatabaseUnavailable(reply, request, sql, config);
    }
  });

  app.post("/api/chat/end", async (request, reply) => {
    const user = request.appUser;
    if (!user) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const parsed = chatEndBodySchema().safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid body" });
    }
    try {
      const session = await endSessionForUser(
        sql,
        parsed.data.session_id,
        user.id,
      );
      if (!session) {
        request.log.info(
          { sessionId: parsed.data.session_id, userId: user.id },
          "chat session not found",
        );
        return reply.code(404).send(notFound(config));
      }
      promoteEndedSitting(config, request.log, session.id, user.id);
      return reply.code(204).send();
    } catch (error) {
      request.log.error({ err: error }, "chat session end failed");
      return sendDatabaseUnavailable(reply, request, sql, config);
    }
  });

  app.post("/api/chat", async (request, reply) => {
    const user = request.appUser;
    if (!user) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const parsed = chatBodySchema().safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid body" });
    }
    const pin = parseOptionalPersonaId(request.body, config.PERSONA_ID_QUERY);
    if (!pin.ok) {
      return reply.code(400).send({ error: "invalid body" });
    }

    const pinnedId = pin.id;
    let persona: CatalogPersona;
    let session: Awaited<ReturnType<typeof getSessionForUser>>;

    try {
      if (parsed.data.session_id) {
        session = await getSessionForUser(sql, parsed.data.session_id, user.id);
        if (!session) {
          request.log.info(
            { sessionId: parsed.data.session_id, userId: user.id },
            "chat session not found",
          );
          return reply.code(404).send(notFound(config));
        }
        if (session.endedAt) {
          return reply.code(409).send({ error: "session has ended" });
        }
        const sitting = await publishedForSession(sql, session.personaId);
        if (!sitting) {
          request.log.info(
            { sessionId: session.id, userId: user.id },
            "chat session not found",
          );
          return reply.code(404).send(notFound(config));
        }
        if (typeof pinnedId === "string" && pinnedId !== session.personaId) {
          return reply.code(409).send({ error: "session persona mismatch" });
        }
        persona = sitting;
      } else {
        if (!pinnedId) {
          return reply.code(404).send(notFound(config));
        }
        const sitting = await getPublishedPersonaById(sql, pinnedId);
        if (!sitting) {
          return reply.code(404).send(notFound(config));
        }
        persona = sitting;
        session = await createTextSession(sql, user.id, persona.id);
      }
    } catch (error) {
      request.log.error({ err: error }, "chat session lookup failed");
      return sendDatabaseUnavailable(reply, request, sql, config);
    }

    const activity = await redisQuiet(
      request.log,
      config,
      "touchChatActivity",
      session.id,
      () => touchChatActivity(redis, config, session.id),
    );
    if (activity === null) {
      request.log.error({ sessionId: session.id }, "chat activity not stored");
    }

    if (quotaAppliesToCaller(isOwnerEmail(user.email, config))) {
      let usage: QuotaUsage;
      let limits: Awaited<ReturnType<typeof resolveLiveQuotaLimits>>;
      try {
        limits = await resolveLiveQuotaLimits(sql, config);
        usage = await loadQuotaUsage(sql, user.id, limits);
      } catch (error) {
        request.log.error({ err: error }, "chat quota lookup failed");
        return sendDatabaseUnavailable(reply, request, sql, config);
      }
      const refused = quotaRefusal(config, usage, limits);
      if (refused) {
        request.log.warn(
          {
            userId: user.id,
            code: refused.code,
            reset_at: refused.reset_at,
          },
          config.QUOTA_LOG_REFUSED,
        );
        return reply.code(429).send(refused);
      }
      for (const kind of quotaWarnKinds(config, usage, limits)) {
        request.log.warn({ userId: user.id, kind }, config.QUOTA_LOG_WARN);
      }
    }

    const correlationId = parsed.data.correlation_id ?? randomUUID();
    const response = await callWorker(config, "/internal/turn", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [config.CORRELATION_ID_HEADER]: correlationId,
      },
      body: JSON.stringify({
        app_user_id: user.id,
        engram_user_id: user.engramUserId,
        persona_id: persona.id,
        session_id: session.id,
        text: parsed.data.text,
      }),
    });
    const payload = parseWorkerBody(await response.text());
    const fields =
      payload && typeof payload === "object"
        ? (payload as Record<string, unknown>)
        : {};
    request.log.info(
      turnLogFields(config, {
        correlation_id:
          typeof fields.correlation_id === "string"
            ? fields.correlation_id
            : correlationId,
        session_id: session.id,
        turn_ids: fields.turn_ids,
        action: fields.action,
        reasons: fields.reasons,
        recorded: fields.recorded,
      }),
      config.LOG_TURN_EVENT,
    );
    return reply
      .code(response.status)
      .send(
        memberFacingBody(
          response.status,
          payload,
          config.INSIGHTS_ERROR_NOT_FOUND,
        ),
      );
  });
}
