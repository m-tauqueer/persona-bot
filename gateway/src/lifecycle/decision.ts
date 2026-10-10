import { DELETION_STATUS, type DeletionStatus } from "../schema.js";

export type StoredConsent = {
  privacyVersion: string;
  termsVersion: string;
};

export function consentIsCurrent(
  stored: StoredConsent | null,
  current: StoredConsent,
): boolean {
  if (stored === null) {
    return false;
  }
  return (
    stored.privacyVersion === current.privacyVersion &&
    stored.termsVersion === current.termsVersion
  );
}

export function confirmationMatches(input: string, expected: string): boolean {
  return input.trim() === expected.trim();
}

export type DeleteTargetResult =
  | { ok: true }
  | { ok: false; reason: "owner_protected" | "self" };

export function canDeleteAccount(input: {
  targetIsOwner: boolean;
  isSelf: boolean;
  allowSelf: boolean;
}): DeleteTargetResult {
  if (input.targetIsOwner) {
    return { ok: false, reason: "owner_protected" };
  }
  if (input.isSelf && !input.allowSelf) {
    return { ok: false, reason: "self" };
  }
  return { ok: true };
}

export type DeletionAction = "request" | "complete" | "cancel";

export function parseDeletionAction(
  raw: string,
  tokens: { request: string; complete: string; cancel: string },
): DeletionAction | null {
  if (raw === tokens.request) {
    return "request";
  }
  if (raw === tokens.complete) {
    return "complete";
  }
  if (raw === tokens.cancel) {
    return "cancel";
  }
  return null;
}

export type DeletionTransitionResult =
  | { ok: true; status: DeletionStatus }
  | { ok: false; reason: "invalid_transition" };

export function nextDeletionStatus(input: {
  action: DeletionAction;
  current: DeletionStatus | null;
}): DeletionTransitionResult {
  if (input.action === "request") {
    if (
      input.current === null ||
      input.current === DELETION_STATUS.CANCELLED ||
      input.current === DELETION_STATUS.COMPLETED
    ) {
      return { ok: true, status: DELETION_STATUS.PENDING };
    }
    return { ok: false, reason: "invalid_transition" };
  }
  if (input.current !== DELETION_STATUS.PENDING) {
    return { ok: false, reason: "invalid_transition" };
  }
  if (input.action === "complete") {
    return { ok: true, status: DELETION_STATUS.COMPLETED };
  }
  return { ok: true, status: DELETION_STATUS.CANCELLED };
}

export function sessionPastRetention(input: {
  endedAt: Date | null;
  now: Date;
  retentionDays: number;
}): boolean {
  if (input.retentionDays <= 0 || input.endedAt === null) {
    return false;
  }
  const cutoff =
    input.now.getTime() - input.retentionDays * 24 * 60 * 60 * 1000;
  return input.endedAt.getTime() <= cutoff;
}
