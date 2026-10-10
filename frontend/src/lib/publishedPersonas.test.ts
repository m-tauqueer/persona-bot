import { describe, expect, it } from "vitest";
import { parsePublishedDirectory } from "./publishedPersonas";

describe("published persona directory", () => {
  it("keeps published rows and drops malformed ones", () => {
    expect(
      parsePublishedDirectory({
        personas: [
          {
            id: "11111111-1111-1111-1111-111111111111",
            handle: "ada",
            display_name: "Ada",
            description: "first",
          },
          { id: "nope" },
          {
            id: "22222222-2222-2222-2222-222222222222",
            handle: "nova",
            display_name: "Nova",
            description: null,
          },
        ],
      }),
    ).toEqual([
      {
        id: "11111111-1111-1111-1111-111111111111",
        handle: "ada",
        display_name: "Ada",
        description: "first",
      },
      {
        id: "22222222-2222-2222-2222-222222222222",
        handle: "nova",
        display_name: "Nova",
        description: null,
      },
    ]);
  });

  it("returns an empty list when the payload is missing", () => {
    expect(parsePublishedDirectory(null)).toEqual([]);
    expect(parsePublishedDirectory({})).toEqual([]);
  });
});
