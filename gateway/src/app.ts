import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import websocket from "@fastify/websocket";
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from "fastify";
import type { Redis } from "ioredis";
import type postgres from "postgres";
import { rateLimitPluginOptions } from "./auth/rateLimit.js";
import {
  type GatewayConfig,
  corsAllowedMethods,
  rateLimitEnabled,
} from "./config.js";
import { registerLifecycleRoutes } from "./lifecycle/routes.js";
import { registerOpsRoutes } from "./ops/routes.js";
import { registerAccessRoutes } from "./routes/access.js";
import { registerAdminRoutes } from "./routes/admin.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerChatRoutes } from "./routes/chat.js";
import { registerInsightRoutes } from "./routes/insights.js";
import { registerMemoryRoutes } from "./routes/memories.js";
import { registerPersonaRoutes } from "./routes/personas.js";
import { registerQuotaRoutes } from "./routes/quota.js";
import { registerVoiceRoutes } from "./routes/voice.js";

type Sql = ReturnType<typeof postgres>;

export async function createGatewayApp(deps: {
  config: GatewayConfig;
  sql: Sql;
  redis: Redis;
  loggerInstance?: FastifyBaseLogger;
}): Promise<FastifyInstance> {
  const { config, sql, redis } = deps;
  const app = Fastify(
    deps.loggerInstance
      ? { loggerInstance: deps.loggerInstance }
      : {
          logger: {
            level: config.LOG_LEVEL,
            ...(config.NODE_ENV === "development"
              ? { transport: { target: "pino-pretty" } }
              : {}),
          },
        },
  );

  redis.on("error", (error) => {
    app.log.error({ err: error }, "redis error");
  });

  await app.register(cors, {
    origin: config.FRONTEND_ORIGIN,
    credentials: true,
    methods: corsAllowedMethods(config),
  });
  await app.register(cookie, {
    secret: config.SESSION_SECRET,
  });
  if (rateLimitEnabled(config)) {
    // Cookie is registered first so a member session can key the limiter by
    // user id. Unknown callers still key by IP. Redis-backed; skipOnError
    // fails open so a Redis blip never takes the door down.
    await app.register(rateLimit, {
      ...rateLimitPluginOptions(config, { redis }),
      redis,
    });
  }
  await app.register(multipart, {
    limits: { fileSize: config.ADMIN_INGEST_MAX_BYTES },
  });
  await app.register(websocket);
  await registerAuthRoutes(app, { config, sql, redis });
  await registerAdminRoutes(app, { config, sql });
  await registerPersonaRoutes(app, { config, sql });
  await registerChatRoutes(app, { config, sql, redis });
  await registerInsightRoutes(app, { config, sql });
  await registerAccessRoutes(app, { config, sql });
  await registerQuotaRoutes(app, { config, sql });
  await registerLifecycleRoutes(app, { config, sql, redis });
  await registerOpsRoutes(app, { config, sql, redis });
  await registerMemoryRoutes(app, { config, sql });
  await registerVoiceRoutes(app, { config, sql, redis });

  app.get("/health", async () => ({
    ok: true,
    service: "gateway",
  }));

  return app;
}
