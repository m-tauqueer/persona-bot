# Engram per-member private memory — production rollout

Owner: Tauqueer. Status: **Both phases shipped and live-verified 8 Sep 2026.** `ENGRAM_MEMBER_SESSION_AUTH=true`. Per-subscriber isolation and per-member private writes were confirmed by hand on two Google accounts. The earlier subject-ingest workaround plan is withdrawn. Nothing here is left to implement — see §Outstanding for the operator tasks that remain. Evidence: [ENGRAM_MEMBER_PRIVATE_WORKAROUND.md](engram-member-private-workaround.md). Contract: [ENGRAM.md](../architecture/memory.md) §2.3. Product map: [README.md](README.md).

Working rule: Tauqueer names **one phase and one part**. This file is not the current product plan ([CALLER_MEMORY_PLAN.md](../plans/caller-memory.md) is). If he names a leftover operator task from here, finish only that, run its manual test, stop, and **commit only when he asks**. Do not mention phase/part numbers in commit messages.

Sibling to [PHASE_5_PLAN.md](phase-5-plan.md). Personas product parts stay there. This file is the memory-isolation work.

---

## Problem in one page

**Fixed.** Historically every Cognora member talked to Engram with **one org API key**, so Engram resolved every conversation to one principal — the key owner — and all members shared that private pool under each persona. That was the "Harish" leak. Each member now authenticates as themselves and writes their own pool.

Engram is not missing an API. It derives the private pool from the authenticated principal and expects one credential per end user. We create each member's Engram account with a password (`worker/src/worker/engram/org_member.py:124`) and then throw it away (`:138`). Live-verified: with a session token from `auth.login`, `chat` / `converse` / `retrieve` land in `{org}:{persona}:{member}` and the admin pool stays empty.

Two independent pieces of work, in this order:

| Phase | Goal | Why first |
| --- | --- | --- |
| **1 — Contain** | No member ever hears, sees, or exports another member's memory, and we stop writing new contamination | Correct under **both** the current key model and the fixed one. No new dependency, no new secret, no migration. |
| **2 — Fix** | Each member authenticates as themselves; native per-member private memory returns | Needs a stored credential, a new dependency, a migration, and re-provisioning. |

### What changed from the withdrawn plan

- The old Phase 1 put the leak-stopping filter behind a flag **defaulting OFF**. Shipping it would have changed nothing until someone remembered to flip it. **Phase 1 here is unconditional.** A containment control that has an off switch is not containment.
- The old plan had no step for the leaked text we already copied into our own Postgres, which survives the victim's account deletion and is still exportable. That is now a Phase 1 part.
- Phase 2 is the native path, not a workaround. `user_memories` stays where it already belongs — the delete-my-data purge — and never becomes a recall path.

---

## Design lock (opinionated)

### One rule for grounding, correct in both worlds

Never ground a reply on a private-pool row that is not the acting member's. Today that leaves shared rows only; after Phase 2 it keeps the member's own private rows too. Same code, no flag, nothing to delete later. Express it as one named helper and use it on the answer path **and** the panel path — the two must never disagree again.

### Fail closed, never fall back

If a member's session token cannot be minted, **fail the turn**. Do not fall back to the org key. That fallback is precisely the bug being fixed, and a silent fallback would restore the leak the day an unrelated login glitch happens.

### One flag, and rollback is degraded-not-leaky

| Env | Default | Meaning when true |
| --- | --- | --- |
| `ENGRAM_MEMBER_SESSION_AUTH` | `false` | Member turns authenticate as the member |

Flag OFF is the Phase 1 state: no leak, no member-private memory, shared teach still answers. Flag ON is the Phase 2 state. Rollback is an env flip that **degrades** the product; it never re-opens the leak, because Phase 1 is not behind the flag.

### Store the password, do not derive it

The credential can be set exactly once — an org admin cannot reset a member's password (`403 platform:admin`) and re-adding does not change it. So a derived password (HMAC of a master secret) is a trap: the day the master secret rotates, **every member is permanently unreachable** and there is no recovery. Store a random per-member password encrypted at rest instead. Encryption can be re-keyed; an Engram password cannot be reset.

### Which client makes which call

