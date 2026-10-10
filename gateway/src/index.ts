import { createGatewayApp } from "./app.js";
import { createPostgres, createRedis } from "./clients.js";
import { loadGatewayConfig } from "./config.js";
import { applySessionRetention } from "./lifecycle/retain.js";

const config = loadGatewayConfig();
const sql = createPostgres(config);
const redis = createRedis(config);
const app = await createGatewayApp({ config, sql, redis });

app.addHook("onClose", async () => {
  await redis.quit();
  await sql.end({ timeout: 5 });
});

if (config.RETENTION_SWEEP_SECONDS > 0) {
  const sweepMs = config.RETENTION_SWEEP_SECONDS * 1000;
  const sweep = () => {
    applySessionRetention(sql, config, app.log)
      .then((result) => {
        if (result.sessions > 0) {
          app.log.info(result, "session retention");
        }
      })
      .catch((error: unknown) => {
        app.log.error({ err: error }, "session retention failed");
      });
  };
  sweep();
  setInterval(sweep, sweepMs);
}

await app.listen({
  host: config.GATEWAY_HOST,
  port: config.GATEWAY_PORT,
});
