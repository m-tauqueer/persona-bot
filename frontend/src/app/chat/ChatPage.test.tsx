import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  readStoredChatSessionId,
  writeStoredChatSessionId,
} from "../../lib/chatSession";
import { personaPinField } from "../../lib/personaVoice";
import { ChatPage } from "./ChatPage";

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

describe("ChatPage picker", () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    apiMock.mockReset();
    apiMock.mockResolvedValue({ personas: [ada, nova] });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  });

  it("keeps send off the picker until a published persona is picked", async () => {
    render(<ChatPage />);
    expect(await screen.findByRole("button", { name: /@ada/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
    expect(screen.queryByRole("button", { name: "End chat" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /@ada/i }));
    expect(await screen.findByRole("heading", { name: "Ada" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Ada" }).className).toContain(
      "chat-page--sit",
    );
    expect(screen.getByText("Say something. Memory stays with this persona.")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("shows empty copy when nothing is published", async () => {
    apiMock.mockResolvedValue({ personas: [] });
    render(<ChatPage />);
    expect(await screen.findByText("No published personas yet.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
  });

  it("returns to the selector from an idle sitting", async () => {
    render(<ChatPage />);
    fireEvent.click(await screen.findByRole("button", { name: /@ada/i }));
    expect(await screen.findByRole("heading", { name: "Ada" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByRole("button", { name: /@nova/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
  });

  it("keeps Ada and Nova sittings on separate stored pins", async () => {
    const adaSession = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    const novaSession = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
    writeStoredChatSessionId("member", ada.id, adaSession);
    writeStoredChatSessionId("member", nova.id, novaSession);
    apiMock.mockImplementation(async (path: string) => {
      if (path === "/api/personas") {
        return { personas: [ada, nova] };
      }
      if (path.includes(adaSession)) {
        return {
          persona: ada,
          session_id: adaSession,
          turns: [{ ordinal: 1, speaker: "user", text: "ada hello" }],
        };
      }
      if (path.includes(novaSession)) {
        return {
          persona: nova,
          session_id: novaSession,
          turns: [{ ordinal: 1, speaker: "user", text: "nova hello" }],
        };
      }
      throw new Error(`unexpected ${path}`);
    });
    render(<ChatPage />);
    fireEvent.click(await screen.findByRole("button", { name: /@ada/i }));
    expect(await screen.findByText("ada hello")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.click(await screen.findByRole("button", { name: /@nova/i }));
    expect(await screen.findByText("nova hello")).toBeTruthy();
    expect(screen.queryByText("ada hello")).toBeNull();
    await waitFor(() => {
      expect(apiMock.mock.calls.some((call) => String(call[0]).includes(novaSession))).toBe(
        true,
      );
    });
  });

  it("hangs up the sitting and the next send starts a new one", async () => {
    const adaSession = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    const nextSession = "cccccccc-cccc-cccc-cccc-cccccccccccc";
    writeStoredChatSessionId("member", ada.id, adaSession);
    apiMock.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === "/api/personas") {
        return { personas: [ada, nova] };
      }
      if (path === "/api/chat/end") {
        expect(init?.method).toBe("POST");
        expect(JSON.parse(String(init?.body))).toEqual({ session_id: adaSession });
        return undefined;
      }
      if (path === "/api/chat" && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as Record<string, string>;
        expect(body.session_id).toBeUndefined();
        expect(body[personaPinField()]).toBe(ada.id);
        return {
          action: "speak",
          reply_text: "fresh sitting",
          session_id: nextSession,
          reasons: [],
        };
      }
      if (typeof path === "string" && path.includes(adaSession)) {
        return {
          persona: ada,
          session_id: adaSession,
          turns: [{ ordinal: 1, speaker: "user", text: "ada hello" }],
        };
      }
      if (typeof path === "string" && path.includes(nextSession)) {
        return {
          persona: ada,
          session_id: nextSession,
          turns: [
            { ordinal: 1, speaker: "user", text: "hello again" },
            { ordinal: 2, speaker: "persona", text: "fresh sitting" },
          ],
        };
      }
      throw new Error(`unexpected ${path}`);
    });
    render(<ChatPage />);
    fireEvent.click(await screen.findByRole("button", { name: /@ada/i }));
    expect(await screen.findByText("ada hello")).toBeTruthy();
    const hangUp = screen.getByRole("button", { name: "End chat" }) as HTMLButtonElement;
    expect(hangUp.disabled).toBe(false);
    fireEvent.click(hangUp);
    await waitFor(() => {
      expect(screen.queryByText("ada hello")).toBeNull();
    });
    expect(readStoredChatSessionId("member", ada.id)).toBeNull();
    fireEvent.change(screen.getByLabelText("Message"), {
      target: { value: "hello again" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("fresh sitting")).toBeTruthy();
    expect(readStoredChatSessionId("member", ada.id)).toBe(nextSession);
    expect(screen.getByText("hello again").className).toContain("chat-bubble--user");
    expect(screen.getByText("fresh sitting").className).toContain("chat-bubble--assistant");
  });

  it("keeps hang-up disabled until a sitting exists", async () => {
    render(<ChatPage />);
    fireEvent.click(await screen.findByRole("button", { name: /@ada/i }));
    expect(await screen.findByRole("heading", { name: "Ada" })).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "End chat" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("stops an in-flight send and restores the draft", async () => {
    apiMock.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === "/api/personas") {
        return { personas: [ada, nova] };
      }
      if (path === "/api/chat" && init?.method === "POST") {
        return await new Promise((_resolve, reject) => {
          const fail = () => {
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          };
          if (init.signal?.aborted) {
            fail();
            return;
          }
          init.signal?.addEventListener("abort", fail);
        });
      }
      throw new Error(`unexpected ${path}`);
    });
    render(<ChatPage />);
    fireEvent.click(await screen.findByRole("button", { name: /@ada/i }));
    expect(await screen.findByRole("heading", { name: "Ada" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Message"), {
      target: { value: "hold this" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByRole("button", { name: "Stop" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Send" })).toBeTruthy();
    });
    expect((screen.getByLabelText("Message") as HTMLTextAreaElement).value).toBe("hold this");
  });
});
