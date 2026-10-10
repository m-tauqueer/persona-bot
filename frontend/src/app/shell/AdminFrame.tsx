import { useEffect } from "react";
import { AdminPage } from "../admin/AdminPage";
import { ConversationsPage } from "../admin/ConversationsPage";
import { DeletionsPage } from "../admin/DeletionsPage";
import { OverviewPage } from "../admin/OverviewPage";
import { PeoplePage } from "../admin/PeoplePage";
import { logoutUrl } from "../../lib/gateway";
import {
  adminNav,
  loadNavConfig,
  navIdForPath,
  signInCopy,
} from "../../lib/nav";
import { matchPath, matchPattern, replace, useRoute } from "../../lib/router";
import { PATTERNS, ROUTES } from "../../lib/routes";
import { isConsentSessionStatus, isHeldSessionStatus } from "../../lib/sessionState";
import { useSession } from "../session";
import { AppShell } from "./AppShell";
import { GateLayout, SignInCard } from "./SignInCard";

function adminPage(path: string) {
  if (matchPath(path, ROUTES.adminPersona)) {
    return <AdminPage />;
  }
  if (
    matchPath(path, ROUTES.adminConversations) ||
    matchPattern(path, PATTERNS.adminSession)
  ) {
    return <ConversationsPage />;
  }
  if (matchPath(path, ROUTES.adminPeople)) {
    return <PeoplePage />;
  }
  if (matchPath(path, ROUTES.adminDeletions)) {
    return <DeletionsPage />;
  }
  return <OverviewPage />;
}

export function AdminFrame() {
  const path = useRoute();
  const session = useSession();
  const nav = loadNavConfig();
  const isOwner = session.status === "ready" && session.me.owner;

  useEffect(() => {
    if (isConsentSessionStatus(session.status)) {
      replace(ROUTES.consent);
      return;
    }
    if (isHeldSessionStatus(session.status)) {
      replace(ROUTES.waitlist);
      return;
    }
    if (session.status === "ready" && !isOwner) {
      replace(ROUTES.dashboard);
    }
  }, [isOwner, session.status]);

  if (
    session.status === "loading" ||
    isHeldSessionStatus(session.status) ||
    isConsentSessionStatus(session.status)
  ) {
    return (
      <GateLayout>
        <p>{nav.loadingLabel}</p>
      </GateLayout>
    );
  }

  if (session.status === "signed_out") {
    const copy = signInCopy(path);
    return <SignInCard title={copy.title} body={copy.body} next={path} />;
  }

  if (!session.me.owner) {
    return (
      <GateLayout>
        <p>{nav.loadingLabel}</p>
      </GateLayout>
    );
  }

  const items = adminNav();

  return (
    <AppShell
      active={navIdForPath(items, path)}
      items={items}
      brand={nav.appName}
      homeTo={ROUTES.admin}
      personaName={session.persona?.display_name ?? nav.appName}
      accountEmail={session.me.email}
      signOutLabel={nav.signOutLabel}
      onSignOut={() => {
        window.location.href = logoutUrl(path);
      }}
    >
      {adminPage(path)}
    </AppShell>
  );
}
