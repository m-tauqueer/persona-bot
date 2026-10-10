import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VoiceTranscript } from "./VoiceTranscript";

const avatar = {
  userSeed: "member",
  personaSeed: "ada",
  size: 36,
  gridSize: 6,
  hueSpread: 45,
  animated: false,
};

describe("VoiceTranscript bubbles", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  });

  it("puts the configured user role on the right and the persona on the left", () => {
    render(
      <VoiceTranscript
        title="Live chat"
        empty="empty"
        userRole="caller"
        assistantRole="persona"
        userLabel="You"
        assistantLabel="Ada"
        avatar={avatar}
        lines={[
          { id: 1, role: "caller", text: "ada hello", interim: false },
          { id: 2, role: "persona", text: "fresh sitting", interim: false },
        ]}
      />,
    );
    const user = screen.getByText("ada hello");
    const persona = screen.getByText("fresh sitting");
    expect(user.className).toContain("voice-sit__bubble--user");
    expect(persona.className).toContain("voice-sit__bubble--assistant");
    expect(user.closest(".voice-sit__row")?.className).toContain("voice-sit__row--user");
    expect(persona.closest(".voice-sit__row")?.className).toContain(
      "voice-sit__row--assistant",
    );
    expect(screen.getByLabelText("You")).toBeTruthy();
    expect(screen.getByLabelText("Ada")).toBeTruthy();
  });
});
