function chatSessionStorageKey(): string {
  const value = import.meta.env.VITE_CHAT_SESSION_STORAGE_KEY;
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("VITE_CHAT_SESSION_STORAGE_KEY is not set");
  }
  return value;
}

export function chatSessionStorageSlot(userId: string, personaId: string): string {
  return `${chatSessionStorageKey()}:${userId}:${personaId}`;
}

export function readStoredChatSessionId(
  userId: string,
  personaId: string,
): string | null {
  return window.localStorage.getItem(chatSessionStorageSlot(userId, personaId));
}

export function writeStoredChatSessionId(
  userId: string,
  personaId: string,
  sessionId: string,
): void {
  window.localStorage.setItem(
    chatSessionStorageSlot(userId, personaId),
    sessionId,
  );
}

export function clearStoredChatSessionId(
  userId: string,
  personaId: string,
): void {
  window.localStorage.removeItem(chatSessionStorageSlot(userId, personaId));
}
