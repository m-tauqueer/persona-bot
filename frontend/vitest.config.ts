import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
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
  plugins: [react()],
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    setupFiles: ["src/test/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: [
        "src/lib/nav.ts",
        "src/lib/sessionState.ts",
        "src/lib/memoryPanel.ts",
        "src/lib/personaVoice.ts",
        "src/lib/publishedPersonas.ts",
        "src/lib/swarmHear.ts",
        "src/lib/voiceTranscript.ts",
        "src/app/dashboard/MemoryPanel.tsx",
      ],
      thresholds: coverage,
    },
  },
});
