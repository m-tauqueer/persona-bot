/**
 * Barge-in state machine. Covers the case that matters most: an interrupted
 * utterance whose end is never announced must not mute the rest of the call.
 */
import { createVoiceBargeIn } from "./bargeIn.js";

let failed = 0;

function check(name: string, ok: boolean): void {
  if (ok) {
    console.log(`${name}=ok`);
    return;
  }
  console.error(`${name}=FAIL`);
  failed += 1;
}

// Speaking over silence is not an interruption.
const idle = createVoiceBargeIn();
check("idle_user_start_is_not_barge_in", idle.onUserStarted() === false);
check("idle_audio_accepted", idle.acceptBinary() === true);

// Speaking over the agent drops the rest of that utterance.
const live = createVoiceBargeIn();
check("live_audio_accepted", live.acceptBinary() === true);
check("live_user_start_is_barge_in", live.onUserStarted() === true);
check("live_audio_dropped", live.acceptBinary() === false);
check("repeat_user_start_ignored", live.onUserStarted() === false);
check("still_dropping", live.acceptBinary() === false);
live.onAgentAudioDone();
check("audio_done_resumes", live.acceptBinary() === true);

// The regression: interrupted, no AgentAudioDone, next turn begins.
const orphan = createVoiceBargeIn();
orphan.acceptBinary();
check("orphan_barge_in", orphan.onUserStarted() === true);
check("orphan_dropping", orphan.acceptBinary() === false);
orphan.onAgentThinking();
check("new_turn_resumes_without_audio_done", orphan.acceptBinary() === true);

// A fresh turn after a clean finish still behaves.
const cycle = createVoiceBargeIn();
cycle.acceptBinary();
cycle.onUserStarted();
cycle.onAgentAudioDone();
cycle.acceptBinary();
check("second_barge_in", cycle.onUserStarted() === true);
check("second_drop", cycle.acceptBinary() === false);

if (failed) {
  console.error(`FAIL: ${failed} check(s)`);
  process.exit(1);
}
console.log("PROBE_OK");
