import { MEMORY_ICONS } from "./memory-icons";
import { requiredVite, requiredViteInt } from "./env";
import { matchPath, matchPattern, pathWithin } from "./router";
import {
  ADMIN_APP_NAV_ROUTE_IDS,
  ADMIN_NAV_ROUTE_IDS,
  OWNER_NAV_ROUTE_IDS,
  PATTERNS,
  PERSONAL_ROUTE_IDS,
  ROUTES,
  type RouteId,
} from "./routes";

export type NavItem = {
  id: string;
  label: string;
  icon: string;
  to: string;
};

const ROUTE_IDS = new Set<string>(Object.keys(ROUTES));

function parseNavItems(raw: string, allowed: ReadonlySet<string>, name: string): NavItem[] {
  const items: NavItem[] = [];
  const seen = new Set<string>();
  for (const entry of raw.split(/[;\n]+/)) {
    const trimmed = entry.trim();
    if (trimmed.length === 0) {
      continue;
    }
    const parts = trimmed.split("|").map((part) => part.trim());
    if (parts.length !== 4) {
      throw new Error(`Invalid ${name} entry: ${trimmed}`);
    }
    const [id, label, icon, routeId] = parts;
    if (!id || !label || !icon || !routeId) {
      throw new Error(`Invalid ${name} entry: ${trimmed}`);
    }
    if (seen.has(id)) {
      throw new Error(`Duplicate nav id: ${id}`);
    }
    if (!ROUTE_IDS.has(routeId) || !allowed.has(routeId)) {
      throw new Error(`Unknown nav route: ${routeId}`);
    }
    if (!(icon in MEMORY_ICONS)) {
      throw new Error(`Unknown nav icon: ${icon}`);
    }
    seen.add(id);
    items.push({
      id,
      label,
      icon,
      to: ROUTES[routeId as RouteId],
    });
  }
  if (items.length === 0) {
    throw new Error(`${name} is empty`);
  }
  return items;
}

export type NavConfig = {
  appName: string;
  items: NavItem[];
  ownerItems: NavItem[];
  adminItems: NavItem[];
  adminAppItems: NavItem[];
  aboveNotchCount: number;
  signOutLabel: string;
  loadingLabel: string;
  continueLabel: string;
  notOwnerMessage: string;
  signIn: {
    chatTitle: string;
    chatBody: string;
    voiceTitle: string;
    voiceBody: string;
    personaTitle: string;
    personaBody: string;
    adminTitle: string;
    adminBody: string;
    appTitle: string;
    appBody: string;
  };
};

let cached: NavConfig | null = null;

export function resetNavConfig(): void {
  cached = null;
}

