export const SUBSCRIPTION_STATUS = {
  ACTIVE: "active",
  REVOKED: "revoked",
} as const;

export const ACCESS_STATUS = {
  REQUESTED: "requested",
  APPROVED: "approved",
  ACTIVE: "active",
  DENIED: "denied",
  REVOKED: "revoked",
} as const;

export const SESSION_KIND = {
  MEMBER: "member",
  WAITLIST: "waitlist",
  REFUSED: "refused",
  CONSENT: "consent",
} as const;

export const DELETION_STATUS = {
  PENDING: "pending",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
} as const;

export const OPS_SERVICE = {
  GATEWAY: "gateway",
  WORKER: "worker",
} as const;

export const SESSION_CHANNEL = {
  TEXT: "text",
  VOICE: "voice",
} as const;

export const TURN_SPEAKER = {
  USER: "user",
  PERSONA: "persona",
} as const;

export const CONTROLLER_ACTION = {
  SPEAK: "speak",
  SILENCE: "silence",
} as const;

export const AUDIO_DIRECTION = {
  USER: "user",
  BOT: "bot",
} as const;

export type SubscriptionStatus =
  (typeof SUBSCRIPTION_STATUS)[keyof typeof SUBSCRIPTION_STATUS];
export type AccessStatus = (typeof ACCESS_STATUS)[keyof typeof ACCESS_STATUS];
export type SessionKind = (typeof SESSION_KIND)[keyof typeof SESSION_KIND];
export type DeletionStatus =
  (typeof DELETION_STATUS)[keyof typeof DELETION_STATUS];
export type OpsService = (typeof OPS_SERVICE)[keyof typeof OPS_SERVICE];
export type SessionChannel =
  (typeof SESSION_CHANNEL)[keyof typeof SESSION_CHANNEL];
export type TurnSpeaker = (typeof TURN_SPEAKER)[keyof typeof TURN_SPEAKER];
export type ControllerAction =
  (typeof CONTROLLER_ACTION)[keyof typeof CONTROLLER_ACTION];
export type AudioDirection =
  (typeof AUDIO_DIRECTION)[keyof typeof AUDIO_DIRECTION];
