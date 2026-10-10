import { afterEach, describe, expect, it, vi } from "vitest";
import {
  adminNav,
  isAdminPath,
  isConsentPath,
  isLegalPath,
  isPersonalPath,
  isPublicPath,
  isStatusPath,
  isWaitlistPath,
  loadNavConfig,
  navIdForPath,
  personalNav,
  resetNavConfig,
  signInCopy,
} from "./nav";
import { ROUTES } from "./routes";

afterEach(() => {
  resetNavConfig();
});

describe("nav config", () => {
  it("gives members the personal list only", () => {
    const nav = loadNavConfig();
    const member = personalNav(false);
    expect(member.map((item) => item.id)).toEqual(nav.items.map((item) => item.id));
    expect(member.some((item) => item.to === ROUTES.admin)).toBe(false);
    expect(nav.items.every((item) => !isAdminPath(item.to))).toBe(true);
    expect(nav.items.map((item) => item.id)).toEqual(["voice", "chat", "home", "data"]);
    expect(nav.aboveNotchCount).toBe(2);
    expect(nav.appName).toBe("Fern");
    expect(nav.items.find((item) => item.id === "home")?.label).toBe("History");
    expect(nav.items.find((item) => item.id === "chat")?.label).toBe("persona-chat");
    expect(nav.items.find((item) => item.id === "voice")?.label).toBe("Persona voice");
  });

  it("adds owner items only for owners", () => {
    const nav = loadNavConfig();
    const owner = personalNav(true);
    expect(nav.ownerItems.every((extra) => owner.some((item) => item.id === extra.id))).toBe(
      true,
    );
    expect(nav.ownerItems.every((item) => isAdminPath(item.to))).toBe(true);
  });

  it("adds the personal app link on the admin list", () => {
    const nav = loadNavConfig();
    const items = adminNav();
    expect(nav.adminAppItems.every((extra) => items.some((item) => item.id === extra.id))).toBe(
      true,
    );
    expect(nav.adminAppItems.every((item) => isPersonalPath(item.to))).toBe(true);
    expect(nav.adminItems.every((item) => isAdminPath(item.to))).toBe(true);
  });

  it("classifies personal and admin paths", () => {
    expect(isPersonalPath("/dashboard")).toBe(true);
    expect(isPersonalPath("/dashboard/sessions/abc")).toBe(true);
    expect(isPersonalPath("/dashboard/data")).toBe(true);
    expect(isPersonalPath("/chat")).toBe(true);
    expect(isPersonalPath("/admin")).toBe(false);
    expect(isAdminPath("/admin/people")).toBe(true);
    expect(isAdminPath("/admin/deletions")).toBe(true);
    expect(isAdminPath("/dashboard")).toBe(false);
    expect(isWaitlistPath("/waitlist")).toBe(true);
    expect(isPersonalPath("/waitlist")).toBe(false);
    expect(isAdminPath("/waitlist")).toBe(false);
    expect(isConsentPath("/consent")).toBe(true);
    expect(isLegalPath("/privacy")).toBe(true);
    expect(isLegalPath("/terms")).toBe(true);
    expect(isLegalPath("/consent")).toBe(false);
    expect(isStatusPath("/status")).toBe(true);
    expect(isPublicPath("/status")).toBe(true);
    expect(isPublicPath("/privacy")).toBe(true);
    expect(isPublicPath("/dashboard")).toBe(false);
    expect(isLegalPath("/status")).toBe(false);
  });

  it("picks the nested nav id for a session path", () => {
    const items = personalNav(false);
    expect(navIdForPath(items, "/dashboard")).toBe("home");
    expect(navIdForPath(items, "/dashboard/sessions/x")).toBe("home");
    expect(navIdForPath(items, "/chat")).toBe("chat");
  });

  it("selects sign-in copy from the path", () => {
    expect(signInCopy("/chat").title).toBe("persona-chat");
    expect(signInCopy("/voice").title).toBe("Fern");
    expect(signInCopy("/admin/people").title).toBe("Admin");
    expect(signInCopy("/dashboard").title).toBe("Sign in");
  });

  it("rejects an unknown nav route", () => {
    vi.stubEnv("VITE_NAV_ITEMS", "home|Home|home|not-a-route");
    resetNavConfig();
    expect(() => loadNavConfig()).toThrow(/Unknown nav route/);
  });
});