export function loadNavConfig(): NavConfig {
  if (cached) {
    return cached;
  }
  const items = parseNavItems(
    requiredVite("VITE_NAV_ITEMS"),
    new Set(PERSONAL_ROUTE_IDS),
    "VITE_NAV_ITEMS",
  );
  const ownerItems = parseNavItems(
    requiredVite("VITE_NAV_OWNER_ITEMS"),
    new Set(OWNER_NAV_ROUTE_IDS),
    "VITE_NAV_OWNER_ITEMS",
  );
  const adminItems = parseNavItems(
    requiredVite("VITE_ADMIN_NAV_ITEMS"),
    new Set(ADMIN_NAV_ROUTE_IDS),
    "VITE_ADMIN_NAV_ITEMS",
  );
  const adminAppItems = parseNavItems(
    requiredVite("VITE_ADMIN_APP_ITEMS"),
    new Set(ADMIN_APP_NAV_ROUTE_IDS),
    "VITE_ADMIN_APP_ITEMS",
  );
  if (requiredVite("VITE_WAITLIST_PATH") !== ROUTES.waitlist) {
    throw new Error("VITE_WAITLIST_PATH must match the waitlist route");
  }
  if (requiredVite("VITE_CONSENT_PATH") !== ROUTES.consent) {
    throw new Error("VITE_CONSENT_PATH must match the consent route");
  }
  if (requiredVite("VITE_PRIVACY_PATH") !== ROUTES.privacy) {
    throw new Error("VITE_PRIVACY_PATH must match the privacy route");
  }
  if (requiredVite("VITE_TERMS_PATH") !== ROUTES.terms) {
    throw new Error("VITE_TERMS_PATH must match the terms route");
  }
  if (requiredVite("VITE_STATUS_PATH") !== ROUTES.status) {
    throw new Error("VITE_STATUS_PATH must match the status route");
  }
  if (requiredVite("VITE_DATA_PATH") !== ROUTES.data) {
    throw new Error("VITE_DATA_PATH must match the data route");
  }
  if (requiredVite("VITE_ADMIN_DELETIONS_PATH") !== ROUTES.adminDeletions) {
    throw new Error("VITE_ADMIN_DELETIONS_PATH must match the deletions route");
  }
  cached = {
    appName: requiredVite("VITE_APP_NAME"),
    items,
    ownerItems,
    adminItems,
    adminAppItems,
    aboveNotchCount: requiredViteInt("VITE_NAV_ABOVE_NOTCH_COUNT"),
    signOutLabel: requiredVite("VITE_SIGNOUT_LABEL"),
    loadingLabel: requiredVite("VITE_LOADING_LABEL"),
    continueLabel: requiredVite("VITE_SIGNIN_CONTINUE"),
    notOwnerMessage: requiredVite("VITE_NOT_OWNER_MESSAGE"),
    signIn: {
      chatTitle: requiredVite("VITE_SIGNIN_TITLE_CHAT"),
      chatBody: requiredVite("VITE_SIGNIN_BODY_CHAT"),
      voiceTitle: requiredVite("VITE_SIGNIN_TITLE_VOICE"),
      voiceBody: requiredVite("VITE_SIGNIN_BODY_VOICE"),
      personaTitle: requiredVite("VITE_SIGNIN_TITLE_PERSONA"),
      personaBody: requiredVite("VITE_SIGNIN_BODY_PERSONA"),
      adminTitle: requiredVite("VITE_SIGNIN_TITLE_ADMIN"),
      adminBody: requiredVite("VITE_SIGNIN_BODY_ADMIN"),
      appTitle: requiredVite("VITE_SIGNIN_TITLE_APP"),
      appBody: requiredVite("VITE_SIGNIN_BODY_APP"),
    },
  };
  return cached;
}

export function personalNav(owner: boolean): NavItem[] {
  const { items, ownerItems } = loadNavConfig();
  return owner ? [...items, ...ownerItems] : items;
}

export function adminNav(): NavItem[] {
  const { adminItems, adminAppItems } = loadNavConfig();
  return [...adminItems, ...adminAppItems];
}

export function navIdForPath(items: NavItem[], path: string): string {
  const exact = items.find((item) => matchPath(path, item.to));
  if (exact) {
    return exact.id;
  }
  const nested = [...items]
    .filter((item) => pathWithin(path, item.to))
    .sort((a, b) => b.to.length - a.to.length)[0];
  return nested?.id ?? items[0]?.id ?? "";
}

export function isPersonalPath(path: string): boolean {
  return (
    matchPath(path, ROUTES.dashboard) ||
    matchPath(path, ROUTES.chat) ||
    matchPath(path, ROUTES.voice) ||
    matchPath(path, ROUTES.data) ||
    matchPattern(path, PATTERNS.dashboardSession) !== null
  );
}

export function isAdminPath(path: string): boolean {
  return pathWithin(path, ROUTES.admin);
}

export function isWaitlistPath(path: string): boolean {
  return matchPath(path, ROUTES.waitlist);
}

export function isConsentPath(path: string): boolean {
  return matchPath(path, ROUTES.consent);
}

export function isLegalPath(path: string): boolean {
  return matchPath(path, ROUTES.privacy) || matchPath(path, ROUTES.terms);
}

export function isStatusPath(path: string): boolean {
  return matchPath(path, ROUTES.status);
}

export function isPublicPath(path: string): boolean {
  return isLegalPath(path) || isStatusPath(path);
}

export function signInCopy(path: string): { title: string; body: string } {
  const { signIn } = loadNavConfig();
  if (matchPath(path, ROUTES.chat)) {
    return { title: signIn.chatTitle, body: signIn.chatBody };
  }
  if (matchPath(path, ROUTES.voice)) {
    return { title: signIn.voiceTitle, body: signIn.voiceBody };
  }
  if (isAdminPath(path)) {
    return { title: signIn.adminTitle, body: signIn.adminBody };
  }
  return { title: signIn.appTitle, body: signIn.appBody };
}
