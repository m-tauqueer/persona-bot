# Voice audio path

Reference. How sound gets from the member's microphone to Deepgram, and from the persona's reply
back out of the member's device. Transport and brain routing are in
[`../architecture.md`](../architecture.md); this file owns the **audio** layer only.

Behaviour is the code. This file owns intent. When they disagree about behaviour, believe
`frontend/src/lib/micCapture.ts`, `frontend/src/lib/pcmPlayback.ts`,
and `frontend/src/app/voice/VoicePage.tsx`.

Spoken output is locked in
[`../decisions/0013-spoken-output-stays-simple.md`](../decisions/0013-spoken-output-stays-simple.md):
the path Tauqueer sat on 1 Oct 2026. The 18 Sep review
([`../reviews/voice-audio-2026-09-18.md`](../reviews/voice-audio-2026-09-18.md)) describes the
half-duplex tree that sitting replaced. Work still open:
[`../plans/voice-audio.md`](../plans/voice-audio.md).

---

## 1. The two graphs

The browser runs **two** `AudioContext`s. They are never connected to each other.

| | Capture | Playback |
| --- | --- | --- |
| Created in | `micCapture.ts` | `pcmPlayback.ts` `createPcmPlayback` |
| Sample rate | `VITE_DEEPGRAM_AUDIO_INPUT_SAMPLE_RATE` (16000) | `VITE_DEEPGRAM_AUDIO_OUTPUT_SAMPLE_RATE` (24000) |
| Direction | mic → worklet → WebSocket | WebSocket → buffer sources → sink |
| Torn down by | `MicCapture.stop()` | `PcmPlayback.stop()` |

Both rates come from config and must match what the gateway tells Deepgram and Fish. The mic graph
resamples with `resampleLinear` against the context's **actual** `sampleRate`, because a browser may
not honour the requested rate.

## 2. Capture

```
getUserMedia({ channelCount, sampleRate,
               echoCancellation, noiseSuppression, autoGainControl })   ← all from config
    │
MediaStreamAudioSourceNode
    │
AudioWorkletNode  (worklet source is built at runtime, name from VITE_VOICE_WORKLET_NAME)
    │  port.postMessage(Float32Array) per render quantum
    ▼
resampleLinear → SampleAccumulator(VITE_VOICE_CAPTURE_FRAME_SAMPLES) → floatToInt16Le
    │
    ▼
socket.sendBinary(uplinkMicFrame(frame, held))
```

`SampleAccumulator` exists so the uplink emits **fixed-size** frames (320 samples ≈ 20 ms) rather
than whatever size the render quantum produced. Deepgram's endpointing is steadier with a regular
frame cadence.

`uplinkMicFrame(frame, held)` returns a zero-filled buffer of the **same length** when held, never a
shorter buffer and never nothing. Sending correctly-sized silence keeps the stream's timing intact;
sending nothing would look like a network stall. The call holds a frame only while the member has
muted. Playback does not gate the uplink.

The three processing flags are still config — see §4. This file does not turn them on or off.

## 3. Playback

```
socket binary (int16 LE PCM)
    │
int16LeToFloat → AudioBuffer → AudioBufferSourceNode.start(max(nextTime, now))
    │
  gain node ─────► sink
```

Chunks are scheduled back-to-back: each source starts at `max(nextTime, now)` and `nextTime`
advances by the buffer duration, so consecutive chunks join without a gap. A chunk that arrives late
starts at `now` and the schedule re-bases from there.

The gain node carries three levels, all from config
(`VITE_VOICE_PLAYBACK_SPEAK_GAIN`, `VITE_VOICE_PLAYBACK_DUCK_GAIN`):

- **speak** — normal reply playback.
- **duck** — the member is making interim words while the persona talks. Quieter, still playing.
- **flush** — silence, and every scheduled source stopped and dropped. Used by barge-in and by the
  interrupt control.

`flush()` returns whether anything was actually playing, so a caller can tell a real interruption
from a press against silence.

### The sink

The gain node connects to `context.destination`. That is the hardware sink, and it is the path
Tauqueer sat on 1 Oct 2026.

A later tree inserted `MediaStreamDestination` and a hidden `<audio>` element to chase loudspeaker
routing on Android, then silenced the microphone for a configured tail because that element's
latency is not reported. That path is not in this tree. Do not put it back to pace a transcript or
to guess a drain window. Earpiece versus loudspeaker is still
[`0011`](../decisions/0011-audio-mode-is-measured-not-assumed.md): measure it, do not patch it.

