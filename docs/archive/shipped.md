# Shipped (history)

What already works. **Not a build plan.** Do not start work from this file. Ground truth for behaviour is the code. Map: [README.md](README.md). Snapshot: [CONTEXT.md](../progress.md). Current work: [CALLER_MEMORY_PLAN.md](../plans/caller-memory.md). Fish/UI (paused): [PHASE_6_PLAN.md](phase-6-plan.md). Personas (built): [PHASE_5_PLAN.md](phase-5-plan.md). Later work: [FUTURE.md](future.md). Engram: [ENGRAM.md](../architecture/memory.md).

This digest replaces the completed task lists that used to live in `PHASE_PLAN.md`, `PHASE_1_PLAN.md`, `PHASE_2_PLAN.md`, `PHASE_3_PLAN.md`, and the done slices of `PRODUCTION_PLAN.md`, so agents do not treat old “do this part next” text as current work.

---

## Product today

Typed chat at `/chat`. Spoken call at `/voice` (Deepgram Voice Agent + BYO-LLM shim). Personal app at `/dashboard`. Owner app at `/admin`. Public `/status`. Waitlist Google sign-in. Daily member quotas exist as a switch (`0` is unlimited; currently off). Consent, export, delete-my-data, ended-session retention. Local ops alerts (`ops_events`). Isolation: `sessions.user_id` + published persona pin + worker identity match. Delete-my-data forgets and unsubscribes every persona that member used, not one active row. Daily member quotas stay per member when a cap is on; both caps are `0` (off) until named back on. **Local catalog can store many personas.** Owner `/admin/persona` can create or link a second persona, teach and ingest the selected row, set a TTS voice id on `voice_config`, and publish or unpublish locally (no Engram delete). Live: Engram `create` 403 with this key → paste id and link; teach and document ingest on the selected row; local publish. Sign-in does not subscribe anyone. The first think for a sitting calls Engram subscribe for **that** persona, mirrors `subscriptions` on success, logs manage-scope 403 and continues, and fails the turn if retrieve/chat return not-subscribed. **Live-checked on `/voice`:** one subscribe attempt per persona, then talk. This worker key is `org_admin` but scoped to `memory:read`/`write` plus billing/members/metrics/tokens **read** — no `org:manage`, so Engram’s Subscribers list stays empty. Filling that list is still open (broader key or their dashboard), not more grant code. Chat, voice, dashboard history, memory, and the owner conversation list take a published persona pin; missing or unpublished is the same 404 as a missing session, and a missing pin on a session list returns an empty page (no mixed Ada+Nova). `GET /api/personas` lists published rows only — drafts stay off that list. Talk still requires a pick. Typed chat stores the sitting id per (user, persona). `ENGRAM_PERSONA_ID` is seed-only when the table is empty. Leftover persona sittings: [PHASE_5_PLAN.md](phase-5-plan.md) §4. Current work: [CALLER_MEMORY_PLAN.md](../plans/caller-memory.md). Fish/UI (paused): [PHASE_6_PLAN.md](phase-6-plan.md).

Blob audio archiving is off (`VOICE_AUDIO_PERSIST_ENABLED=false`) until there is a storage account. `BRAIN_MODE=chat` is the slow switch; default is `retrieve`. Spoken calls need a live `BYO_LLM_PUBLIC_URL` (ngrok in local dev).

---

## Phases 0–1

Repo, npm workspaces + uv worker, Compose Postgres/Redis, config from `.env`, smoke checks. Postgres canonical record. Engram wrapper behind an interface. Google auth. Typed chat. Controller speak/silence (no keyword heuristics). Isolation on the session row.

---

## Phase 2 — voice (measured)

Shipping path: browser mic → gateway WS → Deepgram Voice Agent (Nova-3 STT, Aura-2 TTS, barge-in) → worker BYO-LLM (controller → Engram → speaking LLM, streamed) → speech as words arrive.

| Brain | Engram call | To first spoken word |
| --- | --- | --- |
| `retrieve` (default) | `personas.retrieve` ~0.7–1.5 s, no converse dump | **~2.5–4 s** live (`npm run brains` **2.80 s**) |
| `chat` (switch) | `personas.chat` ~11 s generation | **~12.5–14.5 s** |

`top_k=25` (10 was thin). Reframe/answer streamed; clients warmed; session lock not held across the brain. Two in-flight turns share one claimed Engram `session_id`.

What the plan got wrong (keep this):

- `LatencyReport` is one field per message, merged at `AgentAudioDone`.
- `AgentThinking` is not emitted; do not hang on it.
- Interrupted audio may never send `AgentAudioDone`; a new agent turn must clear barge-in.
- Deepgram warns `SLOW_THINK_REQUEST` at 5 s; it does not drop the call.
- No audio → `CLIENT_MESSAGE_TIMEOUT`; probes must stream silence like a browser.
- Nova-3 Voice Agent listen has no `endpointing` knob (Flux/v2 only).

Blob path proven against Azurite; real Azure credentials still unexercised. Storage failure must not end a call.

---

## Phase 3.1–3.8

Failure handling and reconnect copy. Read API (personal history, owner reconstruct). App shell: landing, `/dashboard`, `/admin`. Per-turn traces / correlation id. Latency budget check (`npm run budgets`). Security review: cookie/CORS, think-endpoint unauth 401, OpenAPI hidden, isolation probe. Gateway rate limit + worker internal-secret throttle. Memory panel identity bind.

