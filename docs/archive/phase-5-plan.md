# Phase 5 — Personas

Built. Leftover **live sittings** are in §4. Current product work is [CALLER_MEMORY_PLAN.md](../plans/caller-memory.md). Fish/UI is paused in [PHASE_6_PLAN.md](phase-6-plan.md). Owner: Tauqueer. Map: [README.md](README.md). Read [AGENTS.md](../../AGENTS.md), [CONTEXT.md](../progress.md), [PRD.md](prd.md), [TRD.md](../architecture.md), and [ENGRAM.md](../architecture/memory.md) first. **Do only the part Tauqueer names.** Do not start [FUTURE.md](future.md) until named.

Goal: several owner-created Engram personas. A member talks to **one sitting at a time**. Shared knowledge is per persona. Private memory is per (user, persona). Isolation is structural in Engram plus an explicit persona pin on every app session.

---

## 1. Locked with Tauqueer (7 Sep 2026)

### Product

1. **Owner-only create.** Members do not create or teach. User-shaped personas stay parked. If Engram `create` 403s, the owner may **link** an existing Engram persona id, then teach/publish locally.
2. **Every approved member sees every published persona** and may pick any. No talk until they pick. Empty state copy comes from config.
3. **Both gates.** Our published list is who may see it in this app. On **first talk** (or admin Subscribe tester) the worker **ensures the Google email is an Engram org member** (`members.add`), persists Engram’s `user_id`, **then** `personas.subscribe` for **that** persona, then talks. Bind `EngramClient` only after that id is saved. Fail the turn if add or subscribe fails (except subscribe already-granted). Isolation is still the private tenant `{org}:{persona}:{user}` — subscribe does not mix pools. Waitlist accounts are never added to Engram People. **Needs `members:manage` on the worker key** (live 403 name; plus `org:manage` and memory read/write).
4. **After sign-in: dashboard.** The **same picker** is on chat and on voice. Owner in the member app sees only published (drafts stay on `/admin/persona`).
5. **Quotas unchanged.** No per-persona cap. Existing member daily caps stay.
6. **Switching personas ends that sitting.** New Postgres session + new Engram `session_id`. Two browser tabs may hold two sittings (Ada and Nova) at once.
7. **Members only see published.** Unpublished = owner draft.
8. **Hide vs destroy.** Unpublish is local; pools stay; the **next** think on a live call 404s (current utterance may finish). Destroy is typed confirm + Engram `personas.delete` (wipes every member’s private pool for that persona) + delete our row.
9. **Subscribe on first talk**, not on waitlist admit, not to every published persona at once. First talk also joins Engram People if needed; a later persona only subscribes.

### Architecture

10. **Catalog vs engine.** Our `personas` table is the product catalog (handle, name, description, `voice_config`, published). Engram is the memory engine. Members never list Engram’s API.
11. **Pin, don’t guess.** Every session has `user_id` + `persona_id`. Chat, voice, history, memory, and lifecycle take that id. `resolveActivePersona` goes away. Missing or unpublished → same 404 as a missing session (no leak).
12. **Pools.** Owner teach/answer/shared ingest → `{org}:{persona}`. Member talk (`retrieve` + `converse`, or `chat`) → `{org}:{persona}:{user}`. Never ingest product chats into `{org}:{user}`. Never hand-build tenant strings.
13. **Sitting vs long-term memory.** Engram `session_id` is this sitting’s thread. Yesterday’s facts live in the private pool; a new sitting still retrieves them. Chat and voice for the same persona are **two Postgres sessions** (text vs voice) and **two Engram `session_id`s**; they still share the private pool. Do not share one Engram thread across mic and keyboard.
14. **TTS.** Deepgram voice id lives on that persona’s `voice_config`. `DEEPGRAM_TTS_VOICE` is fallback only if a row has none. Style rules in `voice_config` stay for the speaking LLM.
15. **`ENGRAM_PERSONA_ID`.** No longer chooses the active persona. Optional **seed** only when the local table is empty.
16. **History and memory.** Filter by the persona you are on. Never mix Ada and Nova in one transcript. Owner conversations list filters by persona the same way.
17. **Delete-my-data.** Forget + unsubscribe **every** persona that member used, not “the one active row.” Do **not** `members.remove`. Never remove the Engram org admin from People.
18. **Identity headers** already carry our persona UUID (`x-persona-id`). The think path must use the session’s persona, not “the only row.”

