import type { FastifyInstance } from "fastify";
import type postgres from "postgres";
import { createRequireOwner } from "../auth/owner.js";
import type { GatewayConfig } from "../config.js";
import {
  envQuotaLimits,
  parseQuotaSettingsBody,
  quotaSettingsPayload,
  resolveQuotaLimits,
} from "../quota/settings.js";
import { loadQuotaSettings, saveQuotaSettings } from "../quota/store.js";

type Sql = ReturnType<typeof postgres>;

export async function registerQuotaRoutes(
  app: FastifyInstance,
  deps: { config: GatewayConfig; sql: Sql },
): Promise<void> {
  const { config, sql } = deps;
  const requireOwner = createRequireOwner(config);

  await app.register(
    async (admin) => {
      admin.addHook("preHandler", requireOwner);

      admin.get("/quota", async () => {
        const stored = await loadQuotaSettings(sql);
        const limits = resolveQuotaLimits(stored, envQuotaLimits(config));
        return quotaSettingsPayload(
          limits,
          stored ? config.QUOTA_SOURCE_STORED : config.QUOTA_SOURCE_ENV,
        );
      });

      admin.put("/quota", async (request, reply) => {
        const actor = request.appUser;
        if (!actor) {
          return reply
            .code(401)
            .send({ error: config.ACCESS_ERROR_UNAUTHORIZED });
        }
        const parsed = parseQuotaSettingsBody(request.body);
        if (!parsed.ok) {
          return reply.code(400).send({
            error:
              parsed.reason === "timezone"
                ? config.QUOTA_ERROR_INVALID_TIMEZONE
                : config.QUOTA_ERROR_INVALID,
          });
        }
        const saved = await saveQuotaSettings(sql, parsed.limits, actor.id);
        return quotaSettingsPayload(saved, config.QUOTA_SOURCE_STORED);
      });
    },
    { prefix: "/api/admin" },
  );
}
