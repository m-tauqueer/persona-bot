# Plan — voice audio and voice configuration

**Current work.** Owner: Tauqueer. Branch: `frontend`.

Named parts for two problems that turned out to be adjacent: the echo/routing trade in the browser
audio path, and the persona voice settings that cannot be reached from the admin panel.

**1 Oct 2026.** Tauqueer sat commit `5585f0e` and the cloned voice came out clean, with less delay
than the later tree. Spoken output is back on that path: one Fish socket per utterance, tokens
streamed, one flush at the end, playback on `AudioContext.destination`, the reply shown as a whole
line. Short answers stay a speaking-prompt line. The hidden `<audio>` element, the capture hold,
and the word-by-word transcript are off this path. Locked in
[`../decisions/0013-spoken-output-stays-simple.md`](../decisions/0013-spoken-output-stays-simple.md).
Phase 1 below still describes the 18 Sep tree; do not rebuild that hold to chase loudspeaker
routing. The three microphone flags were not changed.

Evidence: [`../reviews/voice-audio-2026-09-18.md`](../reviews/voice-audio-2026-09-18.md).
How the path works: [`../architecture/voice-audio.md`](../architecture/voice-audio.md).

Tauqueer names **one phase and one part**. Do only that part, its subparts in order. Nothing from
later parts. Loop and commit rules: [`../../AGENTS.md`](../../AGENTS.md) §3–§4.

---

## Why this plan exists

On 18 Sep 2026 the call was half-duplex over the loudspeaker: while the persona spoke, the
member's microphone was not transmitted, and for 2500 ms afterwards it was still not transmitted.

That shape was not chosen. It fell out of turning echo cancellation off in order to get sound out of
the loudspeaker instead of the earpiece, and it was patched four times. The patches kept the call
running; they also meant nobody could interrupt the persona, and the first 2.5 s of every member
reply was dropped. The 1 Oct sitting put the speaking path back to the earlier direct sink instead
of keeping those patches.

**Phase 1 settles the trade with measurements instead of argument.** Phases 2–4 follow from it.

Three defects are correct to fix in either direction, so they are not gated on phase 1:
the interrupt-button tail leak, the doubled flush, and the blind drain constant.

---

## Locked (18 Sep 2026)

1. **Chrome only.** Android Chrome on phones; Chrome and Brave on desktop. iOS Safari is not a
   target for this work, and no part may add an iOS-specific path.
2. **The audio mode is a decision record, not a config accident.** Phase 1 measures; the outcome
   becomes an ADR; `.env.example` then reflects a choice someone made on purpose.
3. **No provider fallback.** A Fish sitting that cannot get Fish audio fails closed with copy from
   config. Unchanged from [`../decisions/0002-hosted-fish-tts-per-persona.md`](../decisions/0002-hosted-fish-tts-per-persona.md).
4. **Per-persona beats global.** Voice settings that differ between personas belong in that
   persona's `voice_config`, keyed from env, with env as the default for personas that set nothing.
   Never id-format sniffing. Extends [`../decisions/0005-persona-voice-provider.md`](../decisions/0005-persona-voice-provider.md).
5. **`s2.1-pro-free` is not a quality compromise.** Fish's own guidance says it is the same model as
   S2.1-Pro at $0, without a guaranteed TTFA or DPA. Moving to `s2.1-pro` buys a latency guarantee,
   and bills the Wallet. It does not buy a better voice. See
   [`../archive/phase-6-plan.md`](../archive/phase-6-plan.md) §1.9 for the Studio-vs-Wallet lock.
6. **Diagnostics are owner-only.** Anything added in phase 1 sits behind the same gate as `/admin`
   and never ships on a member route.

---

## Phase 1 — Measure the audio trade

These steps were written against the 18 Sep half-duplex tree. Do not rebuild the capture hold or
the hidden audio element. The 1 Oct sitting already removed them. What is still open here is the
device measurement of earpiece versus loudspeaker, then locking that in 0011.

Goal: stop guessing. Get real numbers off Tauqueer's own Android Chrome for both modes, then lock
one in a decision record.

### Part 1.1 — Fix what is wrong in either mode

