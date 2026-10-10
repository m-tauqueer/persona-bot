import { describe, expect, it } from "vitest";
import { groupIncidentsByDay } from "./status";

describe("groupIncidentsByDay", () => {
  it("keeps newest-first order and splits on calendar day", () => {
    const groups = groupIncidentsByDay([
      { id: "a", at: "2026-09-07T12:00:00.000Z", title: "one" },
      { id: "b", at: "2026-09-07T11:00:00.000Z", title: "two" },
      { id: "c", at: "2026-09-05T12:00:00.000Z", title: "three" },
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0]?.items.map((item) => item.id)).toEqual(["a", "b"]);
    expect(groups[1]?.items.map((item) => item.id)).toEqual(["c"]);
  });
});
