# Phase 6 — Cloned voices, then member UI

**Paused.** Current work is [CALLER_MEMORY_PLAN.md](../plans/caller-memory.md). Resume only when Tauqueer names a part from **this** file.

Owner: Tauqueer. **Do only the part he names.** Never start the next part yourself.

Goal: an owner can put a **cloned Fish Audio voice** on a persona (paste an id or upload a clip). A member who picks that persona on `/voice` hears that voice. Personas without a Fish id keep Deepgram Aura. Then Home, chat, and voice use a **card-grid picker**, then onboarding, mobile, accessibility, and accounts.

A Fish API key is not required to write tests. Live Fish sittings start when `FISH_API_KEY` is in `.env`. No Azure GPU. No self-host.

---

## Docs map

Canonical map (roles, read order, what to update): [README.md](README.md). Snapshot: [CONTEXT.md](../progress.md). Why: [decisions/README.md](../decisions/README.md). How we write docs and run a sitting: [WORKFLOW.md](workflow.md).

This file is the **named parts** for cloned Fish voices and member UI. It is **paused**; current work is [CALLER_MEMORY_PLAN.md](../plans/caller-memory.md). Resume only when Tauqueer names a part from this file.

---

## Working loop

Full text: [WORKFLOW.md](workflow.md) and [AGENTS.md](../../AGENTS.md) §3. Tauqueer names **one part** from this file. Do only that part. Never jump ahead.

1. Do its **subparts in order**. Nothing from later parts.
2. After **each subpart**: run the automated checks that cover the change (`npm run typecheck`, lint, `npm test`, worker tests; `isolation` / `security` / `failures` when the part says so). Then a **logic check** of the diff: config not hardcoding; no keyword/heuristic language understanding; isolation and fail-closed; copy from config; no tenant strings built by hand; audio never sent to Engram.
3. After the last subpart: **stop and tell Tauqueer** whether this part needs a manual sitting (live call, paste a real Fish id, browser click-through). If the part lists a Manual test, walk him through it and wait until it passes. If it lists none (docs-only), say so. If UI changed, verify in the browser as part of that sitting. Do not mark the part done until that is settled.
4. **Commit that part** (short imperative subject, optional one-line why). Do **not** mention phase or part numbers. No AI attribution, no `Co-authored-by`, no tool banners, no emojis. Do not skip hooks. Then **stop** until Tauqueer names the next part.

---

## 1. Locked with Tauqueer (8 Sep 2026)

### Product

1. **Hosted Fish only.** `api.fish.audio`. No self-host, no Azure GPU for this work.
2. **Deepgram stays.** Nova-3 STT and Aura-2 Voice Agent remain the default sitting.
3. **Per persona, not a global switch.** The owner chooses Deepgram Aura or Fish Audio on that row (`PERSONA_VOICE_PROVIDER_KEY`, values from env). Empty or missing means Aura. A stored Fish id does not by itself change the sitting. Hang up to change persona (already true).
4. **Owner-only clone.** Members never upload. The owner may **paste** a Fish voice id from fish.audio **or upload a clip** on `/admin/persona`. Persistent Fish `reference_id` only. Do not send reference audio on every turn.
5. **No id sniffing.** Dedicated `voice_config` keys named from env: Deepgram (`PERSONA_VOICE_TTS_KEY` / `tts_voice`), Fish (`PERSONA_VOICE_FISH_KEY` / `fish_voice`), and the sitting choice (`PERSONA_VOICE_PROVIDER_KEY` / `voice_provider`). Never guess from uuid shape or from whether the Fish key is nonempty.
6. **Brain unchanged.** Controller → Engram → speaking LLM, streamed. Fish only turns those tokens into audio.
7. **Audio never goes to Engram.** Clone bytes go to Fish only. Text-only into Engram still holds.
8. **Fail closed.** A Fish sitting with a missing/invalid key or Fish 401/402 → sitting error copy from config. Do **not** fall back to Aura (wrong voice). The product still boots without a Fish key if no sitting needs Fish.
9. **Studio vs API credits.** Plus/Pro trial minutes are the Fish website. In-app speech uses the Wallet / API key. `FISH_TTS_MODEL` is config (e.g. `s2.1-pro-free` while testing).
10. **UI after Fish speak.** Home + persona **card grid** (same picker on chat and voice), then empty/mic/errors/boundary, mobile, accessibility, then display name/avatar and sign-out everywhere. Extra auth providers stay parked.

