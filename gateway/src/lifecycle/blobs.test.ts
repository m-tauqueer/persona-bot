import { describe, expect, it } from "vitest";
import { blobNameFromUrl } from "./blobs.js";

describe("blobNameFromUrl", () => {
  it("reads the name after the container segment", () => {
    expect(
      blobNameFromUrl(
        "https://acct.blob.core.windows.net/voice/voice/abc.wav",
        "voice",
      ),
    ).toBe("voice/abc.wav");
  });

  it("returns null for a bad url", () => {
    expect(blobNameFromUrl("not-a-url", "voice")).toBeNull();
  });
});
