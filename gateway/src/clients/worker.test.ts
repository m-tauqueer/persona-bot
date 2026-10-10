import { describe, expect, it } from "vitest";
import { memberFacingBody } from "./worker.js";

describe("memberFacingBody", () => {
  it("hides which case produced a worker 404", () => {
    const missingSession = {
      error: "session not found",
      reason: "session_not_found",
    };
    const unpublishedPersona = {
      error: "persona not found",
      reason: "persona_not_found",
    };
    expect(memberFacingBody(404, missingSession, "not found")).toEqual({
      error: "not found",
    });
    expect(memberFacingBody(404, unpublishedPersona, "not found")).toEqual(
      memberFacingBody(404, missingSession, "not found"),
    );
  });

  it("leaves other statuses to speak for themselves", () => {
    const refused = { error: "daily limit reached", code: "quota_turns" };
    expect(memberFacingBody(429, refused, "not found")).toBe(refused);
    const spoken = { action: "speak", turn_ids: [] };
    expect(memberFacingBody(200, spoken, "not found")).toBe(spoken);
  });
});