| Calls | Client |
| --- | --- |
| `chat`, `converse`, `retrieve` on a member turn; memory panel retrieve | **member session token** |
| `personas.create/get/update/delete`, `teach`, `answer`, `questions`, `pool(pid,"shared")` | org key |
| `members.add`, `members.list`, `subscribe`, `unsubscribe`, `subscribers` | org key |
| `user_memories`, `forget_user_memory` (delete-my-data) | org key |
| `insights.logs` | org key |

A member token holds `["memory:read","memory:write"]` only. Asking it to subscribe or teach returns 403 — correctly.

---

## Phase 1 — what actually shipped

Shipped. Phase 1 is the containment layer, and it stays in place under Phase 2 — it is what survives a Phase 2 regression.

| Part | State |
| --- | --- |
| One grounding rule, used everywhere | shipped — `may_ground` in `worker/src/worker/engram/tenant.py`, applied to both `memories` and `memories_used` |
| Stop writing into the admin pool | shipped — write-back suppressed, `BRAIN_MODE=chat` refused at boot |
| Purge what already leaked | shipped — migration `0013`; 197 `memory_refs` and 440 `turns.messages` cleared locally |
| Keep probes off the live persona | shipped — write-capable probes require `PROBE_PERSONA_ID`; grant cache invalidated on purge |
| Sitting and close-out | shipped — live two-account sitting passed |

One rule was tightened beyond the original plan. A private row now grounds only when `ENGRAM_MEMBER_SESSION_AUTH` is true — that is, only when we actually reached Engram as that member. On one org key the only private pool `retrieve` can return is the key owner's, and it holds every member's turns; `is_own_private_pool` matches it for whoever signs in as that owner. Ownership is only meaningful once we authenticate as the member, so private rows are refused until then. `npm run isolation` now reports `memory_panel_other_private_rows_are_that_member's=ok (none)` where it previously named the admin id.

The `turns.text` decision was taken (wipe — migration `0015`). See §Outstanding below for what is still on the operator.

---

## Phase 2 — what shipped

Every member now authenticates as themselves. Live-verified 8 Sep 2026: **per-subscriber isolation holds and per-member private writes land in that member's own pool.**

| Part | State |
| --- | --- |
| Credential storage | shipped — migration `0014`, AES-GCM in `worker/src/worker/engram/member_secret.py`, key from `ENGRAM_MEMBER_SECRET_KEY` |
| Provision with a credential we keep | shipped — `ensure_org_member` stores the password encrypted alongside `engram_user_id` |
| Session token cache and member client | shipped — `worker/src/worker/engram/session.py`, 12h JWT from `auth.login` |
| Route member turns through the member client | shipped — per-turn `member_authenticated` gates grounding, write-back, and brain mode |
| Panel, export, delete-my-data | shipped — erase clears the stored secret and drops the cached token |
| Probes, tests, isolation gate | shipped — `npm run isolation` asserts turn grounding, not just the panel |
| Pre-containment transcripts | shipped — migration `0015` |

How a turn resolves its credential:

1. `_resolve_member_client` asks `MemberSessionCache` for a token. A live token is returned without touching Postgres.
2. On a miss it decrypts that member's stored password, calls `auth.login`, and caches the JWT with its own `expires_in`. The mint lock is **per member** — one member's cold login never stalls another's turn.
3. `EngramClient(org, member_id, api_key=<JWT>)` serves `retrieve` / `converse` / `chat`. Everything admin-shaped stays on the org key.
4. No credential → `member_authenticated=False` → org key, shared-only grounding, no write-back, `retrieve` forced. Never member-private under the key owner.

A `401` re-logs in once, then that turn degrades. There is no path from a failed member credential to a member-private read or write on the org key.

## Outstanding (operator, not code)

- **Engram admin-pool forget** — [ENGRAM_MEMBER_PRIVATE_WORKAROUND.md](engram-member-private-workaround.md) §10. The mixed-owner product traffic is still in the key owner's pool. Nothing writes to it any more.
- **Three permanently stranded accounts, and only these three:** `getcognora@gmail.com`, `tauqueer655@gmail.com`, and `mohammadtuti655@gmail.com` (the API key owner). We hold no credential for them and an org admin cannot reset an Engram password. They degrade to shared-only for good. Any other Google account, including later testers, gets private memory. Do not sit private-recall tests on those three.
- **Delete-my-data is a one-way door.** Erase clears the stored secret, and that member's Engram password can never be reissued, so they are shared-only afterwards. Member-facing copy for this is drafted but not shipped — see the wipe section of the workaround doc.
- Still worth asking Engram for: an org-admin-scoped session mint for a member of their own org, which would remove password custody entirely. Not a blocker.

