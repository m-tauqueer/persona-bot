# Engram contract (this product)

How Engram actually works, read from the live alpha docs on 7 Sep 2026 and re-measured against the live API on 8 Sep 2026, then mapped onto this codebase. **This file is the Engram source of truth for agents.** Do not re-infer isolation from memory. When the live site disagrees with this file, update this file and the TRD together. Product map: [README.md](../README.md). Snapshot: [progress.md](../progress.md). Current work ([caller-memory.md](../plans/caller-memory.md), [0009](../decisions/0009-private-is-extracted-caller-facts.md)): retrieve writes extracted caller facts as private text; it does not converse the sitting. Hang-up runs a second extract over the finished sitting. A named owner command forgets one member's private pool for one persona; it does not destroy the persona.

- Docs: <https://engram-docs-alpha.netlify.app/>
- Agent index: <https://engram-docs-alpha.netlify.app/llms.txt>
- API: `https://api-engram-alpha.getmetacognition.com`
- SDK: `pip install engram-ai-sdk` (import `engram_sdk`)
- Context7 MCP was not connected when this was written; every page below was fetched from the site.

Pages crawled (all 200 unless noted): home, quickstart, changelog, authentication, `llms.txt`; concepts: architecture, persona-memory, taxonomy, metrics; ingestion: overview, text, images, audio, video, documents, conversations, batch, consent, perception, structured; SDK: overview, tenants, personas, memory, conversation, sessions, threads, ingest, errors, collections, auth, tokens, account, admin, members, orgs, platform, billing, insights, audit, metrics, models; API: logs, metrics; examples: overview, knowledge-backfill, meeting-recorder, multimodal-agent, support-copilot, visual-journal; cookbooks: overview, agent-memory, conversation-memory, knowledge-base, set-up-team, rotate-keys, billing-limits, usage-dashboard.

404s that look like they should exist: `/sitemap.xml`, `/llms-full.txt`, `/concepts/isolation`, `/concepts/adr-003`. ADR-003 is linked from persona-memory to a private GitHub repo; the isolation design is restated on `/concepts/persona-memory`.

---

## 1. What Engram is (and is not)

Engram is a **memory database** behind a backend that does auth, tenant isolation, billing, and audit. Content is perceived, embedded, admitted or absorbed, and the graph reorganizes between writes. Retrieval is relevance-ranked, not a SQL filter.

It is **not** our app database. Postgres stays the canonical transcript. Redis stays ephemeral. Azure Blob stays audio (when on). Engram holds **what the persona knows** and **what this member told that persona**.

Three Engram objects that are easy to confuse, and that we must not mix:

| Name | What it is | This product |
| --- | --- | --- |
| `sessions.open/close` | Groups generic `memory.ingest` writes on `{org}` or `{org}:{user}` | **Do not use** for persona chat |
| Persona `session_id` | One conversation thread in `{org}:{persona}:{user}` | **This is our thread.** Carry it on `chat` / `retrieve`. The retrieve path no longer converse-writes. |
| `threads.*` | Verbatim append-only log (core conversational mode) | **Do not use** |

`sessions.list()` after persona chats is empty, correctly. Reaching for it to find chats is the wrong object.

---

## 2. Tenants and pools

A tenant is the isolation boundary. Every memory lives under exactly one. The backend **derives** tenant strings server-side and hashes them to a collision-free 32-bit prefix. The engine cannot cross tenants.

### 2.1 Four addresses (docs disagree on how many; all four exist)

Taxonomy/auth pages still describe `{org}` and `{org}:{user}` plus isolation modes (`strict` / `org` / `global`). Persona pages add two more. **For this product we use the persona pair. We do not write conversation into `{org}:{user}`.**

