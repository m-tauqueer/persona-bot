export const ROUTES = {
  home: "/",
  dashboard: "/dashboard",
  chat: "/chat",
  voice: "/voice",
  waitlist: "/waitlist",
  consent: "/consent",
  privacy: "/privacy",
  terms: "/terms",
  status: "/status",
  data: "/dashboard/data",
  admin: "/admin",
  adminConversations: "/admin/conversations",
  adminPeople: "/admin/people",
  adminPersona: "/admin/persona",
  adminDeletions: "/admin/deletions",
} as const;

export const PATTERNS = {
  dashboardSession: "/dashboard/sessions/:id",
  adminSession: "/admin/conversations/:id",
} as const;

export type Route = (typeof ROUTES)[keyof typeof ROUTES];
export type RouteId = keyof typeof ROUTES;

export const PERSONAL_ROUTE_IDS = ["dashboard", "chat", "voice", "data"] as const satisfies readonly RouteId[];

export const ADMIN_NAV_ROUTE_IDS = [
  "admin",
  "adminConversations",
  "adminPeople",
  "adminPersona",
  "adminDeletions",
] as const satisfies readonly RouteId[];

export const OWNER_NAV_ROUTE_IDS = ["admin"] as const satisfies readonly RouteId[];

export const ADMIN_APP_NAV_ROUTE_IDS = [
  "dashboard",
] as const satisfies readonly RouteId[];

export const LEGACY_DASHBOARD_REDIRECTS: ReadonlyArray<{ from: string; to: Route }> = [
  { from: "/dashboard/persona", to: ROUTES.adminPersona },
  { from: "/dashboard/conversations", to: ROUTES.adminConversations },
  { from: "/dashboard/people", to: ROUTES.adminPeople },
];

export function dashboardSessionPath(id: string): string {
  return `/dashboard/sessions/${id}`;
}

export function adminSessionPath(id: string): string {
  return `/admin/conversations/${id}`;
}
