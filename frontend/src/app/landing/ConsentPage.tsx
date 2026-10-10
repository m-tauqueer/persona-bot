import { useEffect, useState } from "react";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { api } from "../../lib/gateway";
import { loadNavConfig } from "../../lib/nav";
import { navigate } from "../../lib/router";
import { ROUTES } from "../../lib/routes";
import { loadUiCopy } from "../../lib/uiCopy";
import { FetchError } from "../dashboard/FetchState";
import { GateLayout } from "../shell/SignInCard";

type ConsentPayload = {
  privacy_version: string;
  terms_version: string;
  privacy_path: string;
  terms_path: string;
};

export function ConsentPage() {
  const nav = loadNavConfig();
  const copy = loadUiCopy();
  const [payload, setPayload] = useState<ConsentPayload | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [privacyOk, setPrivacyOk] = useState(false);
  const [termsOk, setTermsOk] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const next = await api<ConsentPayload>("/api/consent");
        if (!cancelled) {
          setPayload(next);
          setError(null);
        }
      } catch (caught) {
        if (!cancelled) {
          setError(caught);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function submit() {
    if (!payload || !privacyOk || !termsOk) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ redirect: string }>("/api/consent", {
        method: "POST",
        body: JSON.stringify({
          privacy_version: payload.privacy_version,
          terms_version: payload.terms_version,
          accepted: true,
        }),
      });
      window.location.href = result.redirect;
    } catch (caught) {
      setError(caught);
      setBusy(false);
    }
  }

  return (
    <GateLayout>
      <Card>
        <h1 className="mc-pagehead__title" style={{ marginBottom: 8 }}>
          {copy.consentTitle}
        </h1>
        <p style={{ color: "var(--text-mid)", marginBottom: 18 }}>
          {copy.consentBody}
        </p>
        {error ? (
          <FetchError error={error} onRetry={() => window.location.reload()} />
        ) : null}
        <label
          style={{
            display: "flex",
            gap: 10,
            alignItems: "flex-start",
            marginBottom: 12,
            color: "var(--text-hi)",
          }}
        >
          <input
            type="checkbox"
            checked={privacyOk}
            onChange={(event) => setPrivacyOk(event.target.checked)}
            style={{ marginTop: 4 }}
          />
          <span>
            {copy.consentPrivacyLabel}{" "}
            <button
              type="button"
              className="mc-activity__title"
              style={{
                background: "none",
                border: 0,
                padding: 0,
                color: "var(--text-hi)",
                textDecoration: "underline",
                cursor: "pointer",
              }}
              onClick={() => navigate(ROUTES.privacy)}
            >
              {copy.privacyTitle}
            </button>
          </span>
        </label>
        <label
          style={{
            display: "flex",
            gap: 10,
            alignItems: "flex-start",
            marginBottom: 18,
            color: "var(--text-hi)",
          }}
        >
          <input
            type="checkbox"
            checked={termsOk}
            onChange={(event) => setTermsOk(event.target.checked)}
            style={{ marginTop: 4 }}
          />
          <span>
            {copy.consentTermsLabel}{" "}
            <button
              type="button"
              className="mc-activity__title"
              style={{
                background: "none",
                border: 0,
                padding: 0,
                color: "var(--text-hi)",
                textDecoration: "underline",
                cursor: "pointer",
              }}
              onClick={() => navigate(ROUTES.terms)}
            >
              {copy.termsTitle}
            </button>
          </span>
        </label>
        <Button
          type="button"
          variant="solid"
          disabled={busy || !payload || !privacyOk || !termsOk}
          onClick={() => void submit()}
        >
          {copy.consentAcceptLabel}
        </Button>
        {!payload ? (
          <p style={{ color: "var(--text-mid)", marginTop: 12 }}>
            {nav.loadingLabel}
          </p>
        ) : null}
      </Card>
    </GateLayout>
  );
}
