import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

type SitChromeValue = {
  sitting: boolean;
  setSitting: (sitting: boolean) => void;
};

const SitChromeContext = createContext<SitChromeValue | null>(null);

export function SitChromeProvider({ children }: { children: ReactNode }) {
  const [sitting, setSitting] = useState(false);
  const value = useMemo(() => ({ sitting, setSitting }), [sitting]);
  return (
    <SitChromeContext.Provider value={value}>{children}</SitChromeContext.Provider>
  );
}

export function useSitChrome(): SitChromeValue {
  return useContext(SitChromeContext) ?? { sitting: false, setSitting: () => {} };
}

export function useMaxWidth(px: number): boolean {
  const query = `(max-width: ${px}px)`;
  const [matches, setMatches] = useState(() => readMatch(query));

  useEffect(() => {
    if (typeof window.matchMedia !== "function") {
      return;
    }
    const media = window.matchMedia(query);
    const sync = () => {
      setMatches(media.matches);
    };
    sync();
    media.addEventListener("change", sync);
    return () => {
      media.removeEventListener("change", sync);
    };
  }, [query]);

  return matches;
}

function readMatch(query: string): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(query).matches
  );
}
