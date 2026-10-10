import { describe, expect, it } from "vitest";
import { testConfig } from "../test/config.js";
import { takeSseTokens } from "./thinkStream.js";

describe("takeSseTokens", () => {
  it("reads content deltas and the done marker", () => {
    const config = testConfig();
    const buffer = [
      `${config.BYO_LLM_SSE_DATA_PREFIX} ${JSON.stringify({
        choices: [{ delta: { role: "assistant" } }],
      })}`,
      "",
      `${config.BYO_LLM_SSE_DATA_PREFIX} ${JSON.stringify({
        choices: [{ delta: { content: "Hello" } }],
      })}`,
      "",
      `${config.BYO_LLM_SSE_DATA_PREFIX} ${config.BYO_LLM_SSE_DONE}`,
      "",
      "partial",
    ].join("\n");
    const taken = takeSseTokens(buffer, config);
    expect(taken.tokens).toEqual(["Hello"]);
    expect(taken.done).toBe(true);
    expect(taken.rest).toBe("partial");
  });
});
