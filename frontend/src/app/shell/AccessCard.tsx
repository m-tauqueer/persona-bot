import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { logoutUrl } from "../../lib/gateway";
import { loadNavConfig } from "../../lib/nav";
import { ROUTES } from "../../lib/routes";
import { loadUiCopy } from "../../lib/uiCopy";
import { GateLayout } from "./SignInCard";

export function AccessCard({
  status,
}: {
  status: "waitlisted" | "denied" | "revoked";
}) {
  const nav = loadNavConfig();
  const copy = loadUiCopy();
  const title =
    status === "denied"
      ? copy.accessDeniedTitle
      : status === "revoked"
        ? copy.accessRevokedTitle
        : copy.waitlistTitle;
  const body =
    status === "denied"
      ? copy.accessDeniedBody
      : status === "revoked"
        ? copy.accessRevokedBody
        : copy.waitlistBody;
  return (
    <GateLayout>
      <p className="mc-gate__brand">{nav.appName}</p>
      <Card>
        <h1 className="mc-pagehead__title mc-gate__title">{title}</h1>
        <p className="mc-gate__body">{body}</p>
        <Button
          variant="solid"
          onClick={() => {
            window.location.href = logoutUrl(ROUTES.home);
          }}
        >
          {nav.signOutLabel}
        </Button>
      </Card>
    </GateLayout>
  );
}
