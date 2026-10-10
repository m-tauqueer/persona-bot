import {
  type GatewayConfig,
  internalThinkUrl,
  thinkEndpointHeaders,
} from "../config.js";
import type { ThinkIdentity } from "../deepgram/settings.js";

export function takeSseTokens(
  buffer: string,
  config: GatewayConfig,
): { rest: string; tokens: string[]; done: boolean } {
  const parts = buffer.split(/\r?\n\r?\n/);
  const rest = parts.pop() ?? "";
  const tokens: string[] = [];
  let done = false;
  const prefix = config.BYO_LLM_SSE_DATA_PREFIX;
  for (const block of parts) {
    for (const line of block.split(/\r?\n/)) {
      if (!line.startsWith(prefix)) {
        continue;
      }
      const data = line.slice(prefix.length).trim();
      if (data === config.BYO_LLM_SSE_DONE) {
        done = true;
        continue;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(data) as unknown;
      } catch {
        continue;
      }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        continue;
      }
      const choices = (parsed as { choices?: unknown }).choices;
      if (!Array.isArray(choices) || choices.length === 0) {
        continue;
      }
      const choice = choices[0];
      if (!choice || typeof choice !== "object" || Array.isArray(choice)) {
        continue;
      }
      const delta = (choice as { delta?: unknown }).delta;
      if (!delta || typeof delta !== "object" || Array.isArray(delta)) {
        continue;
      }
      const content = (delta as { content?: unknown }).content;
      if (typeof content === "string" && content.length > 0) {
        tokens.push(content);
      }
    }
  }
  return { rest, tokens, done };
}

export async function streamThink(
  config: GatewayConfig,
  identity: ThinkIdentity,
  text: string,
  signal: AbortSignal,
  onToken: (token: string) => void,
): Promise<{ spoke: boolean }> {
  const response = await fetch(internalThinkUrl(config), {
    method: "POST",
    headers: {
      ...thinkEndpointHeaders(config, identity),
      "content-type": "application/json",
    },
    body: JSON.stringify({
      stream: true,
      model: config.DEEPGRAM_THINK_MODEL,
      messages: [{ role: config.BYO_LLM_USER_ROLE, content: text }],
    }),
    signal,
  });
  if (!response.ok) {
    const error = new Error(`think status ${response.status}`);
    (error as Error & { status: number }).status = response.status;
    throw error;
  }
  if (!response.body) {
    return { spoke: false };
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let spoke = false;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const taken = takeSseTokens(buffer, config);
    buffer = taken.rest;
    for (const token of taken.tokens) {
      spoke = true;
      onToken(token);
    }
    if (taken.done) {
      break;
    }
  }
  return { spoke };
}
