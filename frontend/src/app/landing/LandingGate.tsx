import { useEffect } from "react";
import { isLegalPath, isPublicPath, isStatusPath, loadNavConfig } from "../../lib/nav";
import { matchPath, replace, useRoute } from "../../lib/router";
import { ROUTES } from "../../lib/routes";
import {
  isConsentSessionStatus,
  isHeldSessionStatus,
} from "../../lib/sessionState";
import { useSession } from "../session";
import { AccessCard } from "../shell/AccessCard";
import { GateLayout } from "../shell/SignInCard";
import { ConsentPage } from "./ConsentPage";
import { LandingPage } from "./LandingPage";
import { LegalPage } from "./LegalPage";
import { StatusPage } from "./StatusPage";

export function LandingGate() {
  const path = useRoute();
  const session = useSession();
  const { loadingLabel } = loadNavConfig();
  const publicPage = isPublicPath(path);

  useEffect(() => {
    if (publicPage) {
      return;
    }
    if (session.status === "ready") {
      replace(ROUTES.dashboard);
      return;
    }
    if (isConsentSessionStatus(session.status)) {
      if (!matchPath(path, ROUTES.consent)) {
        replace(ROUTES.consent);
      }
      return;
    }
    if (isHeldSessionStatus(session.status)) {
      if (!matchPath(path, ROUTES.waitlist)) {
        replace(ROUTES.waitlist);
      }
      return;
    }
    if (session.status === "signed_out" && !matchPath(path, ROUTES.home)) {
      replace(ROUTES.home);
    }
  }, [publicPage, path, session.status]);

  if (isStatusPath(path)) {
    return <StatusPage />;
  }

  if (isLegalPath(path)) {
    return <LegalPage />;
  }

  if (session.status === "loading" || session.status === "ready") {
    return (
      <GateLayout>
        <p>{loadingLabel}</p>
      </GateLayout>
    );
  }

  if (isConsentSessionStatus(session.status)) {
    return <ConsentPage />;
  }

  if (isHeldSessionStatus(session.status)) {
    return <AccessCard status={session.status} />;
  }

  return <LandingPage />;
}