```
member (waitlist-approved)
  → published rows in OUR personas table
  → pick Ada (chat or voice — same picker)
  → Postgres session: user_id + persona_id + channel + Engram session_id
  → worker: claimed ids must match the row
  → EngramClient(org, this member)
       retrieve / converse / chat(Ada’s Engram id)
       private  {org}:{ada}:{alice}     never built by hand
       shared   {org}:{ada}             owner teach only
```

---

## 2. Ingest map (who writes where)

| Who | Action | Engram call | Pool |
| --- | --- | --- | --- |
| Owner | teach / question bank / document | `teach`, `answer`, `pool(pid,"shared").document` | **shared** `{org}:{persona}` |
| Owner | set spoken voice | local `personas.voice_config` (TTS id + style) | — |
| Member | talk (default brain) | `retrieve` then `converse` with `session_id` + `speaker` | **private** `{org}:{persona}:{user}` |
| Member | talk (`BRAIN_MODE=chat`) | `chat` (Engram writes both sides) | **private** |
| Member | first talk | `members.add` if needed, persist Engram `user_id`, `subscribe(pid, that id)`, then the turn | People + grant |
| Owner | unpublish | local `published=false` | pools unchanged; next think 404 |
| Owner | destroy | `personas.delete` after typed confirm | **shared + every private pool for that persona** |
| Member | delete account | forget + unsubscribe **each** persona used | that member’s private only |

Conversation is **never** promoted to shared. Teaching is **never** written from a member chat.

---

## 3. Parts (name one to start)

**Every part 5.1–5.8 is built.** Automated checks are green: `npm test` (gateway, frontend, worker), `npm run isolation`, `npm run security`, `npm run failures`. What is still open is **live sittings**, not code — each part below says which. One thing is blocked outside this repo: Engram-side per-member private memory ([ENGRAM.md](../architecture/memory.md) §2.3).

### Part 5.1 — Stop assuming one persona (done)

- Goal: the backend can store and address many local personas without throwing.
- Tasks: replace `resolveActivePersona` with lookup by id; `published` on `personas` (existing rows published so today’s single persona still works); session create requires `persona_id`; chat/voice/memory/lifecycle 404 on missing or unpublished the same way as a missing session; `ENGRAM_PERSONA_ID` is seed-only when the table is empty, never the resolver. Config, no magic ids. Member directory read of published rows (API; picker UI is later parts).
- Manual test: two local rows do not 500/409 the app; unpublished id 404s; isolation probe still passes with one published persona. **Passed.**
- Audit follow-up: `ENGRAM_PERSONA_ID` is now seed-only in the CLI too (`PersonaAdmin.seed_persona_id` returns it only for an empty catalog). Before, `create-persona` with no `--engram-persona-id` fell back to the env value and `register`'s upsert could rewrite an existing persona's handle, name and voice.
- Deliberate, not a gap: a **malformed** persona id answers 400 where the route validates it, while missing / unpublished / missing-session all answer one identical 404. A malformed id cannot name a real row, so telling a caller their input was invalid reveals nothing about what exists.

### Part 5.2 — Owner: many personas (done)

- Goal: `/admin/persona` creates **or links**, lists, teaches, ingests, publishes, and sets voice on more than one persona.
- Tasks: try Engram `personas.create`; on 403, link an existing Engram persona id; local row + `voice_config` (including TTS voice id); teach/questions/shared ingest aimed at the selected persona; publish/unpublish; do not call Engram `delete` here.
- Manual test: owner creates or links a second persona, teaches a fact, publishes it, sets a TTS voice; members still cannot see the unpublished draft. **Passed.** Live create 403 → link; teach and shared ingest on the selected row; local publish. Engram subscribe still 403s `org:manage` with this key (record locally). Member talk pickers came in later parts, not a miss here.