### Architecture

11. **Voice Agent cannot speak a Fish `reference_id`.** Aura sittings keep the current Voice Agent socket. Fish sittings use the split pipeline in [TRD](../architecture.md) §2.4: Deepgram **listen** streaming WSS (STT + endpointing) + Fish TTS WebSocket + our barge-in. The worker brain is unchanged.
12. **Fish live TTS:** `wss://api.fish.audio/v1/tts/live` (MessagePack; `StartEvent` then `TextEvent` / `FlushEvent`). Format PCM at the same sample rate the browser already plays (`VITE_DEEPGRAM_AUDIO_OUTPUT_SAMPLE_RATE`, 24000). Latency from config (`FISH_TTS_LATENCY`, agent default `balanced`). Contract: <https://docs.fish.audio/api-reference/endpoint/websocket/tts-live.md>.
13. **Clone:** `POST /model` (`train_mode=fast`, `visibility=private`). Contract: <https://docs.fish.audio/developer-guide/sdk-guide/python/voice-cloning.md>. Official SDKs: `fishaudio` (worker) and `fish-audio` (gateway). Secrets stay server-side.
14. **Gateway owns speech transport** (Deepgram and Fish). Worker owns clone upload and the brain. Same root `.env`.
15. **Component library.** Copy only the file about to be used from `Desktop/component-library` into `frontend/src`. Do not copy the Metacognition memory KPI / heatmap / `FeaturedMemory` gallery. Notes: [COMPONENT_LIBRARY.md](../../frontend/COMPONENT_LIBRARY.md).

```
member picks a published persona
  → provider equals the configured Fish value (and a Fish id is present)?
       no  → Deepgram Voice Agent (Nova-3 + Aura-2 + barge-in) as today
       yes → Deepgram listen WSS → worker think (streamed) → Fish TTS WS → browser PCM
             barge-in: duck on interim words; stop Fish once speech is sustained; think on commit
```

---

## 2. Ingest and TTS map

| Who | Action | Where it goes |
| --- | --- | --- |
| Owner | paste Fish voice id | local `personas.voice_config` (Fish key from env) |
| Owner | upload clip to clone | Fish `POST /model`; store returned id on that key. Bytes are not kept in Postgres or Engram |
| Owner | Deepgram Aura vs Fish Audio | local `personas.voice_config` (provider key from env). Empty means Aura |
| Owner | Deepgram Aura id | local `personas.voice_config` (existing TTS key) |
| Owner | teach / questions / documents | Engram shared `{org}:{persona}` — unchanged |
| Member | talk | Engram private `{org}:{persona}:{user}` — unchanged |
| Member | `/voice` with provider = Fish value | Deepgram STT + Fish TTS; brain unchanged |
| Member | `/voice` with provider empty or Aura | Deepgram Voice Agent — unchanged |

Conversation is never promoted to shared. Clone audio is never sent to Engram.

---

## 3. Parts (name one to start)

### Part 0 — Docs structure

