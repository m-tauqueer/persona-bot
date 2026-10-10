import { describe, expect, it } from "vitest";
import { queuedSql } from "../test/http.js";
import {
  createTextSession,
  createVoiceSession,
  endSessionForUser,
  getSessionForUser,
} from "./sessions.js";

const ownerId = "11111111-1111-1111-1111-111111111111";
const otherId = "22222222-2222-2222-2222-222222222222";
const sessionId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const personaId = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

describe("getSessionForUser", () => {
  it("returns null when the session is missing", async () => {
    await expect(
      getSessionForUser(queuedSql([[]]) as never, sessionId, ownerId),
    ).resolves.toBeNull();
  });

  it("returns null when the session belongs to someone else", async () => {
    await expect(
      getSessionForUser(
        queuedSql([
          [
            {
              id: sessionId,
              user_id: otherId,
              persona_id: personaId,
              ended_at: null,
            },
          ],
        ]) as never,
        sessionId,
        ownerId,
      ),
    ).resolves.toBeNull();
  });

  it("returns the session when user_id matches", async () => {
    await expect(
      getSessionForUser(
        queuedSql([
          [
            {
              id: sessionId,
              user_id: ownerId,
              persona_id: personaId,
              ended_at: null,
            },
          ],
        ]) as never,
        sessionId,
        ownerId,
      ),
    ).resolves.toEqual({
      id: sessionId,
      userId: ownerId,
      personaId,
      endedAt: null,
    });
  });

  it("creates text and voice sessions from the insert row", async () => {
    const row = {
      id: sessionId,
      user_id: ownerId,
      persona_id: personaId,
      ended_at: null,
    };
    await expect(
      createTextSession(queuedSql([[row]]) as never, ownerId, personaId),
    ).resolves.toEqual({
      id: sessionId,
      userId: ownerId,
      personaId,
      endedAt: null,
    });
    await expect(
      createVoiceSession(queuedSql([[row]]) as never, ownerId, personaId),
    ).resolves.toEqual({
      id: sessionId,
      userId: ownerId,
      personaId,
      endedAt: null,
    });
  });

  it("throws when insert returns no row", async () => {
    await expect(
      createTextSession(queuedSql([[]]) as never, ownerId, personaId),
    ).rejects.toThrow(/session insert returned no row/);
  });
});

describe("endSessionForUser", () => {
  it("returns null when the session belongs to someone else", async () => {
    await expect(
      endSessionForUser(
        queuedSql([
          [
            {
              id: sessionId,
              user_id: otherId,
              persona_id: personaId,
              ended_at: null,
            },
          ],
        ]) as never,
        sessionId,
        ownerId,
      ),
    ).resolves.toBeNull();
  });

  it("ends the sitting when the caller owns it", async () => {
    await expect(
      endSessionForUser(
        queuedSql([
          [
            {
              id: sessionId,
              user_id: ownerId,
              persona_id: personaId,
              ended_at: null,
            },
          ],
          [],
        ]) as never,
        sessionId,
        ownerId,
      ),
    ).resolves.toEqual({
      id: sessionId,
      userId: ownerId,
      personaId,
      endedAt: null,
    });
  });
});
