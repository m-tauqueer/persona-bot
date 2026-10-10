import { ACCESS_STATUS, type AccessStatus } from "../schema.js";
import { nextSignInAction } from "./decision.js";

export type MeAccessLabels = {
  active: string;
  waitlisted: string;
  denied: string;
  revoked: string;
  consent: string;
};

export type MeView =
  | { http: 401 }
  | {
      http: 200;
      body:
        | {
            access: string;
            id: string;
            email: string;
            owner: boolean;
          }
        | {
            access: string;
            email: string;
            owner: false;
          };
    };

export function resolveMeView(input: {
  hasMemberSession: boolean;
  user: { id: string; email: string } | null;
  requestStatus: AccessStatus | null;
  email: string | null;
  owner: boolean;
  labels: MeAccessLabels;
  needsConsent?: boolean;
}): MeView {
  if (!input.email) {
    return { http: 401 };
  }
  if (input.needsConsent) {
    return {
      http: 200,
      body: {
        access: input.labels.consent,
        email: input.email,
        owner: false,
      },
    };
  }
  const action = nextSignInAction({
    owner: input.owner,
    hasUser: input.user !== null,
    requestStatus: input.requestStatus,
  });
  if (action.type === "refuse") {
    return {
      http: 200,
      body: {
        access:
          action.status === ACCESS_STATUS.DENIED
            ? input.labels.denied
            : input.labels.revoked,
        email: input.email,
        owner: false,
      },
    };
  }
  if (action.type === "provision" && input.hasMemberSession && input.user) {
    return {
      http: 200,
      body: {
        access: input.labels.active,
        id: input.user.id,
        email: input.user.email,
        owner: input.owner,
      },
    };
  }
  return {
    http: 200,
    body: {
      access: input.labels.waitlisted,
      email: input.email,
      owner: false,
    },
  };
}

export function meAccessLabels(config: {
  ACCESS_ME_ACTIVE: string;
  ACCESS_ME_WAITLISTED: string;
  ACCESS_ME_DENIED: string;
  ACCESS_ME_REVOKED: string;
  ACCESS_ME_CONSENT: string;
}): MeAccessLabels {
  return {
    active: config.ACCESS_ME_ACTIVE,
    waitlisted: config.ACCESS_ME_WAITLISTED,
    denied: config.ACCESS_ME_DENIED,
    revoked: config.ACCESS_ME_REVOKED,
    consent: config.ACCESS_ME_CONSENT,
  };
}
