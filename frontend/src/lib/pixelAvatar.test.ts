import { describe, expect, it } from "vitest";
import { generateGrid, generatePalette, hashSeed } from "./pixelAvatar";

describe("pixel avatar", () => {
  it("is deterministic for the same seed", () => {
    const seed = "ada";
    expect(hashSeed(seed)).toBe(hashSeed(seed));
    expect(generatePalette(hashSeed(seed), 45)).toEqual(
      generatePalette(hashSeed(seed), 45),
    );
    expect(generateGrid(hashSeed(seed), 6)).toEqual(
      generateGrid(hashSeed(seed), 6),
    );
  });

  it("changes when the seed changes", () => {
    expect(generateGrid(hashSeed("ada"), 6)).not.toEqual(
      generateGrid(hashSeed("nova"), 6),
    );
  });
});