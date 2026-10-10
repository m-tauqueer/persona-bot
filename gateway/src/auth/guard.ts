import type { FastifyReply, FastifyRequest } from "fastify";
import type { Redis } from "ioredis";
import type postgres from "postgres";
import { nextSignInAction } from "../access/decision.js";
import { getAccessByGoogleSub } from "../access/store.js";
import { type GatewayConfig, isOwnerEmail } from "../config.js";
import { readSessionRecord, sessionAppUserId } from "./session.js";
import { getUserById } from "./users.js";

type Sql = ReturnType<typeof postgres>;

export function createRequireAppUser(deps: {
  sql: Sql;
  redis: Redis;
  config: GatewayConfig;
}) {
  return async function requireAppUser(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const record = await readSessionRecord(deps.redis, request, deps.config);
    const appUserId = record ? sessionAppUserId(record) : null;
    if (!appUserId) {
      return reply
        .code(401)
        .send({ error: deps.config.ACCESS_ERROR_UNAUTHORIZED });
    }
    const user = await getUserById(deps.sql, appUserId);
    if (!user) {
      return reply
        .code(401)
        .send({ error: deps.config.ACCESS_ERROR_UNAUTHORIZED });
    }
    const requestRow = await getAccessByGoogleSub(deps.sql, user.googleSub);
    const action = nextSignInAction({
      owner: isOwnerEmail(user.email, deps.config),
      hasUser: true,
      requestStatus: requestRow?.status ?? null,
    });
    if (action.type !== "provision") {
      return reply
        .code(401)
        .send({ error: deps.config.ACCESS_ERROR_UNAUTHORIZED });
    }
    request.appUser = user;
  };
}
