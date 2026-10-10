# Review — spoken output on the earlier tree

Date: 1 Oct 2026. Tauqueer sat branch `sahil-2` at `5585f0e` ("Merge pull request #4 from
m-tauqueer/features") and said the cloned voice comes out clean, and that latency is better than
on the later tree.

## What that commit does

Fish speak is one live socket per utterance. The gateway sends each speaking-model token as it
arrives (`fishSession.ts` `sendText`) and calls `flush` once when the utterance has been spoken.
The browser schedules those PCM chunks on `AudioContext.destination`. There is no word clock on
the transcript, no capture hold, and no hidden `<audio>` element.

## What landed after it, and what this sitting kept

| Later change | Sitting |
| --- | --- |
| Hidden `<audio>` element and `MediaStreamDestination` (`26a78c3`) | Removed. That hop added a sink latency no API reports. |
| Echo cancellation off, then a capture hold and a 2500 ms tail (`de727b8`, `15f2d8c`, `1d30965`) | Hold removed. The three microphone flags were left as config. With them off, the speaker can leak back into the mic. |
| Word-by-word transcript against playback time | Removed. The sidebar shows the whole reply when the gateway sends it. |
| "Make it crisp: one short sentence…" on both default speaking prompts | Kept. That is the only later speaking change this sitting wanted. |
| Uncommitted Fish flushes on a character count, plus a warmup syllable | Not applied. That is what changed the voice partway through a reply. |

The rest of the later tree stays: personas, caller-fact write-back, hang-up, and the voice UI.

Lock: [`../decisions/0013-spoken-output-stays-simple.md`](../decisions/0013-spoken-output-stays-simple.md).
How the audio path works now: [`../architecture/voice-audio.md`](../architecture/voice-audio.md).
