import type { FastifyRequest } from "fastify";

export type AppUser = {
  id: string;
  googleSub: string;
  email: string;
  engramUserId: string;
};

declare module "fastify" {
  interface FastifyRequest {
    appUser?: AppUser;
  }
}

export type AuthedRequest = FastifyRequest & { appUser: AppUser };
