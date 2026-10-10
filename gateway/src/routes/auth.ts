import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Redis } from "ioredis";
import type postgres from "postgres";
import { z } from "zod";
import { meAccessLabels, resolveMeView } from "../access/me.js";
import { getAccessByGoogleSub } from "../access/store.js";
import { admitGoogleIdentity } from "../auth/admit.js";
import { SignInError } from "../auth/errors.js";
import {
  buildGoogleAuthorizationUrl,
  createOauthSecrets,
  exchangeAuthorizationCode,
  verifyGoogleIdToken,
} from "../auth/google.js";
import { createRequireAppUser } from "../auth/guard.js";
import {
  createSessionFromRecord,
  destroySession,
  readSessionRecord,
  sessionAppUserId,
  sessionGoogleSub,
  sessionIdentityEmail,
  storeOauthPending,
  takeOauthPending,
} from "../auth/session.js";
import { getUserById } from "../auth/users.js";
import {
  type GatewayConfig,
  consentRedirectUrl,
  frontendPathRedirect,
  googleCallbackPath,
  isOwnerEmail,
  postLoginRedirectUrl,
} from "../config.js";
import { consentIsCurrent } from "../lifecycle/decision.js";
import { getConsent } from "../lifecycle/store.js";
import { SESSION_KIND } from "../schema.js";

type Sql = ReturnType<typeof postgres>;

const callbackQuerySchema = z.object({
  code: z.string().min(1).optional(),
  state: z.string().min(1).optional(),
  error: z.string().optional(),
});

const googleStartQuerySchema = z.object({
  next: z.string().optional(),
});

export async function registerAuthRoutes(
  app: FastifyInstance,
  deps: {
    config: GatewayConfig;
    sql: Sql;
    redis: Redis;
  },
): Promise<void> {
  const { config, sql, redis } = deps;
  const requireAppUser = createRequireAppUser(deps);

  app.get("/auth/google", async (request, reply) => {
    const start = googleStartQuerySchema.parse(request.query);
    const secrets = createOauthSecrets(config);
    await storeOauthPending(redis, config, secrets.state, {
      nonce: secrets.nonce,
      code_verifier: secrets.codeVerifier,
      next: frontendPathRedirect(config, start.next),
    });
    const url = await buildGoogleAuthorizationUrl(config, {
      state: secrets.state,
      nonce: secrets.nonce,
      codeChallenge: secrets.codeChallenge,
    });
    return reply.redirect(url);
  });

  app.get(googleCallbackPath(config), async (request, reply) => {
    try {
      const query = callbackQuerySchema.parse(request.query);
      if (query.error || !query.code || !query.state) {
        throw new SignInError(query.error ?? "missing code or state");
      }
      const pending = await takeOauthPending(redis, config, query.state);
      if (!pending) {
        throw new SignInError("state mismatch");
      }
      const idToken = await exchangeAuthorizationCode(config, {
        code: query.code,
        codeVerifier: pending.code_verifier,
      });
      const identity = await verifyGoogleIdToken(
        config,
        idToken,
        pending.nonce,
      );
      const storedConsent = await getConsent(sql, identity.sub);
      if (
        !consentIsCurrent(storedConsent, {
          privacyVersion: config.CONSENT_PRIVACY_VERSION,
          termsVersion: config.CONSENT_TERMS_VERSION,
        })
      ) {
        await createSessionFromRecord(redis, reply, config, {
          kind: SESSION_KIND.CONSENT,
          google_sub: identity.sub,
          email: identity.email,
          next: frontendPathRedirect(config, pending.next),
        });
        return reply.redirect(consentRedirectUrl(config));
      }
      const admitted = await admitGoogleIdentity(
        { sql, config, redis },
        identity,
        pending.next,
        reply,
        request.log,
      );
      return reply.redirect(admitted.redirect);
    } catch (error) {
      if (error instanceof SignInError) {
        request.log.warn({ reason: error.reason }, "google sign-in failed");
        return reply.code(401).send({ error: "Sign-in failed" });
      }
      request.log.error(error, "google sign-in error");
      return reply.code(500).send({ error: "Sign-in failed" });
    }
  });

  async function logout(request: FastifyRequest, reply: FastifyReply) {
    await destroySession(redis, request, reply, config);
    if (request.method === "GET") {
      const next = frontendPathRedirect(
        config,
        googleStartQuerySchema.parse(request.query).next,
      );
      if (next) {
        return reply.redirect(new URL(next, config.FRONTEND_ORIGIN).toString());
      }
      return reply.redirect(postLoginRedirectUrl(config));
    }
    return reply.code(204).send();
  }

  app.get("/auth/logout", logout);
  app.post("/auth/logout", logout);

  app.addHook("preHandler", async (request, reply) => {
    const path = request.url.split("?")[0] ?? "";
    if (path !== "/api" && !path.startsWith("/api/")) {
      return;
    }
    if (
      path === "/api/me" ||
      path === "/api/consent" ||
      path === config.STATUS_API_PATH
    ) {
      return;
    }
    await requireAppUser(request, reply);
  });

  app.get("/api/me", async (request, reply) => {
    const record = await readSessionRecord(redis, request, config);
    if (!record) {
      return reply.code(401).send({ error: config.ACCESS_ERROR_UNAUTHORIZED });
    }
    const appUserId = sessionAppUserId(record);
    const googleSub = sessionGoogleSub(record);
    const user = appUserId ? await getUserById(sql, appUserId) : null;
    const access = googleSub
      ? await getAccessByGoogleSub(sql, googleSub)
      : user
        ? await getAccessByGoogleSub(sql, user.googleSub)
        : null;
    const email = user?.email ?? access?.email ?? sessionIdentityEmail(record);
    const view = resolveMeView({
      hasMemberSession: appUserId !== null,
      user,
      requestStatus: access?.status ?? null,
      email,
      owner: email ? isOwnerEmail(email, config) : false,
      labels: meAccessLabels(config),
      needsConsent: record.kind === SESSION_KIND.CONSENT,
    });
    if (view.http === 401) {
      return reply.code(401).send({ error: config.ACCESS_ERROR_UNAUTHORIZED });
    }
    return view.body;
  });
}
