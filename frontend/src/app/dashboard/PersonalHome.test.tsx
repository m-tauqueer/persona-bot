import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PersonalHome } from "./PersonalHome";

const sessionState = {
  status: "ready" as const,
  me: { id: "member", email: "member@example.com", owner: false },
  persona: null as null,
  reloadPersona: vi.fn(async () => undefined),
};

const apiMock = vi.fn();
const fetchPersonalSessions = vi.fn();
const fetchPersonalMemories = vi.fn();

vi.mock("../session", () => ({
  useSession: () => sessionState,
}));

vi.mock("../../lib/gateway", async () => {
  const actual = await vi.importActual<typeof import("../../lib/gateway")>(
    "../../lib/gateway",
  );
  return {
    ...actual,
    api: (...args: unknown[]) => apiMock(...args),
  };
});

vi.mock("../../lib/insights", async () => {
  const actual = await vi.importActual<typeof import("../../lib/insights")>(
    "../../lib/insights",
  );
  return {
    ...actual,
    fetchPersonalSessions: (...args: unknown[]) => fetchPersonalSessions(...args),
    fetchPersonalMemories: (...args: unknown[]) => fetchPersonalMemories(...args),
  };
});

const ada = {
  id: "11111111-1111-1111-1111-111111111111",
  handle: "ada",
  display_name: "Ada",
  description: "first",
};

const nova = {
  id: "22222222-2222-2222-2222-222222222222",
  handle: "nova",
  display_name: "Nova",
  description: null,
};

describe("PersonalHome picker", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    apiMock.mockReset();
    fetchPersonalSessions.mockReset();
    fetchPersonalMemories.mockReset();
    apiMock.mockResolvedValue({ personas: [ada, nova] });
    fetchPersonalSessions.mockResolvedValue({
      range: "7d",
      sessions: [],
      next_cursor: null,
    });
    fetchPersonalMemories.mockResolvedValue({ memories: [] });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  });

  it("does not load mixed sittings until a published persona is picked", async () => {
    render(<PersonalHome />);
    expect(await screen.findByRole("button", { name: /@ada/i })).toBeTruthy();
    expect(screen.getAllByText("Pick someone first.").length).toBeGreaterThan(0);
    expect(fetchPersonalSessions).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /@ada/i }));
    await waitFor(() => {
      expect(fetchPersonalSessions).toHaveBeenCalledWith({
        range: "7d",
        cursor: undefined,
        personaId: ada.id,
      });
    });
    fireEvent.click(screen.getByRole("button", { name: /@nova/i }));
    await waitFor(() => {
      expect(fetchPersonalSessions).toHaveBeenCalledWith({
        range: "7d",
        cursor: undefined,
        personaId: nova.id,
      });
    });
  });
});
