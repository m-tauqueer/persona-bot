import type { FastifyReply, FastifyRequest } from "fastify";
import type { AppUser } from "../auth/types.js";

export function mockReply() {
  const reply = {
    sent: false,
    statusCode: 200,
    body: undefined as unknown,
    code(statusCode: number) {
      reply.statusCode = statusCode;
      return reply;
    },
    send(body: unknown) {
      reply.body = body;
      reply.sent = true;
      return reply;
    },
    clearCookie() {
      return reply;
    },
    setCookie() {
      return reply;
    },
  };
  return reply as typeof reply & FastifyReply;
}

export function mockRequest(args: {
  appUser?: AppUser;
  cookies?: Record<string, string>;
  ip?: string;
  unsignCookie?: (raw: string) => { valid: boolean; value: string };
}) {
  return {
    appUser: args.appUser,
    cookies: args.cookies ?? {},
    ip: args.ip ?? "127.0.0.1",
    unsignCookie:
      args.unsignCookie ?? ((raw: string) => ({ valid: true, value: raw })),
    log: { warn: () => undefined, error: () => undefined },
  } as unknown as FastifyRequest;
}

export function queuedSql(responses: unknown[][]) {
  let index = 0;
  return async () => responses[index++] ?? [];
}
