import { requiredVite } from "./env";

export type ReadyMe = {
  id: string;
  email: string;
  owner: boolean;
};

export type HeldMe = {
  email: string;
  owner: false;
};

export type MePayload = {
  access?: string;
  id?: string;
  email: string;
  owner: boolean;
};

export type SessionFromMe =
  | { status: "ready"; me: ReadyMe }
  | { status: "waitlisted"; me: HeldMe }
  | { status: "denied"; me: HeldMe }
  | { status: "revoked"; me: HeldMe }
  | { status: "consent"; me: HeldMe }
  | { status: "signed_out"; me: null };

export function accessMeLabels() {
  return {
    active: requiredVite("VITE_ACCESS_ACTIVE"),
    waitlisted: requiredVite("VITE_ACCESS_WAITLISTED"),
    denied: requiredVite("VITE_ACCESS_DENIED"),
    revoked: requiredVite("VITE_ACCESS_REVOKED"),
    consent: requiredVite("VITE_ACCESS_CONSENT"),
  };
}

export function isHeldSessionStatus(
  status: string,
): status is "waitlisted" | "denied" | "revoked" {
  return (
    status === "waitlisted" || status === "denied" || status === "revoked"
  );
}

export function isConsentSessionStatus(status: string): status is "consent" {
  return status === "consent";
}

export function sessionFromMeFetch(
  result: { ok: true; me: MePayload } | { ok: false },
): SessionFromMe {
  if (!result.ok) {
    return { status: "signed_out", me: null };
  }
  const { me } = result;
  const labels = accessMeLabels();
  if (me.access === labels.consent) {
    return { status: "consent", me: { email: me.email, owner: false } };
  }
  if (me.access === labels.waitlisted) {
    return { status: "waitlisted", me: { email: me.email, owner: false } };
  }
  if (me.access === labels.denied) {
    return { status: "denied", me: { email: me.email, owner: false } };
  }
  if (me.access === labels.revoked) {
    return { status: "revoked", me: { email: me.email, owner: false } };
  }
  if (typeof me.id === "string" && me.id.length > 0) {
    return {
      status: "ready",
      me: { id: me.id, email: me.email, owner: me.owner },
    };
  }
  return { status: "signed_out", me: null };
}
