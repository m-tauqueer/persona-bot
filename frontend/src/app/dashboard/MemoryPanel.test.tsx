import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryPanel } from "./MemoryPanel";

const sessionState = {
  status: "ready" as const,
  me: { id: "user-a", email: "a@example.com", owner: false },
  persona: {
    id: "persona-a",
    handle: "ada",
    display_name: "Ada",
    description: null,
  } as {
    id: string;
    handle: string;
    display_name: string;
    description: string | null;
  } | null,
  reloadPersona: async () => undefined,
};

const fetchPersonalMemories = vi.fn();

vi.mock("../session", () => ({
  useSession: () => sessionState,
}));

vi.mock("../../lib/insights", () => ({
  fetchPersonalMemories: (personaId: string) => fetchPersonalMemories(personaId),
}));

describe("MemoryPanel", () => {
  beforeEach(() => {
    fetchPersonalMemories.mockReset();
    sessionState.status = "ready";
    sessionState.me = { id: "user-a", email: "a@example.com", owner: false };
    sessionState.persona = {
      id: "persona-a",
      handle: "ada",
      display_name: "Ada",
      description: null,
    };
    fetchPersonalMemories.mockResolvedValue({
      memories: [{ text: "private fact for a", tenant: "org:p:a" }],
    });
  });

  it("loads memories for the pinned persona", async () => {
    render(<MemoryPanel personaId="persona-a" />);
    await waitFor(() => {
      expect(fetchPersonalMemories).toHaveBeenCalledWith("persona-a");
    });
    expect(await screen.findByText("private fact for a")).toBeTruthy();
  });

  it("does not fetch when no persona is pinned", async () => {
    render(<MemoryPanel personaId={null} />);
    expect(await screen.findByText("Pick someone first.")).toBeTruthy();
    expect(fetchPersonalMemories).not.toHaveBeenCalled();
  });

  it("shows the empty copy when there are no memories", async () => {
    fetchPersonalMemories.mockResolvedValue({ memories: [] });
    render(<MemoryPanel personaId="persona-a" />);
    expect(await screen.findByText("Nothing stored about you yet.")).toBeTruthy();
  });

  it("shows unavailable copy when the fetch fails", async () => {
    fetchPersonalMemories.mockRejectedValue(new Error("down"));
    render(<MemoryPanel personaId="persona-a" />);
    expect(
      await screen.findByText(
        "Memory is unavailable right now. Your history is still here.",
      ),
    ).toBeTruthy();
  });

  it("refetches when the signed-in user id changes", async () => {
    const { rerender } = render(<MemoryPanel personaId="persona-a" />);
    await waitFor(() => {
      expect(fetchPersonalMemories).toHaveBeenCalledTimes(1);
    });
    fetchPersonalMemories.mockResolvedValue({
      memories: [{ text: "private fact for b", tenant: "org:p:b" }],
    });
    sessionState.me = { id: "user-b", email: "b@example.com", owner: false };
    rerender(<MemoryPanel personaId="persona-a" />);
    await waitFor(() => {
      expect(fetchPersonalMemories).toHaveBeenCalledTimes(2);
    });
    expect(await screen.findByText("private fact for b")).toBeTruthy();
  });

  it("refetches when the picked persona changes", async () => {
    const { rerender } = render(<MemoryPanel personaId="persona-a" />);
    await waitFor(() => {
      expect(fetchPersonalMemories).toHaveBeenCalledWith("persona-a");
    });
    fetchPersonalMemories.mockResolvedValue({
      memories: [{ text: "nova private", tenant: "org:p:n" }],
    });
    rerender(<MemoryPanel personaId="persona-n" />);
    await waitFor(() => {
      expect(fetchPersonalMemories).toHaveBeenCalledWith("persona-n");
    });
    expect(await screen.findByText("nova private")).toBeTruthy();
  });
});
