# Cognora Engram member authentication — combined report

Status: **shipped and live-verified 8 Sep 2026.** `ENGRAM_MEMBER_SESSION_AUTH=true`. Per-subscriber isolation and per-member private writes confirmed by hand on two Google accounts. Two hot-path defects found in review after this report was written and fixed before shipping: the member password was re-read from Postgres on every turn despite a 12h token cache (now a lazy provider, so a warm token costs no database read), and the token mint held one global lock across the `auth.login` network call (now per member). See [ENGRAM_PRIVATE_ROLLOUT.md](engram-private-rollout.md) for the current state. Product map: [README.md](README.md).

Context7 MCP was not connected. Engram SDK 0.4.0 in the worker venv and the live alpha were the fallback.

---

## Part 1 — Credential storage

**Status:** done (unit + migrate). Live product behaviour unchanged.

**Changed:**
- `infra/migrations/0014_engram_member_secret.sql` — nullable `users.engram_member_secret`. `ADD COLUMN IF NOT EXISTS`.
- `worker/src/worker/engram/member_secret.py` — AES-256-GCM, per-record nonce, 32-byte key from `ENGRAM_MEMBER_SECRET_KEY`.
- `worker/pyproject.toml` — `cryptography`; `uv.lock` updated.
- `worker/src/worker/config.py` — `engram_member_secret_key` on `blank_optional`; boot refuses a missing/malformed key only when the session-auth flag is true.
- `gateway/src/observe/securityProbe.ts` — `ENGRAM_MEMBER_SECRET_KEY` in `BROWSER_FORBIDDEN_ENV`.
- `.env.example` documents the key.

**Tests:** `cd worker && uv sync && uv run ruff check src tests && uv run pytest -q` green; `npm run migrate` applied `0014`.

**Logic check:**
1. Secret cannot reach `/api/me/export` (SELECT is `id, email, created_at`), turn traces (`turn_log_fields` allowlist), or error messages (`MemberSecretError` never includes plaintext/ciphertext). Admin people SELECT is `id, google_sub, email, engram_user_id`. Decrypt warnings log `reason=` only.
2. Decrypt failure for one member: `_load_member_password` returns `None` (warn `decrypt_failed`). That member degrades. The worker does not die.
3. Migration is `IF NOT EXISTS`. Re-run does not rewrite ciphertext.
4. Gateway/frontend do not SELECT this column.

**Decisions:** AES-GCM via `cryptography`; key is 32 random bytes, base64, never a password derivation secret.

**Not done:** none for this part.

---

## Part 2 — Provision members with a credential we keep

**Status:** done (unit). Existing Engram members stay null-secret.

**Changed:**
- `worker/src/worker/engram/org_member.py` — always generate a password; `members.add` never gets `""`. `ConflictError` → list lookup, id without password, one warn `already_a_member`. Login checked at provision time. Probe skip unchanged.
- `worker/src/worker/persistence/sessions.py` / `admin/store.py` — one `UPDATE` for id + `COALESCE` ciphertext.
- Turn persist: id and secret in the same statement.

**Tests:** worker ruff + pytest green (see combined suite).

**Logic check:**
1. Half-written id-without-secret from this persist cannot happen: one UPDATE, one commit. Encrypt failure → ciphertext `None`, id written, secret stays null (degrade).
2. Flag false: provision/store only. `may_ground` / write-back / chat boot gates unchanged until part 4.
3. Nothing in product code still calls `members.add` with an empty password (docs still mention the old bug).
4. Operator: `SELECT id, email FROM users WHERE engram_member_secret IS NULL`.

**Decisions:** Verify `auth.login` at provision time so a stored secret is a proven password, not a value that might fail later.

**Not done:** stranded accounts cannot be re-credentialed.

---

## Part 3 — Session token cache and the member client

**Status:** done (unit). Live JWT test is skipped unless `ENGRAM_LIVE_MEMBER_SESSION_TEST=1`.

