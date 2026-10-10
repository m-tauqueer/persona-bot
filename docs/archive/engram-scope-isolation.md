# Engram scope isolation — shared is the persona, private is the member

Named plan. Owner: Tauqueer. **Do only the part he names.** Never start the next part yourself.

Companion to [ENGRAM.md](../architecture/memory.md) (the memory contract) and [ENGRAM_PRIVATE_ROLLOUT.md](engram-private-rollout.md) (how each member came to authenticate as themselves). That work made the *pools* correct. This work makes the *reads* correct: a question about the member must not be answered out of the persona's shared pool, and a question about the persona must not be answered out of the member's private pool.

Measured against the live alpha on 9 Sep 2026. Read-only probes; no writes.

---

## Problem in one page

Three separate faults stack up. Only the third is the one that was reported.

### 1. Private recall is dead right now (regression, not a design gap)

Engram's backend is on **0.5.0**. We are pinned to **SDK 0.4.0** (`uv.lock:298`). PyPI has only `0.3.0` and `0.4.0` — **0.5.0 was never published**, so `uv sync` cannot fix this.

0.5.0 changed `retrieve`: *"shared knowledge is always searched; private memory is now opt-in via `user_id`."* SDK 0.4.0's `personas.retrieve` sends `{"query", "top_k"}` and nothing else (`engram_brain.py:251` → `resources.py:873`). Under 0.5.0 that is a **shared-only** read.

Probed live with the exact body our worker sends today:

```
POST /v1/orgs/{org}/personas/{pid}/retrieve   {"query": "...", "top_k": 5}
200  scope: "shared"   tenants: ["{org}:{persona}"]   every row 2-segment
```

So `may_ground` (`engram/tenant.py:42`) is working perfectly and has simply had no private row to keep since the backend upgraded. Consequences today:

- Every answer on `/chat` and `/voice` is grounded on shared teach alone.
- The `/dashboard` memory panel is **empty for every member** — it filters to own-private-only (`turn/service.py:1132`), and no private row arrives.
- `converse` write-back still runs, so the private pools are filling up correctly. Nothing has been lost; it is only unreadable.

### 2. Even when fixed, `scope="both"` starves the member's pool

Engram's ranking protects pool membership: *"the shared pool is guaranteed roughly half the `top_k` slots."* The two pools are independent ANN indices whose scores are not the same quantity. So a single merged call structurally reserves half the budget for the persona's bio no matter how relevant the member's own history is.

### 3. One flat list gives the answerer no way to attribute a memory

`_ground_retrieve` (`turn/service.py:1046`) flattens every kept row into `memories: list[str]`, and the answer prompt calls that *"the only allowed source of facts, retrieved from your own memory"* (`reframe/defaults.py:20`). Nothing tells the model that a 2-segment row is **about the persona** and a 3-segment row is **about the caller**. Asked "what do I do?", the model does exactly what it was told: it answers from memory — the persona's memory.

That is the reported bug, and it survives fixing (1) unless the split is carried into the prompt.

---

## What Engram gives us (measured 9 Sep 2026, read-only, org key)

`POST /v1/orgs/{org}/personas/{pid}/retrieve`:

| Request | Status | `scope` | Pools | Row tenants |
| --- | --- | --- | --- | --- |
| `{query, top_k}` — what we send today | 200 | `shared` | 1 | 2-segment only |
| `+ scope="both", user_id` | 200 | `both` | 2 | 2- and 3-segment |
| `+ user_id` alone | 200 | `both` | 2 | 2- and 3-segment |
| `+ scope="private"` (**no `user_id`**) | 200 | `private` | 1 | 3-segment only |
| `+ scope="shared", user_id` | **422** | — | — | `user_id is meaningless for scope='shared'` |
| `+ any unknown field` | **422** | — | — | `extra_forbidden` |

Alias endpoints `POST .../retrieve/shared` and `POST .../retrieve/private` both return 200 with the same `{results, scope, tenants}` shape.

Two facts do a lot of work here:

