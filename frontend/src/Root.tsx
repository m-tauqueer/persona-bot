import { useEffect } from "react";
import { CookieBanner } from "./app/landing/CookieBanner";
import { LandingGate } from "./app/landing/LandingGate";
import { AdminFrame } from "./app/shell/AdminFrame";
import { ProductFrame } from "./app/shell/ProductFrame";
import { SessionProvider } from "./app/session";
import { isAdminPath, isPersonalPath } from "./lib/nav";
import { matchPath, replace, useRoute } from "./lib/router";
import { LEGACY_DASHBOARD_REDIRECTS } from "./lib/routes";

function LegacyRedirect({ to }: { to: string }) {
  useEffect(() => {
    replace(to);
  }, [to]);
  return null;
}

export default function Root() {
  const path = useRoute();
  const legacy = LEGACY_DASHBOARD_REDIRECTS.find((entry) =>
    matchPath(path, entry.from),
  );

  return (
    <SessionProvider>
      {legacy ? (
        <LegacyRedirect to={legacy.to} />
      ) : isAdminPath(path) ? (
        <AdminFrame />
      ) : isPersonalPath(path) ? (
        <ProductFrame />
      ) : (
        <LandingGate />
      )}
      <CookieBanner />
    </SessionProvider>
  );
}
