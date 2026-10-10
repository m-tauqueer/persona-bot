/**
 * Watch probe: local health plus a forced alert row.
 * Gateway/worker /health SKIP when those processes are not running.
 */
import { createPostgres, createRedis } from "../clients.js";
import { loadGatewayConfig } from "../config.js";
import { forcedOpsEvent } from "../ops/decision.js";
import { insertOpsEvent, listOpsEvents } from "../ops/store.js";

let failed = 0;

function check(name: string, ok: boolean, detail = ""): void {
  if (ok) {
    console.log(`${name}=ok${detail ? ` ${detail}` : ""}`);
    return;
  }
  console.error(`${name}=FAIL${detail ? ` ${detail}` : ""}`);
  failed += 1;
}

function skip(name: string, detail: string): void {
  console.log(`${name}=SKIP ${detail}`);
}

function bindHealthUrl(host: string, port: number): string {
  const hostname = host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;
  return `http://${hostname}:${port}/health`;
}

async function pingJsonOk(url: string, timeoutMs: number): Promise<boolean> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    return false;
  }
  const body = (await response.json()) as { ok?: unknown };
  return body.ok === true;
}

const config = loadGatewayConfig();
const sql = createPostgres(config);
const redis = createRedis(config);

try {
  try {
    const rows = await sql<{ n: number }[]>`select 1 as n`;
    check("postgres", rows[0]?.n === 1);
  } catch (error) {
    check(
      "postgres",
      false,
      error instanceof Error ? error.message : String(error),
    );
  }

  try {
    const pong = await redis.ping();
    check("redis", pong === "PONG");
  } catch (error) {
    check(
      "redis",
      false,
      error instanceof Error ? error.message : String(error),
    );
  }

  const gatewayUrl = bindHealthUrl(config.GATEWAY_HOST, config.GATEWAY_PORT);
  try {
    check(
      "gateway_health",
      await pingJsonOk(gatewayUrl, config.OPS_HEALTH_TIMEOUT_MS),
    );
  } catch (error) {
    skip(
      "gateway_health",
      error instanceof Error ? error.message : String(error),
    );
  }

  const workerUrl = `${config.WORKER_URL.replace(/\/$/, "")}/health`;
  try {
    check(
      "worker_health",
      await pingJsonOk(workerUrl, config.OPS_HEALTH_TIMEOUT_MS),
    );
  } catch (error) {
    skip(
      "worker_health",
      error instanceof Error ? error.message : String(error),
    );
  }

  const forced = forcedOpsEvent(config);
  check("forced_payload", forced !== null);
  if (forced) {
    const id = await insertOpsEvent(sql, forced);
    const listed = await listOpsEvents(sql, config.OPS_LIST_LIMIT);
    const found = listed.find((event) => event.id === id);
    check("forced_event_stored", found?.code === config.OPS_FORCE_CODE, id);
    check(
      "forced_event_listed",
      found !== undefined,
      found ? found.created_at : "",
    );
  }
} finally {
  await sql.end({ timeout: 5 });
  redis.disconnect();
}

if (failed > 0) {
  console.error("PROBE_FAIL");
  process.exit(1);
}
console.log("PROBE_OK");
