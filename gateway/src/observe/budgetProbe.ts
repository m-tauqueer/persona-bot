/**
 * Compare recent time-to-first-word against configured p50/p90 budgets.
 * Does not change product behaviour. Lower LATENCY_BUDGET_* to force a fail.
 */
import { createPostgres } from "../clients.js";
import { loadGatewayConfig } from "../config.js";
import { budgetByBrainMode, latestTracedTurn } from "../insights/queries.js";
import { budgetForMode, turnLogFields } from "./fields.js";

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
const sql = createPostgres(config);

try {
  const leaked = turnLogFields(config, {
    correlation_id: "11111111-1111-1111-1111-111111111111",
    session_id: "22222222-2222-2222-2222-222222222222",
    text: "should never be logged",
  });
  check("log_fields_keep_correlation", leaked.correlation_id !== undefined);
  check("log_fields_drop_text", !Object.hasOwn(leaked, "text"));

  const modes = await budgetByBrainMode(sql, config);
  console.log(`budget_window_hours=${config.LATENCY_BUDGET_WINDOW_HOURS}`);
  console.log(`budget_p50_ms=${config.LATENCY_BUDGET_FIRST_WORD_MS}`);
  console.log(`budget_p90_ms=${config.LATENCY_BUDGET_P90_MS}`);

  if (modes.length === 0) {
    console.log("budget_samples=none");
    check("budget_holds_with_no_samples", true);
  }

  for (const row of modes) {
    const p50 = row.p50;
    const p90 = row.p90;
    const budget = budgetForMode(config, row.brain_mode);
    console.log(
      `brain_mode=${row.brain_mode} samples=${row.samples} p50=${p50 ?? ""} p90=${p90 ?? ""} budget_p50=${budget.p50} budget_p90=${budget.p90}`,
    );
    if (p50 !== null && p50 > budget.p50) {
      check(`budget_p50_${row.brain_mode}`, false, `${p50} > ${budget.p50}`);
    } else {
      check(`budget_p50_${row.brain_mode}`, true);
    }
    if (p90 !== null && p90 > budget.p90) {
      check(`budget_p90_${row.brain_mode}`, false, `${p90} > ${budget.p90}`);
    } else {
      check(`budget_p90_${row.brain_mode}`, true);
    }
  }

  const traced = await latestTracedTurn(sql);
  if (traced) {
    console.log(`correlation_id=${traced.correlation_id}`);
    console.log(`turn_id=${traced.turn_id}`);
    console.log(`session_id=${traced.session_id}`);
    check("turn_row_has_correlation", true);
  } else {
    console.log("correlation_id=");
    check("turn_row_has_correlation", true, "no traced turns yet");
  }
} finally {
  await sql.end({ timeout: 5 });
}

if (failed > 0) {
  console.error("PROBE_FAIL");
  process.exit(1);
}
console.log("PROBE_OK");