---

## Phase 1 — Contain the leak

**Goal:** No member can hear, read, or export another member's private memory, and no new member turn adds to the admin pool. Member-private recall is empty until Phase 2 — an honest, stated tradeoff.

**Non-goals:** credentials, `auth.login`, migrations, re-provisioning, `BRAIN_MODE=chat`.

### Part: One grounding rule, used everywhere

**What**

- Add a named helper in `worker/src/worker/engram/tenant.py` for "may this retrieve row ground a reply for this member" — shared rows, plus private rows owned by the acting member. Build on the existing `private_pool_owner` / `is_own_private_pool`; do not re-count segments at call sites.
- Apply it in the `TurnRunner` retrieve branch (`worker/src/worker/turn/service.py:412-429`) before `memories` and `memories_used` are built. Today that path filters nothing.
- Keep `retrieve_memories` (`:825-849`) on the same helper so the panel and the answer path can never diverge again.
- **Unconditional.** No flag.
- Preserve empty-memory speak/silence controller behaviour. No keyword heuristics.

**Files likely touched:** `worker/src/worker/engram/tenant.py`, `worker/src/worker/turn/service.py`, `worker/tests/test_tenant.py`, `worker/tests/test_engram.py`

**Manual test**

1. Two Google accounts, one published persona. A states a private fact; B asks about it. B must not know it.
2. Owner teach still grounds replies for both, on `/chat` and `/voice`.
3. Unit: shared row passes; own-private passes; other-member private is dropped; malformed/empty tenant is dropped.

**Done when:** The answer model never receives a private row belonging to anyone but the acting member; panel and answer path share one helper; tests assert the **positive** (row owner equals the acting member), not merely "not the other user."

---

### Part: Stop writing into the shared admin pool

**What**

- Stop `converse` write-back on the member turn path while `ENGRAM_MEMBER_SESSION_AUTH` is false. `_should_write_back` / `_write_back` (`turn/service.py:758-823`).
- Refuse `BRAIN_MODE=chat` at boot while the flag is false — `personas.chat` writes the caller's pool and there is no correct caller yet. Boot-time settings validation, so the worker cannot start in a contaminating combination.
- No dual-write, no subject-ingest substitute. Phase 2 restores the write path properly.

**Files likely touched:** `worker/src/worker/turn/service.py`, `worker/src/worker/config.py`, `.env.example`, write-back tests

**Manual test**

1. Two members each take a turn with unique probe strings.
2. `user_memories(persona, admin_id)` shows **no new rows** from those turns.
3. Shared teach still readable on a later turn.
4. `BRAIN_MODE=chat` with the flag false → worker refuses to start with an explicit message.

**Done when:** No product traffic reaches the admin private pool; shared path intact.

---

### Part: Purge what already leaked out of Engram

**What**

The leak did not stay in Engram. In retrieve mode `outcome.messages` is the retrieved memory text, and it was persisted to `turns.messages` (`turn/service.py:927`) and `memory_refs.memories_used` (`:936-941`), then re-served through session detail (`gateway/src/insights/queries.ts:580,589-595`) and `/api/me/export` (`gateway/src/lifecycle/export.ts:97,140-144`). `wipeMemberRows` deletes by the deleting user's id, so one member's words inside another's rows survive that member's delete-my-data.

- A migration (or a reviewed one-off script Tauqueer runs) that clears `memory_refs.memories_used` and the retrieved-memory content in `turns.messages` for every turn taken before the Phase 1 filter shipped. Do not try to sort by owner — the rows are mixed-owner by construction. Delete them.
- Operator checklist for the Engram side: forget the admin private pool's product-traffic rows for personas that took real traffic (`user_memories` + `forget_user_memory` against the admin People id, or the dashboard Private tab). Disposable under [ENGRAM.md](../architecture/memory.md) §2.3. Do **not** migrate them into member pools — they are not any single member's.
- No automatic mass-delete in product code.

**Files likely touched:** `infra/migrations/`, `docs/ENGRAM_MEMBER_PRIVATE_WORKAROUND.md` (cleanup appendix)

**Manual test**

- After the purge, a member's session detail and `/api/me/export` contain no other member's memory text. Spot-check the known "Harish" turns.
- Admin private pool holds no product-traffic rows for the audio-bot persona.

**Done when:** No leaked text remains readable through our own API, and the Engram-side cleanup is a checklist Tauqueer has run once.

