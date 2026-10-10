# Progress

Implementation/status update: 10 Oct 2026. Owner: Tauqueer. Decisions account access is live-verified; a product sitting has not passed for this change.

This file answers "where are we?" It is not the architecture spec
([`architecture.md`](architecture.md)), not the memory contract
([`architecture/memory.md`](architecture/memory.md)), and not a build list ([`plans/`](plans/)).
For behaviour, read the code.

---

## What this is

A browser voice bot that speaks as an owner-taught **persona** with long-term Engram memory. Members
sign in with Google (waitlist), pick a published persona, then talk at `/chat` or `/voice`. Private
memory is per (member, persona). Shared knowledge is per persona.

Speech today: Deepgram Voice Agent (Nova-3 STT + Aura-2 TTS) with our brain behind a BYO-LLM shim.
A persona whose provider is Fish and that has a Fish id uses Deepgram listen + hosted Fish TTS
instead; the brain is unchanged.

## What works

Typed chat, spoken calls, personal `/dashboard`, owner `/admin` (create/link, teach, ingest,
publish, unpublish, destroy), waitlist, daily quotas, consent/export/delete, public `/status`,
isolation probes. Personas are built end to end: pickers on `/chat`, `/voice`, `/dashboard`, with
sittings and memory pinned to the chosen persona.

Per-member Engram private memory works (8 Sep 2026): each member authenticates with their own
session token, so their turns land in their own private pool, and a member we cannot credential
degrades to shared-only rather than falling back to the key owner. That credential hole is three
accounts only — full list and why in [`architecture/memory.md`](architecture/memory.md) §11.

Private recall on the default brain was restored 9 Sep 2026 after Engram 0.5.0 made unscoped
retrieve shared-only: two parallel scoped reads labelled `persona_memories` / `caller_memories`, and
a private-only memory panel. A scope classifier can run beside those reads and drop the list that
does not bear on the question; it is off until `ENGRAM_SCOPE_ROUTER_ENABLED=true`.

Caller facts are extracted off the reply path and written as private text. Hang-up (End call, socket
close, End chat) fires a second extract over the finished sitting. The owner CLI can list and forget
one member's private pool for one persona without destroying shared knowledge.

History and measured latency: [`archive/shipped.md`](archive/shipped.md).

## In flight

**[`plans/openai-decisions.md`](plans/openai-decisions.md) (10 Oct 2026).** Phase 1 memory
routing code is implemented with a dedicated client, bounded contextual adapter, shadow/active
modes, unchanged permission filtering, safe logs, and a read-only calibration probe. Defaults
remain legacy backend/off; no `.env` changes. A real 12-case run with candidate confidence `0.7`
returned 12 valid answers, nine effective policy matches, three conservative both choices, and zero incorrect
narrowings. Earlier cold requests timed out. Owner threshold approval, paired first-word samples,
and `/chat`/Aura/Fish manual sittings remain pending; **the phase is not done**.
[Evidence and handoff](tests/decisions-memory-routing.md). Phase 2 answer/acknowledge code is now implemented by explicit owner request, with one combined
Decisions request and the existing speaking stream. The combined 14-case probe needs a stricter
scope candidate (`0.9`) than the initial scope-only run; acknowledge candidate is `0.8`. Both
remain unapproved and disabled. [Phase 2 validation](tests/decisions-conversation.md). Memory
validation and quality evaluation remain planned. Existing audio/caller-memory work stays open.

**Spoken output (1 Oct 2026).** Tauqueer sat commit `5585f0e`. The cloned Fish voice came out clean
and the call was quicker than the later tree. Playback is `AudioContext.destination` again. Fish
gets the token stream and one flush at the end of the utterance. The transcript shows the whole
reply when it arrives. Short answers stay the speaking-prompt line. The hidden audio element, the
mic hold, and the word-by-word reveal are not on this path. Lock:
[`decisions/0013-spoken-output-stays-simple.md`](decisions/0013-spoken-output-stays-simple.md).

**[`plans/voice-audio.md`](plans/voice-audio.md)** — earpiece versus loudspeaker is still unmeasured,
and per-persona voice configuration is still open. The three microphone flags were not changed on
1 Oct. Evidence for the old half-duplex tree:
[`reviews/voice-audio-2026-09-18.md`](reviews/voice-audio-2026-09-18.md).

Also in that plan: the Fish model is pinned globally to `s2.1-pro-free` with no per-persona or admin
control, and the Deepgram Aura voice is a free-text id box with no catalogue and no preview.

**[`plans/caller-memory.md`](plans/caller-memory.md)** — live `/chat` and `/voice` sittings for the
labelled lists, the classifier, and next-sitting caller-fact recall are still outstanding.

## Parked

Nothing in [`archive/`](archive/README.md) starts until Tauqueer names it into a plan. Cloned Fish
voices and the member card-grid UI are in [`archive/phase-6-plan.md`](archive/phase-6-plan.md);
parked product is in [`archive/future.md`](archive/future.md).

Deliberately off: blob audio archiving (`VOICE_AUDIO_PERSIST_ENABLED=false` until a storage account
is named) and `BRAIN_MODE=chat` (slow, kept as a switch; default `retrieve`). CI/CD, backups,
Key Vault, and security 2.0 are not in the current deploy — see [`ops/deploy.md`](ops/deploy.md).

Aura spoken calls need a live public worker URL (`BYO_LLM_PUBLIC_URL`). Fish sittings think at
`WORKER_URL` from the gateway. A Fish API key is not required to write tests; live Fish sittings
need `FISH_API_KEY`.

---

## Hard constraints

Do not re-decide these here. Full log: [`decisions/`](decisions/README.md).

- **Tauqueer names the part.** Never pick the next one. Never work two parts at once.
- Config, not magic values. No keyword or intent heuristics for language understanding.
- Never hand-build Engram tenant strings. Text-only into Engram. Audio — including clone clips —
  never goes to Engram.
- TTS routing is a dedicated provider key from env (`PERSONA_VOICE_PROVIDER_KEY`), not id-format
  sniffing and not "Fish key is nonempty." A Fish sitting with a missing key or a 401/402 fails
  closed, with no Aura fallback.
- Ground truth for behaviour is the code. Docs own intent.

## Layout

| Path | Role |
| --- | --- |
| `frontend/` | React 18 + Vite + Tailwind. `/`, `/status`, `/waitlist`, `/dashboard`, `/chat`, `/voice`, `/admin` |
| `gateway/` | TypeScript: Google auth, chat HTTP, admin proxy, Deepgram Voice Agent and Fish speech transport |
| `worker/` | Python (uv, CPython 3.12): Engram, reframe, controller, BYO-LLM, clone upload |
| `infra/` | Compose Postgres/Redis, migrations, Azure deploy script |
| `docs/` | This tree. Map: [`README.md`](README.md) |
