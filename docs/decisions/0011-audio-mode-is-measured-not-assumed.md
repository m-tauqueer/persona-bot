# 0011. The audio mode is measured on a device, then locked

- Status: Proposed
- Date: 2026-09-18
- Decider: Tauqueer

## Context

A voice call over a loudspeaker has one hard problem: the microphone hears the persona. If that echo
reaches Deepgram, it transcribes the bot's own words as caller speech.

Chrome offers exactly two escapes, and they are mutually exclusive. Acoustic echo cancellation
(`echoCancellation: true`) subtracts the rendered output from the captured input and allows full
duplex — but opening a microphone with voice processing puts Chrome's audio session into
communication mode, which routes output to the **earpiece**. Turning it off returns output to the
**loudspeaker**, and the echo must then be handled by not transmitting: a half-duplex gate that
silences the uplink while reply audio plays.

The tree currently does the second. That was never decided. `VITE_VOICE_ECHO_CANCELLATION=false`
appeared as a config default while chasing loudspeaker routing, and the consequences were then
patched four times: a capture hold, a longer capture hold, and a 2500 ms pad standing in for a sink
latency that the chosen output path does not expose. The cost is that nobody can interrupt the
persona and the first 2.5 s of every caller reply is discarded. Full account:
[`../reviews/voice-audio-2026-09-18.md`](../reviews/voice-audio-2026-09-18.md).

Both modes are defensible products. Earpiece-with-interruption is a phone call. Loudspeaker-without
-interruption is a speakerphone you take turns on. Which one this should be is a product judgement,
and it has been made four times by accident and zero times on purpose.

Targets are Chrome only: Android Chrome on phones, Chrome and Brave on desktop. iOS Safari is not in
scope, so no decision here needs to accommodate WebKit's audio session behaviour.

## Decision

The audio mode is settled by **measurement on Tauqueer's own device**, and the result is recorded
here as an Accepted decision before any code depends on it.

An owner-only diagnostic runs the capture and playback path in four named modes — echo cancellation
on or off, crossed with output to `context.destination` or to a `MediaStreamDestination` feeding a
hidden `<audio>` element — and reports for each: the output route, the echo leak as a ratio of
microphone level during playback to microphone level in silence, the true sink latency by round-trip
marker, and the actual versus requested sample rate of both graphs.

Crossing both variables is deliberate. It separates "echo cancellation changed the routing" from
"the `<audio>` hop changed the routing," which the current tree cannot distinguish because both
changed at once.

Tauqueer then names the winning mode. This record moves to Accepted, states which mode, what was
measured, and what the caller gives up. `.env.example` is set to match, with a comment pointing here.

Until that happens, **no part may change the three microphone processing flags or the output sink**
on the strength of an argument. Three defects are independent of the outcome and are fixed
regardless: the interrupt control reopening the uplink into the persona's own trailing audio, the
duplicated flush, and the blind drain constant.

## Consequences

One part of work — building a diagnostic — buys a number instead of an opinion, and the number
outlives the argument. The reasoning survives in a form a later agent cannot accidentally undo by
changing a default.

Whichever mode wins, code has to be deleted. If echo cancellation wins, the capture hold, the hidden
audio element, and the 2500 ms pad all go. If the loudspeaker wins, the barge-in machinery goes —
browser and gateway both, including `applySpeechHold` and `VOICE_BARGE_IN_HOLD_MS` — because it
cannot fire and its presence misleads. Leaving unreachable machinery in place because it might
someday work is how the current contradiction arose: the gateway's comments still say the microphone
hears the persona, which stopped being true the moment the uplink was gated.

The diagnostic is owner-gated and must never appear on a member route.

This decision binds Chrome only. Adding an iOS target reopens it, because WebKit couples routing to
its audio session differently and the measurements here would not transfer.

## Alternatives considered

**Pick a mode by argument and move on.** Rejected — that is what produced the current state. The
trade depends on the device's speaker, the room, and how people hold the phone. None of those is
knowable from the code.

**Software echo cancellation in a worklet.** An adaptive filter would in principle give loudspeaker
output *and* full duplex. Rejected: substantial DSP to build and tune, competing with a hardware
implementation that already exists and is better, for a benefit only realised if the loudspeaker
also wins the measurement.

**Keep half-duplex and accept it permanently.** Not rejected — it is one of the two candidate
outcomes. It is rejected only as something to assume without measuring.

## Notes after

1 Oct 2026. Tauqueer sat the earlier speaking path and locked it in
[0013](0013-spoken-output-stays-simple.md). Playback is `context.destination` again. The capture
hold and the hidden audio element are gone. The three microphone processing flags were not changed.
This record still governs how earpiece versus loudspeaker gets locked: measure it, do not guess.
