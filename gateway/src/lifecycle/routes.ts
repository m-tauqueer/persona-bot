import type { FastifyInstance } from "fastify";
import type { Redis } from "ioredis";
import type postgres from "postgres";
import { z } from "zod";
import { admitGoogleIdentity } from "../auth/admit.js";
import { createRequireOwner } from "../auth/owner.js";
import {
  destroySession,
  readSessionRecord,
  sessionConsentNext,
  sessionGoogleSub,
  sessionIdentityEmail,
} from "../auth/session.js";
import { getUserById } from "../auth/users.js";
import { callWorker } from "../clients/worker.js";
import { type GatewayConfig, isOwnerEmail } from "../config.js";
import { resolvePageSize } from "../insights/parse.js";
import { listLocalPersonas } from "../personas.js";
import { SESSION_KIND } from "../schema.js";
import {
  canDeleteAccount,
  confirmationMatches,
  nextDeletionStatus,
  parseDeletionAction,
} from "./decision.js";
import { eraseMemberAccount } from "./erase.js";
import { loadMemberArchive } from "./export.js";
import {
  decodeDeletionCursor,
  encodeDeletionCursor,
  parseDeletionStatus,
} from "./parse.js";
import {
  getDeletionByIds,
  getPendingDeletionForUser,
  insertDeletionRequest,
  listDeletionRequests,
  markDeletionCancelled,
  markDeletionCompleted,
  upsertConsent,
} from "./store.js";

type Sql = ReturnType<typeof postgres>;

const consentBodySchema = z.object({
  privacy_version: z.string().min(1),
  terms_version: z.string().min(1),
  accepted: z.boolean(),
});

const deleteBodySchema = z.object({
  confirmation: z.string().min(1),
});

const memberDeletionBodySchema = z.object({
  action: z.string().min(1),
  confirmation: z.string().optional(),
});

const listQuerySchema = z.object({
  status: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.string().optional(),
});

