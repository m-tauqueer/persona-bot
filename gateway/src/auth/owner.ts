import type { FastifyReply, FastifyRequest } from "fastify";
import { type GatewayConfig, isOwnerEmail } from "../config.js";

export function createRequireOwner(config: GatewayConfig) {
  return async function requireOwner(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    if (reply.sent) {
      return;
    }
    const user = request.appUser;
    if (!user) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    if (!isOwnerEmail(user.email, config)) {
      request.log.warn({ userId: user.id }, "owner route refused");
      return reply.code(403).send({ error: "forbidden" });
    }
  };
}
