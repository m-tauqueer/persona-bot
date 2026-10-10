import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConversationsPage } from "./ConversationsPage";

const apiMock = vi.fn();
const fetchOwnerSessions = vi.fn();

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
    fetchOwnerSessions: (...args: unknown[]) => fetchOwnerSessions(...args),
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

describe("ConversationsPage picker", () => {
  afterEach(() => {
    cleanup();
    window.history.replaceState({}, "", "/");
  });

  beforeEach(() => {
    window.history.replaceState({}, "", "/admin/conversations");
    apiMock.mockReset();
    fetchOwnerSessions.mockReset();
    apiMock.mockResolvedValue({ personas: [ada, nova] });
    fetchOwnerSessions.mockResolvedValue({
      range: "7d",
      sessions: [],
      next_cursor: null,
    });
  });

  it("does not list mixed sittings until a published persona is picked", async () => {
    render(<ConversationsPage />);
    expect(await screen.findByRole("button", { name: /@ada/i })).toBeTruthy();
    expect(screen.getByText("Pick someone first.")).toBeTruthy();
    expect(fetchOwnerSessions).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /@ada/i }));
    await waitFor(() => {
      expect(fetchOwnerSessions).toHaveBeenCalledWith({
        range: "7d",
        cursor: undefined,
        channel: undefined,
        userId: undefined,
        personaId: ada.id,
      });
    });
  });
});
