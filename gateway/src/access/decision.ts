import { ACCESS_STATUS, type AccessStatus } from "../schema.js";

export type SignInAccessAction =
  | { type: "provision"; reason: "owner" | "existing_member" | "approved" }
  | { type: "waitlist" }
  | {
      type: "refuse";
      status: typeof ACCESS_STATUS.DENIED | typeof ACCESS_STATUS.REVOKED;
    };

export type AccessBatchAction = "approve" | "deny" | "revoke";

export function parseBatchAction(
  raw: string,
  tokens: { approve: string; deny: string; revoke: string },
): AccessBatchAction | null {
  if (raw === tokens.approve) {
    return "approve";
  }
  if (raw === tokens.deny) {
    return "deny";
  }
  if (raw === tokens.revoke) {
    return "revoke";
  }
  return null;
}

export type BatchStatusResult =
  | { ok: true; status: AccessStatus }
  | { ok: false; reason: "owner_protected" | "self" | "invalid_transition" };

export function nextSignInAction(input: {
  owner: boolean;
  hasUser: boolean;
  requestStatus: AccessStatus | null;
}): SignInAccessAction {
  if (input.owner) {
    return { type: "provision", reason: "owner" };
  }
  if (input.requestStatus === ACCESS_STATUS.DENIED) {
    return { type: "refuse", status: ACCESS_STATUS.DENIED };
  }
  if (input.requestStatus === ACCESS_STATUS.REVOKED) {
    return { type: "refuse", status: ACCESS_STATUS.REVOKED };
  }
  if (input.hasUser) {
    return { type: "provision", reason: "existing_member" };
  }
  if (
    input.requestStatus === ACCESS_STATUS.APPROVED ||
    input.requestStatus === ACCESS_STATUS.ACTIVE
  ) {
    return { type: "provision", reason: "approved" };
  }
  return { type: "waitlist" };
}

export function nextBatchStatus(input: {
  action: AccessBatchAction;
  current: AccessStatus;
  hasUser: boolean;
  targetIsOwner: boolean;
  isSelf: boolean;
}): BatchStatusResult {
  if (input.action === "revoke" && input.isSelf) {
    return { ok: false, reason: "self" };
  }
  if (
    (input.action === "deny" || input.action === "revoke") &&
    input.targetIsOwner
  ) {
    return { ok: false, reason: "owner_protected" };
  }
  if (input.action === "approve") {
    if (input.hasUser) {
      return { ok: true, status: ACCESS_STATUS.ACTIVE };
    }
    if (
      input.current === ACCESS_STATUS.REQUESTED ||
      input.current === ACCESS_STATUS.DENIED ||
      input.current === ACCESS_STATUS.APPROVED ||
      input.current === ACCESS_STATUS.REVOKED
    ) {
      return { ok: true, status: ACCESS_STATUS.APPROVED };
    }
    return { ok: false, reason: "invalid_transition" };
  }
  if (input.action === "deny") {
    if (input.hasUser) {
      return { ok: false, reason: "invalid_transition" };
    }
    if (
      input.current === ACCESS_STATUS.REQUESTED ||
      input.current === ACCESS_STATUS.APPROVED ||
      input.current === ACCESS_STATUS.DENIED
    ) {
      return { ok: true, status: ACCESS_STATUS.DENIED };
    }
    return { ok: false, reason: "invalid_transition" };
  }
  if (input.current === ACCESS_STATUS.REVOKED) {
    return { ok: true, status: ACCESS_STATUS.REVOKED };
  }
  if (
    input.hasUser &&
    (input.current === ACCESS_STATUS.ACTIVE ||
      input.current === ACCESS_STATUS.APPROVED)
  ) {
    return { ok: true, status: ACCESS_STATUS.REVOKED };
  }
  return { ok: false, reason: "invalid_transition" };
}