### Part 5.3 — Subscribe on first talk (done)

- Goal: talking to a published persona grants Engram access without subscribing the world at admit time.
- Tasks: drop admit-time subscribe to `ENGRAM_PERSONA_ID` only; on first turn/call for (user, persona), `subscribe` then proceed; log 403 `org:manage` without failing the member if retrieve still works; if retrieve/chat 403 not-subscribed, fail closed. Mirror `subscriptions` when subscribe succeeds.
- Manual test: new member is not subscribed to every persona; first voice or chat turn to Ada records a subscribe attempt; a second persona first-talk does the same. **Passed.** Live `/voice` sitting: first talk to each published persona logged `subscribe_forbidden` (`403 org:manage`); retrieve still 200; spoken call still worked. Engram People → Subscribers stays 0 until a key (or dashboard session) can grant audience — that is not more code in this part.

### Part 5.4 — Voice picker

- Goal: on `/voice` the member must pick a published persona before talking; switching ends the call.
- Tasks: list published personas; start call with that `persona_id`; Deepgram Settings use that row’s TTS id (`voice_config`, env fallback); hang up to switch; two tabs allowed.
- Manual test: member A talks to Ada, hangs up, talks to Nova; each call’s transcript is only that persona; Ada’s shared fact is not Nova’s; Ada and Nova can sound different if their TTS ids differ. Picker and TTS-from-row are in the product; confirm hang-up → switch on a live call if that sitting is still open.

### Part 5.5 — Chat, history, memory follow the persona

- Goal: typed chat uses the **same picker**; history and memory never mix personas.
- Tasks: chat sitting pin; no talk until pick; history and memory filter by the persona you are on; owner conversation list filters by persona. New sitting = new Engram `session_id`; private-pool recall still works.
- Manual test: Ada chat does not list Nova turns; memory panel for Ada does not show Nova private hits; opening chat with no pick shows the empty state, not a guessed persona. **Code is in; do not mark done until the sitting below passes.**
- Audit follow-up: call phases, call and chat buttons, the transcript empty states and the request-failed fallback were hardcoded in `VoicePage.tsx` and `ChatPage.tsx`. They now come from `VITE_CALL_*` / `VITE_CHAT_*` / `VITE_REQUEST_FAILED` like the rest of the copy. Adding browser copy means the running Vite needs a restart and the keys must exist in `.env`, not only `.env.example`, or `requiredVite` throws on load.

### Part 5.6 — Isolation and delete-my-data for many personas

- Goal: two users × two personas cannot leak; account delete clears every private pool.
- Tasks: extend `npm run isolation`; lifecycle purge loops personas used, not one active row; quotas unchanged (per member).
- Manual test: user A cannot read user B’s sitting for the same published persona; user A’s first-persona memory tenants are not the second persona’s private pool; delete-my-data forgets and unsubscribes every persona that member used. **Code is in; do not mark done until the sitting below passes.**
- Audit (8 Sep 2026) found and fixed four gaps: a relayed worker 404 told a member an unpublished draft existed (`memberFacingBody` now makes every member-facing 404 identical); `GET /api/me/sessions/:id` still served a transcript after unpublish (member views filter on `published`, owner views do not); the memory panel showed shared-pool rows under “what it remembers about you” (now only the acting member’s own private tenant, `worker/src/worker/engram/tenant.py`); delete-my-data enumerated only personas it could still prove were used and wiped Postgres even when the Engram purge failed (now every catalog persona, and it refuses to delete our rows unless the purge came back clean).
- **Engram-side per-member private memory works as of 8 Sep 2026.** It had been broken by our own credential model, not blocked externally: Every persona call goes out on one org API key, so Engram resolves each member's conversation to the key owner and they share one private pool. Live-verified 8 Sep 2026 that a member session token from `auth.login` fixes it — evidence in [ENGRAM_MEMBER_PRIVATE_WORKAROUND.md](engram-member-private-workaround.md), plan in [ENGRAM_PRIVATE_ROLLOUT.md](engram-private-rollout.md), contract in [ENGRAM.md](../architecture/memory.md) §2.3. Both halves of this manual test now pass: per-subscriber isolation and per-member private writes were confirmed by hand, and `npm run isolation` asserts turn grounding as well as the memory panel.
- Probe hardened (8 Sep 2026). Added: the **positive** tenant assertion — every private row a member reads must belong to that member, which is the check that would have caught §2.3 on day one instead of passing vacuously for months; cross-user reads in **both** directions on **both** personas (`owner_second`, `other_first`, `other_second` for session and chat); the second member's second-persona list excluding the other member and the other persona; and a transcript on an unpublished persona returning 404 to its own member while staying visible to the owner.
- Still not probed, with reasons: **voice/WebSocket isolation** — the spoken path runs the same `TurnRunner.begin` identity gate, and forged identity headers on the public think endpoint are already covered by `npm run security` (`worker/src/worker/observe/security.py`), so a WebSocket probe would re-test the same gate through a harder harness. **Delete-my-data** — asserting it end to end means irreversibly erasing a real member, so it stays a manual sitting.