- Goal: the repo has a durable docs workflow (map, context, decisions, instructions) so later parts can start one at a time. No product code.
- Subparts:
  - **0.a** This file: locks, ingest/TTS map, working loop (subpart → tests → logic → ask about manual → commit → stop), every later part with subparts.
  - **0.b** [README.md](README.md) (canonical map, Diátaxis roles, read order), [CONTEXT.md](../progress.md) (snapshot), [WORKFLOW.md](workflow.md) (how we update docs and run a sitting).
  - **0.c** [decisions/](../decisions/README.md): template plus Accepted records for docs-as-code, hosted Fish per persona, the working loop, and early product locks.
  - **0.d** Index pointers: [PHASE_PLAN.md](../progress.md), [FUTURE.md](future.md), [PRODUCTION_PLAN.md](../ops/deploy.md), root README.
  - **0.e** [AGENTS.md](../../AGENTS.md): current work is this file; working loop matches WORKFLOW; read order points at the map.
  - **0.f** Intent only: [TRD.md](../architecture.md) §1.4 TTS is per-persona Deepgram or Fish; [PRD.md](prd.md) cloning is current, not parked; [SHIPPED.md](shipped.md) does not claim Fish shipped.
  - **0.g** [COMPONENT_LIBRARY.md](../../frontend/COMPONENT_LIBRARY.md): primitives the card-grid part may copy.
  - **0.h** Logic pass: docs agree with Engram isolation, no tenant hand-builds, no keyword TTS routing, no GPU/self-host, no duplicate locks (ADR vs TRD vs this file).
- Tests: none (markdown). Logic: the read in 0.h.
- Manual: none. After this part, stop and wait for Tauqueer to name Part 1.
- Commit: docs only. Fold into the same docs commit if this part is still open.

### Part 1 — Put a Fish voice id on a persona

- Goal: the catalog can store a Fish id next to Aura without breaking Aura calls.
- Subparts:
  - **1.a** Env: `FISH_API_KEY` optional at boot; `FISH_API_BASE_URL`, `FISH_TTS_MODEL`, `FISH_TTS_FORMAT`, `FISH_TTS_SAMPLE_RATE`, `FISH_TTS_LATENCY`, `PERSONA_VOICE_FISH_KEY`, matching `VITE_*` for admin. Gateway Zod + worker pydantic-settings.
  - **1.b** Admin paste field. Merge/split both TTS keys. Fish id is never written onto the Deepgram key.
  - **1.c** Voice Agent Settings use **only** the Deepgram key. A row with Fish set must not send that id to Aura.
- Tests after each subpart. Logic: no id-format sniffing.
- Manual: paste a Fish id on one persona, leave another on Aura; Aura call still works. Fish speech is Part 3.

### Part 2 — Clone from a clip; owner chooses Aura or Fish

- Goal: owner upload creates a persistent Fish voice and stores the id. Owner explicitly chooses Deepgram Aura vs Fish Audio (config values). `/voice` still uses Aura until speak work.
- Subparts:
  - **2.a** Admin choose buttons. Store `PERSONA_VOICE_PROVIDER_KEY` with `PERSONA_VOICE_PROVIDER_AURA` / `PERSONA_VOICE_PROVIDER_FISH`. Empty/missing → Aura. Do not infer from whether a Fish id is present. `/voice` unchanged.
  - **2.b** Upload (types/size from config) → Fish `POST /model` (`train_mode=fast`, `visibility=private`, enhance from config) → persist returned `_id` on the Fish key. Do not change the provider. Do not log audio bytes or the API key. Separate file input from Engram ingest.
  - **2.c** Fail closed on missing key / untrained / Fish 402 / disallowed or empty clip. Paste-id still works. Clip is not stored in Engram or Postgres.
- Tests with a mocked Fish client. Isolation/security unchanged.
- Manual:
  1. Carry-forward from Part 1: paste a Fish id (placeholder is fine) on one persona, leave another empty; Aura `/voice` still speaks Aura. A persona with a Fish id also still Aura this sitting.
  2. Click Deepgram Aura vs Fish Audio, save, reload — the choice persists. Choosing Fish does not change `/voice` yet.
  3. With `FISH_API_KEY` in `.env`, upload a short allowed clip; the Fish id appears on the Fish field, Deepgram field unchanged. Clip is not in Engram or Postgres.
  4. Disallowed type or empty clip shows the config error. Missing key / 402 if you can provoke them.

### Part 3 — `/voice` speaks the clone