| Tenant | Pool | What it holds | How we reach it |
| --- | --- | --- | --- |
| `{org}` | workspace | generic org memory | `EngramClient("org")` — we only use this for `insights.logs` |
| `{org}:{user}` | **user personal** | that member’s general memory, **not** a persona chat | `EngramClient(org, user)` then `ingest.*` — **do not put chats here** |
| `{org}:{persona}` | **persona shared** | what the owner taught this persona | `personas.teach` / `answer` / `pool(pid, "shared")` / `shared(pid)` |
| `{org}:{persona}:{user}` | **persona private** | one member’s conversations with **that** persona | **persona endpoints only** (`chat`, `converse`, `retrieve`, `private`) |

**Never build a tenant string with an f-string.** `scoped(f"{org}:{persona}:{user}")` is refused on generic `/t/{tenant}` routes **by design** (403). Those routes have no subscription check; serving them would let a member read another member’s chats by editing a URL.

Our worker binds `EngramClient(org_id, engram_user_id)` and then calls `personas.*`. The persona id is an argument, not a hand-built tenant — that part is right. **But the bind does not choose the private pool.** See §2.4.

Each member’s Engram `user_id` is the app user UUID as **32 hex characters** (no hyphens). App `users.id` stays a Postgres uuid. Subscribe `body.user_id` is capped at 32 characters; a hyphenated UUID is 36 and Engram returns 422. The same hex string is used for the client bind and for `personas.subscribe`, so grant and retrieve address one identity.

### 2.2 Shared vs private (the product rule)

Two pools sit under one persona and **never mix**. Nothing from a conversation is promoted to shared.

- **Shared** = who the persona **is**. Owner teach / question bank / shared document ingest. Every subscriber of that persona reads it. Alice’s chat with Ada does not appear here.
- **Private** = what **this member** and **this persona** have said to each other. Only that member (and a workspace admin) reads it. Kwame talking to Ada cannot see Alice’s Ada chats. Alice talking to Nova cannot see her own Ada chats — different private tenant.

`personas.retrieve` is **not** a guaranteed union of the two pools. Backend **0.5.0** (measured 9 Sep 2026) made private memory **opt-in**: shared knowledge is always searched; the caller's private pool is included only when the body names `user_id` or `scope="both"` / `scope="private"`. A body of `{query, top_k}` — which is what SDK **0.4.0** sends — is a **shared-only** read. The two pools are independent ANN indices; under `scope="both"` Engram still reserves roughly half of `top_k` for shared (a membership floor), so a long private history cannot take every slot.

Alias routes `POST .../retrieve/shared` and `POST .../retrieve/private` return the same `{results, scope, tenants}` shape. Unknown body fields are a **422** (`extra_forbidden`). `user_id` with `scope="shared"` is also a **422**. `scope="private"` with no `user_id` defaults to the authenticated caller — that is the member-JWT path. Naming `user_id` is the workspace-admin surface.

SDK **0.5.0** (the `scope=` kwarg on `personas.retrieve`) was **never published**. PyPI has `0.3.0` and `0.4.0` only. We stay on 0.4.0 and post scoped bodies ourselves; do not wait on `uv sync` to restore private recall.

Read `tenant` and `text` off **each result row**. The top-level `tenants` list only names the pools searched. `zip(results, tenants)` mislabels every hit past the second.

Each pool numbers `gid`s from 1001 independently. `404 engine 404: gid 1023` means **wrong pool**, not deleted. `personas.node(pid, gid, scope="shared"|"private")` must name the pool.

### 2.3 Conversation identity is the credential, not the bound user (measured 8 Sep 2026)

`chat`, `converse`, and `retrieve` send **only** the persona id and the message. There is no `user_id` in the body, the query, or a header. The subject is whoever the bearer token authenticates as. `EngramClient(org, user_id)` uses `user_id` for the generic `/t/{tenant}` routes and as the default metrics subject — **the persona routes ignore it** (SDK 0.4.0, `resources.py`, section comment "conversation (writes the CALLER's private pool)").

That is by design, not a gap. Engram derives the pool from the authenticated principal and never accepts it from the client:

> "Because the backend derives the tenant strings server-side (never accepting them from the client), the isolation is structural." — [concepts/persona-memory](https://engram-docs-alpha.netlify.app/concepts/persona-memory)

So a backend serving many end users needs **one credential per end user**. Engram issues them:

> "A caller carries one of two bearer tokens; **both resolve to the same principal**. **Session** — a short-lived token for a signed-in person… **API key** — a long-lived `egm_` credential for a program." — [authentication](https://engram-docs-alpha.netlify.app/authentication)

> "A session token works anywhere an API key does." — [quickstart](https://engram-docs-alpha.netlify.app/quickstart)

**Measured 8 Sep 2026** on a throwaway persona and member, both destroyed afterwards:

| Client | Call | Resulting tenant |
| --- | --- | --- |
| org key | `chat` / `converse` | `{org}:{persona}:{key owner}` — everyone shares it |
| `auth.login` session token | `chat` / `converse` | `{org}:{persona}:{that member}` |
| `auth.login` session token | `retrieve` with `{query, top_k}` only (SDK 0.4.0) | **shared only** on backend 0.5.0 (`scope: "shared"`, 2-segment tenants) |

`auth.login(email, password)` returns `{token, token_type: "bearer", expires_in: 43200, user, role, tenant}` — a 12-hour JWT whose `sub` is the member. `EngramClient(org, member_id, api_key=<token>)` is then that member for every persona route.

**Our bug, for months — now fixed.** The worker held one `org_admin` key and talked as the key owner for every member, so every conversation landed in `…:8de1b2b278724e0bba19000086f8bef2`. `ensure_org_member` generated each member's Engram password and then cleared it, destroying the only credential that would have made isolation work. It now keeps that password, encrypted, and mints a session token per member. Shipped and live-verified 8 Sep 2026 — see §11 and [engram-private-rollout.md](../archive/engram-private-rollout.md).

It stayed invisible because the isolation probe asserted only that the returned private tenant was **not** user B's id. Assert the positive: the private tenant a member reads must **equal** that member's Engram `user_id`.

**The credential is set once and cannot be reset** (measured). An org admin cannot change a member's password: `platform.set_password` → `403 platform:admin`; `members.add` on an existing email → `409`, password unchanged; `members.remove` + re-add returns the **same** `user_id` with the **old** password and the private pool intact. Our key holds `billing:read, members:manage, members:read, memory:read, memory:write, metrics:read, org:manage, tokens:read` — no `platform:admin`, and no `tokens:manage` (so `tokens.create` is 403 as well, and org tokens carry no subject anyway).

A member token is correctly confined: permissions are `memory:read, memory:write`, and it gets `403 cannot access another user's private memory` for another member's pool and `403` on a three-segment generic tenant.

Which surfaces accept a subject with the **org key** (workspace-admin only): `pool(pid, scope, user_id=)`, `private(pid, user_id=)`, `user_memories`, `forget_user_memory`, `node`, `conversations`, `conversation`, `compress`, `subscribe`, `unsubscribe`. Use these for administration and for delete-my-data — **not** as a recall path.

**The credential is per member and lives in our database.** First talk creates the Engram account with a password we generate and keep (AES-GCM at rest); `auth.login` mints a 12h JWT, cached in memory, refreshed before expiry, never logged or persisted. Conversation routes use that token; every admin surface stays on the org key. A member we cannot credential degrades to shared-only — never member-private under the key owner.

Evidence and the full probe transcript: [ENGRAM_MEMBER_PRIVATE_WORKAROUND.md](../archive/engram-member-private-workaround.md). Rollout: [engram-private-rollout.md](../archive/engram-private-rollout.md). The earlier "admin subject-ingest workaround" is **withdrawn** — it traded semantic private retrieve, compression, and threads for a limitation that does not exist.

### 2.4 What we never ingest where

| Intent | Call | Lands in |
| --- | --- | --- |
| Teach Ada a fact | `personas.teach(ada, text)` or `answer` | shared `{org}:ada` |
| Teach Ada from a document | `personas.pool(ada, "shared").document(...)` | shared |
| Member says something / persona replies (`retrieve` brain) | two scoped `retrieve`s; sitting in Postgres; off-path extract (per-turn and hang-up) may `private(pid).text` caller facts on the **member JWT** | private `{org}:ada:alice` grows extracted facts only — never the transcript |
| Member says something (`chat` brain switch) | `personas.chat(ada, msg, session_id=)` | private (Engram writes both sides) |
| Extra private media (receipt, note) | `personas.private(ada).text/image/...` | private |
| Generic `client.ingest.text` while bound as Alice | `{org}:alice` **personal** | **Not used for this product’s conversations** |

`converse` **does not reply**. Our default brain (`BRAIN_MODE=retrieve`) is retrieve + answer model. The sitting is Postgres. Durable caller facts are private text ingest (`personas.private(pid).text` on the member JWT). We do not converse-write user text or spoken reply. Building a UI on converse alone would look like the persona is ignoring people.

`personas.private` returns an **ingest surface**, not a full client. There is no `memory.list` on the private tenant. Read private via `retrieve` or admin `user_memories`.

`personas.shared` / `pool(pid, "shared")` reach the same shared memories; `pool` goes through the persona endpoint and applies the **subscription check** even where generic tenant writes would be allowed. Our wrapper already uses `pool(..., "shared")` for document/text ingest. Keep that.

---

## 3. Conversation threads (`session_id`)

- Omit `session_id` on `chat` / `converse` → a **new** conversation every turn (amnesiac).
- Carry `reply.session_id` (or the id we claimed) for the whole app session with **that persona**.
- Our app claims the id (`uuid4().hex`) on first need so two in-flight turns share a thread. Engram treats it as an opaque caller-chosen key. `PersonaReply.session_id` is always populated (falls back to the id the SDK sent).
- Resume from Engram: `personas.conversations(pid)` newest first, then `conversation(pid, session_id)`. Unknown id → `NotFoundError`, not an empty transcript.
- `turn_count` is lifetime. Compressed segments come back as one `summary` turn, so `len(turns)` can be smaller.
- Switching personas **must** start a new app session and a new Engram `session_id`. One Engram thread is one member + one persona.

Compression (we do not have to call it): every `compress_every` turns (5 in persona private pools, 15 elsewhere) folds into an EPISODIC node; a worker narrates; then raw turns may be reclaimed. Hourly while the pool has traffic; once after ~24h silence. `purged: 0` usually means summaries are not written yet — an episode with no summary authorizes no deletion. Admin: `compress` / `compress_all` (the latter is on `llms.txt`, not on the personas SDK page).

---

## 4. Subscriptions vs isolation

These are different.

**Isolation** is structural (separate tenants). Subscribe cannot leak Alice’s private pool to Kwame. Unsubscribe does **not** delete the private pool.

**Subscription** is an **access grant** to use that persona (read shared + own private, chat). Docs:

> Chatting requires an active subscription — a member without one gets `ForbiddenError`.

> An unsubscribed member who attempts to use a persona receives a 403 Forbidden.

> `personas.unsubscribe(pid, user_id)` — their private pool is untouched.

Subscribe / unsubscribe / subscribers are **workspace-admin** on the docs. The live API names `org:manage` for subscribe and `members:manage` for `members.add` / `members.update`. Independently, `chat` / `retrieve` / `converse` have worked without a subscription on this alpha; we no longer rely on that.

**First talk (and admin Subscribe tester)** joins Engram People if needed (`members.add` by Google email), persists Engram’s `user_id`, binds `EngramClient` as that id, then `personas.subscribe` for **that** persona. New member rows get a random password today that is **discarded** — the change that makes isolation work is keeping it, encrypted (§2.3, and the rollout plan). It must never be logged or emailed. Existing Engram emails are added with no password. Fail the turn if add or subscribe fails (except subscribe already-granted). Waitlist accounts are never added to People. Isolation probe `probe-*@example.test` addresses must not call `members.add`. Do not treat our `subscriptions` table as isolation.

So:

1. **Published list in our app is who may see the persona.**
2. **On first talk** ensure People membership, persist Engram’s `user_id`, then `personas.subscribe(engram_persona_id, that id)`.
3. If add or subscribe fails (`members:manage` 403, 422, 5xx): fail the turn. Do not talk under a minted placeholder id.
4. If retrieve/chat return `ForbiddenError` (not subscribed): fail the turn honestly. Isolation still holds.
5. **Never treat our `subscriptions` table as the isolation control.** It is a mirror for admin visibility.
6. **Delete-my-data** forgets and unsubscribes; it does not `members.remove`. Never remove the Engram org admin from People.

`persona_subscriptions` on Engram’s side: `(id, org_id, persona_id, user_id, created_at)`, unique `(persona_id, user_id)`.

---

## 5. Create, update, delete

- `personas.create(name, handle=, description=, avatar_url=)` — workspace-admin. **Description is grounding, not decoration.**
- `update(..., status="active"|"archived")` — archive is the non-destructive hide.
- `delete(pid)` — **removes the shared pool and every subscriber’s private pool.** This is destroy, not unpublish.
- `list` / `get` — management.

For this product:

| Owner intent | App | Engram |
| --- | --- | --- |
| Draft / hide from members | local `published = false` | leave pools alone; optional `status=archived` |
| Stop one member using it | unpublished already covers all members; do not build per-member assign | optional `unsubscribe` (private pool remains) |
| Destroy the persona | delete local row after confirm | `personas.delete` — **all members lose that private history** |
| Forget one dirty private pool | `npm run admin -- list-private` / `forget-private` (named member + persona; confirm the handle) | `user_memories` + `forget_user_memory` for **that** member only. Does not unsubscribe. Does not `personas.delete`. |
| Member deletes their account | local sessions ∪ subscriptions, then `user_memories` + `forget_user_memory` + `unsubscribe` per Engram persona id | every persona that member used, not one active row |

Admin-only (member naming anyone else → `ForbiddenError: cannot access another user's private memory`): `users`, `user_memories`, `forget_user_memory`, `node(..., user_id=)`, `conversations(..., user_id=)`, `compress(..., user_id=)`, `private(pid, user_id=)`, `compress_all`.

`memory.forget` / `personas.forget` are **soft** (de-index). `collections.delete_row` is physical. Do not confuse them.

---

## 6. Auth, roles, scopes (what the docs actually say)

Roles: `member` | `org_admin` | `superadmin`. Permission shape is `resource:action`. Named scopes in the docs: `memory:read`, `memory:write`, `metrics:read`, `audit:read`. Empty scopes or `"*"` = full role of the creator. Scopes cannot exceed the creator.

Two bearer credentials, and they are interchangeable on the wire — the SDK sends `Authorization: Bearer <api_key>` and nothing else (`engram_sdk/_common.py:85`). An `egm_` API key is a program's identity; `auth.login(email, password)` mints a 12-hour session token that **is** that member. `tokens.create(name, scopes=[...])` narrows permissions only; it carries no subject and cannot represent another user. Measured permissions: our org key has `org:manage`, `members:manage`, `members:read`, `memory:*`, `metrics:read`, `billing:read`, `tokens:read`; a member has `memory:read`, `memory:write`.

`org:manage` is **not** in the public docs; it is what the live API returned on subscribe. `members:manage` is what the live API returned on `members.add`/`update`. Check `account.me().permissions`. See §4.

Our product org is one Engram org. Each approved Google member maps to one Engram `user_id`. The **persona** is not a second Engram user.

Isolation modes (`strict` / `org` / `global`) apply to **generic** `{org}:{user}` tenants. Persona pools are a separate `authorize_persona_access` guard. We stay on persona endpoints and never depend on flipping `ISOLATION_MODE`.

Writes: never blind-retry on HTTP status. Reads may retry 429/502/503/504. Default SDK `max_retries=2`; our wrapper sets `max_retries=0` and retries reads itself. Keep that.

`gid=None` on ingest often means **absorbed** (success, merged), not failure. Media can also still be finishing. Audio conversation turns return 202 — memory is not there yet. We send **text only** into Engram (TRD); consent flags for audio/video/FER do not apply.

---

## 7. Call matrix we use

| Call | When | Writes | Reads |
| --- | --- | --- | --- |
| `retrieve(pid, query, top_k)` | SDK 0.4.0 path (probes, leftover callers) | — | **shared only** on backend 0.5.0. Private is opt-in via `scope` / `user_id`. Member turns must not send `user_id`; `scope="private"` defaults to the caller. |
| `retrieve_scoped(pid, query, scope=, top_k)` | default brain: two parallel reads; memory panel: private only | — | turn path: one **shared** + one **private** on the **member JWT**. Degraded members and org-key fallback: shared only — never a private read. Memory panel: **private** on the member JWT; empty if we cannot credential the member. |
| `private(pid).text(text)` | off-path caller-fact write after a retrieve reply | caller private — **member JWT**; omit `user_id` and `session_id` | — |
| `converse(pid, text, session_id=, speaker=)` | unused on the member turn path (probes only) | caller private — **member JWT** | — |
| `chat(pid, message, session_id=)` | `BRAIN_MODE=chat` switch | caller private — **member JWT** | shared + caller private |
| `auth.login(email, password)` | mint a member session on a cold cache (once per 12h) | — | bearer token for that member |
| `members.add(email, password=)` | first talk | People row **and the only credential we will ever have** | — |
| `teach` / `answer` / `questions` | owner admin | shared | — |
| `pool(pid, "shared").document/text` | owner ingest | shared | — |
| `members.add` then `subscribe` / `unsubscribe` | first talk / account delete | People + grant | — |
| `user_memories` / `forget_user_memory` | member delete-my-data; owner named private-pool forget | forget private | one member’s private |
| `delete` | owner destroy | destroys shared + all private | — |
| `create` / `update` / `list` / `get` | owner admin | persona row | — |

`top_k`: at 10 retrieve answers were thin; **25** is what we measured. Keep it in config.

`PersonaReply.messages` is a list of 1–3 strings. SDK models page documents `reply.text`; our SDK 0.4.0 path treats `messages` as the source and flattens with `ENGRAM_MESSAGE_JOIN`. Trust the wrapper + a live probe, not the models page, if they disagree.

---

## 8. Failures that matter here

| What you see | Means | Do |
| --- | --- | --- |
| 401 | bad key | fix key; no retry |
| 402 | org over allowance | stop writes |
| 403 `ForbiddenError` on chat | not subscribed, or wrong pool | typed not-subscribed; do not invent a tenant |
| 403 `org:manage` on subscribe / list subscribers | key cannot grant Engram audience | fail the turn; fix the key |
| 403 `members:manage` on `members.add` | key cannot join People | fail the turn; fix the key |
| 422 `user is not a member of this org` | subscribe id is not on People | join People, persist Engram id, subscribe again once |
| retrieve returns a private tenant that is **not** the acting member | we called as the key owner, not as the member | §2.3; never ground a reply on it and never show it |
| 401 `invalid email or password` on `auth.login` | we do not hold that member's credential; it cannot be reset | fail the turn closed; re-provision the member. Never fall back to the org key |
| 403 `platform:admin` on `set_password` | an org admin cannot reset a member password | §2.3; the password from `members.add` is the only one we get |
| 403 `tokens:manage` on `tokens.create` | our key cannot mint org tokens — and they carry no subject anyway | use `auth.login` per member |
| 403 persona-private on `/t/` | someone built a three-segment tenant | use persona endpoints |
| 404 `engine 404: gid N` | wrong pool | pass `scope=` |
| 404 unknown `session_id` on `conversation()` | bad thread id | do not treat as empty chat |
| 422 | body failed contract | reason names the field |
| 5xx | engine/backend | retry reads only |
| `gid=None` | absorbed or media still running | usually ok |

Logs: `engram.insights.logs` is org-scoped, `audit:read`, **no memory text**. `result` is `ok` | `denied` | `error`.

---

## 9. What we deliberately do not use

- `{org}:{user}` personal pool for chats (Pattern A in their cookbooks — “tenant is the user”). That cannot share teach-knowledge across members without duplicating it.
- `memory.ingest` / `conversation.ingest` on the user client for product turns.
- Collections, threads, billing subscribe, platform superadmin, metrics dashboards.
- Audio/video/FER into Engram.
- Hand-built tenants, including the `/sdk/overview` example `EngramClient(org, f"{persona}:{user}")` — tenants page says that is 403 on generic routes.

Support-copilot’s **main** example uses one `ENGRAM_USER_ID` and `memory.retrieve` with no persona — that is **not** isolation. Their persona sidebar is the model we follow.

---

## 10. Doc contradictions (do not paper over)

1. Taxonomy = two tenant shapes; persona pages = four. We implement four and only write the persona pair.
2. Concepts: subscribers may teach shared. SDK: `teach` is workspace-admin only. We keep teach owner-only.
3. Isolation unknown flag: taxonomy says fallback `strict`; admin `set_flag` rejects unknown.
4. Two “subscriptions”: persona access vs billing plan.
5. Two `session_id`s: `sessions.open` vs persona conversation.
6. `org:manage` and `members:manage` live vs undocumented in public docs. The role name `org_admin` is not enough — check `account.me().permissions`.
7. Subscribe required for chat (docs) vs alpha serving chat without subscribe (measured). Product policy: first talk joins People then subscribes; fail closed if that fails. App published list is the member-facing gate. Chat also *appeared* to work unsubscribed because the caller was always the subscribed admin — see §2.3.
8. [examples/support-copilot](https://engram-docs-alpha.netlify.app/examples/support-copilot) promises "per-member isolation, so one customer's conversation is invisible to another" while its sample program binds a single `ENGRAM_USER_ID`. Both are true only when each customer is a distinct authenticated member. Nothing on the site shows a server obtaining many member credentials — that omission is what cost us the leak. §2.3.
9. [sdk/overview](https://engram-docs-alpha.netlify.app/sdk/overview) shows `EngramClient(org_id, f"{persona_id}:{user_id}")` for persona-private addressing; [sdk/tenants](https://engram-docs-alpha.netlify.app/sdk/tenants) and `llms.txt` both say that is a guaranteed 403. Do not build on the overview snippet.

---

## 11. Our wrapper today

`worker/src/worker/engram/engram_brain.py` already exposes create/get/delete, teach/answer/questions, shared ingest via `pool`, private text ingest via `private(pid).text` (no `user_id` on a member JWT), subscribe/unsubscribe, chat, retrieve (tenant off each row), `retrieve_scoped` (httpx body with `scope` from config, never `user_id`), converse. The default turn path issues a shared retrieve and a private retrieve **in parallel** on the member JWT, grounds each list with `may_ground`, and hands the answerer two labelled lists (`persona_memories` / `caller_memories`) plus speaker-labelled sitting history from Postgres. The answerer may speak from persona knowledge of a subject; it must not treat that knowledge as the persona's employer or product, and it must not speak caller facts in the first person as itself. After the reply, a write-back thread extracts caller facts and writes them as private text; it does not converse the sitting. That per-turn pass reads **only the newest exchange** - history is context it may not re-extract, because each earlier exchange already had its own pass. When the sitting ends, the same extractor runs once more over the size-capped transcript under a **closing brief**: it emits only what needed the whole sitting to see, never a restatement of what one exchange stated plainly (session receipt; hang-up twice is a no-op). A fact that does not carry the third-person prefix is discarded before it can reach the pool, where it would read back as persona speech. Every written row is date-stamped, because the private pool is append-only: a correction cannot remove the stale row, so the answerer is told the later-stated of two conflicting caller memories is the current one. Timeout, error, or unrecognised JSON writes nothing extra. An empty fact list is success. Degraded members never write. The client path does not wait on either pass. A config-pluggable classifier may run **beside** those reads and drop one list; it cannot add a list or skip `may_ground`. Timeout, error, or an unrecognised value keeps both lists. An empty caller list is answered honestly, never substituted from shared. `memory_refs` stores which pool each grounded row came from. The chosen scope and reason code join the per-turn log allowlist; memory text does not. Extract reason codes live on the dedicated write-back log, not the turn allow-list. The memory panel (`/internal/memories`) issues a **private** scoped read and still filters with `is_own_private_pool`. A member we cannot credential gets the shared read alone on the turn path and an empty panel. Client factory is `EngramClient(org, user_id)` with `max_retries=0`. That surface is enough for multi-persona **if** the gateway stops assuming there is one local row.

The owner catalog on `/admin/persona` can create or link more than one persona, teach and ingest the selected row, set TTS on `voice_config`, publish or unpublish locally, and destroy. Destroy calls `personas.delete` (shared pool plus every member's private pool) after the owner types the handle, then clears the local subscriptions, sittings and persona row. The gateway does not guess one local row.

Admit no longer subscribes `ENGRAM_PERSONA_ID`. First think for a sitting ensures Engram People membership (`members.add`), persists Engram’s `user_id`, then `personas.subscribe` for that persona, and fails closed if join or subscribe fails. Chat, voice, dashboard history, and the owner conversation list pin a published persona before they load that persona’s sittings or memory. Locked product shape: [phase-5-plan.md](../archive/phase-5-plan.md).

App-side isolation (session ownership, persona pin, published gate, identity check on every turn) holds and is probed. **Engram-side per-member private memory now holds too**, as of 8 Sep 2026: conversation routes run on a per-member session token (`worker/src/worker/engram/session.py`, `factory.create_member_engram`), while admin surfaces keep the org key. **Private recall on the default brain was restored 9 Sep 2026** (backend 0.5.0 made unscoped `retrieve` shared-only): two scoped reads, labelled answer lists, private memory panel. `npm run isolation` asserts pool ownership on the turn path as well as the memory panel, and that private `memory_refs` rows are labelled as the caller's list.

Two layers, and the lower one is deliberately independent of the upper: `may_ground` (`worker/src/worker/engram/tenant.py`) refuses any private row that is not the acting member's *and* refuses every private row when we did not authenticate as that member. It is unconditional, so a regression in the credential path degrades to shared-only instead of leaking. **Only three Google accounts are stuck that way** — `getcognora@gmail.com`, `tauqueer655@gmail.com`, and `mohammadtuti655@gmail.com` (the API key owner). They were already in Engram People before we kept passwords; `members.add` is 409 and an org admin cannot reset the password, so we hold no `engram_member_secret` for them. Checked 17 Sep 2026 against local `users` and Engram People. Every other Google account that joins People after that (including `rathera655@gmail.com`) stores a password and gets private memory. Do not test private recall, caller facts, or next-sitting memory on those three. Member-facing reads never show another member’s pool: the memory panel filters to the acting member’s own private tenant (`worker/src/worker/engram/tenant.py`). Delete-my-data purges every catalog persona and refuses to delete our rows unless Engram reported the purge clean, because those rows are the only map back to what a member left behind.

---

## 12. Named private-pool forget (operator)

Dirty converse dumps stay in a member’s private pool until the owner names **that member** and **that persona**. This is not delete-my-data (it does not unsubscribe, and it does not wipe every persona that member used). It is not destroy (it does not `personas.delete`).

1. `npm run admin -- show` — copy the local persona UUID and the handle.
2. Name the member: Google email, app user id, or Engram user id.
3. `npm run admin -- list-private --user <email> --persona-id <uuid>`
4. `npm run admin -- forget-private --user <email> --persona-id <uuid> --confirm <handle>`
5. `list-private` again — `count` is 0.
6. Then a clean sitting. Do not run this for every member. Do not destroy the persona (shared plus every private pool would go). Subscription stays, so the next sitting still talks.