---

### Part: Keep probes off the live persona

**What**

- `worker/src/worker/engram/probe.py:44` chats to `ENGRAM_PERSONA_ID` — the real `7f5f6d3d…` — writing probe turns into a pool that grounds real member replies. `worker/src/worker/brain/probe.py:39` drives real turns through both brain modes.
- Point write-capable probes at a dedicated throwaway persona (`PROBE_PERSONA_ID` already exists in config) and skip cleanly when it is unset. Read-only probes may stay.
- Invalidate `_grant_tried` (`turn/service.py:185`) when `purge_private_pool` unsubscribes a member, so delete-my-data followed by a new turn re-subscribes without a worker restart.

**Files likely touched:** `worker/src/worker/engram/probe.py`, `worker/src/worker/brain/probe.py`, `worker/src/worker/turn/service.py`, `worker/src/worker/lifecycle/purge.py`

**Manual test**

- `uv run python -m worker.engram.probe` and `npm run brains` with `PROBE_PERSONA_ID` unset → skip; set → writes land only on the throwaway persona.
- Delete-my-data, then talk again → re-subscribed without restarting the worker.

**Done when:** No probe can write into a persona that serves members.

---

### Part: Phase 1 sitting and close-out

**Manual test (must pass before Phase 1 closes)**

| Check | Expect |
| --- | --- |
| A states a private fact | Bot answers from shared/general knowledge only |
| B asks about it | Must not know it |
| Owner teach | Both members can use it |
| Voice and typed chat | Both respect the rule |
| B's session detail and export | No text belonging to A |
| Admin `user_memories` after both turns | No new rows |

**Phase 1 definition of done**

- Grounding rule is unconditional and shared by the answer and panel paths.
- No new writes to the admin pool; `BRAIN_MODE=chat` refused while the flag is false.
- Historical leaked text purged from Postgres and from the admin pool.
- Probes cannot write to a member-facing persona.
- Member-private recall is empty by design until Phase 2.

---

## Phase 2 — Authenticate each member as themselves

**Goal:** With `ENGRAM_MEMBER_SESSION_AUTH=true`, each member's turns read and write `{org}:{persona}:{member}` natively — semantic private retrieve, Engram compression and episodes, working threads, and `BRAIN_MODE=chat` correct again.

**Depends on:** Phase 1 complete and its sitting passed.

### Part: Credential storage

**What**

- Migration `infra/migrations/0013_…`: a nullable encrypted-secret column on `users` beside `engram_user_id`.
- Add `cryptography` to `worker/pyproject.toml` (not currently a dependency). AES-GCM, key from a new env var, base64, 32 bytes. Fail boot with a clear message if the flag is on and the key is missing or malformed.
- Encrypt/decrypt helpers in the engram package, with the key never logged and never returned by any API. Add the new env var to the secrets allowlist checks that `npm run security` already runs.
- **Store, do not derive** — see the design lock. Nothing about a member's password may be recomputable from the member's identity alone.

**Files likely touched:** `infra/migrations/`, `worker/pyproject.toml`, `worker/src/worker/engram/` (new module), `worker/src/worker/config.py`, `.env.example`, worker tests

**Manual test**

- Round-trip encrypt/decrypt; wrong key fails loudly; boot refuses a malformed key when the flag is on; the secret never appears in logs or in `/api/me/export`.

**Done when:** We can store and retrieve a per-member secret safely, with no product behaviour change yet.

---

### Part: Provision members with a credential we keep

**What**

- `ensure_org_member` (`worker/src/worker/engram/org_member.py:102-139`) currently tries `password=""` first and clears the generated password at `:138`. Invert it: always generate a strong password, pass it to `members.add`, and persist it encrypted **in the same transaction that persists `engram_user_id`**.
- Handle the case Engram gives us no credential for: `members.add` returning `409 user is already a member`, or succeeding for an email that already had an Engram account. We cannot reset that password (`403 platform:admin`, measured). Fail closed with a typed, actionable error — do not talk under the org key.
- Keep `skip_org_join` for probe addresses.

**Files likely touched:** `worker/src/worker/engram/org_member.py`, `worker/src/worker/persistence/sessions.py`, `worker/src/worker/turn/service.py`, worker tests

**Manual test**

- A brand-new Google account first-talks: member row created, secret stored encrypted, `engram_user_id` persisted.
- A pre-existing Engram email: turn fails closed with an explicit message, nothing written under the org key.