### Part 5.7 — Unpublish and destroy

- Goal: hide vs wipe are different, both owner-only, both confirmed.
- Tasks: unpublish hides from members, leaves Engram pools, next think 404s on a live call; destroy calls `personas.delete` after typed confirm and removes the local row. Copy from config. Never destroy from a member UI.
- Built: unpublish now asks first (a confirm panel, copy from config) because taking a persona away from members ends a live call on its next reply; publishing stays one click. Destroy is confirmed by **typing the persona's handle**, not a fixed phrase, so the owner cannot wipe the wrong row with something already in the clipboard. Order is Engram first (`personas.delete` removes the shared pool and every member's private pool, so there is nothing left to unsubscribe), then our rows — while they exist we can still name what to delete. `subscriptions` and `sessions` are `ON DELETE RESTRICT`, so `delete_persona_cascade` clears both before the persona in one transaction; turns, spans, memory refs and audio rows follow by cascade. The gateway collects that persona's blob urls **before** calling the worker, because the rows that name them are about to go. An Engram 404 means it is already gone their side and the local rows still get cleared. Also on the CLI: `npm run admin -- destroy --persona-id <id> --confirm <handle>`.
- Verified live on a throwaway local row: wrong handle → 400 `confirmation_mismatch` with nothing touched; correct handle → persona, sitting, turn, latency span and subscription all gone.
- Manual test: unpublish makes the persona disappear from the picker; republish restores chats still in Engram. Destroy of a throwaway persona makes retrieve/chat 404 and local history gone. **Destroy against a real Engram persona has not been run — it is irreversible and needs a throwaway persona Tauqueer is willing to lose.**

### Part 5.8 — Engram People then subscribe

- Goal: Cognora members are real Engram org members. First talk (and Subscribe tester) joins People, stores **Engram’s** `user_id`, subscribes **that** persona, then talks as that id. Private memory is `{org}:{persona}:{Engram user_id}`. Production: fail closed; no “record local only”; no minted id on subscribe/retrieve after join.
- Tasks:
  - Worker `ensure_org_member(email)`: if missing, `members.add(email, role="member", name=email, password=random only when new)`. Never log, store, show, or email the password. Existing Engram email: add with no password. Persist returned `user_id` onto `users.engram_user_id`. Then bind `EngramClient` and `personas.subscribe`. Same path for admin Subscribe tester.
  - Admit still only mints a unique placeholder `engram_user_id` (NOT NULL UNIQUE). Waitlist never calls Engram. Second persona: subscribe only.
  - Fail the turn / admin action if `members.add` or subscribe fails (except subscribe 409 already). Drop admin “record local only.” One retry if subscribe 422s “not a member of this org” after join. `members:manage` 403: fail closed, copy from config.
  - Two in-flight talks: add conflict → resolve by email, one id. Brain cache keyed by the resolved id. Identity check before remap; this turn uses the new id after persist.
  - Delete-my-data: forget + unsubscribe every persona used; never `members.remove`; never remove the org admin (`mohammadtuti655@gmail.com` on this org). Isolation probe must not `members.add` `probe-*@example.test`.
  - Docs: [ENGRAM.md](../architecture/memory.md) §4 and [TRD.md](../architecture.md) subscribe bullets match this lock. Tests: returned id (not placeholder) is what subscribe and retrieve use; existing email; add conflict; bind after persist; fail closed; two personas one People id; password absent from logs; probe emails skipped.
