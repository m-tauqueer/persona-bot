import pino from "pino";
import { createPostgres } from "../clients.js";
import { loadGatewayConfig } from "../config.js";
import { applySessionRetention } from "./retain.js";

const config = loadGatewayConfig();
const sql = createPostgres(config);
const log = pino({ level: config.LOG_LEVEL });
try {
  const result = await applySessionRetention(sql, config, log);
  console.log(`retained_sessions=${result.sessions}`);
} finally {
  await sql.end({ timeout: 5 });
}
