import { describe, expect, it } from "vitest";
import { deepgramListenUrl } from "../config.js";
import { testConfig } from "../test/config.js";
import {
  applyListenCue,
  emptyListenTurn,
  readListenMessage,
} from "./listen.js";

describe("deepgramListenUrl", () => {
  it("sends the configured endpointing silence on the listen socket", () => {
    const config = testConfig();
    expect(config.DEEPGRAM_LISTEN_ENDPOINTING_MS).toBe(600);
    const url = new URL(deepgramListenUrl(config));
    expect(url.searchParams.get("endpointing")).toBe(
      String(config.DEEPGRAM_LISTEN_ENDPOINTING_MS),
    );
  });

  it("puts a caller-set endpointing value on the listen socket", () => {
    const config = testConfig({ DEEPGRAM_LISTEN_ENDPOINTING_MS: "1200" });
    const url = new URL(deepgramListenUrl(config));
    expect(url.searchParams.get("endpointing")).toBe("1200");
  });

  it("asks Listen for utterance end on the configured gap", () => {
    const config = testConfig();
    expect(config.DEEPGRAM_LISTEN_UTTERANCE_END_MS).toBe(1000);
    const url = new URL(deepgramListenUrl(config));
    expect(url.searchParams.get("utterance_end_ms")).toBe(
      String(config.DEEPGRAM_LISTEN_UTTERANCE_END_MS),
    );
  });
});

describe("readListenMessage", () => {
  const config = testConfig();

  it("reads speech started and utterance end from configured types", () => {
    expect(
      readListenMessage(
        { type: config.DEEPGRAM_LISTEN_MSG_SPEECH_STARTED },
        config,
      ),
    ).toEqual({ kind: "speech_started" });
    expect(
      readListenMessage(
        { type: config.DEEPGRAM_LISTEN_MSG_UTTERANCE_END },
        config,
      ),
    ).toEqual({ kind: "utterance_end" });
  });

  it("reads interim and final transcripts from Results", () => {
    expect(
      readListenMessage(
        {
          type: config.DEEPGRAM_LISTEN_MSG_RESULTS,
          is_final: false,
          channel: { alternatives: [{ transcript: "hello" }] },
        },
        config,
      ),
    ).toEqual({ kind: "interim", text: "hello" });
    expect(
      readListenMessage(
        {
          type: config.DEEPGRAM_LISTEN_MSG_RESULTS,
          is_final: true,
          speech_final: false,
          channel: { alternatives: [{ transcript: "hello there" }] },
        },
        config,
      ),
    ).toEqual({ kind: "final_part", text: "hello there" });
    expect(
      readListenMessage(
        {
          type: config.DEEPGRAM_LISTEN_MSG_RESULTS,
          is_final: true,
          speech_final: true,
          channel: { alternatives: [{ transcript: "done" }] },
        },
        config,
      ),
    ).toEqual({ kind: "speech_final", text: "done" });
  });
});

describe("applyListenCue", () => {
  it("previews interim words without committing the utterance", () => {
    const applied = applyListenCue(emptyListenTurn(), {
      kind: "interim",
      text: "wait",
    });
    expect(applied.preview).toBe("wait");
    expect(applied.transcript).toBeNull();
    expect(applied.turn.committed).toBe(false);
  });

  it("commits once when speech_final and utterance_end both fire", () => {
    let turn = emptyListenTurn();
    turn = applyListenCue(turn, { kind: "speech_started" }).turn;
    turn = applyListenCue(turn, { kind: "final_part", text: "Hello?" }).turn;
    const first = applyListenCue(turn, {
      kind: "speech_final",
      text: "Are you there?",
    });
    expect(first.transcript).toBe("Hello? Are you there?");
    const second = applyListenCue(first.turn, { kind: "utterance_end" });
    expect(second.transcript).toBeNull();
  });

  it("keeps every finalised segment of a multi-segment utterance", () => {
    let turn = emptyListenTurn();
    turn = applyListenCue(turn, {
      kind: "final_part",
      text: "I was thinking about",
    }).turn;
    const done = applyListenCue(turn, {
      kind: "speech_final",
      text: "the pricing page",
    });
    expect(done.transcript).toBe("I was thinking about the pricing page");
  });

  it("commits a later utterance that never gets a fresh SpeechStarted", () => {
    // Fish leaks into the mic, so Listen VAD may never report a new
    // silence-to-speech edge. New words alone must reopen the turn.
    let turn = emptyListenTurn();
    turn = applyListenCue(turn, { kind: "interim", text: "hello there" }).turn;
    const first = applyListenCue(turn, { kind: "utterance_end" });
    expect(first.transcript).toBe("hello there");

    turn = applyListenCue(first.turn, {
      kind: "interim",
      text: "what about you",
    }).turn;
    expect(turn.committed).toBe(false);
    const second = applyListenCue(turn, { kind: "utterance_end" });
    expect(second.transcript).toBe("what about you");
  });

  it("does not re-commit on a trailing utterance_end with no new words", () => {
    let turn = emptyListenTurn();
    turn = applyListenCue(turn, { kind: "interim", text: "hello" }).turn;
    const first = applyListenCue(turn, { kind: "speech_final", text: "" });
    expect(first.transcript).toBe("hello");
    const trailing = applyListenCue(first.turn, { kind: "utterance_end" });
    expect(trailing.transcript).toBeNull();
  });

  it("commits the last draft on utterance_end when speech_final never arrives", () => {
    let turn = emptyListenTurn();
    turn = applyListenCue(turn, {
      kind: "interim",
      text: "What about you?",
    }).turn;
    const committed = applyListenCue(turn, { kind: "utterance_end" });
    expect(committed.transcript).toBe("What about you?");
    expect(committed.turn.committed).toBe(true);
    const again = applyListenCue(committed.turn, {
      kind: "speech_final",
      text: "What about you?",
    });
    expect(again.transcript).toBeNull();
  });

  it("does not commit utterance_end with no draft", () => {
    const applied = applyListenCue(emptyListenTurn(), {
      kind: "utterance_end",
    });
    expect(applied.transcript).toBeNull();
    expect(applied.turn.committed).toBe(false);
  });
});
