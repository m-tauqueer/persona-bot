import { describe, expect, it } from "vitest";
import { requiredVoiceDockIcon } from "./voiceDockIcons";

describe("requiredVoiceDockIcon", () => {
  it("accepts a library icon name from env", () => {
    expect(requiredVoiceDockIcon("VITE_VOICE_ICON_START")).toBe("Mic");
    expect(requiredVoiceDockIcon("VITE_VOICE_ICON_END")).toBe("PhoneHangup");
    expect(requiredVoiceDockIcon("VITE_VOICE_ICON_BACK")).toBe("ArrowLeft");
  });
});
