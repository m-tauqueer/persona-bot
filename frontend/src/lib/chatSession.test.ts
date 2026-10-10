import { afterEach, describe, expect, it } from "vitest";
import {
  chatSessionStorageSlot,
  clearStoredChatSessionId,
  readStoredChatSessionId,
  writeStoredChatSessionId,
} from "./chatSession";

describe("chat sitting storage", () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it("keeps Ada and Nova sittings on separate keys", () => {
    expect(chatSessionStorageSlot("user-a", "ada")).not.toBe(
      chatSessionStorageSlot("user-a", "nova"),
    );
    writeStoredChatSessionId("user-a", "ada", "session-ada");
    writeStoredChatSessionId("user-a", "nova", "session-nova");
    expect(readStoredChatSessionId("user-a", "ada")).toBe("session-ada");
    expect(readStoredChatSessionId("user-a", "nova")).toBe("session-nova");
    clearStoredChatSessionId("user-a", "ada");
    expect(readStoredChatSessionId("user-a", "ada")).toBeNull();
    expect(readStoredChatSessionId("user-a", "nova")).toBe("session-nova");
  });
});
