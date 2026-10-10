import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { api } from "../lib/gateway";
import {
  sessionFromMeFetch,
  type HeldMe,
  type MePayload,
  type ReadyMe,
} from "../lib/sessionState";

export type AppUser = ReadyMe;

export type AppPersona = {
  id: string;
  handle: string;
  display_name: string;
  description: string | null;
};

type SessionState =
  | { status: "loading"; me: null; persona: null }
  | { status: "signed_out"; me: null; persona: null }
  | { status: "ready"; me: AppUser; persona: AppPersona | null }
  | { status: "waitlisted"; me: HeldMe; persona: null }
  | { status: "denied"; me: HeldMe; persona: null }
  | { status: "revoked"; me: HeldMe; persona: null }
  | { status: "consent"; me: HeldMe; persona: null };

type SessionContextValue = SessionState & {
  reloadPersona: () => Promise<void>;
};

const SessionContext = createContext<SessionContextValue | null>(null);

async function fetchPersona(): Promise<AppPersona | null> {
  return null;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({
    status: "loading",
    me: null,
    persona: null,
  });

  const reloadPersona = useCallback(async () => {
    try {
      const persona = await fetchPersona();
      setState((current) =>
        current.status === "ready" ? { ...current, persona } : current,
      );
    } catch {
      setState((current) =>
        current.status === "ready" ? { ...current, persona: null } : current,
      );
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const me = await api<MePayload>("/api/me");
        if (cancelled) return;
        const resolved = sessionFromMeFetch({ ok: true, me });
        if (resolved.status !== "ready") {
          setState({ ...resolved, persona: null });
          return;
        }
        let persona: AppPersona | null = null;
        try {
          persona = await fetchPersona();
        } catch {
          persona = null;
        }
        if (cancelled) return;
        setState({ ...resolved, persona });
      } catch {
        if (cancelled) return;
        setState({ ...sessionFromMeFetch({ ok: false }), persona: null });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <SessionContext.Provider value={{ ...state, reloadPersona }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) {
    throw new Error("useSession must be used inside SessionProvider");
  }
  return value;
}
