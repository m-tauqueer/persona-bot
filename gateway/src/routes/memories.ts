import type { FastifyInstance, FastifyReply } from "fastify";
import type postgres from "postgres";
import { callWorker, memberFacingBody } from "../clients/worker.js";
import type { GatewayConfig } from "../config.js";
import {
  getPublishedPersonaById,
  parseOptionalPersonaId,
} from "../personas.js";

type Sql = ReturnType<typeof postgres>;

async function sendWorker(
  reply: FastifyReply,
  response: Response,
  notFoundError: string,
) {
  const text = await response.text();
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
  return reply
    .code(response.status)
    .send(memberFacingBody(response.status, body, notFoundError));
}

export async function registerMemoryRoutes(
  app: FastifyInstance,
  deps: { config: GatewayConfig; sql: Sql },
): Promise<void> {
  const { config, sql } = deps;

  app.get("/api/me/memories", async (request, reply) => {
    const user = request.appUser;
    if (!user) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    if (config.MEMORY_PANEL_ENABLED !== "true") {
      return reply.code(404).send({ error: config.MEMORY_PANEL_DISABLED });
    }
    const pin = parseOptionalPersonaId(request.query, config.PERSONA_ID_QUERY);
    if (!pin.ok || !pin.id) {
      return reply.code(404).send({ error: config.INSIGHTS_ERROR_NOT_FOUND });
    }
    let persona: Awaited<ReturnType<typeof getPublishedPersonaById>>;
    try {
      persona = await getPublishedPersonaById(sql, pin.id);
    } catch (error) {
      request.log.error({ err: error }, "memory persona lookup failed");
      return reply.code(503).send({
        error: config.FAILURE_MESSAGE_DATABASE,
      });
    }
    if (!persona) {
      return reply.code(404).send({ error: config.INSIGHTS_ERROR_NOT_FOUND });
    }
    const response = await callWorker(config, "/internal/memories", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        app_user_id: user.id,
        engram_user_id: user.engramUserId,
        engram_persona_id: persona.engramPersonaId,
      }),
    });
    return sendWorker(reply, response, config.INSIGHTS_ERROR_NOT_FOUND);
  });
}
