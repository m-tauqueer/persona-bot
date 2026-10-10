/**
 * Cookie, CORS, browser-secret, audit-trail, and public think-endpoint checks.
 * Isolation lives in isolationProbe; this does not change call behaviour.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sessionCookieOptions } from "../auth/session.js";
import { createPostgres } from "../clients.js";
import {
  corsAllowedMethods,
  loadGatewayConfig,
  sessionCookieSecure,
  thinkEndpointUrl,
} from "../config.js";

const BROWSER_FORBIDDEN_ENV = [
  "SESSION_SECRET",
  "INTERNAL_API_SECRET",
  "GOOGLE_CLIENT_SECRET",
  "DATABASE_URL",
  "REDIS_URL",
  "ENGRAM_API_KEY",
  "ENGRAM_MEMBER_SECRET_KEY",
  "OPENAI_API_KEY",
  "DEEPGRAM_API_KEY",
  "FISH_API_KEY",
  "AZURE_STORAGE_KEY",
  "POSTGRES_PASSWORD",
] as const;

let failed = 0;

function check(name: string, ok: boolean, detail = ""): void {
  if (ok) {
    console.log(`${name}=ok${detail ? ` ${detail}` : ""}`);
    return;
  }
  console.error(`${name}=FAIL${detail ? ` ${detail}` : ""}`);
  failed += 1;
}

const config = loadGatewayConfig();
const cookie = sessionCookieOptions(config);

check("cookie_http_only", cookie.httpOnly === true);
check("cookie_signed", cookie.signed === true);
check(
  "cookie_samesite_configured",
  cookie.sameSite === config.SESSION_COOKIE_SAMESITE,
);
check(
  "cookie_secure_follows_production",
  config.NODE_ENV === "production"
    ? sessionCookieSecure(config) === true
    : true,
  `secure=${String(sessionCookieSecure(config))} node_env=${config.NODE_ENV}`,
);
check(
  "cookie_none_requires_secure",
  config.SESSION_COOKIE_SAMESITE !== "none" || sessionCookieSecure(config),
);

check("cors_origin_is_frontend", config.FRONTEND_ORIGIN.length > 0);
check("cors_methods_configured", corsAllowedMethods(config).includes("GET"));

const viteEnvPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../frontend/src/vite-env.d.ts",
);
const viteEnv = readFileSync(viteEnvPath, "utf8");
for (const name of BROWSER_FORBIDDEN_ENV) {
  check(`vite_omits_${name}`, !viteEnv.includes(name));
}

const sql = createPostgres(config);
try {
  const [orphans] = await sql<{ n: string }[]>`
    SELECT count(*)::text AS n
    FROM turns t
    LEFT JOIN sessions s ON s.id = t.session_id
    WHERE s.id IS NULL OR s.user_id IS NULL
  `;
  check(
    "turns_join_a_user",
    orphans?.n === "0",
    `${orphans?.n ?? "?"} orphan turns`,
  );

  const [sessions] = await sql<{ n: string }[]>`
    SELECT count(*)::text AS n FROM sessions WHERE user_id IS NULL
  `;
  check(
    "sessions_have_user",
    sessions?.n === "0",
    `${sessions?.n ?? "?"} sessions`,
  );
} finally {
  await sql.end({ timeout: 5 });
}

if (!config.BYO_LLM_PUBLIC_URL) {
  console.log("public_think_unauth=SKIP BYO_LLM_PUBLIC_URL is not set");
} else {
  const url = thinkEndpointUrl(config);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(config.BYO_LLM_ENDPOINT_EXTRA_HEADERS ?? {}),
      },
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(config.OIDC_HTTP_TIMEOUT_MS),
    });
    const type = response.headers.get("content-type") ?? "";
    if (response.status === 401) {
      check("public_think_unauth", true, "401");
    } else if (response.status === 200 && type.includes("application/json")) {
      check(
        "public_think_unauth",
        false,
        `JSON ${response.status} without the internal secret`,
      );
    } else {
      console.log(
        `public_think_unauth=SKIP status=${response.status} type=${type}`,
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`public_think_unauth=SKIP ${message}`);
  }
}

if (failed > 0) {
  console.error("PROBE_FAIL");
  process.exit(1);
}
console.log("PROBE_OK");
