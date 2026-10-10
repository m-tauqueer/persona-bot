import type { FastifyBaseLogger } from "fastify";
import type postgres from "postgres";
import type { AppUser } from "../auth/types.js";
import { callWorker } from "../clients/worker.js";
import type { GatewayConfig } from "../config.js";
import { listLocalPersonas } from "../personas.js";
import { deleteAudioBlobs } from "./blobs.js";
import { listUserAudioUrls, wipeMemberRows } from "./wipe.js";

type Sql = ReturnType<typeof postgres>;

export type EraseOutcome =
  | { ok: true; sessions: number; engram: string }
  | { ok: false; engram: string };

export function mergeEngramStatus(current: string, next: string): string {
  if (current === "skipped") {
    return next;
  }
  if (next === "skipped") {
    return current;
  }
  if (current === "ok" && next === "ok") {
    return "ok";
  }
  if (current === "failed" && next === "failed") {
    return "failed";
  }
  return "partial";
}

/**
 * Our rows are the only map back to the memory a member left in Engram, so
 * they are deleted last. "skipped" means Engram is not configured and there is
 * nothing remote to lose.
 */
export function eraseMayWipeLocalRows(engram: string): boolean {
  return engram === "ok" || engram === "skipped";
}

export async function eraseMemberAccount(
  sql: Sql,
  config: GatewayConfig,
  log: FastifyBaseLogger,
  user: AppUser,
): Promise<EraseOutcome> {
  // Every catalog persona, not only the ones we can still prove they used:
  // retention deletes ended sessions, so "used" can go quiet while the
  // member's private pool is still in Engram.
  let personas: Awaited<ReturnType<typeof listLocalPersonas>>;
  try {
    personas = await listLocalPersonas(sql);
  } catch (error) {
    log.warn(
      { err: error, userId: user.id },
      "engram purge persona lookup failed",
    );
    return { ok: false, engram: "failed" };
  }
  let engram = "skipped";
  for (const persona of personas) {
    try {
      const response = await callWorker(config, "/internal/lifecycle/purge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          engram_user_id: user.engramUserId,
          engram_persona_id: persona.engramPersonaId,
        }),
      });
      if (response.ok) {
        const body = (await response.json()) as { engram?: string };
        const next = typeof body.engram === "string" ? body.engram : "ok";
        engram = mergeEngramStatus(engram, next);
      } else {
        log.warn(
          {
            status: response.status,
            userId: user.id,
            personaId: persona.id,
          },
          "engram purge request failed",
        );
        engram = mergeEngramStatus(engram, "failed");
      }
    } catch (error) {
      log.warn(
        { err: error, userId: user.id, personaId: persona.id },
        "engram purge unavailable",
      );
      engram = mergeEngramStatus(engram, "failed");
    }
  }
  if (!eraseMayWipeLocalRows(engram)) {
    log.warn(
      { userId: user.id, engram },
      "member erase stopped before deleting local rows",
    );
    return { ok: false, engram };
  }
  const urls = await listUserAudioUrls(sql, user.id);
  await deleteAudioBlobs(config, urls, log);
  const wiped = await wipeMemberRows(sql, user.id);
  return { ok: true, sessions: wiped.sessions, engram };
}
