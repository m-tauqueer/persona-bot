import { describe, expect, it } from "vitest";
import { personaEngineUserId } from "./users.js";

const hyphenated = "3a07018e-b5c2-483a-b80f-07e90488b5f4";
const hex = "3a07018eb5c2483ab80f07e90488b5f4";

describe("personaEngineUserId", () => {
  it("persona engine user id is hyphenless uuid hex", () => {
    expect(personaEngineUserId(hyphenated)).toBe(hex);
    expect(personaEngineUserId(hyphenated.toUpperCase())).toBe(hex);
    expect(personaEngineUserId(hex)).toBe(hex);
  });

  it("persona engine user id leaves non-uuid strings alone", () => {
    expect(personaEngineUserId("user-1")).toBe("user-1");
    expect(personaEngineUserId("")).toBe("");
  });
});