- **`scope="private"` with no `user_id` defaults to the caller.** On the member-JWT path we ask for "my own pool" without naming an id. No admin-only surface, nothing to spoof, nothing to get wrong.
- **Unknown fields are 422.** A typo in a scope value fails loudly instead of silently reverting to shared-only — which is precisely how fault (1) hid for weeks.

---

## Design lock (opinionated)

### Two pools, two calls, two labelled lists

Never rebuild the single flat `memories` array. The turn path issues **two scoped retrieves in parallel** and hands the answerer two named lists. The pools are separate in Engram, separate on the wire, and separate in the prompt. One flat list is what caused this.

### The scope decision is a model output, never a rule

"Is this about the member or about the persona?" is language understanding. AGENTS.md §7 and [TRD](../architecture.md) §1.5 forbid keyword matching and intent if/else for that. It comes from a model or it does not happen. No `if "you" in text`, no pronoun tables, no question-word lists — not even as a "temporary" heuristic.

### The router runs beside retrieval, never in front of it

A classifier placed before Engram adds a full round trip to the path to first word (measured ~2.5s today). Engram's retrieve is 0.7–1.5s. So the scope decision is issued **concurrently with the two retrieves** and consumed when they land. Added latency is the classifier's overrun past Engram, not its full duration — normally zero.

### Phase 1 fails soft; Phase 2 narrows

Phase 1 always fetches both pools and lets the answerer attribute them. A wrong attribution is a prompt problem with all the evidence still present. Phase 2 drops the pool the classifier says is irrelevant — a stronger guarantee, but a wrong drop is unrecoverable. Ship the recoverable one first, hear it, then narrow.

If the classifier fails, times out, or returns anything unrecognised, **fall open to both pools**. A degraded router must never be able to starve a turn of memory.

### An empty caller pool is answered honestly, never substituted

If the member asks something self-directed and their private pool returns nothing, the persona says it does not know that yet. It must **never** serve shared rows as facts about the member — that is the reported bug in its purest form. Say-so-plainly is already in the answer prompt (`reframe/defaults.py`); this makes it per-list rather than per-turn.

Note the asymmetry: an empty *caller* pool is normal and honest. An empty *persona* pool on a persona-directed question means the owner has not taught it — also honest, and already handled.

### `may_ground` does not change

`engram/tenant.py` stays exactly as it is: unconditional, structural, independent of everything above it. Phase 1 and Phase 2 sit **on top** of it and can only ever narrow what it already permitted. A regression up here degrades recall; it cannot leak. That property is why the private rollout survived its own bugs, and it is not up for renegotiation.

### Never send `user_id` on a member turn

`scope="private"` defaults to the caller. Naming a `user_id` is the workspace-admin surface and belongs only in `lifecycle/purge.py` and admin reads. A member turn that names an id is a bug even when the id is their own.

### Scope values and the version prefix are config

`"shared"` / `"private"` / `"both"` are wire literals and the API prefix is `/v1` today, discovered by the SDK from `/config`. Both come from settings, not from string constants in the call site. The current `pool(persona_id, "shared")` hardcode (`engram_brain.py:186`) is grandfathered, not a precedent.

---

## Phase 1 — Separate the pools and restore private recall

Goal: a member's own history reaches the brain again, and the answer model can tell the persona's knowledge from the caller's. No classifier.

### Part: Pin the contract and correct the memory doc

- **1.a** Add a read-only live check that asserts the four rows of the measured table above (scope echo, pool count, tenant segment counts, and the two 422s). It runs against `PROBE_PERSONA_ID`, never a member-facing persona, and makes **no writes**.
- **1.b** Correct [ENGRAM.md](../architecture/memory.md) §2.2 — it states `retrieve` "fans out to **both** … merges by rerank" — which is the pre-0.5.0 contract and is now wrong. Record the opt-in change, the membership floor, the alias endpoints, and that SDK 0.5.0 is unpublished.
- **1.c** Correct [ENGRAM.md](../architecture/memory.md) §7's call matrix row for `retrieve`.
- Tests: the new probe skips cleanly without keys. Logic: no writes, no member-facing persona, no tenant built by hand.
- Manual: none (probe + markdown).

