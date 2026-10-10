# 0013. Spoken output stays the simple Fish path

- Status: Accepted
- Date: 2026-10-01
- Decider: Tauqueer

## Context

On 1 Oct 2026 Tauqueer sat the tree at `5585f0e` (the features merge, checked out as `sahil-2`).
The cloned Fish voice came out clean, and the call felt faster than the later tree.

After that commit the browser path grew a hidden audio element, a capture hold that zeros the
microphone while reply audio plays and for a configured tail after it, and a transcript that
reveals the reply one word at a time against the playback clock. An uncommitted experiment also
flushed Fish mid-utterance and primed a throwaway syllable. That experiment changed the voice
partway through a reply. It is not in this tree.

The speaking model was also told to keep answers short. That is a prompt change. It does not
change how audio is sent or played.

[0011](0011-audio-mode-is-measured-not-assumed.md) still says earpiece versus loudspeaker is
measured before the three microphone flags move. This sitting did not run that four-mode
diagnostic. It did choose the earlier speaking path over the later patches, because those patches
are what made the call slower.

## Decision

Spoken output uses the path that was already working at `5585f0e`:

- The gateway opens one Fish live socket per utterance, sends the speaking model's tokens as they
  arrive, and flushes once when the utterance is finished. It does not split the reply into word
  chunks, flush on a character count, or play a warmup syllable.
- The browser plays that PCM on `AudioContext.destination`. There is no
  `MediaStreamDestination` and no hidden `<audio>` element on the reply path.
- The microphone is not gated by a playback hold. Mute still sends silence of the same frame
  length.
- The sidebar shows each reply as a whole line when the gateway sends it. It does not reveal
  words against a clock.
- Short replies stay an instruction in both default speaking prompts: "Make it crisp: one short
  sentence, or a second sentence only when one sentence cannot carry the turn." Typed chat and
  voice share those prompts.

The three microphone processing flags stay config. This record does not turn echo cancellation on
or off.

## Consequences

The latency of the later sink and the tail hold is gone, and so is the word-by-word transcript.
The last words of a reply can reach the microphone again when echo cancellation is off. That is
the trade this sitting accepted.

Do not reintroduce mid-utterance Fish flushes, a prime clip, per-word TTS chunks, the hidden
audio element, or the capture hold to chase loudspeaker routing or a paced transcript. A louder
phone speaker, if still wanted, comes from the measurement in 0011, not from another unmeasured
patch.

## Alternatives considered

**Keep the half-duplex hold and only delete the word clock.** Rejected. The hold and the audio
element are the latency this sitting was compared against.

**Reset the branch to `5585f0e`.** Rejected. Personas, caller facts, hang-up, and the voice UI
stay. Only the speaking path returns.

**Change the Fish model off `s2.1-pro-free`.** Not this decision.