**Changed:**
- `worker/src/worker/engram/session.py` — `MemberSessionCache`, mint via `auth.login`, `expires_in` from the response, refresh skew from config, lock + LRU. `call_as_member`: one re-login on 401. Null password never calls login. Tokens in memory only.
- `factory.py` — `create_member_engram(..., api_key=token)` refuses empty token; never substitutes the org key.
- `registry.py` — replace a cached brain when the token changes.

**Chosen client strategy:** resolve the token per request, then `BrainRegistry.get(user_id, api_key=token)`. Rebuild when the token changes. Do not reuse a client built on an expired JWT.

**Tests:** worker pytest includes cache, expiry, 401 once, login failure → not an org-key client, two threads mint once, null secret short-circuit.

**Logic check:**
1. Stale client: `get` compares `uses_member_token(api_key)`. A new JWT replaces the brain. Cache `token()` refreshes when `now >= expires_at - skew`. An expired JWT is not returned as a cached token.
2. Two turns on a cold cache: mint holds the lock; one login.
3. Credential per construction: `create_engram` / `EngramBrain` without `api_key` → org key. `create_member_engram` / `EngramBrain(..., api_key=token)` → member JWT. `create_org_engram` → org key. Admin, subscribe, purge, insights, `auth.login` mint → org key. Member retrieve/chat/converse under the flag → member JWT.
4. LRU eviction closes brains no longer in the map. An in-flight holder keeps a Python reference; `close()` can fail that HTTP call. Same as the org-key registry.

**Decisions:** per-request token resolution rather than a 12h client.

**Not done:** live JWT not re-run in this sitting (`ENGRAM_LIVE_MEMBER_SESSION_TEST` unset).

---

## Part 4 — Route member turns through the member client

**Status:** code and unit matrix done. **Live flag-on sitting not run** (`ENGRAM_MEMBER_SESSION_AUTH` still false).

**Changed:**
- `TurnPlan.member_authenticated` / `engram_credential` / `app_user_id`.
- `_resolve_member_client`: flag AND a member brain. Null secret / login failure → org brain + `member_authenticated=False`.
- `may_ground(..., member_authenticated=)` per turn, not a global read.
- `_should_write_back` gated on the plan.
- Unauthenticated turns force `retrieve`, never `personas.chat` as org.
- Trace fields `member_authenticated`, `engram_credential` (allowlisted).
- Member retrieve/converse/chat via `_run_member_op` (401 retry). Grant/subscribe stay on `_brains` (org).

**Tests:** worker matrix (flag off; flag on + credential; flag on + null secret; flag on + login failure). `npm run typecheck && npm run lint && npm test` green.

**Logic check:**
1. Measured from code, not a live flag-on turn: grant/subscribe → org; retrieve/chat/converse on an authenticated plan → member; retrieve fallback after 401 → org + `member_authenticated=False`; teach/answer/questions/pool/members/user_memories/forget/insights → org.
2. Admin-shaped calls were not moved onto the member token. Symptom if they were: `403` (`memory:read/write` only).
3. Flag on: `may_ground` admits private rows only when `member_authenticated` and `is_own_private_pool` (owner equals acting member). Flag off: private rows refused.
4. Degraded turn: write-back skipped; `_write_back` returns before converse even if a claim succeeded. Unit: `test_degraded_write_back_never_converses`.
5. `BRAIN_MODE=chat` + degraded: `_conversation_mode(False)` returns `retrieve`. Chat as org is not run.

**Decisions:** degrade per member, not fail the turn. Mid-op 401 degrades that turn to org retrieve with private rows refused.

**Not done:** restart worker with flag on; Member A/B live tenant checks; stranded-account live talk; `npm run budgets` with login on the path.

---

## Part 5 — Panel, export, and delete-my-data

**Status:** code done. Live A/B panel and delete sitting not run.