**Done when:** Every member we provision has a credential we hold; every member we cannot provision fails closed.

---

### Part: Session token cache and the member client

**What**

- Mint with `auth.login(email, password)`. The response carries `token`, `token_type: "bearer"`, `expires_in: 43200` (12h).
- Cache per member: token plus expiry, refreshed before expiry with a safety margin from config (no magic numbers), thread-safe like `BrainRegistry` (`worker/src/worker/engram/registry.py`). Tokens live in memory only — never Postgres, never logs, never a trace field.
- On `401` from a member call: re-login **once**, then fail. Never fall back to the org key.
- Extend the brain factory so a member client is `EngramClient(org, member_id, api_key=<session token>)` while admin calls keep the org key. The existing per-user cache becomes meaningful for the first time.

**Files likely touched:** `worker/src/worker/engram/factory.py`, `registry.py`, `engram_brain.py`, `interface.py`, `config.py`, `.env.example`, worker tests

**Manual test**

- Live: mint for a real member, confirm the decoded `sub` equals their Engram id, and that a second turn reuses the cached token.
- Forced-expiry test: an expired token triggers exactly one re-login, and a persistent failure fails the turn.

**Done when:** A member client can be built and refreshed, with no fallback path to the org key.

---

### Part: Route member turns through the member client

**What**

- Under the flag: `retrieve`, `converse`, and `chat` on the member turn path use the member client. Admin calls stay on the org key per the design-lock table.
- Restore `converse` write-back (it was stopped in Phase 1) and allow `BRAIN_MODE=chat` when the flag is on.
- Keep the Phase 1 grounding rule in place — it now admits the member's own private rows, and still drops anyone else's. Do not remove it.
- Flag off: Phase 1 behaviour exactly.

**Files likely touched:** `worker/src/worker/turn/service.py`, `worker/src/worker/config.py`, turn tests

**Manual test**

1. Flag on. Member A states a unique fact; the reply tenant is `{org}:{persona}:{A}`.
2. `user_memories(persona, A)` has it; `user_memories(persona, B)` and `user_memories(persona, admin)` do not.
3. A asks again later — the persona remembers. B on the same persona does not know it, and still gets shared teach.
4. Voice and typed chat both.
5. First-word latency still inside budget (`npm run budgets`) — the login is once per 12h, not per turn.

**Done when:** Per-member private memory is real, measured by pool ownership, on both channels.

---

### Part: Re-provision the two existing members

**What**

- `getcognora@gmail.com` and `tauqueer655@gmail.com` have Engram accounts we hold no credential for and cannot reset. Their private pools are empty — every turn they took went to the admin's pool — so nothing is lost by re-provisioning.
- Operator checklist for Tauqueer, not product code: how to give those accounts an Engram identity we control, re-subscribe them, and clear the stale `engram_user_id` locally so first talk re-provisions.
- **Open question he must settle first:** whether `members.add` accepts a service-controlled synthetic address (e.g. `cognora-<app-user-id>@<a domain we own>`) rather than the member's Google address. Engram rejected `@example.test` as reserved and accepted a `+tag` gmail alias; a domain we own is untested. If synthetic addresses work, provisioning never collides with a pre-existing Engram account and the fail-closed branch above becomes unreachable in practice.

**Files likely touched:** `docs/ENGRAM_MEMBER_PRIVATE_WORKAROUND.md`, possibly `worker/src/worker/engram/org_member.py` if the synthetic-address answer changes provisioning

**Manual test**

- Both accounts talk on a published persona; each reply's tenant carries that member's own Engram id.

**Done when:** No member in the product is still stranded on an identity we cannot authenticate as.

---

### Part: Panel, export, and delete-my-data on the new path

**What**

- Memory panel: `retrieve_memories` via the member client now returns real own-private rows through the same grounding helper. Keep the payload shape; never hand-build a tenant string.
- `/api/me/export`: confirm it returns only the acting member's memory, and nothing from the purged historical rows.
- Delete-my-data: `purge_private_pool` already pages `user_memories` + `forget_user_memory` + `unsubscribe` per persona on the org key. Confirm it clears pools written by a member client, for both id shapes (`lifecycle/purge.py:53`).

**Files likely touched:** `worker/src/worker/turn/service.py`, `worker/src/worker/lifecycle/purge.py`, gateway/frontend only if empty-state copy changes

