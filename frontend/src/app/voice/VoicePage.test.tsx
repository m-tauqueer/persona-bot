import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VoicePage } from "./VoicePage";

const sessionState = {
  status: "ready" as const,
  me: { id: "member", email: "member@example.com", owner: false },
  persona: null as null,
  reloadPersona: vi.fn(async () => undefined),
};

const apiMock = vi.fn();

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

vi.mock("thinking-orbs", () => ({
  ThinkingOrb: ({
    state,
    "aria-label": label,
  }: {
    state: string;
    "aria-label"?: string;
  }) => (
    <span data-testid="thinking-orb" data-state={state}>
      {label}
    </span>
  ),
}));

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

describe("VoicePage picker", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    apiMock.mockReset();
    apiMock.mockResolvedValue({ personas: [ada, nova] });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  });

  it("lists published personas and enters a sitting when one is picked", async () => {
    render(<VoicePage />);
    expect(await screen.findByRole("button", { name: /@ada/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /@nova/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Start chat" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /@ada/i }));
    expect(screen.getByRole("region", { name: "Ada" }).className).toContain(
      "voice-sit",
    );
    expect(screen.getAllByRole("button", { name: "Start chat" }).length).toBe(2);
    expect(screen.queryByRole("button", { name: "Pause chat" })).toBeNull();
    expect(screen.queryByRole("button", { name: "End call" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Mute" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Interrupt" })).toBeNull();
    expect(screen.getByRole("complementary", { name: "Live chat" })).toBeTruthy();
    expect(
      screen.getByText("Start a chat to see the live transcript."),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: /@nova/i })).toBeNull();
  });

  it("returns to the selector from an idle sitting", async () => {
    render(<VoicePage />);
    fireEvent.click(await screen.findByRole("button", { name: /@ada/i }));
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByRole("button", { name: /@nova/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Start chat" })).toBeNull();
  });

  it("shows empty copy when nothing is published", async () => {
    apiMock.mockResolvedValue({ personas: [] });
    render(<VoicePage />);
    expect(
      await screen.findByText("No published personas yet."),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Start chat" })).toBeNull();
  });
});
