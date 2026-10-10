import { useEffect } from "react";
import { ChatPage } from "../chat/ChatPage";
import { DataPage } from "../dashboard/DataPage";
import { PersonalHome } from "../dashboard/PersonalHome";
import { VoicePage } from "../voice/VoicePage";
import { logoutUrl } from "../../lib/gateway";
import {
  loadNavConfig,
  navIdForPath,
  personalNav,
  signInCopy,
} from "../../lib/nav";
import { matchPath, replace, useRoute } from "../../lib/router";
import { ROUTES } from "../../lib/routes";
import { isConsentSessionStatus, isHeldSessionStatus } from "../../lib/sessionState";
import { useSession } from "../session";
import { AppShell } from "./AppShell";
import { GateLayout, SignInCard } from "./SignInCard";

function pageFor(path: string) {
  if (matchPath(path, ROUTES.chat)) {
    return <ChatPage />;
  }
  if (matchPath(path, ROUTES.voice)) {
    return <VoicePage />;
  }
  if (matchPath(path, ROUTES.data)) {
    return <DataPage />;
  }
  return <PersonalHome />;
}

export function ProductFrame() {
  const path = useRoute();
  const session = useSession();
  const nav = loadNavConfig();

  useEffect(() => {
    if (isConsentSessionStatus(session.status)) {
      replace(ROUTES.consent);
      return;
    }
    if (isHeldSessionStatus(session.status)) {
      replace(ROUTES.waitlist);
    }
  }, [session.status]);

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

  const items = personalNav(session.me.owner);

  return (
    <AppShell
      active={navIdForPath(items, path)}
      items={items}
      brand={nav.appName}
      homeTo={ROUTES.dashboard}
      personaName={session.persona?.display_name ?? nav.appName}
      accountEmail={session.me.email}
      signOutLabel={nav.signOutLabel}
      flush={matchPath(path, ROUTES.voice)}
      startCollapsed={matchPath(path, ROUTES.voice)}
      onSignOut={() => {
        window.location.href = logoutUrl(path);
      }}
    >
      {pageFor(path)}
    </AppShell>
  );
}