Not built in 3.x: Azure deploy and multilingual stay in [FUTURE.md](future.md). Voice clone is paused ([PHASE_6_PLAN.md](phase-6-plan.md)), not shipped. Retrieve writes extracted caller facts as private text; it does not converse the sitting. Hang-up runs a second extract over the finished sitting ([CALLER_MEMORY_PLAN.md](../plans/caller-memory.md)). A named owner command forgets one member's private pool for one persona; it does not destroy the persona.

Engram subscribe **is** the product grant path now: first talk joins People (`members:manage`) then `personas.subscribe` (`org:manage`) and fails closed if either fails. Isolation for transcripts is still app session + identity match. Engram-side private pools are per-member as of 8 Sep 2026 — see [ENGRAM.md](../architecture/memory.md) §2.3 and §4, and the memory-isolation section below.

---

## Phase 4 product (launch-readiness, local)

Done: automated tests (Vitest + pytest, coverage floor); waitlist; daily quotas + write receipts; local ops alerts + public `/status`; data lifecycle (consent, export, delete, retention).

Not done (parked as Plan X in [FUTURE.md](future.md)): CI/CD, backups, security 2.0, Azure deploy.

---

## Engram per-member private memory

Every member turn used one org API key, so Engram resolved every conversation to the key owner and members shared that one private pool under each persona. Fixed in two layers, both live-verified 8 Sep 2026 on two Google accounts: per-subscriber isolation holds, and a member's private writes land in their own pool.

**Containment** (unconditional, survives any regression in the layer above it):

- A retrieve row grounds a reply only when it is shared persona knowledge, or private *and* we authenticated as that member (`may_ground`, `worker/src/worker/engram/tenant.py`). Unconditional — no flag turns it off. `memories` and `memories_used` come from the same filtered list, so a dropped row cannot still be persisted and re-served. Drop counts are logged (`retrieve_hits*`), never memory text.
- Private rows are refused entirely while `ENGRAM_MEMBER_SESSION_AUTH` is false. On one key the only private pool `retrieve` returns is the key owner's, and it holds everyone's turns — including for the account that owns it.
- `converse` write-back is suppressed and `BRAIN_MODE=chat` is refused at boot until members authenticate as themselves.
- Migrations `0013` and `0015` destroyed the copies that reached our Postgres: `memory_refs.memories_used` → `[]`, `turns.messages` → NULL, and pre-containment `turns.text` replaced with a visible redaction placeholder. Irreversible. Reasoning in [ENGRAM_MEMBER_PRIVATE_WORKAROUND.md](engram-member-private-workaround.md) §11.
- Write-capable probes require `PROBE_PERSONA_ID` and skip without it, so no probe writes a member-facing pool. The subscribe cache is invalidated after delete-my-data.

**Per-member credentials** (`ENGRAM_MEMBER_SESSION_AUTH=true`):

- First talk creates the member's Engram account with a password we generate and keep, encrypted at rest (AES-GCM, `ENGRAM_MEMBER_SECRET_KEY`, migration `0014`). The password can be set exactly once — an org admin cannot reset an Engram password — so it is stored, never derived from a master secret.
- `auth.login` mints a 12h JWT per member, cached in memory with a per-member mint lock. A live token costs no database read on the reply path; a cold one costs one login. `401` re-logs in once, then that turn degrades.
- `retrieve` / `converse` / `chat` run on `EngramClient(org, member_id, api_key=<JWT>)`. Everything admin-shaped — teach, shared ingest, subscribe, `user_memories`, purge, logs — stays on the org key. A member token only holds `memory:read` / `memory:write`.
- A member we cannot credential degrades **per member**: org key, shared-only grounding, no write-back, `retrieve` forced. Never member-private under the key owner. **Only three accounts are in this state:** `getcognora@gmail.com`, `tauqueer655@gmail.com`, and `mohammadtuti655@gmail.com`. Any other Google account is fine. Do not sit private-memory tests on those three.
- Delete-my-data clears the stored secret and drops the cached token. That member is shared-only afterwards — the password cannot be reissued.

Latency is unchanged: the grounding filter is in-process, and the login is once per member per 12 hours, not per turn.

**Private recall reads (9 Sep 2026).** Backend 0.5.0 made SDK 0.4.0 `retrieve` shared-only. The worker now posts two scoped retrieves in parallel (`scope` and per-pool `top_k` from config, never `user_id` on a member turn) on a dedicated retrieve pool, not the write-back pool. The answerer receives `{persona_memories, caller_memories, …}` so a self-directed question is not answered from the persona bio. An empty caller list is not filled from shared. The dashboard memory panel asks for `scope=private` and stays empty for a degraded member. Org-key fallback is shared only. `may_ground` is unchanged. A scope classifier can run beside those reads and drop one list; it is off until `ENGRAM_SCOPE_ROUTER_ENABLED=true`, fails open to both pools, and never bypasses `may_ground`. Live first-word numbers with the classifier on are not measured yet. Live `/chat` and `/voice` sittings for this read path are still outstanding.

---

## Decisions that still hold

Waitlist access (D-A). Catalog can store many personas; talk, history, and memory need a published pick (D-B). Free for now (D-C). GDPR-light (D-D). Azure later (D-E). Google-only (D-F). Single region (D-G).

Hard rules: config not magic values; no keyword/intent heuristics; never hand-build Engram tenant strings; carry persona `session_id`; text-only into Engram. Decision log: [decisions/README.md](../decisions/README.md).