export async function registerLifecycleRoutes(
  app: FastifyInstance,
  deps: {
    config: GatewayConfig;
    sql: Sql;
    redis: Redis;
  },
): Promise<void> {
  const { config, sql, redis } = deps;
  const requireOwner = createRequireOwner(config);
  const adminBatchSchema = z.object({
    action: z.string().min(1),
    ids: z.array(z.string().uuid()).min(1).max(config.LIFECYCLE_BATCH_MAX),
    confirmation: z.string().optional(),
  });
  const actionTokens = {
    request: config.LIFECYCLE_ACTION_REQUEST,
    complete: config.LIFECYCLE_ACTION_COMPLETE,
    cancel: config.LIFECYCLE_ACTION_CANCEL,
  };

  app.get("/api/consent", async (request, reply) => {
    const record = await readSessionRecord(redis, request, config);
    if (!record || record.kind !== SESSION_KIND.CONSENT) {
      return reply.code(401).send({ error: config.ACCESS_ERROR_UNAUTHORIZED });
    }
    return {
      privacy_version: config.CONSENT_PRIVACY_VERSION,
      terms_version: config.CONSENT_TERMS_VERSION,
      privacy_path: config.PRIVACY_PATH,
      terms_path: config.TERMS_PATH,
    };
  });

  app.post("/api/consent", async (request, reply) => {
    const record = await readSessionRecord(redis, request, config);
    if (!record || record.kind !== SESSION_KIND.CONSENT) {
      return reply.code(401).send({ error: config.ACCESS_ERROR_UNAUTHORIZED });
    }
    const googleSub = sessionGoogleSub(record);
    const email = sessionIdentityEmail(record);
    if (!googleSub || !email) {
      return reply.code(401).send({ error: config.ACCESS_ERROR_UNAUTHORIZED });
    }
    const parsed = consentBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: config.LIFECYCLE_ERROR_VERSION });
    }
    if (!parsed.data.accepted) {
      return reply.code(400).send({ error: config.LIFECYCLE_ERROR_ACCEPTED });
    }
    if (
      parsed.data.privacy_version !== config.CONSENT_PRIVACY_VERSION ||
      parsed.data.terms_version !== config.CONSENT_TERMS_VERSION
    ) {
      return reply.code(400).send({ error: config.LIFECYCLE_ERROR_VERSION });
    }
    await upsertConsent(sql, {
      googleSub,
      privacyVersion: parsed.data.privacy_version,
      termsVersion: parsed.data.terms_version,
    });
    const admitted = await admitGoogleIdentity(
      { sql, config, redis },
      { sub: googleSub, email },
      sessionConsentNext(record),
      reply,
      request.log,
    );
    return {
      access: admitted.kind,
      redirect: admitted.redirect,
    };
  });

  app.get("/api/me/export", async (request, reply) => {
    const user = request.appUser;
    if (!user) {
      return reply.code(401).send({ error: config.ACCESS_ERROR_UNAUTHORIZED });
    }
    const archive = await loadMemberArchive(sql, user.id);
    if (!archive) {
      return reply.code(404).send({ error: config.ACCESS_ERROR_UNAUTHORIZED });
    }
    let memories: unknown = [];
    try {
      const personas = await listLocalPersonas(sql);
      const collected: {
        persona_id: string;
        handle: string;
        memories: unknown;
      }[] = [];
      for (const persona of personas) {
        const response = await callWorker(config, "/internal/memories", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            app_user_id: user.id,
            engram_user_id: user.engramUserId,
            engram_persona_id: persona.engramPersonaId,
          }),
        });
        if (response.ok) {
          collected.push({
            persona_id: persona.id,
            handle: persona.handle,
            memories: await response.json(),
          });
        } else {
          request.log.warn(
            { status: response.status, personaId: persona.id },
            "export memories unavailable",
          );
        }
      }
      memories = collected;
    } catch (error) {
      request.log.warn({ err: error }, "export memories lookup failed");
    }
    const body = { ...archive, memories };
    return reply
      .header("content-type", "application/json; charset=utf-8")
      .header(
        "content-disposition",
        `attachment; filename="${config.LIFECYCLE_EXPORT_FILENAME}"`,
      )
      .send(body);
  });

  app.get("/api/me/deletion", async (request, reply) => {
    const user = request.appUser;
    if (!user) {
      return reply.code(401).send({ error: config.ACCESS_ERROR_UNAUTHORIZED });
    }
    const pending = await getPendingDeletionForUser(sql, user.id);
    return {
      owner_protected: isOwnerEmail(user.email, config),
      pending: pending
        ? {
            id: pending.id,
            status: pending.status,
            requested_at: pending.requestedAt.toISOString(),
          }
        : null,
    };
  });

  app.post("/api/me/delete", async (request, reply) => {
    const user = request.appUser;
    if (!user) {
      return reply.code(401).send({ error: config.ACCESS_ERROR_UNAUTHORIZED });
    }
    const parsed = deleteBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: config.LIFECYCLE_ERROR_CONFIRMATION });
    }
    if (
      !confirmationMatches(
        parsed.data.confirmation,
        config.LIFECYCLE_DELETE_CONFIRMATION,
      )
    ) {
      return reply
        .code(400)
        .send({ error: config.LIFECYCLE_ERROR_CONFIRMATION });
    }
    const allowed = canDeleteAccount({
      targetIsOwner: isOwnerEmail(user.email, config),
      isSelf: true,
      allowSelf: true,
    });
    if (!allowed.ok) {
      return reply
        .code(403)
        .send({ error: config.LIFECYCLE_ERROR_OWNER_PROTECTED });
    }
    let pending = await getPendingDeletionForUser(sql, user.id);
    if (!pending) {
      const transition = nextDeletionStatus({
        action: "request",
        current: null,
      });
      if (!transition.ok) {
        return reply
          .code(409)
          .send({ error: config.LIFECYCLE_ERROR_INVALID_TRANSITION });
      }
      pending = await insertDeletionRequest(sql, {
        userId: user.id,
        googleSub: user.googleSub,
        email: user.email,
        requestedBy: user.id,
      });
    }
    const complete = nextDeletionStatus({
      action: "complete",
      current: pending.status,
    });
    if (!complete.ok) {
      return reply
        .code(409)
        .send({ error: config.LIFECYCLE_ERROR_INVALID_TRANSITION });
    }
    const erased = await eraseMemberAccount(sql, config, request.log, user);
    if (!erased.ok) {
      // The request stays pending so a retry, or the owner, can finish it.
      return reply
        .code(503)
        .send({ error: config.LIFECYCLE_ERROR_PURGE_INCOMPLETE });
    }
    await markDeletionCompleted(sql, pending.id, user.id);
    await destroySession(redis, request, reply, config);
    return { deleted: true, sessions: erased.sessions, engram: erased.engram };
  });

  app.post("/api/me/deletion-requests", async (request, reply) => {
    const user = request.appUser;
    if (!user) {
      return reply.code(401).send({ error: config.ACCESS_ERROR_UNAUTHORIZED });
    }
    const parsed = memberDeletionBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: config.LIFECYCLE_ERROR_INVALID_ACTION });
    }
    const action = parseDeletionAction(parsed.data.action, actionTokens);
    if (action !== "request" && action !== "cancel") {
      return reply
        .code(400)
        .send({ error: config.LIFECYCLE_ERROR_INVALID_ACTION });
    }
    const allowed = canDeleteAccount({
      targetIsOwner: isOwnerEmail(user.email, config),
      isSelf: true,
      allowSelf: true,
    });
    if (!allowed.ok) {
      return reply
        .code(403)
        .send({ error: config.LIFECYCLE_ERROR_OWNER_PROTECTED });
    }
    const pending = await getPendingDeletionForUser(sql, user.id);
    if (action === "request") {
      if (
        !parsed.data.confirmation ||
        !confirmationMatches(
          parsed.data.confirmation,
          config.LIFECYCLE_DELETE_CONFIRMATION,
        )
      ) {
        return reply
          .code(400)
          .send({ error: config.LIFECYCLE_ERROR_CONFIRMATION });
      }
      const transition = nextDeletionStatus({
        action,
        current: pending?.status ?? null,
      });
      if (!transition.ok) {
        return reply
          .code(409)
          .send({ error: config.LIFECYCLE_ERROR_INVALID_TRANSITION });
      }
      const created = await insertDeletionRequest(sql, {
        userId: user.id,
        googleSub: user.googleSub,
        email: user.email,
        requestedBy: user.id,
      });
      return {
        id: created.id,
        status: created.status,
        requested_at: created.requestedAt.toISOString(),
      };
    }
    if (!pending) {
      return reply
        .code(409)
        .send({ error: config.LIFECYCLE_ERROR_INVALID_TRANSITION });
    }
    const transition = nextDeletionStatus({
      action,
      current: pending.status,
    });
    if (!transition.ok) {
      return reply
        .code(409)
        .send({ error: config.LIFECYCLE_ERROR_INVALID_TRANSITION });
    }
    await markDeletionCancelled(sql, pending.id, user.id);
    return { id: pending.id, status: transition.status };
  });

  await app.register(
    async (admin) => {
      admin.addHook("preHandler", requireOwner);

      admin.get("/deletions", async (request, reply) => {
        const query = listQuerySchema.safeParse(request.query);
        if (!query.success) {
          return reply
            .code(400)
            .send({ error: config.INSIGHTS_ERROR_INVALID_CURSOR });
        }
        const status = parseDeletionStatus(
          query.data.status ?? config.LIFECYCLE_QUEUE_DEFAULT_STATUS,
        );
        if (!status) {
          return reply
            .code(400)
            .send({ error: config.LIFECYCLE_ERROR_INVALID_STATUS });
        }
        const limit = resolvePageSize(config, query.data.limit);
        if (!limit.ok) {
          return reply
            .code(400)
            .send({ error: config.INSIGHTS_ERROR_INVALID_LIMIT });
        }
        let cursor = null;
        if (query.data.cursor) {
          cursor = decodeDeletionCursor(query.data.cursor);
          if (!cursor) {
            return reply
              .code(400)
              .send({ error: config.INSIGHTS_ERROR_INVALID_CURSOR });
          }
        }
        const rows = await listDeletionRequests(sql, {
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
            completed_at: row.completedAt
              ? row.completedAt.toISOString()
              : null,
            user_id: row.userId,
            owner: isOwnerEmail(row.email, config),
          })),
          next_cursor:
            extra && last
              ? encodeDeletionCursor({
                  requested_at: last.requestedAt,
                  id: last.id,
                })
              : null,
        };
      });

      admin.post("/deletions", async (request, reply) => {
        const actor = request.appUser;
        if (!actor) {
          return reply
            .code(401)
            .send({ error: config.ACCESS_ERROR_UNAUTHORIZED });
        }
        const parsed = adminBatchSchema.safeParse(request.body);
        if (!parsed.success) {
          return reply
            .code(400)
            .send({ error: config.LIFECYCLE_ERROR_INVALID_ACTION });
        }
        const action = parseDeletionAction(parsed.data.action, actionTokens);
        if (action !== "complete" && action !== "cancel") {
          return reply
            .code(400)
            .send({ error: config.LIFECYCLE_ERROR_INVALID_ACTION });
        }
        if (action === "complete") {
          if (
            !parsed.data.confirmation ||
            !confirmationMatches(
              parsed.data.confirmation,
              config.LIFECYCLE_DELETE_CONFIRMATION,
            )
          ) {
            return reply
              .code(400)
              .send({ error: config.LIFECYCLE_ERROR_CONFIRMATION });
          }
        }
        const rows = await getDeletionByIds(sql, parsed.data.ids);
        const found = new Map(rows.map((row) => [row.id, row]));
        const updated: string[] = [];
        const errors: { id: string; error: string }[] = [];
        for (const id of parsed.data.ids) {
          const row = found.get(id);
          if (!row) {
            errors.push({ id, error: config.LIFECYCLE_ERROR_UNKNOWN });
            continue;
          }
          const transition = nextDeletionStatus({
            action,
            current: row.status,
          });
          if (!transition.ok) {
            errors.push({
              id,
              error: config.LIFECYCLE_ERROR_INVALID_TRANSITION,
            });
            continue;
          }
          if (action === "complete") {
            if (row.userId) {
              const target = await getUserById(sql, row.userId);
              if (target) {
                const allowed = canDeleteAccount({
                  targetIsOwner: isOwnerEmail(target.email, config),
                  isSelf: target.id === actor.id,
                  allowSelf: false,
                });
                if (!allowed.ok) {
                  errors.push({
                    id,
                    error:
                      allowed.reason === "owner_protected"
                        ? config.LIFECYCLE_ERROR_OWNER_PROTECTED
                        : config.LIFECYCLE_ERROR_INVALID_TRANSITION,
                  });
                  continue;
                }
                const erased = await eraseMemberAccount(
                  sql,
                  config,
                  request.log,
                  target,
                );
                if (!erased.ok) {
                  errors.push({
                    id,
                    error: config.LIFECYCLE_ERROR_PURGE_INCOMPLETE,
                  });
                  continue;
                }
              }
            }
            await markDeletionCompleted(sql, row.id, actor.id);
          } else {
            await markDeletionCancelled(sql, row.id, actor.id);
          }
          updated.push(id);
        }
        return { updated, errors };
      });
    },
    { prefix: "/api/admin" },
  );
}
