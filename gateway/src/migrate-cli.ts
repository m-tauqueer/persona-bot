import { createPostgres } from "./clients.js";
import { loadGatewayConfig } from "./config.js";
import { applyMigrations } from "./migrate.js";

const config = loadGatewayConfig();
const sql = createPostgres(config);
try {
  const run = await applyMigrations(sql);
  if (run.applied.length === 0 && run.skipped.length > 0) {
    console.log(`already applied: ${run.skipped.join(", ")}`);
  } else {
    console.log(`applied: ${run.applied.join(", ") || "(none)"}`);
    if (run.skipped.length > 0) {
      console.log(`skipped: ${run.skipped.join(", ")}`);
    }
  }
} finally {
  await sql.end({ timeout: 5 });
}
