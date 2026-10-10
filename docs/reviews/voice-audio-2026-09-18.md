# Review — voice audio path and voice-provider config

Date: 18 Sep 2026. Reviewer: agent sitting, requested by Tauqueer.
Scope: the four commits after the `features` merge (`26a78c3`, `de727b8`, `15f2d8c`, `1d30965`), the
browser capture/playback path they touched, and the provider-facing voice configuration around it.

Status: **findings recorded on 18 Sep 2026.** The speaking path those findings describe was taken
off the tree on 1 Oct 2026
([0013](../decisions/0013-spoken-output-stays-simple.md),
[`voice-output-2026-10-01.md`](voice-output-2026-10-01.md)). This file stays the account of what
was true on 18 Sep. It is not rewritten as the code changes.

---

## 1. What the code does today

```
Deepgram / Fish PCM
      │
      ▼
AudioContext(24 kHz, latencyHint=interactive)
      │
   gain node ──► MediaStreamDestination ──► <audio autoplay playsinline>   (26a78c3)
      │
      └─ playing() = sources still scheduled
                    OR now < lastAudioEnd + 2500 ms + outputLatency        (1d30965)
                              │
mic worklet (16 kHz, 320-sample frames, ~20 ms)                           
      │                       │
      └───────────────────────┴──► if playing(): send a zero-filled frame instead of the mic frame
```

`echoCancellation`, `noiseSuppression` and `autoGainControl` are all `false` in `.env.example`
(lines 57–59) and are passed straight into `getUserMedia` (`frontend/src/lib/micCapture.ts:50`).

---

## 2. Root cause: one decision, never written down

The four commits are not four independent bugs. They are one choice and three consequences:

| Step | Commit | Effect |
| --- | --- | --- |
| Echo cancellation turned off | `de727b8` | Chrome leaves communication audio mode, so output reaches the loudspeaker instead of the earpiece |
| Mic now hears the speaker | `26a78c3`, `15f2d8c` | Uplink is silenced while reply audio plays — the call becomes half-duplex |
| Half-duplex uplink | — | Barge-in never fires, because Deepgram never hears the user mid-turn |
| `<audio>` element lag is unmeasurable | `1d30965` | A blind 2500 ms pad replaces a measured drain window |

Echo cancellation and loudspeaker routing are coupled in Chrome. A page that opens a microphone with
voice processing enabled puts the audio session into communication mode, and communication mode
routes output to the earpiece. Disabling AEC is what let the sound out of the speaker; everything
after that is the cost of having disabled it.

That trade — **earpiece with real barge-in, or loudspeaker with half-duplex** — is a product
decision. It was made implicitly, in a config default, and has been patched four times since. It
needs to be measured and then locked in a decision record.

---

## 3. Findings

### 3.1 `stopSpeaking()` bypasses the pad it was given — CONFIRMED

`frontend/src/app/voice/VoicePage.tsx:437-449` calls `flush()`, and `flush()` →
`silenceAndDrop()` sets `queued = false` and `lastAudioEnd = 0`
(`frontend/src/lib/pcmPlayback.ts:126-127`). `playbackHoldActive` returns `false` as soon as
`queued` is false (`frontend/src/lib/captureHold.ts:24-26`), so `playing()` goes false on the very
next mic frame. The same line then clears the hold outright with `emptyCaptureHold()`.

Setting the graph gain to zero does **not** remove audio already rendered into the
`MediaStreamDestination` buffer — the `<audio>` element keeps playing the tail. So pressing the
interrupt button reopens the mic while the persona's last words are still leaving the speaker: the
exact failure `1d30965` set out to fix, still live on that path.

The same shape is in the `userStartedType` branch at `VoicePage.tsx:250-253`.

**Failure scenario:** user presses the interrupt control mid-reply → graph silences → element still
drains ~100–400 ms of speech → mic is already open → Deepgram transcribes the persona's own tail as
user speech → a phantom turn.

### 3.2 The 2500 ms pad eats the start of the user's reply — CONFIRMED

`VITE_VOICE_CAPTURE_HOLD_AFTER_MS` went `40` → `2500` in `1d30965`. It is applied as `padSec`
*after the last scheduled buffer ends* (`pcmPlayback.ts:203`), so the uplink is silence for 2.5 s
past the end of the persona's turn.

**Failure scenario:** the persona finishes; the member answers immediately; the first 2.5 s of their
answer is transmitted as zero-filled frames. Deepgram receives an utterance that begins mid-word.
The tail leak was traded for a front clip.

### 3.3 `outputLatency` measures a path the audio no longer takes — CONFIRMED

`pcmPlayback.ts:194-196` sums `context.outputLatency + context.baseLatency` as the correction term.
Those describe the AudioContext's own hardware sink. Since `26a78c3` the audio does not go to that
sink — it goes to a `MediaStreamDestination`, then through an `<audio>` element, which adds its own
buffer that no web API exposes.