Independent of the measurement. Do this first so phase 1's numbers are taken against a correct tree.

1. `stopSpeaking()` keeps a drain hold instead of clearing it. Replace
   `captureHold = emptyCaptureHold()` with a hold armed for the drain window, so the interrupt
   button cannot reopen the uplink into the persona's own tail
   ([review §3.1](../reviews/voice-audio-2026-09-18.md)).
2. Same treatment for the `userStartedType` branch in `applyAgentEvent`.
3. Drop the duplicate `playback.flush()` — `bargeIn.stopAgentAudio` already invokes it.
4. Add the regression tests: an interrupt during playback must leave the uplink held; a hold must
   not be clearable while the sink is still draining.

Checks: `npm run typecheck`, `npm run lint`, `npm test`.
Manual: none — phase 1.3 covers it on device.

### Part 1.2 — Owner-only audio diagnostic

A route that runs the capture and playback path in a named mode and reports what actually happened.
Owner-gated, config-driven, not on any member route.

Per mode, report:

- **Routing** — earpiece or loudspeaker. Judged by Tauqueer's ear; the page states which mode is
  live so the observation is attributable.
- **Echo leak** — play a known tone through the output, measure mic RMS during playback against
  mic RMS in silence. The ratio is how much the microphone hears the speaker.
- **Sink latency** — `outputLatency`, `baseLatency`, and a round-trip estimate: emit a marker,
  detect it in the capture graph, record the delta. This is the number that should replace the
  2500 ms constant.
- **Context state** — actual vs requested sample rate for both graphs.

Modes to offer:

| Mode | `echoCancellation` | Sink |
| --- | --- | --- |
| A | `true` | `context.destination` |
| B | `false` | `MediaStreamDestination` → `<audio>` (the 18 Sep tree, since removed) |
| C | `true` | `MediaStreamDestination` → `<audio>` |
| D | `false` | `context.destination` |

C and D are cheap to include and separate the two variables — they tell us whether the `<audio>` hop
is doing anything on its own, or whether the AEC flag is the entire cause of the routing change.

Checks: `npm run typecheck`, `npm run lint`, `npm test`.
Manual: **required.** Tauqueer runs all four modes on the Android phone and on desktop Chrome.

### Part 1.3 — Lock the mode

Read the numbers. Write the decision record. Set `.env.example` to match and say why in a comment.

The record must state: which mode, what was measured, what the member gives up, and what would
reopen the question. If mode A wins, part 2.2 deletes the half-duplex machinery. If mode B wins,
part 2.3 deletes the barge-in machinery instead. **One of those two parts will not run.**

Checks: docs only — the files must agree with each other and with the measurements.
Manual: none.

---

## Phase 2 — Act on the measurement

Exactly one of 2.2 / 2.3 runs, decided by 1.3.

### Part 2.1 — Replace the blind constant

Runs in either direction. `VITE_VOICE_CAPTURE_HOLD_AFTER_MS` stops being a guess: the drain window
becomes the measured sink latency plus a configured margin. If the chosen sink is
`context.destination`, `outputLatency` supplies it directly and the margin is small.

The env var stays — it becomes the **margin**, not the whole window, and its comment says so.

Checks: `npm run typecheck`, `npm run lint`, `npm test`.
Manual: a live sitting — the persona's last word must not appear in the transcript as member speech,
and a member replying immediately must not lose their first words.

### Part 2.2 — Full duplex *(only if phase 1 chose AEC)*

1. Turn the three processing flags on in `.env.example`, with comments explaining the routing cost.
2. Connect the gain node straight to `context.destination`; remove `voicePlaybackElement.ts`.
3. Remove `captureHold.ts` and its call sites — nothing gates the uplink any more.
4. Restore the duck-on-interim and flush-on-committed-start path; verify the gateway's
   `applySpeechHold` sees real speech again.
5. Re-tune `VOICE_BARGE_IN_HOLD_MS` against a live sitting now that the signal is genuine.

Manual: **required.** Interrupt the persona mid-sentence; it must stop and answer the new thing.

