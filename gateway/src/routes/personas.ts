import type { FastifyInstance } from "fastify";
import type postgres from "postgres";
import type { GatewayConfig } from "../config.js";
import { listPublishedPersonas, personaPublicPayload } from "../personas.js";

type Sql = ReturnType<typeof postgres>;

export async function registerPersonaRoutes(
  app: FastifyInstance,
  deps: { config: GatewayConfig; sql: Sql },
): Promise<void> {
  const { sql } = deps;

  app.get("/api/personas", async (request, reply) => {
    const user = request.appUser;
    if (!user) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    try {
      const personas = await listPublishedPersonas(sql);
      return { personas: personas.map(personaPublicPayload) };
    } catch (error) {
      request.log.error({ err: error }, "published persona list failed");
      return reply.code(503).send({
        error: deps.config.FAILURE_MESSAGE_DATABASE,
      });
    }
  });
}
