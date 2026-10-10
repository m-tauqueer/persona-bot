import { describe, expect, it } from "vitest";
import { asJsonArray, asJsonValue } from "./json.js";

describe("asJsonArray", () => {
  it("returns an empty list for null, undefined, and non-lists", () => {
    expect(asJsonArray(null)).toEqual([]);
    expect(asJsonArray(undefined)).toEqual([]);
    expect(asJsonArray("x")).toEqual([]);
    expect(asJsonArray({ gid: 1 })).toEqual([]);
  });

  it("keeps a JSON list and does not stringify nested text specially", () => {
    expect(asJsonArray([{ gid: 1 }])).toEqual([{ gid: 1 }]);
    expect(asJsonArray([])).toEqual([]);
  });
});

describe("asJsonValue", () => {
  it("passes null through", () => {
    expect(asJsonValue(null)).toBeNull();
  });
});