### Part 2.3 — Honest half-duplex *(only if phase 1 chose the loudspeaker)*

If the member cannot interrupt, the code must stop pretending they can.

1. Remove `frontend/src/lib/bargeIn.ts` and its call sites; the manual interrupt control stays.
2. Remove `VITE_VOICE_PLAYBACK_DUCK_GAIN` and the duck level.
3. Gateway: remove `applySpeechHold` and `VOICE_BARGE_IN_HOLD_MS`, and correct the comments in
   `fishSession.ts` that describe echo reaching the uplink — it no longer can.
4. Make the gating visible in the UI. If the member's microphone is closed, the interface must show
   it, rather than appearing to listen while discarding audio.

Manual: **required.** Confirm the phase badge never claims to be listening while the uplink is held.

---

## Phase 3 — Persona voice configuration

Independent of phases 1–2; may be named at any time.

### Part 3.1 — Sweep provider config for the same pattern

Before changing anything, list every provider-facing value that is global env but reads as
per-persona: Fish model, latency, format, sample rate; Deepgram STT model and Aura voice; the
reframe model. For each: should it vary per persona, and what breaks if it does?

Output: a findings section appended to
[`../reviews/voice-audio-2026-09-18.md`](../reviews/voice-audio-2026-09-18.md) §4.4, and Tauqueer
picks which move.

Checks: none — analysis only. Manual: none.

### Part 3.2 — Fish model per persona

`FISH_TTS_MODEL` becomes a `voice_config` key named from env, with the env value as the default for
personas that do not set one. Accepted values are config, not a hardcoded list:
`s1`, `s2-pro`, `s2.1-pro`, `s2.1-pro-free` per Fish's websocket TTS reference.

An admin selector offers them with the cost stated plainly — the free variant is the same model
without a TTFA guarantee (locked item 5), so the owner is choosing a latency guarantee and a bill,
not a better voice.

Checks: `npm run typecheck`, `npm run lint`, `npm test`, `npm run fish`.
Manual: a live Fish sitting on a persona with a non-default model.

### Part 3.3 — Aura voice picker

Replace the free-text "TTS voice id" input with a selector over a real catalogue.

Deepgram publishes roughly 90 Aura-2 voices across eight languages and does not document a
list-voices endpoint. First subpart is to establish whether one exists — a probe against the live key
settles it, in the style of the existing `npm run` probes. If it does, the catalogue is fetched and
cached. If it does not, the catalogue is config, in the same shape a fetched one would take, so
swapping the source later is not a rewrite.

The field must still accept a raw id for a voice the catalogue does not know.

Checks: `npm run typecheck`, `npm run lint`, `npm test`.
Manual: pick a voice from the list, publish, hear it in a sitting.

### Part 3.4 — Voice preview in admin

A preview control next to each voice field: synthesise a configured line through that provider and
voice, play it in the browser. Owner-only, server-side keys, no member route.

This is the part that stops personas being published with a voice nobody has heard.

Checks: `npm run typecheck`, `npm run lint`, `npm test`.
Manual: preview both an Aura voice and a Fish voice before publishing.

---

## Phase 4 — Close the loop

### Part 4.1 — Update the record

`../architecture/voice-audio.md` §4 and §5 stop describing an open question and describe what was
built. `progress.md` moves this plan out of current work. The review file is **not** rewritten — it
stays as the 18 Sep 2026 account.

### Part 4.2 — Regression coverage

Whatever phase 1 measured becomes a test where it can be: frame-level uplink gating, drain-window
arithmetic, barge-in state transitions. The device-dependent parts stay a manual sitting and are
listed as such in `../tests/README.md`.

---

## Open questions

- **Does Deepgram expose a list-voices endpoint?** Decides whether 3.3 fetches or configures its
  catalogue. Settle with a live probe, not documentation.
- **Is the `<audio>` hop load-bearing on its own?** Modes C and D in part 1.2 answer it. If the AEC
  flag alone drives routing, the hop can go regardless of which mode wins.
- **Does the Wallet have credits for `s2.1-pro`?** Part 3.2 offers the choice; whether it can be
  exercised live is an account question for Tauqueer.