**Manual test**

- A's panel shows A's rows only; B's shows B's. Export matches. After A deletes their data, `user_memories(persona, A)` is empty and A's rows are gone from the panel.

**Done when:** Every member-facing read and the erase path agree with the new pools.

---

### Part: Probes, tests, and the isolation gate

**What**

- Fold the live session probe into `worker/src/worker/engram/probe.py`: provision a throwaway member on a throwaway persona, mint a token, talk, and assert the returned tenant **equals** that member's id and that the admin pool stays empty. Clean up in a `finally`. Skip cleanly without credentials.
- Fix `worker/tests/test_engram.py:112-121`, which asserts a private tenant is passed through rather than that it belongs to the caller.
- Extend `npm run isolation` beyond the memory panel to the turn grounding path.
- `npm test`, `npm run test:worker`, `npm run isolation`, `npm run security`, `npm run failures` green.

**Files likely touched:** `worker/src/worker/engram/probe.py`, `worker/tests/`, `gateway/src/voice/isolationProbe.ts`, `docs/SHIPPED.md`

**Manual test**

- Full suite green; live two-member sitting passes with the flag on.

**Done when:** A regression that reintroduces the shared principal fails a test rather than reaching a member.

---

### Phase 2 definition of done

- Flag on: member turns authenticate as the member; private pools are per member, verified by ownership assertions.
- No fallback to the org key anywhere on a member path; provisioning failures fail closed.
- Panel, export, and delete-my-data agree with the new pools.
- Both existing members re-provisioned; no stranded identities.
- `BRAIN_MODE=chat` correct again; `converse` write-back restored.
- Rollback = `ENGRAM_MEMBER_SESSION_AUTH=false` → Phase 1 behaviour: degraded, not leaking.

---

## Cross-cutting: what must not break

| Surface | Rule |
| --- | --- |
| Owner teach / answer / shared ingest | Org key, shared pool, unchanged |
| Subscribe / member join / first talk | Org key; provisioning gains a stored secret |
| Voice BYO-LLM / barge-in / Deepgram | Unchanged; only the brain's credential changes |
| Typed chat | Same turn runner path as voice |
| App session isolation | Unchanged; still mandatory |
| Delete-my-data | Org key admin surfaces; must still clear member pools |

---

## Config summary

```bash
# Master switch. ON = members authenticate as themselves (shipped, live).
# OFF = Phase 1 containment: no leak, no member-private memory.
ENGRAM_MEMBER_SESSION_AUTH=true

# Required when the switch is on. 32 random bytes, base64. Encrypts each
# member's Engram password at rest. Rotating this re-encrypts; it must never be
# used to derive a password. Boot refuses a missing or malformed key.
ENGRAM_MEMBER_SECRET_KEY=

# Refresh a 12h session token this long before it expires.
# ENGRAM_MEMBER_TOKEN_REFRESH_SKEW_SECONDS=1800

# Write-capable probes must not target a member-facing persona; they skip
# when this is unset.
# PROBE_PERSONA_ID=
```

---

## Non-goals

1. Subject (`user_id`) on `chat` / `converse` / `retrieve`. Not needed; not coming; stop asking for it.
2. The withdrawn workaround: subject ingest + `user_memories` as a recall path.
3. Dual-write of any kind.
4. Migrating historical admin-pool rows into member pools. They are mixed-owner; they get deleted.
5. One Engram org per Cognora member.
6. Treating the Engram Private-tab UI as an API.
7. Keyword/intent heuristics for speak/silence or memory ranking.
8. Starting [FUTURE.md](future.md) or the Azure deploy as part of this rollout.

Still worth asking Engram for, but not a blocker: an org-admin-scoped session mint for a member of their own org, so a backend need not hold member passwords at all. See [ENGRAM_MEMBER_PRIVATE_WORKAROUND.md](engram-member-private-workaround.md) §6.

---

## Order the work was done in

**Phase 1:** One grounding rule → Stop writing into the admin pool → Purge what already leaked → Keep probes off the live persona → Sitting and close-out.

**Phase 2:** Credential storage → Provision members with a credential we keep → Session token cache and member client → Route member turns through the member client → Panel, export, delete-my-data → Probes, tests, isolation gate → Wipe pre-containment transcripts → Sitting and close-out.

Both are shipped. The part-by-part text below is kept as the record of what each step changed and how it was tested; it is no longer a queue of work.
