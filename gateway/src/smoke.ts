import { createBlobService, createPostgres, createRedis } from "./clients.js";
import { loadGatewayConfig } from "./config.js";
import { applyMigrations, formatMigrationDetail } from "./migrate.js";

type Status = "ok" | "skip" | "fail";

type Check = {
  name: string;
  status: Status;
  detail: string;
};

function optionalEnv(name: string): string | undefined {
  const value = process.env[name];
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function fail(name: string, detail: string): Check {
  return { name, status: "fail", detail };
}

function ok(name: string, detail: string): Check {
  return { name, status: "ok", detail };
}

function skip(name: string, detail: string): Check {
  return { name, status: "skip", detail };
}

async function checkPostgres(
  sql: ReturnType<typeof createPostgres>,
): Promise<Check> {
  const rows = await sql`select 1 as n`;
  if (rows[0]?.n !== 1) {
    return fail("postgres", "select 1 did not return 1");
  }
  return ok("postgres", "connected");
}

async function checkRedis(
  redis: ReturnType<typeof createRedis>,
): Promise<Check> {
  const pong = await redis.ping();
  if (pong !== "PONG") {
    return fail("redis", "PING did not return PONG");
  }
  return ok("redis", "PING PONG");
}

async function checkMigrations(
  sql: ReturnType<typeof createPostgres>,
): Promise<Check> {
  try {
    const run = await applyMigrations(sql);
    return ok("migration", formatMigrationDetail(run));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return fail("migration", detail);
  }
}

async function checkGoogle(
  config: ReturnType<typeof loadGatewayConfig>,
): Promise<Check> {
  const discovery = await fetch(config.GOOGLE_OIDC_DISCOVERY_URL);
  if (!discovery.ok) {
    return fail("google", `OIDC discovery HTTP ${discovery.status}`);
  }
  const doc = (await discovery.json()) as { token_endpoint?: unknown };
  if (typeof doc.token_endpoint !== "string") {
    return fail("google", "OIDC discovery missing token_endpoint");
  }
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: "voice-bot-smoke-not-a-code",
    client_id: config.GOOGLE_CLIENT_ID,
    client_secret: config.GOOGLE_CLIENT_SECRET,
    redirect_uri: config.GOOGLE_CALLBACK_URL,
  });
  const tokenRes = await fetch(doc.token_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const tokenJson = (await tokenRes.json()) as { error?: unknown };
  if (tokenJson.error === "invalid_client") {
    return fail("google", "client id or secret rejected (invalid_client)");
  }
  if (tokenJson.error === "redirect_uri_mismatch") {
    return fail("google", "redirect URI does not match Google Cloud Console");
  }
  if (tokenJson.error === "invalid_grant") {
    return ok(
      "google",
      "OIDC discovery ok; client accepted (invalid_grant on dummy code)",
    );
  }
  return fail(
    "google",
    `unexpected token error: ${String(tokenJson.error ?? tokenRes.status)}`,
  );
}

async function checkAzure(
  config: ReturnType<typeof loadGatewayConfig>,
): Promise<Check> {
  if (
    !config.AZURE_STORAGE_ACCOUNT ||
    !config.AZURE_STORAGE_KEY ||
    !config.AZURE_BLOB_CONTAINER
  ) {
    return skip("azure", "not configured");
  }
  const blob = createBlobService(config);
  const container = blob.getContainerClient(config.AZURE_BLOB_CONTAINER);
  const create = await container.createIfNotExists();
  const exists = await container.exists();
  if (!exists) {
    return fail("azure", "container still missing after createIfNotExists");
  }
  return ok(
    "azure",
    create.succeeded ? "container created" : "container exists",
  );
}

async function checkDeepgram(): Promise<Check> {
  const key = optionalEnv("DEEPGRAM_API_KEY");
  const base = optionalEnv("DEEPGRAM_API_BASE_URL");
  if (!key) {
    return skip("deepgram", "not configured");
  }
  if (!base) {
    return fail(
      "deepgram",
      "DEEPGRAM_API_KEY set but DEEPGRAM_API_BASE_URL missing",
    );
  }
  const res = await fetch(`${base.replace(/\/$/, "")}/v1/projects`, {
    headers: { Authorization: `Token ${key}` },
  });
  if (!res.ok) {
    return fail("deepgram", `projects HTTP ${res.status}`);
  }
  return ok("deepgram", "projects list ok");
}

async function checkOpenAI(): Promise<Check> {
  const key = optionalEnv("OPENAI_API_KEY");
  const base =
    optionalEnv("OPENAI_BASE_URL") ?? optionalEnv("OPENAI_API_BASE_URL");
  if (!key) {
    return skip("openai", "not configured");
  }
  if (!base) {
    return fail(
      "openai",
      "OPENAI_API_KEY set but OPENAI_BASE_URL / OPENAI_API_BASE_URL missing",
    );
  }
  const res = await fetch(`${base.replace(/\/$/, "")}/v1/models`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!res.ok) {
    return fail("openai", `models HTTP ${res.status}`);
  }
  const body = (await res.json()) as { data?: unknown };
  if (!Array.isArray(body.data)) {
    return fail("openai", "models response missing data array");
  }
  return ok("openai", `${body.data.length} models`);
}

async function checkEngram(): Promise<Check> {
  const key = optionalEnv("ENGRAM_API_KEY");
  const base = optionalEnv("ENGRAM_BASE_URL");
  if (!key) {
    return skip("engram", "not configured");
  }
  if (!base) {
    return fail("engram", "ENGRAM_API_KEY set but ENGRAM_BASE_URL missing");
  }
  const res = await fetch(`${base.replace(/\/$/, "")}/config`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!res.ok) {
    return fail("engram", `config HTTP ${res.status}`);
  }
  return ok("engram", "config ok");
}

async function main(): Promise<void> {
  const config = loadGatewayConfig();
  const sql = createPostgres(config);
  const redis = createRedis(config);
  const checks: Check[] = [];
  try {
    checks.push(await checkPostgres(sql));
    checks.push(await checkRedis(redis));
    checks.push(await checkMigrations(sql));
    checks.push(await checkGoogle(config));
    checks.push(await checkAzure(config));
    checks.push(await checkDeepgram());
    checks.push(await checkOpenAI());
    checks.push(await checkEngram());
  } finally {
    await sql.end({ timeout: 5 });
    redis.disconnect();
  }

  for (const check of checks) {
    const tag = check.status.toUpperCase();
    console.log(`${tag}\t${check.name}\t${check.detail}`);
  }
  const failed = checks.filter((c) => c.status === "fail");
  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

await main();