**Changed:**
- Panel already uses `_resolve_member_client` + `_run_member_op` + the same `may_ground` then `is_own_private_pool`. Payload `{text, tenant}` unchanged.
- Export still calls `/internal/memories` as the acting member; archive SQL does not select the secret; 0013-cleared `messages` / `memories_used` stay empty.
- `purge_private_pool` stays on the org key; both id shapes unchanged.
- `wipeMemberRows` nulls `engram_member_secret` then deletes the user, only after `eraseMayWipeLocalRows` (purge `ok` or `skipped`).
- `TurnRunner.forget_member_session` + lifecycle purge drops the cached JWT even on partial/skipped remote purge.
- Operator copy: `docs/ENGRAM_MEMBER_PRIVATE_WORKAROUND.md` §12.

**Empty-state copy:** `VITE_EMPTY_MEMORY=Nothing stored about you yet.` still true for a degraded empty panel. **Do not ship a wording change without asking.** Proposed delete body addition: `Private memory cannot be restored afterwards. A later sign-in still works, but this persona will only use shared knowledge.`

**Tests:** worker pytest; `npm test`; isolation panel still empty under flag off.

**Logic check:**
1. Panel and answer path share `may_ground`. Panel then also requires `is_own_private_pool`, so shared teach is off the panel. A row the answer path would refuse cannot appear on the panel. Shared rows can ground a reply and stay off the panel — that is existing product behaviour.
2. After delete-my-data, a returning member talks: 409 → id stored, secret null → shared-only. They lose private memory and can never get a new Engram password.
3. Export memories come from the acting member's retrieve helper; another member's pool is not queried.
4. Partial remote purge: `eraseMayWipeLocalRows` is false → secret kept. We must not strand them if Engram still holds their pool.

**Decisions:** drop the JWT on every purge call (stop in-flight member writes); clear the secret only when local wipe is allowed.

**Not done:** live delete-my-data on a credentialed member.

---

## Part 6 — Probes, tests, and the isolation gate

**Status:** code done. Live member-session probe **skipped** (`PROBE_PERSONA_ID` unset). Isolation turn-grounding checks green on existing rows.

**Changed:**
- `worker/src/worker/engram/probe.py` — throwaway member on the throwaway persona, mint, chat, assert labelled tenant owner equals that member, admin pool does not mention the marker, cleanup in `finally`. Skip writes without `PROBE_PERSONA_ID`. Org-key chat also asserted to land on the throwaway persona when writes run.
- `gateway/src/voice/isolationProbe.ts` — turn grounding via `memory_refs.memories_used` private tenants; keep `ownsEveryPrivateRow`.
- `test_degraded_write_back_never_converses`.

**Tests:**
- `npm run typecheck && npm run lint && npm test` green
- `npm run isolation` `PROBE_OK` including `turn_grounding_*`
- `npm run security` `PROBE_OK` including `vite_omits_ENGRAM_MEMBER_SECRET_KEY=ok`
- `npm run failures` `PROBE_OK`
- `cd worker && uv run ruff check src tests` green
- `uv run python -m worker.engram.probe` — read-only OK; `member_session=SKIP PROBE_PERSONA_ID is unset`

