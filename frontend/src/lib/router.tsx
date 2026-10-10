import { useEffect, useState } from "react";

const ROUTE_CHANGE = "app:routechange";

const normalize = (path: string) => path.replace(/\/+$/, "") || "/";

function locationKey() {
  return `${window.location.pathname}${window.location.search}`;
}

export function navigate(to: string) {
  const url = new URL(to, window.location.origin);
  const next = `${url.pathname}${url.search}`;
  if (next === locationKey()) return;
  window.history.pushState({}, "", next);
  window.dispatchEvent(new Event(ROUTE_CHANGE));
  window.scrollTo(0, 0);
}

export function replace(to: string) {
  const url = new URL(to, window.location.origin);
  const next = `${url.pathname}${url.search}`;
  if (next === locationKey()) return;
  window.history.replaceState({}, "", next);
  window.dispatchEvent(new Event(ROUTE_CHANGE));
  window.scrollTo(0, 0);
}

function useLocationKey() {
  const [key, setKey] = useState(locationKey);

  useEffect(() => {
    const sync = () => setKey(locationKey());
    window.addEventListener("popstate", sync);
    window.addEventListener(ROUTE_CHANGE, sync);
    return () => {
      window.removeEventListener("popstate", sync);
      window.removeEventListener(ROUTE_CHANGE, sync);
    };
  }, []);

  return key;
}

export function useRoute() {
  const key = useLocationKey();
  return key.split("?")[0] ?? "/";
}

export function useSearchParams() {
  const key = useLocationKey();
  const query = key.includes("?") ? key.slice(key.indexOf("?") + 1) : "";
  return new URLSearchParams(query);
}

export const matchPath = (path: string, route: string) =>
  normalize(path) === normalize(route);

export function matchPattern(
  path: string,
  pattern: string,
): Record<string, string> | null {
  const pathParts = normalize(path).split("/");
  const patternParts = normalize(pattern).split("/");
  if (pathParts.length !== patternParts.length) {
    return null;
  }
  const params: Record<string, string> = {};
  for (let i = 0; i < patternParts.length; i += 1) {
    const part = patternParts[i] ?? "";
    const value = pathParts[i] ?? "";
    if (part.startsWith(":")) {
      if (!value) {
        return null;
      }
      params[part.slice(1)] = decodeURIComponent(value);
      continue;
    }
    if (part !== value) {
      return null;
    }
  }
  return params;
}

export function pathWithin(path: string, base: string): boolean {
  const current = normalize(path);
  const root = normalize(base);
  return current === root || current.startsWith(`${root}/`);
}
