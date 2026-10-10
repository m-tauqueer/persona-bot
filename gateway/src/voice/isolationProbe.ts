/**
 * One signed-in user must never reach another user's conversation, including
 * the read API. Runs against the real HTTP handlers with two session cookies.
 */
import { randomUUID } from "node:crypto";
import { Writable } from "node:stream";
import pino from "pino";
import { nextSignInAction } from "../access/decision.js";
import { createGatewayApp } from "../app.js";
import { persistAuthSession, signSessionCookieValue } from "../auth/session.js";
import { personaEngineUserId } from "../auth/users.js";
import { createPostgres, createRedis } from "../clients.js";
import {
  isOwnerEmail,
  loadGatewayConfig,
  rateLimitEnabled,
} from "../config.js";
import {
  decodeSessionCursor,
  encodeSessionCursor,
  resolveRangeId,
} from "../insights/parse.js";
import {
  ownerLatency,
  ownerOverview,
  personalSessionDetail,
} from "../insights/queries.js";
import { type AccessStatus, SESSION_CHANNEL } from "../schema.js";

let failed = 0;

function check(name: string, ok: boolean, detail = ""): void {
  if (ok) {
    console.log(`${name}=ok${detail ? ` ${detail}` : ""}`);
    return;
  }
  console.error(`${name}=FAIL${detail ? ` ${detail}` : ""}`);
  failed += 1;
}

function tenantMentionsPersona(
  tenant: unknown,
  engramPersonaId: string,
): boolean {
  return typeof tenant === "string" && tenant.includes(engramPersonaId);
}

function privateEngramUserId(tenant: unknown): string | null {
  if (typeof tenant !== "string") return null;
  const parts = tenant.split(":");
  // Engram private tenant is `{org}:{persona}:{user}`.
  if (parts.length !== 3) return null;
  return parts[2] ?? null;
}

function privateOwnersFromMemoriesUsed(memoriesUsed: unknown): string[] {
  if (!Array.isArray(memoriesUsed)) {
    return [];
  }
  const owners: string[] = [];
  for (const row of memoriesUsed) {
    if (!row || typeof row !== "object") {
      continue;
    }
    const owner = privateEngramUserId((row as { tenant?: unknown }).tenant);
    if (owner) {
      owners.push(owner);
    }
  }
  return owners;
}