### Part: Scoped retrieve in the wrapper

- **2.a** Config: `ENGRAM_API_VERSION_PATH` (default `/v1`), `ENGRAM_RETRIEVE_SCOPE_SHARED` / `_PRIVATE` / `_BOTH`, `ENGRAM_RETRIEVE_TOP_K_SHARED`, `ENGRAM_RETRIEVE_TOP_K_PRIVATE`. Worker pydantic-settings; document in `.env.example`.
- **2.b** `EngramBrain.retrieve_scoped(persona_id, query, *, scope, top_k)` posting the persona endpoint over httpx with the bearer this brain already holds (`self._member_token` when member-bound, else the org key). Reuses `_read` for the 429/502/503/504 retry policy and `_map_sdk_error` for status mapping. Returns the existing `RetrieveOutcome` — parsing, including reading `tenant` off each row, is unchanged.
- **2.c** Keep `retrieve()` as-is for now so nothing else moves under us; the turn path switches in the next part.
- Tests: request body asserted field-by-field (a scope typo must reach Engram and 422, not be swallowed); member brain sends the member bearer and never the org key; no `user_id` is ever sent.
- Logic: no tenant strings built by hand; scope values and prefix from config; the API key never logged.
- Manual: none.

### Part: Two parallel retrieves on the turn path

- **3.a** Replace the single retrieve at `turn/service.py:437` with a shared read and a private read issued **concurrently**, each with its own `top_k`. Reads get **their own pool** — they must never share the write-back executor, because a queued `converse` would then sit in front of the next turn's retrieve, on the path to first word. One private read is submitted per turn; the shared read runs on the calling thread, so a turn needs a single pool slot and the shared leg can never queue.
- **3.b** The private read runs only when `member_authenticated` is true. Degraded members issue the shared read alone — same fail-closed rule as today, one fewer call rather than a fallback.
- **3.c** Keep the org-key retry fallback at `:449` for the shared read only. It must never be used for a private read: an org-key private read returns the **key owner's** pool, which is the original leak. `may_ground` would drop those rows anyway; this makes it structural, not incidental.
- **3.d** `_ground_retrieve` gains a per-pool shape and returns two lists. It keeps calling `may_ground` on every row of both — that gate stays the last word.
- Tests: both reads fire concurrently **even while the write-back pool is saturated**; a degraded member issues shared only; an org-key private read is impossible by construction; grounded/dropped counts stay per-pool and stay log-allowlisted.
- Logic: isolation, fail-closed, no `user_id` on member turns.
- Manual: with two members, ask each a self-directed question and confirm each sees only their own rows.

### Part: Labelled answer payload and honest empty pools

- **4.a** The answer payload becomes `{persona_memories, caller_memories, history, question, voice_config}` in place of the flat `memories`. Key names from config.
- **4.b** `ANSWER_SYSTEM_PROMPT` states the attribution rule: `persona_memories` are facts about the persona and its work; `caller_memories` are facts about the person being spoken to; neither may be used as the other. Facts still come only from these two lists.
- **4.c** Empty-list handling: `caller_memories` empty on a self-directed question → say so plainly, never substitute `persona_memories`. `ReframeEmptyInputError` (`reframe/answerer.py`) now fires only when **both** lists are empty.
- **4.d** `memory_refs` persistence keeps the pool each row came from so a trace can be read back.
- Tests: payload keys asserted exactly; a both-empty turn still raises; a caller-empty turn does not; the system prompt is asserted verbatim as today.
- Logic: no keyword rules in the prompt-building code — attribution is the model's job, the code only labels.
- Manual: **this is the sitting that answers the report.** Ask "what do I do?" and "what do you do?" of the same persona in one call and confirm the two answers draw on different pools.

### Part: Memory panel on the private endpoint