So the correction term is real but describes the wrong hop, and the unmeasured hop is the one that
actually lags. That is why finding 3.2's constant had to be so large: 2500 ms is a guess standing in
for a number the current architecture cannot obtain.

### 3.4 Barge-in is unreachable code on both sides — CONFIRMED

With the uplink zero-filled during playback, Deepgram never hears the member mid-turn. Therefore:

- `frontend/src/lib/bargeIn.ts` — `onUserInterim` and `onUserStarted` never fire during a reply.
- `VITE_VOICE_PLAYBACK_DUCK_GAIN=0.25` is never applied.
- `gateway/src/voice/bargeIn.ts` `applySpeechHold` and `VOICE_BARGE_IN_HOLD_MS=500` receive only
  silence during agent speech.

The gateway code was written for the opposite assumption, and says so in its own comments:
`gateway/src/voice/fishSession.ts:566` reads *"VAD also fires on Fish playback leaking into the
mic"*, and `bargeIn.ts:54` reads *"the mic hears the persona too"*. Two layers now hold contradictory
beliefs about whether echo reaches the uplink. Only the manual interrupt control still works.

### 3.5 `playback.ready` calls `play()` after an await — PLAUSIBLE

`pcmPlayback.ts:78-93` awaits `context.resume()` before `media.start()`, so the `el.play()` lands in
a later task than the click that authorised it. The fallback to `context.destination` only runs if
`play()` **rejects**; a browser that resolves the promise without producing audio leaves the call
silent with no fallback. Not observed on Chrome — recorded because the recovery path has a hole, not
because it has failed.

### 3.6 Minor

- `stopSpeaking()` flushes twice — `bargeIn.stopAgentAudio` already invokes the flush callback
  (`VoicePage.tsx:442-445`).
- `queued` carries no information after the first `enqueue`; only `lastAudioEnd` decides the pad.
- `duck` / `restore` / `flush` use `setValueAtTime` with no ramp, so gain changes click.
- `micCapture.ts` creates a second `AudioContext` at 16 kHz while playback holds one at 24 kHz.
  Works on Chrome; worth noting as a constraint if the sample rates are ever reconsidered.

---

## 4. Provider configuration gaps

### 4.1 Fish model is pinned globally — CONFIRMED, with a correction

`FISH_TTS_MODEL` defaults to `s2.1-pro-free` (`gateway/src/config.ts:691-694`) and is read in exactly
one place, as a request header (`gateway/src/fish/live.ts:87`). It is not per-persona, not in
`voice_config`, and not reachable from `/admin/persona`.

**Correction to the concern that raised this.** Fish's published guidance states `s2.1-pro-free` is
*the same model* as S2.1-Pro at $0, without a guaranteed TTFA (time to first audio) or a DPA. So the
free variant is not a lower-quality voice. Switching buys a **latency guarantee**, not better audio.

There is a second reason this looked like a gap.
[`../archive/phase-6-plan.md`](../archive/phase-6-plan.md) §1.9 already locked the distinction:
Plus/Pro minutes on the fish.audio website are **Studio** minutes; in-app speech bills the Wallet
against the API key. A Pro subscription on the site does not by itself change what the API serves.

Model identifiers accepted by the live endpoint, per Fish's websocket TTS reference:
`s1`, `s2-pro`, `s2.1-pro`, `s2.1-pro-free`. Latency values: `low`, `normal`, `balanced`
(config is `balanced`; `low` is the one that moves TTFA).

### 4.2 Deepgram Aura has no voice picker — CONFIRMED

`/admin/persona` exposes a free-text "TTS voice id" input (`AdminPage.tsx:497`, and again at `:679`
for the second form). The owner must recall and type `aura-2-thalia-en` exactly. There is no
catalogue, no validation, and no way to tell a typo from an unavailable voice until a live sitting
fails. Deepgram publishes roughly 90 Aura-2 voices across eight languages.

### 4.3 No voice preview anywhere — CONFIRMED

Neither provider can be auditioned from admin. A persona is published with a voice nobody has heard,
and the first time anyone hears it is a member's live sitting.

### 4.4 The same shape elsewhere

`FISH_TTS_LATENCY`, `FISH_TTS_FORMAT`, `FISH_TTS_SAMPLE_RATE` and `DEEPGRAM_STT_MODEL` are global
env with no per-persona override. Whether any of those *should* be per-persona is a separate
question from whether they *can* be; recorded here so the sweep in the plan has a starting list.

---

## 5. Not findings

Checked and found correct, recorded so they are not re-examined:

- `noteCaptureHold` only ever extends a deadline (`Math.max`), so a late frame cannot shorten a hold.
- `captureHoldGapMs(320, 16000) = 40 ms` — two frame periods, correctly derived from config rather
  than hardcoded.
- `performance.now()` and `context.currentTime` are mixed in the same module but never compared to
  each other; each clock stays within its own domain.
- `uplinkMicFrame` allocates a correctly-sized zero buffer, so a held frame keeps Deepgram's stream
  timing intact rather than creating a gap.
- The frontend suite is green: 28 files, 93 tests, at `1d30965`.