**Logic check:**
1. If part 4 routing were reverted, `test_authenticated_op_uses_member_token_not_org` goes red first. Isolation turn grounding would still pass under containment (no other's private in `memories_used`).
2. Probe cleanup is `finally`: forget via `purge_private_pool`, `members.remove`. Mid-fail can leave a People row if remove fails; the private pool is best-effort forgotten.
3. Write-capable probes still require `PROBE_PERSONA_ID`. Unset → no write to the member-facing persona.

**Decisions:** isolation turn path is read-only on existing `memory_refs` so `npm run isolation` does not converse on the live persona.

**Not done:** live throwaway member probe (needs `PROBE_PERSONA_ID`).

---

## Part 7 — Wipe the pre-containment transcripts

**Status:** done. Migration applied locally.

**Changed:**
- `infra/migrations/0015_redact_pre_containment_transcripts.sql` — placeholder `[redacted: recorded before private memory was isolated]`. Cutoff = `schema_migrations.applied_at` for `0013_clear_leaked_memory_text.sql` (`2026-09-08 02:46:43.420409+00:00` on this database).
- `docs/ENGRAM_MEMBER_PRIVATE_WORKAROUND.md` §11 records the decision.

**Tests:** `npm run migrate` applied 0015. Local counts: pre-cutoff 440, all redacted; post-cutoff 5, none redacted; empty-string turns 0. Isolation `owner_insight_session_ok=ok 200` after the wipe. `npm run typecheck && npm run lint && npm test` green.

**Logic check:**
1. Cutoff is 0013's `applied_at`. A turn written during 0015 has `created_at` after that cutoff → untouched.
2. Re-run: `text IS DISTINCT FROM` the placeholder; later turns stay.
3. Session detail, owner conversation list, export still render the placeholder. `SpokenTranscript` keeps rows with `text.length > 0`, so redacted history shows as intentional, not as a blank bug.
4. Other conversational columns: `turns.messages` and `memory_refs.memories_used` already cleared by 0013. `stt_meta->>'transcript'` can still hold the speaker's own STT on voice turns — that is not mixed-owner retrieve text. Audio blobs unchanged.

**Decisions:** placeholder rather than `''` because `turns.text` is `NOT NULL` and empty would look like a missing write.

**Not done:** none for this part.

---

## Part 8 — Sitting, leftovers, and close-out

**Status:** blocked.

Needs **two Google accounts that have never been joined to Engram**. These three cannot hold a member credential: `getcognora@gmail.com`, `tauqueer655@gmail.com`, `mohammadtuti655@gmail.com`.

`docs/SHIPPED.md`, `docs/ENGRAM_PRIVATE_ROLLOUT.md` status lines, and `docs/ENGRAM.md` §2.3 / §11 were **not** updated.

Engram admin-pool forget (`ENGRAM_MEMBER_PRIVATE_WORKAROUND.md` §10) was not walked; Tauqueer runs it.

---

# Combined report

## What changed, in one paragraph

The worker can now store an encrypted Engram password per member, mint a 12-hour session JWT, and — when `ENGRAM_MEMBER_SESSION_AUTH` is true — run retrieve/converse/chat as that member so private memory is `{org}:{persona}:{member}`. Members we cannot credential (null secret, login failure, decrypt failure, stranded emails) keep talking on the org key with `member_authenticated=False`, so `may_ground` still refuses every private row and converse write-back stays off. Delete-my-data nulls the stored secret (password cannot be reissued) and drops the in-memory token. Pre-containment `turns.text` is redacted. The flag is still false, so the running product is still containment: shared teach only, no member-private recall.

## Credential model

Provision: `members.add(email, password=<random>)`. If `auth.login` accepts it, encrypt and persist in the same UPDATE as `engram_user_id`. If 409 or login miss: store the id, secret null, one warn, turn continues. Mint: org-key `auth.login`, cache token + `expires_in`, refresh by `ENGRAM_MEMBER_TOKEN_REFRESH_SKEW_SECONDS` (default 1800). Failure points: missing key → cannot encrypt (null secret); decrypt fail → degrade; login fail → degrade; 401 → one re-login then degrade; never fall back to the org key *for a private read or write*.

## Degradation

Today, with the flag false, **every** member is unauthenticated for grounding (`member_authenticated=False`). Known stranded forever: `getcognora@gmail.com`, `tauqueer655@gmail.com`, `mohammadtuti655@gmail.com`. After delete-my-data, that member is permanently shared-only. Ops see `member_authenticated` and `engram_credential` on the turn log (allowlist). `engram_credential_unavailable` warn with `reason=` (`already_a_member`, `password_not_accepted`, `decrypt_failed`, `secret_key_missing`, `encrypt_failed`).

## Which credential makes which call

| Call | Credential |
| --- | --- |
| `auth.login` | org key |
| `members.add` / `list` / `remove` | org key |
| `subscribe` / `unsubscribe` / `subscribers` | org key |
| `personas.create/get/update/delete`, `teach`, `answer`, `questions`, `pool(pid,"shared")` | org key |
| `user_memories` / `forget_user_memory` | org key |
| `insights.logs` | org key |
| `retrieve` / `converse` / `chat` on an authenticated member turn | member JWT |
| same calls when degraded or flag off | org key, with private rows refused and converse skipped |

Not live-measured on a flag-on member turn in this sitting.

## Changes by part

See parts 1–8 above.

## Full test run

| Command | Result |
| --- | --- |
| `cd worker && uv run ruff check src tests` | All checks passed |
| `cd worker && uv run pytest -q` | 156 passed, 1 skipped |
| `npm run typecheck` | green |
| `npm run lint` | Checked 111 files, no fixes |
| `npm test` | gateway 138, frontend 47, worker 156 passed / 1 skipped |
| `npm run isolation` | `PROBE_OK` including `turn_grounding_*` |
| `npm run security` | `PROBE_OK` including `vite_omits_ENGRAM_MEMBER_SECRET_KEY=ok` |
| `npm run failures` | `PROBE_OK` |
| `npm run migrate` | applied `0015` |
| `uv run python -m worker.engram.probe` | `PROBE_OK`; member session skipped (no `PROBE_PERSONA_ID`) |
| `npm run budgets` | **not run** (part 4 live / part 8) |
| `ENGRAM_LIVE_MEMBER_SESSION_TEST=1` JWT | **not re-run** this sitting |

## Live sitting results

Not run. Flag still false. Need two never-joined Google accounts.

## Data destroyed

- **0014:** no data destroyed; adds a nullable column.
- **0015:** 440 pre-cutoff `turns.text` values replaced with `[redacted: recorded before private memory was isolated]`. 5 later turns untouched. Cannot be recovered.

## Security review of the new secret

- At rest: AES-GCM ciphertext in `users.engram_member_secret`. Key only on the worker (`ENGRAM_MEMBER_SECRET_KEY`). A 32-byte key was written into local `.env` (gitignored); flag left false.
- Who can read plaintext: the worker, after decrypt, in memory for login. Gateway/frontend never SELECT it.
- Leak checks: not in export, traces, admin people list, Vite env (`npm run security`). Session JWTs are not logged; `_login_token` is proof-only.
- Encryption can be re-keyed; an Engram password cannot.

## What is still broken or unverified

- Flag-on routing not live-tested.
- Member-session probe skipped without `PROBE_PERSONA_ID`.
- Live JWT mint not re-run this sitting.
- `npm run budgets` not run with login on the path.
- Admin-pool forget (§10) not run.
- Stranded three stay shared-only forever.
- Members provisioned before the secret key existed in `.env` have null secrets until they are somehow re-credentialed (they cannot be).
- `stt_meta` may still hold the speaker's own STT transcript on old voice turns.
- If `LOG_TURN_FIELDS` is overridden in some environment without the new names, identity fields will not appear (this `.env` did not override; failures probe showed them).

## Rollback

- Part 1: drop the column (data loss of ciphertext). Key unused if flag false.
- Part 2: old members already have ids; secrets stay until wiped.
- Part 3: in-memory only; restart clears tokens.
- Part 4: `ENGRAM_MEMBER_SESSION_AUTH=false` restores containment. Do not remove `may_ground`.
- Part 5: delete-my-data clearing the secret **cannot be undone** for that member.
- Part 7: 0015 **cannot be undone**. Transcripts are gone.
- Do not derive a replacement password. There is no reset.