## 4. Echo: the coupling that drives everything

A voice call over a loudspeaker has one hard problem. **The microphone hears the persona.** If that
echo reaches Deepgram, it transcribes the bot's own words as member speech and the call talks to
itself.

There are exactly two ways out, and they are mutually exclusive on Chrome:

### Acoustic echo cancellation

`echoCancellation: true` makes the browser subtract the rendered output from the captured input.
It is the correct answer — full duplex, the member can interrupt at any moment, no uplink gating.

The cost: opening a microphone with voice processing puts Chrome's audio session into
**communication mode**, and communication mode routes output to the **earpiece**. The phone must be
held to the ear like a phone call. This is true on Android, not only iOS.

### Half-duplex gating

`echoCancellation: false` leaves the session in normal media mode, so output reaches the
**loudspeaker**. The other way to handle the echo is to stop transmitting: while reply audio is
playing, the uplink sends silence.

That gate is not in this tree. When it was, the member could not interrupt, because Deepgram never
heard them during a reply, and the gate had to guess when the speaker had really finished. The
1 Oct sitting removed it. See §5.

`.env.example` still has all three processing flags off. That was a config default, not a locked
mode. The 1 Oct sitting did not change those flags. It removed the uplink gate that had been papering
over them. With the flags off, the microphone can hear the speaker again. Measuring both modes on a
real device and locking the result is still [`0011`](../decisions/0011-audio-mode-is-measured-not-assumed.md).

## 5. No capture hold

The uplink is not silenced while a reply plays, and there is no drain pad after it. Mute is the only
reason a frame is replaced with silence.

The hold that used to do this lived in `captureHold.ts`. It existed because the hidden audio element
kept sounding after the graph said the reply had ended, and a 2500 ms guess was standing in for a
latency the element does not report
([review §3.2](../reviews/voice-audio-2026-09-18.md)). That guess also dropped the start of the
member's next turn. The 1 Oct sitting chose the direct sink and dropped the hold.

## 6. Barge-in

Duck on interim words, flush on a committed user start, clear the drop when a new agent turn begins.
The gateway still waits until speech is sustained. The browser no longer zeros the uplink, so those
signals can reach Deepgram again while the persona is speaking.

| Signal | Meaning | Response |
| --- | --- | --- |
| Interim user words while the persona speaks | might be a throat-clear, might be an interruption | **duck** — quieter, keep playing |
| Committed user start | a real interruption | **flush** — stop, drop the rest of the utterance |
| Agent thinking | a new turn begins | clear the drop |
| Agent audio done | that reply ended | clear the drop unless the member pressed interrupt |

The gateway mirrors this with a stricter rule: interim words start a clock and the persona only
yields once speech is *sustained* past `VOICE_BARGE_IN_HOLD_MS` (`applySpeechHold`). Deliberately not
the first word and not a VAD click — both fire on a throat-clear, and in speaker mode both fire on
the persona's own voice leaking back in.

Manual interrupt (the dock control) bypasses all of it: flush, hold the drop, return the floor.

## 7. Levels

The ring amplitude is driven from whichever side is live: mic RMS while listening, playback RMS while
speaking (`ringSourceForPhase`). Level updates are coalesced through one
`requestAnimationFrame` (`publishLevel`) so a 20 ms frame cadence cannot drive React renders.

## 8. Configuration

Every value in this path comes from env. No magic numbers in logic.

| Variable | Governs |
| --- | --- |
| `VITE_DEEPGRAM_AUDIO_INPUT_SAMPLE_RATE` | capture graph rate; must match what the gateway tells Deepgram |
| `VITE_DEEPGRAM_AUDIO_OUTPUT_SAMPLE_RATE` | playback graph rate; must match Aura and `FISH_TTS_SAMPLE_RATE` |
| `VITE_VOICE_CAPTURE_FRAME_SAMPLES` | uplink frame size |
| `VITE_VOICE_ECHO_CANCELLATION` | §4 — still config; not locked by the 1 Oct sitting |
| `VITE_VOICE_NOISE_SUPPRESSION` | mic processing |
| `VITE_VOICE_AUTO_GAIN_CONTROL` | mic processing |
| `VITE_VOICE_PLAYBACK_SPEAK_GAIN` | normal reply level |
| `VITE_VOICE_PLAYBACK_DUCK_GAIN` | level while the member is speaking over the persona |
| `VOICE_BARGE_IN_HOLD_MS` | gateway: how long sustained speech must last to take the floor |