- **5.a** `/internal/memories` uses `scope="private"` instead of retrieving both and discarding shared client-side. The `is_own_private_pool` filter stays as defence in depth.
- Tests: existing panel tests unchanged in expectation; the request now names the private scope.
- Manual: the panel shows rows again for a credentialed member, and stays empty for a degraded one.

### Part: Probes, tests, and the isolation gate

- **6.a** `npm run isolation` asserts the positive: a member's private rows carry **their** tenant, and a self-directed question is answered from `caller_memories`.
- **6.b** Fix `engram/probe.py:98` — it calls `cache.token(..., password=...)` but `MemberSessionCache.token` is keyword-only `(*, engram_user_id, email, password_provider, force_refresh=False)`. It raises `TypeError` and no test covers it, so the live member-session probe cannot currently pass.
- **6.c** `npm run brains` re-run so the retrieve/chat comparison reflects the new shape.
- **6.d** `security` and `failures` green.
- Manual: full `isolation` + `security` run.

### Part: Phase 1 sitting and close-out

- Live call on `/voice` and a typed sitting on `/chat`, both personas, both members.
- Update [CONTEXT.md](../progress.md) and [SHIPPED.md](shipped.md) with what was measured — including the latency delta from the second retrieve, which should be ~0 because the calls are parallel.

### Phase 1 definition of done

Private recall works again; the memory panel is populated; a self-directed question is answered from the member's pool and a persona-directed one from the persona's; an empty caller pool is answered honestly rather than from shared; `may_ground` is untouched; isolation and security are green.

---

## Phase 2 — Let a model choose the scope

Do not start until Tauqueer names a part from here, and not before Phase 1 has been heard on a live call. Phase 1 may prove sufficient — if it does, this phase is dropped, not shrunk.

Goal: a clearly self-directed question never has the persona's bio in front of the answer model, and a clearly persona-directed one never has the member's history.

### Part: Scope as a structured model decision

- **7.a** Config-pluggable classifier (model, timeout, prompt from config) returning a small structured object — chosen scope plus a reason code — in the shape the controller already uses (`TRD` §1.5). Not a free-text answer, not a regex over one.
- **7.b** Issued **concurrently** with the two retrieves. It never blocks the retrieves from starting.
- **7.c** Fail open: timeout, error, or an unrecognised value → both pools, exactly as Phase 1. Recorded as a reason code, not swallowed.
- Tests: the classifier is stubbed; concurrency asserted; every failure mode falls open to both.
- Logic: **no keyword matching anywhere in this part**, including in the fallback.

### Part: Apply the decision

- **8.a** The chosen scope narrows which labelled list reaches the answerer. It can only ever remove a list, never add one and never bypass `may_ground`.
- **8.b** A narrowed-away pool is still retrieved (the calls are already in flight); the decision governs grounding, not fetching. If a later measurement shows skipping the call is worth it, that is a separate part with its own latency evidence.
- **8.c** The chosen scope and reason code join the per-turn trace and the log allowlist. Never the memory text.
- Tests: each scope narrows to the right list; a narrow to an empty list still answers honestly rather than falling back to the other pool.
- Manual: the three cases from the report — "what do I do", "what do you do", and a generic conversational turn.

### Part: Phase 2 sitting and close-out

- Live call covering all three cases plus a deliberately ambiguous one.
- Measure first-word p50/p90 against budget (`npm run budgets`) and confirm the classifier did not push it out.
- Update [CONTEXT.md](../progress.md), [TRD](../architecture.md) §1.2/§1.5, and an ADR for scope routing if it ships.

### Phase 2 definition of done

The scope decision is a model output, runs concurrently, fails open, only narrows, and the first-word budget is unchanged. Or: it was tried, measured, and dropped — recorded in [FUTURE.md](future.md) with the numbers.

---

## Cross-cutting: what must not break