- Before the live sitting (local data, not Engram People): delete Cognora `users` **other than** `mohammadtuti655@gmail.com` (sessions/subscriptions/turns go with them — `ON DELETE RESTRICT`). Leave `access_requests` / `consents` so they are not waitlisted again. **`getcognora@gmail.com` signs in again** (owner auto-provision) and gets a new placeholder until first talk joins People. Do not `members.remove` the Engram org admin. Do not start this sitting until `account.me().permissions` includes `members:manage`.
- Manual test: Subscribe tester or first talk puts that Google email on Engram People and under that persona’s Subscribers; retrieve private tenant uses Engram’s `user_id`; a second Google member is a second People row and a different private tenant; shared teach still reads; missing `members:manage` fails closed (no silent minted talk). **Code is in; do not mark done until that sitting passes.**

---

## 4. Done when (the phase)

A member picks Ada or Nova on chat and on voice, each remembers that member separately, the owner can teach and voice them separately, unpublished drafts stay owner-only, destroy is explicit, two tabs do not mix pools, `npm run isolation` covers two users × two personas, and first talk joins Engram People then subscribes that persona. Then stop. Caller-fact private memory is [CALLER_MEMORY_PLAN.md](../plans/caller-memory.md). Cloned voices, Home/picker UI, onboarding, and accounts are [PHASE_6_PLAN.md](phase-6-plan.md) (paused).

### What is left (8 Sep 2026)

Code for 5.1–5.8 is built. Logic review (same day) found no isolation/fail-closed product defects; two probe nits were fixed (unpublished `PROBE_PERSONA_ID` pins fail closed; `npm run failures` restores any temporary subscription mirror so first-talk join is not skipped later). Automated suite green including `npm run failures`. Residual risk: CLI `npm run admin -- destroy` does not collect Azure blob urls the way the gateway destroy route does — harmless while `VOICE_AUDIO_PERSIST_ENABLED=false`.

1. **Blocked on Engram conversation subject** — native `chat`/`retrieve`/`converse` still use the API key’s private pool ([ENGRAM.md](../architecture/memory.md) §2.3). **Workaround researched and planned in two phases** (stop leak first, then subject ingest + `user_memories`): [ENGRAM_PRIVATE_ROLLOUT.md](engram-private-rollout.md). Evidence: [ENGRAM_MEMBER_PRIVATE_WORKAROUND.md](engram-member-private-workaround.md). Do not implement until Tauqueer names a phase and a part from that rollout. Old admin-pool converse data stays disposable.
2. **Live sittings (your checklist)** — do not mark a part done until its sitting passes:
   - **5.4** Hang up on `/voice`, pick the other published persona, talk again; transcripts stay per persona; TTS can differ per row.
   - **5.5** Chat / history / memory on Ada then Nova; no mix; empty state with no pick.
   - **5.6** Two Google users × two personas by hand (session ownership + persona pin). Private-tenant half stays blocked on §2.3. Optional: delete-my-data on a throwaway member.
   - **5.7** Unpublish → disappears from picker; republish restores Engram chats. Destroy only a throwaway Engram persona you are willing to lose.
   - **5.8** Subscribe tester or first talk puts that Google email on Engram People and under that persona’s Subscribers; second member is a second People row. Shared teach still reads. (True distinct private tenants still need Engram’s subject answer.)
3. **Do not** treat the passing isolation probe as proof of Engram-side per-member memory. It proves the app's own gates, and now proves that no member is shown another member's pool.
