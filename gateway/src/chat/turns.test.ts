import { describe, expect, it } from "vitest";
import { queuedSql } from "../test/http.js";
import { listTurnsForUser } from "./turns.js";

const ownerId = "11111111-1111-1111-1111-111111111111";
const sessionId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

describe("listTurnsForUser", () => {
  it("returns null when the session is not owned", async () => {
    await expect(
      listTurnsForUser(queuedSql([[]]) as never, sessionId, ownerId),
    ).resolves.toBeNull();
  });

  it("returns turns only after the ownership query succeeds", async () => {
    const turns = [
      { ordinal: 1, speaker: "user", text: "hello" },
      { ordinal: 2, speaker: "persona", text: "hi" },
    ];
    await expect(
      listTurnsForUser(
        queuedSql([[{ id: sessionId }], turns]) as never,
        sessionId,
        ownerId,
      ),
    ).resolves.toEqual(turns);
  });
});
