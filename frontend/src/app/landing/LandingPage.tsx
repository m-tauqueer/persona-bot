import { SignInCard } from "../shell/SignInCard";
import { loadNavConfig } from "../../lib/nav";
import { navigate } from "../../lib/router";
import { ROUTES } from "../../lib/routes";
import { loadUiCopy } from "../../lib/uiCopy";

export function LandingPage() {
  const { appName, signIn } = loadNavConfig();
  const copy = loadUiCopy();
  return (
    <>
      <SignInCard title={appName} body={signIn.appBody} next={ROUTES.dashboard} />
      <p className="st__foot" style={{ position: "relative", zIndex: 1, marginTop: 0 }}>
        <button
          type="button"
          className="st-link"
          onClick={() => navigate(ROUTES.privacy)}
        >
          {copy.privacyTitle}
        </button>
        <span aria-hidden="true">·</span>
        <button
          type="button"
          className="st-link"
          onClick={() => navigate(ROUTES.terms)}
        >
          {copy.termsTitle}
        </button>
        <span aria-hidden="true">·</span>
        <button
          type="button"
          className="st-link"
          onClick={() => navigate(ROUTES.status)}
        >
          {copy.statusLink}
        </button>
      </p>
    </>
  );
}