function memoryRefPool(row: unknown, key: string): string | null {
  if (!row || typeof row !== "object") {
    return null;
  }
  const value = (row as Record<string, unknown>)[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function ownsEveryPrivateRow(tenants: Iterable<string>, engramUserId: string) {
  return [...tenants].every(
    (tenant) =>
      personaEngineUserId(tenant) === personaEngineUserId(engramUserId),
  );
}

const config = loadGatewayConfig();
const sql = createPostgres(config);
const redis = createRedis(config);
const logLines: string[] = [];
const logger = pino(
  { level: "info" },
  new Writable({
    write(chunk, _encoding, callback) {
      logLines.push(chunk.toString());
      callback();
    },
  }),
);
const app = await createGatewayApp({
  config,
  sql,
  redis,
  loggerInstance: logger,
});

function logged(message: string): boolean {
  return logLines.some((line) => line.includes(message));
}

try {
  const defaultRange = resolveRangeId(config, undefined);
  check("default_range_resolves", defaultRange.ok);
  check("unknown_range_rejected", !resolveRangeId(config, "not-a-range").ok);
  if (defaultRange.ok) {
    try {
      await ownerLatency(sql, config, defaultRange.id);
      check("owner_latency_sql_ok", true);
    } catch (error) {
      check(
        "owner_latency_sql_ok",
        false,
        error instanceof Error ? error.message : String(error),
      );
    }
  }
  const cursor = encodeSessionCursor({
    started_at: new Date("2026-01-01T00:00:00.000Z"),
    id: "11111111-1111-1111-1111-111111111111",
  });
  const decoded = decodeSessionCursor(cursor);
  check(
    "session_cursor_roundtrip",
    decoded?.id === "11111111-1111-1111-1111-111111111111",
  );
  check("session_cursor_rejects_garbage", decodeSessionCursor("nope") === null);

  const users = await sql<
    {
      id: string;
      email: string;
      engram_user_id: string;
      access_status: AccessStatus | null;
    }[]
  >`
    SELECT u.id, u.email, u.engram_user_id, a.status AS access_status
    FROM users u
    LEFT JOIN access_requests a ON a.google_sub = u.google_sub
    ORDER BY u.created_at
  `;
  const owner = users.find((user) => isOwnerEmail(user.email, config)) ?? null;
  const other =
    users.find((user) => {
      if (isOwnerEmail(user.email, config)) {
        return false;
      }
      return (
        nextSignInAction({
          owner: false,
          hasUser: true,
          requestStatus: user.access_status,
        }).type === "provision"
      );
    }) ?? null;

  const cookieFor = async (userId: string) => {
    const id = await persistAuthSession(redis, config, userId);
    return `${config.SESSION_COOKIE_NAME}=${signSessionCookieValue(config, id)}`;
  };

  const get = (path: string, cookie?: string) =>
    app.inject({
      method: "GET",
      url: path,
      headers: cookie ? { cookie } : {},
    });

  const post = (path: string, cookie: string, body: Record<string, unknown>) =>
    app.inject({
      method: "POST",
      url: path,
      headers: {
        cookie,
        "content-type": "application/json",
      },
      payload: JSON.stringify(body),
    });

  const anonymous = await get("/api/me");
  check(
    "anonymous_refused",
    anonymous.statusCode === 401,
    `${anonymous.statusCode}`,
  );
  const anonymousAdmin = await get("/api/admin/overview");
  check(
    "anonymous_admin_refused",
    anonymousAdmin.statusCode === 401,
    `${anonymousAdmin.statusCode}`,
  );
  const anonymousStatus = await get(config.STATUS_API_PATH);
  check(
    "anonymous_status_ok",
    anonymousStatus.statusCode === 200,
    `${anonymousStatus.statusCode}`,
  );
  if (anonymousStatus.statusCode === 200) {
    const body = anonymousStatus.json() as {
      overall?: { label?: unknown };
      components?: unknown;
      incidents?: unknown;
      checked_at?: unknown;
    };
    check("anonymous_status_overall", typeof body.overall?.label === "string");
    check("anonymous_status_components", Array.isArray(body.components));
    check("anonymous_status_incidents", Array.isArray(body.incidents));
    check("anonymous_status_checked_at", typeof body.checked_at === "string");
    const first = Array.isArray(body.incidents) ? body.incidents[0] : null;
    if (first && typeof first === "object") {
      check(
        "anonymous_status_incident_public",
        !("correlation_id" in first) &&
          !("service" in first) &&
          !("code" in first),
      );
    }
  }

  if (rateLimitEnabled(config)) {
    check(
      "rate_limit_active",
      anonymous.headers["x-ratelimit-limit"] !== undefined,
      String(anonymous.headers["x-ratelimit-limit"] ?? ""),
    );
  } else {
    console.log("rate_limit_active=SKIP (RATE_LIMIT_ENABLED=false)");
  }

  const corsOk = await app.inject({
    method: "OPTIONS",
    url: "/api/me",
    headers: {
      origin: config.FRONTEND_ORIGIN,
      "access-control-request-method": "GET",
    },
  });
  check(
    "cors_allows_frontend_origin",
    corsOk.headers["access-control-allow-origin"] === config.FRONTEND_ORIGIN,
    String(corsOk.headers["access-control-allow-origin"] ?? ""),
  );
  check(
    "cors_allows_credentials",
    corsOk.headers["access-control-allow-credentials"] === "true",
  );
  const foreignOrigin = new URL(config.FRONTEND_ORIGIN);
  foreignOrigin.host = `not-${foreignOrigin.host}`;
  const corsForeign = await app.inject({
    method: "OPTIONS",
    url: "/api/me",
    headers: {
      origin: foreignOrigin.origin,
      "access-control-request-method": "GET",
    },
  });
  check(
    "cors_rejects_other_origin",
    corsForeign.headers["access-control-allow-origin"] !== foreignOrigin.origin,
  );

  if (!owner || !other || owner.id === other.id) {
    console.log("isolation=SKIP (needs an owner and a second app user)");
  } else {
    const ownerCookie = await cookieFor(owner.id);
    const otherCookie = await cookieFor(other.id);
    console.log(`owner=${owner.email}`);
    console.log(`other=${other.email}`);

    const meOwner = await get("/api/me", ownerCookie);
    const meOther = await get("/api/me", otherCookie);
    const ownerBody = meOwner.json() as Record<string, unknown>;
    const otherBody = meOther.json() as Record<string, unknown>;
    check(
      "separate_identities",
      meOwner.statusCode === 200 &&
        meOther.statusCode === 200 &&
        ownerBody.id === owner.id &&
        otherBody.id === other.id &&
        ownerBody.id !== otherBody.id,
    );
    check(
      "me_omits_engram_user_id",
      !Object.hasOwn(ownerBody, "engram_user_id"),
    );
    check("me_omits_google_sub", !Object.hasOwn(ownerBody, "google_sub"));

    const directory = await get("/api/personas", ownerCookie);
    const directoryBody = directory.json() as {
      personas?: { id?: string; published?: unknown }[];
    };
    check(
      "directory_lists_published",
      directory.statusCode === 200 && Array.isArray(directoryBody.personas),
      `${directory.statusCode}`,
    );
    check(
      "directory_omits_published_flag",
      (directoryBody.personas ?? []).every(
        (row) => !Object.hasOwn(row, "published"),
      ),
    );
    const chatUnpinned = await get("/api/chat", ownerCookie);
    check(
      "chat_without_pin_is_404",
      chatUnpinned.statusCode === 404,
      `${chatUnpinned.statusCode}`,
    );
    const chatConflict = chatUnpinned.json() as { error?: string };
    check(
      "chat_without_pin_matches_missing_session",
      chatConflict.error === config.INSIGHTS_ERROR_NOT_FOUND,
      `${chatConflict.error ?? ""}`,
    );

    const marker = randomUUID();
    const [draft] = await sql<{ id: string }[]>`
      INSERT INTO personas (
        engram_persona_id, handle, display_name, published
      )
      VALUES (
        ${`probe-${marker}`},
        ${`probe-${marker}`},
        ${"unpublished probe"},
        ${false}
      )
      RETURNING id
    `;
    try {
      if (draft) {
        const hidden = await get("/api/personas", ownerCookie);
        const hiddenBody = hidden.json() as { personas?: { id?: string }[] };
        check(
          "directory_hides_unpublished",
          hidden.statusCode === 200 &&
            !(hiddenBody.personas ?? []).some((row) => row.id === draft.id),
        );
        const unpublishedChat = await get(
          `/api/chat?${config.PERSONA_ID_QUERY}=${draft.id}`,
          ownerCookie,
        );
        check(
          "unpublished_persona_chat_is_404",
          unpublishedChat.statusCode === 404,
          `${unpublishedChat.statusCode}`,
        );
        const unpublishedBody = unpublishedChat.json() as { error?: string };
        check(
          "unpublished_persona_matches_missing_session",
          unpublishedBody.error === config.INSIGHTS_ERROR_NOT_FOUND,
        );
        const unpublishedMem = await get(
          `/api/me/memories?${config.PERSONA_ID_QUERY}=${draft.id}`,
          ownerCookie,
        );
        check(
          "unpublished_persona_memories_is_404",
          unpublishedMem.statusCode === 404,
          `${unpublishedMem.statusCode}`,
        );

        // Unpublish hides transcripts too, not just the picker. The owner
        // still needs the draft visible to inspect it.
        const [draftSitting] = await sql<{ id: string }[]>`
          INSERT INTO sessions (user_id, persona_id, channel)
          VALUES (${other.id}, ${draft.id}, ${SESSION_CHANNEL.TEXT})
          RETURNING id
        `;
        if (draftSitting) {
          try {
            const memberRead = await get(
              `/api/me/sessions/${draftSitting.id}`,
              otherCookie,
            );
            check(
              "unpublished_persona_transcript_is_404_for_its_member",
              memberRead.statusCode === 404,
              `${memberRead.statusCode}`,
            );
            const ownerRead = await get(
              `/api/admin/sessions/${draftSitting.id}`,
              ownerCookie,
            );
            check(
              "unpublished_persona_transcript_stays_visible_to_owner",
              ownerRead.statusCode === 200,
              `${ownerRead.statusCode}`,
            );
          } finally {
            await sql`DELETE FROM sessions WHERE id = ${draftSitting.id}`;
          }
        }
      }
    } finally {
      if (draft) {
        await sql`DELETE FROM personas WHERE id = ${draft.id}`;
      }
    }

    const publishedId = (directoryBody.personas ?? []).find(
      (row): row is { id: string } => typeof row.id === "string",
    )?.id;
    const memQuery = publishedId
      ? `/api/me/memories?${config.PERSONA_ID_QUERY}=${publishedId}`
      : "/api/me/memories";
    const ownerMem = await get(memQuery, ownerCookie);
    const otherMem = await get(memQuery, otherCookie);

    if (config.MEMORY_PANEL_ENABLED !== "true") {
      console.log("memories_panel_probe=SKIP (MEMORY_PANEL_ENABLED is off)");
    } else if (!publishedId) {
      console.log("memories_panel_probe=SKIP (no published persona)");
    } else {
      check(
        "memory_panel_owner_ok",
        ownerMem.statusCode === 200,
        `${ownerMem.statusCode}`,
      );
      check(
        "memory_panel_other_ok",
        otherMem.statusCode === 200,
        `${otherMem.statusCode}`,
      );

      if (ownerMem.statusCode !== 200 || otherMem.statusCode !== 200) {
        console.log("memory_panel_probe=SKIP (non-200 response)");
      } else {
        const ownerPanel = ownerMem.json() as {
          memories?: { tenant?: string | null }[];
        };
        const otherPanel = otherMem.json() as {
          memories?: { tenant?: string | null }[];
        };

        const ownerPrivateTenants = new Set(
          (ownerPanel.memories ?? [])
            .map((m) => privateEngramUserId(m.tenant))
            .filter((v): v is string => typeof v === "string" && v.length > 0),
        );
        const otherPrivateTenants = new Set(
          (otherPanel.memories ?? [])
            .map((m) => privateEngramUserId(m.tenant))
            .filter((v): v is string => typeof v === "string" && v.length > 0),
        );

        check(
          "memory_panel_owner_never_leaks_other_private_tenant",
          ![...ownerPrivateTenants].some(
            (tenant) =>
              personaEngineUserId(tenant) ===
              personaEngineUserId(other.engram_user_id),
          ),
        );
        check(
          "memory_panel_other_never_leaks_owner_private_tenant",
          ![...otherPrivateTenants].some(
            (tenant) =>
              personaEngineUserId(tenant) ===
              personaEngineUserId(owner.engram_user_id),
          ),
        );

        // The two checks above are negative: they passed for months while the
        // panel served a third party's pool that matched neither id. Assert
        // the positive — every private row belongs to the member reading it.
        check(
          "memory_panel_owner_private_rows_are_the_owners",
          ownsEveryPrivateRow(ownerPrivateTenants, owner.engram_user_id),
          [...ownerPrivateTenants].join(",") || "(none)",
        );
        check(
          "memory_panel_other_private_rows_are_that_member's",
          ownsEveryPrivateRow(otherPrivateTenants, other.engram_user_id),
          [...otherPrivateTenants].join(",") || "(none)",
        );
      }
    }

    if (!publishedId) {
      console.log("turn_grounding_probe=SKIP (no published persona)");
    } else {
      const grounded = await sql<
        { engram_user_id: string; memories_used: unknown }[]
      >`
        SELECT u.engram_user_id, m.memories_used
        FROM turns t
        INNER JOIN sessions s ON s.id = t.session_id
        INNER JOIN users u ON u.id = s.user_id
        LEFT JOIN memory_refs m ON m.turn_id = t.id
        WHERE s.persona_id = ${publishedId}
          AND s.user_id IN ${sql([owner.id, other.id])}
      `;
      if (grounded.length === 0) {
        console.log("turn_grounding_probe=SKIP (no turns for these members)");
      } else {
        let ownerLeaked = false;
        let otherLeaked = false;
        let ownerOwned = true;
        let otherOwned = true;
        let labelled = 0;
        let privateMislabelled = false;
        let sharedMislabelled = false;
        const poolKey = config.MEMORY_REF_POOL_KEY;
        const callerPool = config.MEMORY_REF_POOL_CALLER;
        const personaPool = config.MEMORY_REF_POOL_PERSONA;
        for (const row of grounded) {
          const memoriesUsed = row.memories_used;
          const owners = privateOwnersFromMemoriesUsed(memoriesUsed);
          if (
            personaEngineUserId(row.engram_user_id) ===
            personaEngineUserId(owner.engram_user_id)
          ) {
            if (!ownsEveryPrivateRow(owners, owner.engram_user_id)) {
              ownerOwned = false;
            }
            if (
              owners.some(
                (item) =>
                  personaEngineUserId(item) ===
                  personaEngineUserId(other.engram_user_id),
              )
            ) {
              ownerLeaked = true;
            }
          }
          if (
            personaEngineUserId(row.engram_user_id) ===
            personaEngineUserId(other.engram_user_id)
          ) {
            if (!ownsEveryPrivateRow(owners, other.engram_user_id)) {
              otherOwned = false;
            }
            if (
              owners.some(
                (item) =>
                  personaEngineUserId(item) ===
                  personaEngineUserId(owner.engram_user_id),
              )
            ) {
              otherLeaked = true;
            }
          }
          if (!Array.isArray(memoriesUsed)) {
            continue;
          }
          for (const memory of memoriesUsed) {
            const pool = memoryRefPool(memory, poolKey);
            if (pool === null) {
              continue;
            }
            labelled += 1;
            const tenant = (memory as { tenant?: unknown }).tenant;
            const privateOwner = privateEngramUserId(tenant);
            if (privateOwner !== null && pool !== callerPool) {
              privateMislabelled = true;
            }
            if (
              typeof tenant === "string" &&
              tenant.split(":").length === 2 &&
              pool !== personaPool
            ) {
              sharedMislabelled = true;
            }
          }
        }
        check("turn_grounding_owner_private_rows_are_the_owners", ownerOwned);
        check(
          "turn_grounding_other_private_rows_are_that_member's",
          otherOwned,
        );
        check("turn_grounding_owner_never_grounded_on_other", !ownerLeaked);
        check("turn_grounding_other_never_grounded_on_owner", !otherLeaked);
        if (labelled === 0) {
          console.log(
            "turn_grounding_pool_labels=SKIP (no pool field on memory_refs yet)",
          );
        } else {
          check(
            "turn_grounding_private_rows_are_caller_memories",
            !privateMislabelled,
          );
          check(
            "turn_grounding_shared_rows_are_persona_memories",
            !sharedMislabelled,
          );
        }
      }
    }

    const publishedRows = await sql<
      { id: string; engram_persona_id: string }[]
    >`
      SELECT id, engram_persona_id
      FROM personas
      WHERE published = true
      ORDER BY created_at
    `;
    const firstPersona = publishedRows[0];
    const secondPersona = publishedRows[1];
    if (!firstPersona || !secondPersona) {
      console.log("two_persona_isolation=SKIP (need two published personas)");
    } else {
      const inserted: string[] = [];
      try {
        const pairs: Array<{
          userId: string;
          personaId: string;
          name: string;
        }> = [
          { userId: owner.id, personaId: firstPersona.id, name: "owner_first" },
          {
            userId: owner.id,
            personaId: secondPersona.id,
            name: "owner_second",
          },
          { userId: other.id, personaId: firstPersona.id, name: "other_first" },
          {
            userId: other.id,
            personaId: secondPersona.id,
            name: "other_second",
          },
        ];
        const byName: Record<string, string> = {};
        for (const pair of pairs) {
          const [row] = await sql<{ id: string }[]>`
            INSERT INTO sessions (user_id, persona_id, channel)
            VALUES (${pair.userId}, ${pair.personaId}, ${SESSION_CHANNEL.TEXT})
            RETURNING id
          `;
          if (row) {
            inserted.push(row.id);
            byName[pair.name] = row.id;
          }
        }
        const pin = (personaId: string) =>
          `${config.PERSONA_ID_QUERY}=${encodeURIComponent(personaId)}`;
        const ownerFirstList = await get(
          `/api/me/sessions?${pin(firstPersona.id)}`,
          ownerCookie,
        );
        const ownerFirstBody = ownerFirstList.json() as {
          sessions?: { id?: string; user_id?: string }[];
        };
        const ownerFirstIds = new Set(
          (ownerFirstBody.sessions ?? [])
            .map((row) => row.id)
            .filter((id): id is string => typeof id === "string"),
        );
        check(
          "owner_first_list_includes_own_sitting",
          ownerFirstList.statusCode === 200 &&
            typeof byName.owner_first === "string" &&
            ownerFirstIds.has(byName.owner_first),
          `${ownerFirstList.statusCode}`,
        );
        check(
          "owner_first_list_excludes_second_persona",
          typeof byName.owner_second === "string" &&
            !ownerFirstIds.has(byName.owner_second),
        );
        check(
          "owner_first_list_excludes_other_user",
          typeof byName.other_first === "string" &&
            !ownerFirstIds.has(byName.other_first),
        );

        const otherFirstList = await get(
          `/api/me/sessions?${pin(firstPersona.id)}`,
          otherCookie,
        );
        const otherFirstBody = otherFirstList.json() as {
          sessions?: { id?: string }[];
        };
        const otherFirstIds = new Set(
          (otherFirstBody.sessions ?? [])
            .map((row) => row.id)
            .filter((id): id is string => typeof id === "string"),
        );
        check(
          "other_first_list_excludes_owner_sitting",
          otherFirstList.statusCode === 200 &&
            typeof byName.owner_first === "string" &&
            !otherFirstIds.has(byName.owner_first),
          `${otherFirstList.statusCode}`,
        );

        const otherSecondList = await get(
          `/api/me/sessions?${pin(secondPersona.id)}`,
          otherCookie,
        );
        const otherSecondIds = new Set(
          (otherSecondList.json() as { sessions?: { id?: string }[] }).sessions
            ?.map((row) => row.id)
            .filter((id): id is string => typeof id === "string") ?? [],
        );
        check(
          "other_second_list_includes_own_sitting",
          otherSecondList.statusCode === 200 &&
            typeof byName.other_second === "string" &&
            otherSecondIds.has(byName.other_second),
          `${otherSecondList.statusCode}`,
        );
        check(
          "other_second_list_excludes_owner_sitting",
          typeof byName.owner_second === "string" &&
            !otherSecondIds.has(byName.owner_second),
        );
        check(
          "other_second_list_excludes_first_persona",
          typeof byName.other_first === "string" &&
            !otherSecondIds.has(byName.other_first),
        );

        // Both directions, both personas: a leak in either one is a leak.
        for (const [name, cookie, label] of [
          ["owner_second", otherCookie, "other_user_cannot_read_owner_second"],
          ["other_first", ownerCookie, "owner_cannot_read_other_first"],
          ["other_second", ownerCookie, "owner_cannot_read_other_second"],
        ] as const) {
          const sessionId = byName[name];
          if (!sessionId) {
            continue;
          }
          const stolen = await get(`/api/me/sessions/${sessionId}`, cookie);
          check(
            `${label}_session`,
            stolen.statusCode === 404,
            `${stolen.statusCode}`,
          );
          const stolenChat = await get(
            `/api/chat?session_id=${sessionId}`,
            cookie,
          );
          check(
            `${label}_chat`,
            stolenChat.statusCode === 404,
            `${stolenChat.statusCode}`,
          );
        }

        if (byName.owner_first) {
          const stolenPinned = await get(
            `/api/me/sessions/${byName.owner_first}`,
            otherCookie,
          );
          check(
            "other_user_cannot_read_owner_first_session",
            stolenPinned.statusCode === 404,
            `${stolenPinned.statusCode}`,
          );
          const stolenChat = await get(
            `/api/chat?session_id=${byName.owner_first}`,
            otherCookie,
          );
          check(
            "other_user_cannot_read_owner_first_chat",
            stolenChat.statusCode === 404,
            `${stolenChat.statusCode}`,
          );
          const mismatched = await post("/api/chat", ownerCookie, {
            text: "persona pin must match the sitting",
            session_id: byName.owner_first,
            [config.PERSONA_ID_QUERY]: secondPersona.id,
          });
          check(
            "sitting_pin_mismatch_is_409",
            mismatched.statusCode === 409,
            `${mismatched.statusCode}`,
          );
        }

        if (config.MEMORY_PANEL_ENABLED === "true") {
          const firstMem = await get(
            `/api/me/memories?${pin(firstPersona.id)}`,
            ownerCookie,
          );
          const secondMem = await get(
            `/api/me/memories?${pin(secondPersona.id)}`,
            ownerCookie,
          );
          if (firstMem.statusCode === 200 && secondMem.statusCode === 200) {
            const firstHits = firstMem.json() as {
              memories?: { tenant?: string | null }[];
            };
            const secondHits = secondMem.json() as {
              memories?: { tenant?: string | null }[];
            };
            const firstLeaksSecond = (firstHits.memories ?? []).some((hit) =>
              tenantMentionsPersona(
                hit.tenant,
                secondPersona.engram_persona_id,
              ),
            );
            const secondLeaksFirst = (secondHits.memories ?? []).some((hit) =>
              tenantMentionsPersona(hit.tenant, firstPersona.engram_persona_id),
            );
            check("first_persona_memory_omits_second_pool", !firstLeaksSecond);
            check("second_persona_memory_omits_first_pool", !secondLeaksFirst);
          } else {
            console.log("two_persona_memory=SKIP (memory panel non-200)");
          }
        }
      } finally {
        for (const id of inserted) {
          await sql`DELETE FROM sessions WHERE id = ${id}`;
        }
      }
    }

    const [ownerSession] = await sql<{ id: string }[]>`
      SELECT s.id FROM sessions s
      WHERE s.user_id = ${owner.id}
        AND EXISTS (SELECT 1 FROM turns t WHERE t.session_id = s.id)
      ORDER BY s.started_at DESC LIMIT 1
    `;
    if (!ownerSession) {
      console.log("session_read=SKIP (owner has no session with turns)");
    } else {
      const mine = await get(
        `/api/chat?session_id=${ownerSession.id}`,
        ownerCookie,
      );
      const mineBody = mine.json() as { turns?: unknown[] };
      check(
        "owner_reads_own_session",
        mine.statusCode === 200 && (mineBody.turns?.length ?? 0) > 0,
        `${mine.statusCode}, ${mineBody.turns?.length ?? 0} turns`,
      );

      const stolen = await get(
        `/api/chat?session_id=${ownerSession.id}`,
        otherCookie,
      );
      const stolenBody = stolen.json() as { turns?: unknown[] };
      const leaked = (stolenBody.turns?.length ?? 0) > 0;
      check(
        "other_user_reads_nothing",
        stolen.statusCode === 404 && !leaked,
        `${stolen.statusCode}, ${stolenBody.turns?.length ?? 0} turns returned`,
      );
      check("other_user_chat_read_logged", logged("chat session not found"));

      const posted = await post("/api/chat", otherCookie, {
        text: "reading someone else's thread",
        session_id: ownerSession.id,
      });
      check(
        "other_user_cannot_write",
        posted.statusCode >= 400,
        `HTTP ${posted.statusCode}`,
      );
      check("other_user_chat_write_logged", logged("chat session not found"));

      const [beforeEnd] = await sql<{ ended_at: Date | null }[]>`
        SELECT ended_at FROM sessions WHERE id = ${ownerSession.id}
      `;
      const endedByOther = await post("/api/chat/end", otherCookie, {
        session_id: ownerSession.id,
      });
      check(
        "other_user_cannot_end",
        endedByOther.statusCode === 404,
        `HTTP ${endedByOther.statusCode}`,
      );
      const [afterEnd] = await sql<{ ended_at: Date | null }[]>`
        SELECT ended_at FROM sessions WHERE id = ${ownerSession.id}
      `;
      const stamp = (value: Date | null | undefined) =>
        value instanceof Date ? value.toISOString() : String(value ?? "");
      check(
        "other_user_end_leaves_sitting_untouched",
        stamp(beforeEnd?.ended_at) === stamp(afterEnd?.ended_at),
        `${stamp(beforeEnd?.ended_at)} -> ${stamp(afterEnd?.ended_at)}`,
      );

      const [audio] = await sql<{ n: string }[]>`
        SELECT count(*)::text AS n
        FROM audio_assets a
        INNER JOIN turns t ON t.id = a.turn_id
        INNER JOIN sessions s ON s.id = t.session_id
        WHERE s.user_id <> ${owner.id} AND t.session_id = ${ownerSession.id}
      `;
      check(
        "audio_scoped_to_owner",
        audio?.n === "0",
        `${audio?.n ?? "?"} rows reachable from another user`,
      );

      const stolenInsight = await get(
        `/api/me/sessions/${ownerSession.id}`,
        otherCookie,
      );
      check(
        "other_user_insight_session_404",
        stolenInsight.statusCode === 404,
        `${stolenInsight.statusCode}`,
      );
      const stolenJson = stolenInsight.json() as { error?: string };
      check(
        "other_user_insight_session_no_confirm",
        stolenJson.error === config.INSIGHTS_ERROR_NOT_FOUND,
      );
      check(
        "other_user_insight_session_no_email",
        !JSON.stringify(stolenJson).includes(owner.email),
      );
      check(
        "other_user_insight_session_logged",
        logged("personal session not found"),
      );

      const ownInsight = await get(
        `/api/me/sessions/${ownerSession.id}`,
        ownerCookie,
      );
      check(
        "owner_insight_session_ok",
        ownInsight.statusCode === 200,
        `${ownInsight.statusCode}`,
      );
    }

    const adminPaths = [
      "/api/admin/overview",
      "/api/admin/activity",
      "/api/admin/latency",
      "/api/admin/sessions",
      "/api/admin/users",
      "/api/admin/persona",
      "/api/admin/quota",
      "/api/admin/ops",
    ];
    for (const path of adminPaths) {
      const refused = await get(path, otherCookie);
      check(
        `other_user_forbidden_${path}`,
        refused.statusCode === 403,
        `${refused.statusCode}`,
      );
    }
    check("other_user_admin_logged", logged("owner route refused"));
    if (ownerSession) {
      const adminStolen = await get(
        `/api/admin/sessions/${ownerSession.id}`,
        otherCookie,
      );
      check(
        "other_user_forbidden_admin_session",
        adminStolen.statusCode === 403,
        `${adminStolen.statusCode}`,
      );
    }

    const meSessions = await get("/api/me/sessions", otherCookie);
    check("other_user_lists_own_sessions", meSessions.statusCode === 200);
    if (meSessions.statusCode === 200) {
      const listed = meSessions.json() as { sessions?: { user_id?: string }[] };
      check(
        "session_list_without_pin_empty",
        (listed.sessions ?? []).length === 0,
        `${listed.sessions?.length ?? 0} rows`,
      );
      const leakedList = (listed.sessions ?? []).some(
        (session) => session.user_id !== other.id,
      );
      check("other_user_session_list_scoped", !leakedList);
    }

    const ownerUnpinned = await get("/api/me/sessions", ownerCookie);
    if (ownerUnpinned.statusCode === 200) {
      const listed = ownerUnpinned.json() as { sessions?: unknown[] };
      check(
        "owner_session_list_without_pin_empty",
        (listed.sessions ?? []).length === 0,
        `${listed.sessions?.length ?? 0} rows`,
      );
    }

    const adminUnpinned = await get("/api/admin/sessions", ownerCookie);
    if (adminUnpinned.statusCode === 200) {
      const listed = adminUnpinned.json() as { sessions?: unknown[] };
      check(
        "owner_admin_session_list_without_pin_empty",
        (listed.sessions ?? []).length === 0,
        `${listed.sessions?.length ?? 0} rows`,
      );
    }

    const meOverview = await get("/api/me/overview", otherCookie);
    check("other_user_personal_overview", meOverview.statusCode === 200);

    if (defaultRange.ok) {
      const overviewHttp = await get(
        `/api/admin/overview?range=${encodeURIComponent(defaultRange.id)}`,
        ownerCookie,
      );
      check(
        "owner_overview_ok",
        overviewHttp.statusCode === 200,
        `${overviewHttp.statusCode}`,
      );
      if (overviewHttp.statusCode === 200) {
        const fromHttp = overviewHttp.json() as Awaited<
          ReturnType<typeof ownerOverview>
        >;
        const fromSql = await ownerOverview(sql, config, defaultRange.id);
        check(
          "owner_overview_matches_sql",
          fromHttp.sessions === fromSql.sessions &&
            fromHttp.turns === fromSql.turns &&
            fromHttp.active_users === fromSql.active_users &&
            fromHttp.median_first_word_ms === fromSql.median_first_word_ms &&
            fromHttp.p90_first_word_ms === fromSql.p90_first_word_ms &&
            fromHttp.error_rate === fromSql.error_rate &&
            JSON.stringify(fromHttp.brain_mode_split) ===
              JSON.stringify(fromSql.brain_mode_split),
        );
      }

      const latencyHttp = await get(
        `/api/admin/latency?range=${encodeURIComponent(defaultRange.id)}`,
        ownerCookie,
      );
      check(
        "owner_latency_ok",
        latencyHttp.statusCode === 200,
        `${latencyHttp.statusCode}`,
      );

      const opsHttp = await get("/api/admin/ops", ownerCookie);
      check(
        "owner_ops_ok",
        opsHttp.statusCode === 200,
        `${opsHttp.statusCode}`,
      );
      if (opsHttp.statusCode === 200) {
        const ops = opsHttp.json() as {
          health?: unknown;
          events?: unknown;
        };
        check("owner_ops_health_list", Array.isArray(ops.health));
        check("owner_ops_events_list", Array.isArray(ops.events));
      }
      const otherForce = await post("/api/admin/ops/force", otherCookie, {});
      check(
        "other_user_forbidden_ops_force",
        otherForce.statusCode === 403,
        `${otherForce.statusCode}`,
      );

      const badRange = await get(
        "/api/admin/overview?range=not-a-range",
        ownerCookie,
      );
      check(
        "unknown_range_is_400",
        badRange.statusCode === 400,
        `${badRange.statusCode}`,
      );
    }
  }

  const [persona] = await sql<{ id: string }[]>`
    SELECT id FROM personas WHERE published = true ORDER BY created_at LIMIT 1
  `;
  const scopeUser = other ?? owner ?? users[0] ?? null;
  if (persona && scopeUser) {
    const marker = randomUUID();
    const [tempUser] = await sql<{ id: string }[]>`
      INSERT INTO users (google_sub, email, engram_user_id)
      VALUES (${`probe-${marker}`}, ${`probe-${marker}@example.test`}, ${marker})
      RETURNING id
    `;
    if (tempUser) {
      const [tempSession] = await sql<{ id: string }[]>`
        INSERT INTO sessions (user_id, persona_id, channel)
        VALUES (${tempUser.id}, ${persona.id}, ${SESSION_CHANNEL.TEXT})
        RETURNING id
      `;
      try {
        if (tempSession) {
          const leaked = await personalSessionDetail(
            sql,
            tempSession.id,
            scopeUser.id,
          );
          check("query_hides_other_session", leaked === null);
          const own = await personalSessionDetail(
            sql,
            tempSession.id,
            tempUser.id,
          );
          check(
            "query_returns_own_session",
            own !== null && own.id === tempSession.id,
          );
        }
      } finally {
        if (tempSession) {
          await sql`DELETE FROM sessions WHERE id = ${tempSession.id}`;
        }
        await sql`DELETE FROM users WHERE id = ${tempUser.id}`;
      }
    }
  }
} finally {
  await app.close();
  await redis.quit();
  await sql.end({ timeout: 5 });
}

if (failed) {
  console.error(`FAIL: ${failed} check(s)`);
  process.exit(1);
}
console.log("PROBE_OK");