- `may_ground` stays unconditional. Nothing in either phase may bypass it or make it conditional on a scope decision.
- No member turn ever sends `user_id`.
- An org-key client never issues a private read.
- Audio never goes to Engram; text only.
- No tenant string is ever built by hand.
- No keyword or intent heuristic for language understanding, in either phase, including fallbacks.
- Write-back (`converse`) behaviour is unchanged — this work is entirely about reads.
- Degraded members (no credential) keep working on shared alone. Three accounts are permanently degraded and cannot be fixed ([ENGRAM.md](../architecture/memory.md) §2.3).

---

## Config summary

```bash
# Path prefix for the Engram API. The SDK discovers this from /config; our own
# scoped calls need it explicitly. Live alpha reports "v1".
# ENGRAM_API_VERSION_PATH=/v1

# Wire values for the retrieve scope parameter. Unknown values are a 422 at
# Engram, which is the behaviour we want — a typo must fail loudly, not fall
# back to shared-only.
# ENGRAM_RETRIEVE_SCOPE_SHARED=shared
# ENGRAM_RETRIEVE_SCOPE_PRIVATE=private
# ENGRAM_RETRIEVE_SCOPE_BOTH=both

# Per-pool retrieval budgets. Two scoped calls replace one merged call, so
# these are set independently rather than splitting one top_k. The turn path
# reads only these two; ENGRAM_RETRIEVE_TOP_K is left for the contract probe.
# ENGRAM_RETRIEVE_TOP_K_SHARED=25
# ENGRAM_RETRIEVE_TOP_K_PRIVATE=25

# Retrieval pool, separate from ENGRAM_WRITEBACK_WORKERS. Reads are on the
# path to first word and must never queue behind a write-back.
# ENGRAM_RETRIEVE_WORKERS=4

# Phase 2 only. Scope classifier; runs concurrently with retrieval and falls
# open to both pools on timeout, error, or an unrecognised value.
# ENGRAM_SCOPE_ROUTER_ENABLED=false
# ENGRAM_SCOPE_ROUTER_MODEL=
# ENGRAM_SCOPE_ROUTER_TIMEOUT_SECONDS=1
# ENGRAM_SCOPE_ROUTER_SYSTEM_PROMPT=
# ENGRAM_SCOPE_ROUTER_WORKERS=4
# ENGRAM_SCOPE_ROUTER_TEMPERATURE=0
# ENGRAM_SCOPE_ROUTER_MAX_TOKENS=64
# ENGRAM_SCOPE_ROUTER_SCOPE_KEY=scope
# ENGRAM_SCOPE_ROUTER_REASON_KEY=reason
# ENGRAM_SCOPE_ROUTER_QUESTION_KEY=question
# ENGRAM_SCOPE_ROUTER_RESPONSE_FORMAT_TYPE=json_object
# ENGRAM_SCOPE_ROUTER_REASON_SHARED=persona_directed
# ENGRAM_SCOPE_ROUTER_REASON_PRIVATE=self_directed
# ENGRAM_SCOPE_ROUTER_REASON_BOTH=ambiguous
# ENGRAM_SCOPE_ROUTER_REASON_TIMEOUT=timeout
# ENGRAM_SCOPE_ROUTER_REASON_ERROR=error
# ENGRAM_SCOPE_ROUTER_REASON_UNRECOGNISED=unrecognised
# ENGRAM_SCOPE_ROUTER_REASON_DISABLED=disabled
# ENGRAM_SCOPE_ROUTER_REASON_UNAUTHENTICATED=unauthenticated
```

---

## Non-goals

- Changing what is written, or where. Write-back is correct; this is a read-path plan.
- Promoting anything from private to shared. Engram has no promotion path and neither do we.
- `BRAIN_MODE=chat`. Under 0.5.0 `chat` reads "shared + your **general** memory" (`{org}:{user}`), not the persona-private pool — a different shape that needs its own measurement. It stays a switch, and this plan does not touch it.
- Upgrading the SDK. 0.5.0 is unpublished; if it ships, replacing our httpx calls with the documented `scope=` kwarg is a later part.
- Any change to subscriptions, credentials, or `may_ground`.
