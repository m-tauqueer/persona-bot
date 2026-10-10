import { describe, expect, it } from "vitest";
import {
  emptySessionList,
  sessionDetailPublishedOnly,
  sessionDetailScope,
  sessionListScope,
} from "./scope.js";

const viewer = "11111111-1111-1111-1111-111111111111";
const other = "22222222-2222-2222-2222-222222222222";

describe("insights SQL scope", () => {
  it("pins personal lists to the viewer and ignores a filter user", () => {
    expect(
      sessionListScope({
        viewerUserId: viewer,
        ownerView: false,
        filterUserId: other,
      }),
    ).toEqual({ scopeUserId: viewer, userId: null });
  });

  it("lets owner lists see everyone, or one filtered user", () => {
    expect(sessionListScope({ viewerUserId: viewer, ownerView: true })).toEqual(
      { scopeUserId: null, userId: null },
    );
    expect(
      sessionListScope({
        viewerUserId: viewer,
        ownerView: true,
        filterUserId: other,
      }),
    ).toEqual({ scopeUserId: null, userId: other });
  });

  it("scopes personal session detail and leaves owner detail unscoped", () => {
    expect(sessionDetailScope(false, viewer)).toBe(viewer);
    expect(sessionDetailScope(true, viewer)).toBeNull();
  });

  it("hides an unpublished persona's transcript from its member, not the owner", () => {
    expect(sessionDetailPublishedOnly(false)).toBe(true);
    expect(sessionDetailPublishedOnly(true)).toBe(false);
  });

  it("returns no rows when a sitting list has no persona pin", () => {
    expect(emptySessionList("7d")).toEqual({
      range: "7d",
      sessions: [],
      next_cursor: null,
    });
  });
});
