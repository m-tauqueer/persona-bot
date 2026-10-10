import type { GatewayConfig } from "../config.js";

/**
 * A member must not learn from a relayed worker reply whether a persona exists
 * as an unpublished draft. The worker names the case (`persona_not_found` vs
 * `session_not_found`) for its own logs; every 404 leaves here identical.
 */
export function memberFacingBody(
  status: number,
  body: unknown,
  notFoundError: string,
): unknown {
  if (status === 404) {
    return { error: notFoundError };
  }
  return body;
}

export async function callWorker(
  config: GatewayConfig,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const url = new URL(path, config.WORKER_URL);
  const headers = new Headers(init.headers);
  headers.set(config.INTERNAL_SECRET_HEADER, config.INTERNAL_API_SECRET);
  return fetch(url, {
    ...init,
    headers,
    signal: init.signal ?? AbortSignal.timeout(config.WORKER_HTTP_TIMEOUT_MS),
  });
}
