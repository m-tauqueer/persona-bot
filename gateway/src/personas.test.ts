import { describe, expect, it } from "vitest";
import {
  getPersonaById,
  getPublishedPersonaById,
  listLocalPersonas,
  listPublishedPersonas,
  parseOptionalPersonaId,
  personaPublicPayload,
  resolveSpeakModel,
} from "./personas.js";
import { queuedSql } from "./test/http.js";

const published = {
  id: "11111111-1111-1111-1111-111111111111",
  engram_persona_id: "eng-ada",
  handle: "ada",
  display_name: "Ada",
  description: "first",
  published: true,
};

const draft = {
  id: "22222222-2222-2222-2222-222222222222",
  engram_persona_id: "eng-nova",
  handle: "nova",
  display_name: "Nova",
  description: null,
  published: false,
};

describe("persona catalog", () => {
  it("lists every local row including unpublished drafts", async () => {
    const rows = await listLocalPersonas(
      queuedSql([[published, draft]]) as never,
    );
    expect(rows).toHaveLength(2);
    expect(rows[1]?.published).toBe(false);
  });

  it("lists only published rows for the member directory", async () => {
    const rows = await listPublishedPersonas(queuedSql([[published]]) as never);
    expect(rows.map((row) => row.handle)).toEqual(["ada"]);
  });

  it("looks up a row by id without guessing among several", async () => {
    await expect(
      getPersonaById(queuedSql([[draft]]) as never, draft.id),
    ).resolves.toEqual({
      id: draft.id,
      engramPersonaId: "eng-nova",
      handle: "nova",
      displayName: "Nova",
      description: null,
      published: false,
      voiceConfig: {},
    });
  });

  it("treats a missing id and an unpublished id the same for members", async () => {
    await expect(
      getPublishedPersonaById(queuedSql([[]]) as never, published.id),
    ).resolves.toBeNull();
    await expect(
      getPublishedPersonaById(queuedSql([[draft]]) as never, draft.id),
    ).resolves.toBeNull();
    await expect(
      getPublishedPersonaById(queuedSql([[published]]) as never, published.id),
    ).resolves.toMatchObject({ id: published.id, published: true });
  });

  it("uses the persona tts id and falls back to the env voice", () => {
    expect(
      resolveSpeakModel(
        { tts_voice: "aura-2-thalia-en" },
        "tts_voice",
        "aura-2-luna-en",
      ),
    ).toBe("aura-2-thalia-en");
    expect(
      resolveSpeakModel({ tts_voice: "  " }, "tts_voice", "aura-2-luna-en"),
    ).toBe("aura-2-luna-en");
    expect(resolveSpeakModel({}, "tts_voice", "aura-2-luna-en")).toBe(
      "aura-2-luna-en",
    );
  });

  it("never sends a fish voice id to Aura", () => {
    expect(
      resolveSpeakModel(
        {
          tts_voice: "aura-2-thalia-en",
          fish_voice: "fish-ref-1",
        },
        "tts_voice",
        "aura-2-luna-en",
      ),
    ).toBe("aura-2-thalia-en");
    expect(
      resolveSpeakModel(
        { fish_voice: "fish-ref-1" },
        "tts_voice",
        "aura-2-luna-en",
      ),
    ).toBe("aura-2-luna-en");
  });

  it("parses a persona pin without treating a missing field as invalid", () => {
    expect(parseOptionalPersonaId({}, "persona_id")).toEqual({ ok: true });
    expect(
      parseOptionalPersonaId(
        { persona_id: "11111111-1111-1111-1111-111111111111" },
        "persona_id",
      ),
    ).toEqual({ ok: true, id: "11111111-1111-1111-1111-111111111111" });
    expect(
      parseOptionalPersonaId({ persona_id: "nope" }, "persona_id"),
    ).toEqual({ ok: false });
  });

  it("omits engine ids from the member payload", () => {
    expect(
      personaPublicPayload({
        id: published.id,
        engramPersonaId: "eng-ada",
        handle: "ada",
        displayName: "Ada",
        description: "first",
        published: true,
        voiceConfig: {},
      }),
    ).toEqual({
      id: published.id,
      handle: "ada",
      display_name: "Ada",
      description: "first",
    });
  });
});
