# 0002. Hosted Fish TTS per persona

- Status: Accepted
- Date: 2026-09-08
- Decider: Tauqueer

## Context

Members hear Deepgram Aura-2 today via the Voice Agent API. The owner wants some personas to speak a **cloned** voice. Azure GPU quota cannot host Fish (no H100/A100; remaining T4 is too small). Voice Agent cannot speak a Fish `reference_id`. Guessing Fish vs Aura from id shape would be keyword/heuristic routing, which this repo forbids.

## Decision

- **Hosted Fish only** (`api.fish.audio`). No self-host, no Azure GPU for this work.
- **Deepgram stays** for STT on every sitting and for Aura TTS when the persona has no Fish voice id.
- **Per persona**, not a global switch. Owner-only: paste a Fish voice id **or** upload a clip on `/admin/persona`. Persistent `reference_id` only. Clip bytes go to Fish, never Postgres or Engram.
- **No id sniffing.** A dedicated `voice_config` key named from env (`PERSONA_VOICE_FISH_KEY`) means Fish. The existing Deepgram key stays Aura. Empty Fish key → Deepgram.
- **Fail closed.** Fish sitting with missing key / 401 / 402 → sitting error from config. Do not fall back to Aura (wrong voice). The product still boots without a Fish key if no sitting needs Fish.
- **Brain unchanged** (controller → Engram → speaking LLM, streamed). Gateway owns speech transport; worker owns clone upload and the brain.
- **Fish sitting transport:** Deepgram listen WSS + Fish TTS WebSocket + our barge-in. PCM at the configured output sample rate. Latency from config (`FISH_TTS_LATENCY`).
- **Studio vs API credits** are different. In-app speech uses the Wallet / API key. Model id from config.
- **UI after speak works:** Home/picker as cards, then empty/mic/errors, mobile, a11y, accounts. Extra OAuth and member voice prefs stay parked.

Build order: [PHASE_6_PLAN.md](../archive/phase-6-plan.md). Current how: [TRD.md](../architecture.md) §1.4 and §2.4.

## Consequences

Two sitting transports until Fish speak ships. Tests can be written without `FISH_API_KEY`; live Fish sittings cannot. Isolation and Engram ingest rules do not change. Alternatives rejected: spinning a GPU, replacing our brain with Fish Agents, Fish STT, member-created clones, sending a Fish id into Aura Settings.
