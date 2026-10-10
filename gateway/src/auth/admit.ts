import type { FastifyBaseLogger, FastifyReply } from "fastify";
import type { Redis } from "ioredis";
import type postgres from "postgres";
import { nextSignInAction } from "../access/decision.js";
import {
  getAccessByGoogleSub,
  upsertActiveAccess,
  upsertWaitlistRequest,
} from "../access/store.js";
import {
  type GatewayConfig,
  frontendPathRedirect,
  isOwnerEmail,
  postLoginRedirectUrl,
  waitlistRedirectUrl,
} from "../config.js";
import { ACCESS_STATUS, SESSION_KIND } from "../schema.js";
import { createSession, createSessionFromRecord } from "./session.js";
import { getUserByGoogleSub, upsertGoogleUser } from "./users.js";

type Sql = ReturnType<typeof postgres>;

export type GoogleIdentity = { sub: string; email: string };

export type AdmitResult = {
  kind: "member" | "waitlist" | "refused";
  redirect: string;
};

export async function admitGoogleIdentity(
  deps: {
    sql: Sql;
    config: GatewayConfig;
    redis: Redis;
  },
  identity: GoogleIdentity,
  pendingNext: string | undefined,
  reply: FastifyReply,
  _log: FastifyBaseLogger,
): Promise<AdmitResult> {
  const { sql, config, redis } = deps;
  const existing = await getUserByGoogleSub(sql, identity.sub);
  const access = await getAccessByGoogleSub(sql, identity.sub);
  const action = nextSignInAction({
    owner: isOwnerEmail(identity.email, config),
    hasUser: existing !== null,
    requestStatus: access?.status ?? null,
  });
  const next = frontendPathRedirect(config, pendingNext);
  if (action.type === "provision") {
    const user = await upsertGoogleUser(sql, identity);
    await upsertActiveAccess(sql, identity, user.id);
    await createSession(redis, reply, config, user.id);
    const redirect = next
      ? new URL(next, config.FRONTEND_ORIGIN).toString()
      : postLoginRedirectUrl(config);
    return { kind: "member", redirect };
  }
  if (action.type === "waitlist") {
    await upsertWaitlistRequest(sql, identity);
    await createSessionFromRecord(redis, reply, config, {
      kind: SESSION_KIND.WAITLIST,
      google_sub: identity.sub,
      email: identity.email,
      status: ACCESS_STATUS.REQUESTED,
    });
    return { kind: "waitlist", redirect: waitlistRedirectUrl(config) };
  }
  await createSessionFromRecord(redis, reply, config, {
    kind: SESSION_KIND.REFUSED,
    google_sub: identity.sub,
    email: identity.email,
    status: action.status,
  });
  return { kind: "refused", redirect: waitlistRedirectUrl(config) };
}
