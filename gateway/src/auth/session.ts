import { sign as signCookie } from "@fastify/cookie";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Redis } from "ioredis";
import { z } from "zod";
import { type GatewayConfig, sessionCookieSecure } from "../config.js";
import { ACCESS_STATUS, SESSION_KIND } from "../schema.js";
import { randomUrlToken } from "./random.js";

const sessionRecordSchema = z.union([
  z.object({
    kind: z.literal(SESSION_KIND.MEMBER).optional(),
    app_user_id: z.string().uuid(),
  }),
  z.object({
    kind: z.literal(SESSION_KIND.WAITLIST),
    google_sub: z.string().min(1),
    email: z.string().min(1),
    status: z.literal(ACCESS_STATUS.REQUESTED),
  }),
  z.object({
    kind: z.literal(SESSION_KIND.REFUSED),
    google_sub: z.string().min(1),
    email: z.string().min(1),
    status: z.enum([ACCESS_STATUS.DENIED, ACCESS_STATUS.REVOKED]),
  }),
  z.object({
    kind: z.literal(SESSION_KIND.CONSENT),
    google_sub: z.string().min(1),
    email: z.string().min(1),
    next: z.string().min(1).optional(),
  }),
]);

export type SessionRecord = z.infer<typeof sessionRecordSchema>;

const oauthPendingSchema = z.object({
  nonce: z.string().min(1),
  code_verifier: z.string().min(1),
  next: z.string().min(1).optional(),
});

export type OauthPending = z.infer<typeof oauthPendingSchema>;

function sessionRedisKey(config: GatewayConfig, sessionId: string): string {
  return `${config.SESSION_REDIS_KEY_PREFIX}${sessionId}`;
}

function oauthRedisKey(config: GatewayConfig, state: string): string {
  return `${config.OAUTH_REDIS_KEY_PREFIX}${state}`;
}

export function sessionCookieOptions(config: GatewayConfig) {
  return {
    path: config.SESSION_COOKIE_PATH,
    httpOnly: true,
    signed: true,
    sameSite: config.SESSION_COOKIE_SAMESITE,
    secure: sessionCookieSecure(config),
    maxAge: config.SESSION_TTL_SECONDS,
  };
}

export async function storeOauthPending(
  redis: Redis,
  config: GatewayConfig,
  state: string,
  pending: OauthPending,
): Promise<void> {
  await redis.set(
    oauthRedisKey(config, state),
    JSON.stringify(pending),
    "EX",
    config.OAUTH_PENDING_TTL_SECONDS,
  );
}

export async function takeOauthPending(
  redis: Redis,
  config: GatewayConfig,
  state: string,
): Promise<OauthPending | null> {
  const raw = await redis.getdel(oauthRedisKey(config, state));
  if (!raw) {
    return null;
  }
  try {
    const parsed = oauthPendingSchema.safeParse(JSON.parse(raw) as unknown);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function persistSessionRecord(
  redis: Redis,
  config: GatewayConfig,
  record: SessionRecord,
): Promise<string> {
  const sessionId = randomUrlToken(config.SESSION_ID_BYTES);
  await redis.set(
    sessionRedisKey(config, sessionId),
    JSON.stringify(record),
    "EX",
    config.SESSION_TTL_SECONDS,
  );
  return sessionId;
}

export async function persistAuthSession(
  redis: Redis,
  config: GatewayConfig,
  appUserId: string,
): Promise<string> {
  return persistSessionRecord(redis, config, {
    kind: SESSION_KIND.MEMBER,
    app_user_id: appUserId,
  });
}

export function signSessionCookieValue(
  config: GatewayConfig,
  sessionId: string,
): string {
  return signCookie(sessionId, config.SESSION_SECRET);
}

export async function createSessionFromRecord(
  redis: Redis,
  reply: FastifyReply,
  config: GatewayConfig,
  record: SessionRecord,
): Promise<void> {
  const sessionId = await persistSessionRecord(redis, config, record);
  reply.setCookie(
    config.SESSION_COOKIE_NAME,
    sessionId,
    sessionCookieOptions(config),
  );
}

export async function createSession(
  redis: Redis,
  reply: FastifyReply,
  config: GatewayConfig,
  appUserId: string,
): Promise<void> {
  await createSessionFromRecord(redis, reply, config, {
    kind: SESSION_KIND.MEMBER,
    app_user_id: appUserId,
  });
}

export function sessionAppUserId(record: SessionRecord): string | null {
  return "app_user_id" in record ? record.app_user_id : null;
}

export function sessionIdentityEmail(record: SessionRecord): string | null {
  return "email" in record ? record.email : null;
}

export function sessionGoogleSub(record: SessionRecord): string | null {
  return "google_sub" in record ? record.google_sub : null;
}

export function sessionConsentNext(record: SessionRecord): string | undefined {
  return record.kind === SESSION_KIND.CONSENT ? record.next : undefined;
}

export async function readSessionRecord(
  redis: Redis,
  request: FastifyRequest,
  config: GatewayConfig,
): Promise<SessionRecord | null> {
  const raw = request.cookies[config.SESSION_COOKIE_NAME];
  if (!raw) {
    return null;
  }
  const unsigned = request.unsignCookie(raw);
  if (!unsigned.valid) {
    return null;
  }
  const stored = await redis.get(sessionRedisKey(config, unsigned.value));
  if (!stored) {
    return null;
  }
  let parsed: ReturnType<typeof sessionRecordSchema.safeParse>;
  try {
    parsed = sessionRecordSchema.safeParse(JSON.parse(stored) as unknown);
  } catch {
    return null;
  }
  if (!parsed.success) {
    return null;
  }
  await redis.expire(
    sessionRedisKey(config, unsigned.value),
    config.SESSION_TTL_SECONDS,
  );
  return parsed.data;
}

export async function readSessionAppUserId(
  redis: Redis,
  request: FastifyRequest,
  config: GatewayConfig,
): Promise<string | null> {
  const record = await readSessionRecord(redis, request, config);
  return record ? sessionAppUserId(record) : null;
}

export async function destroySession(
  redis: Redis,
  request: FastifyRequest,
  reply: FastifyReply,
  config: GatewayConfig,
): Promise<void> {
  const raw = request.cookies[config.SESSION_COOKIE_NAME];
  if (raw) {
    const unsigned = request.unsignCookie(raw);
    if (unsigned.valid) {
      await redis.del(sessionRedisKey(config, unsigned.value));
    }
  }
  reply.clearCookie(config.SESSION_COOKIE_NAME, sessionCookieOptions(config));
}
