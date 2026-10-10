import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const here = dirname(fileURLToPath(import.meta.url));
const coverage = JSON.parse(
  readFileSync(resolve(here, "../config/test-coverage.json"), "utf8"),
) as {
  lines: number;
  functions: number;
  branches: number;
  statements: number;
};

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: [
        "src/auth/guard.ts",
        "src/auth/owner.ts",
        "src/auth/session.ts",
        "src/auth/rateLimit.ts",
        "src/access/decision.ts",
        "src/access/me.ts",
        "src/access/parse.ts",
        "src/quota/decision.ts",
        "src/quota/settings.ts",
        "src/lifecycle/decision.ts",
        "src/lifecycle/parse.ts",
        "src/lifecycle/blobs.ts",
        "src/ops/decision.ts",
        "src/insights/parse.ts",
        "src/insights/scope.ts",
        "src/chat/sessions.ts",
        "src/chat/turns.ts",
        "src/personas.ts",
        "src/deepgram/settings.ts",
        "src/voice/transport.ts",
      ],
      thresholds: coverage,
    },
  },
});
