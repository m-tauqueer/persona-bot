import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchOwnerSessions, fetchPersonalSessions } from "./insights";

const apiMock = vi.fn();

vi.mock("./gateway", () => ({
  api: (...args: unknown[]) => apiMock(...args),
}));

describe("session list pins", () => {
  beforeEach(() => {
    apiMock.mockReset();
    apiMock.mockResolvedValue({ range: "7d", sessions: [], next_cursor: null });
  });

  it("sends the published persona pin on personal lists", async () => {
    await fetchPersonalSessions({
      range: "7d",
      personaId: "11111111-1111-1111-1111-111111111111",
    });
    expect(apiMock).toHaveBeenCalledWith(
      "/api/me/sessions?range=7d&persona_id=11111111-1111-1111-1111-111111111111",
    );
  });

  it("sends the published persona pin on owner lists", async () => {
    await fetchOwnerSessions({
      range: "7d",
      personaId: "11111111-1111-1111-1111-111111111111",
    });
    expect(apiMock).toHaveBeenCalledWith(
      "/api/admin/sessions?range=7d&persona_id=11111111-1111-1111-1111-111111111111",
    );
  });
});