- Goal: picking a Fish persona hears that voice; Aura personas stay on Voice Agent.
- Subparts:
  - **3.a** Branch at call start: provider equals the configured Fish value and a Fish id is present → Fish transport; else existing Voice Agent path. Provider is Fish but the Fish id is empty → sitting error from config, no Aura fallback.
  - **3.b** Fish path: Deepgram listen WSS → existing think stream → Fish TTS WebSocket with `reference_id` → PCM to the client; barge-in flushes playback and aborts Fish. Thinking cue stays. First-word span recorded. Fish 401/402/timeout → sitting error, no Aura fallback.
  - **3.c** Live probe `npm run fish` (skip without key). `isolation` and `security` still green.
- Manual: pick the cloned persona with provider Fish, hear that voice, interrupt and it stops; pick an Aura persona (or a Fish-id persona still on Aura), Voice Agent path unchanged. Carry-forward: paste-id path still works.

### Part 4 — Home dashboard and persona boxes

- Goal: published personas are a **grid of cards**, not a stacked list. Same picker on Home, `/chat`, and `/voice`. Home has Chat/Voice actions for the picked persona.
- Subparts:
  - **4.a** Shared card grid: name, handle, selected state (Card variant). Copy `Chip` / `Avatar` from the library if missing. Copy the QuickActions **pattern** for Chat / Voice tiles (config labels, real routes). Do **not** invent fake memory KPIs or copy `FeaturedMemory` / heatmap.
  - **4.b** Home: page head, persona grid, Chat/Voice tiles, recent sittings + memory as now. Copy from config. Tokens only.
  - **4.c** Admin persona list uses the same box language so drafts are scannable.
- Tests for picker selection/lock. Browser: pick on Home; chat/voice show the same pick; tiles go to the right route.
- Manual: two published personas as two boxes; pick; history stays per persona.

### Part 5 — First-run and honest failures

- Goal: empty, mic, loading, and crash surfaces are honest and from config.
- Subparts:
  - **5.a** Empty states (no pick, no history, no memory) from config.
  - **5.b** Mic denied / no device coaching on `/voice`.
  - **5.c** Loading and error surfaces; React error boundary on personal and admin trees.
- Manual: new member with no pick sees empty copy; deny mic sees coaching; a thrown child shows the boundary, not a white screen.

### Part 6 — Mobile

- Goal: landing, waitlist, Home, chat, voice, admin usable at a phone width.
- Subparts: layout pass on those routes; no horizontal trap; tap targets usable.
- Manual: phone viewport through sign-in → pick → chat and a call start/stop.

### Part 7 — Accessibility

- Goal: keyboard, focus, ARIA, contrast, reduced motion.
- Subparts: keyboard path through picker, chat, call start/stop, admin voice fields; labels on meters and call phase; `prefers-reduced-motion`.
- Manual: keyboard-only pick + send chat.

### Part 8 — Accounts

- Goal: display name and avatar; sign-out on every signed-in shell.
- Subparts:
  - **8.a** `users` columns; `/api/me` returns name/avatar in addition to `id`, `email`, `owner` — never `engram_user_id` or `google_sub`.
  - **8.b** Personal account screen; show in the shell. Sign-out on personal, admin, waitlist. Extra IdPs parked. Member voice/language preferences parked (persona voice is owner-owned).
- Manual: set name/avatar, see it on Home; sign out from chat, voice, admin, waitlist.

---

## 4. Done when (the phase)

A member picks a cloned-voice persona and hears that voice, with barge-in, while other personas still use Aura. Home shows those personas as cards. Empty/mic/errors, mobile, keyboard access, and a display name all work. Isolation and fail-closed still hold. Then stop. Parked product and Plan X stay in [FUTURE.md](future.md).

### Out of this phase

Self-host / GPU, Fish Agents widget replacing our brain, Fish STT, member-created clones, multilingual, Plan X / Azure deploy, Engram private-rollout (name a part from [ENGRAM_PRIVATE_ROLLOUT.md](engram-private-rollout.md)).
