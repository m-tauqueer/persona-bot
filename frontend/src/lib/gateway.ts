export function gatewayOrigin(): string {
  const value = import.meta.env.VITE_GATEWAY_URL;
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("VITE_GATEWAY_URL is not set");
  }
  return value.replace(/\/+$/, "");
}

export function googleSignInUrl(next?: string): string {
  const url = new URL("/auth/google", `${gatewayOrigin()}/`);
  if (next) {
    url.searchParams.set("next", next);
  }
  return url.toString();
}

export function logoutUrl(next?: string): string {
  const url = new URL("/auth/logout", `${gatewayOrigin()}/`);
  if (next) {
    url.searchParams.set("next", next);
  }
  return url.toString();
}

export function chatSilenceStatus(): string {
  const value = import.meta.env.VITE_CHAT_SILENCE_STATUS;
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("VITE_CHAT_SILENCE_STATUS is not set");
  }
  return value;
}

export function turnSpeakerUser(): string {
  const value = import.meta.env.VITE_TURN_SPEAKER_USER;
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("VITE_TURN_SPEAKER_USER is not set");
  }
  return value;
}

export function turnSpeakerPersona(): string {
  const value = import.meta.env.VITE_TURN_SPEAKER_PERSONA;
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("VITE_TURN_SPEAKER_PERSONA is not set");
  }
  return value;
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined && !(init.body instanceof FormData) && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const response = await fetch(`${gatewayOrigin()}${path}`, {
    ...init,
    credentials: "include",
    headers,
  });
  if (response.status === 204) {
    return undefined as T;
  }
  const body = (await response.json().catch(() => null)) as T | { error?: string; detail?: unknown };
  if (!response.ok) {
    const message =
      body && typeof body === "object" && "error" in body && typeof body.error === "string"
        ? body.error
        : `request failed (${response.status})`;
    throw new ApiError(message, response.status, body);
  }
  return body as T;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
