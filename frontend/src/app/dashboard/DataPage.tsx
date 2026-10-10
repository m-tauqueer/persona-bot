import { useCallback, useEffect, useState } from "react";
import { Section } from "../../components/Section";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { Input } from "../../components/ui/Input";
import { requiredVite } from "../../lib/env";
import { gatewayOrigin, logoutUrl } from "../../lib/gateway";
import { loadNavConfig } from "../../lib/nav";
import { ROUTES } from "../../lib/routes";
import {
  deleteOwnAccount,
  fetchDeletionStatus,
  requestAccountDeletion,
  type DeletionStatus,
} from "../../lib/insights";
import { loadUiCopy } from "../../lib/uiCopy";
import { EmptyNote, FetchError } from "./FetchState";

export function DataPage() {
  const nav = loadNavConfig();
  const copy = loadUiCopy();
  const title =
    nav.items.find((item) => item.to === ROUTES.data)?.label ?? copy.dataTitle;
  const requestAction = requiredVite("VITE_LIFECYCLE_ACTION_REQUEST");
  const cancelAction = requiredVite("VITE_LIFECYCLE_ACTION_CANCEL");
  const [status, setStatus] = useState<DeletionStatus | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [exported, setExported] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setStatus(await fetchDeletionStatus());
    } catch (caught) {
      setError(caught);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function downloadExport() {
    setBusy(true);
    setError(null);
    setExported(false);
    try {
      const response = await fetch(`${gatewayOrigin()}/api/me/export`, {
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error(copy.fetchError);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = requiredVite("VITE_EXPORT_FILENAME");
      link.click();
      URL.revokeObjectURL(url);
      setExported(true);
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }

  async function runDelete() {
    setBusy(true);
    setError(null);
    try {
      await deleteOwnAccount(confirmation);
      window.location.href = logoutUrl(ROUTES.home);
    } catch (caught) {
      setError(caught);
      setBusy(false);
    }
  }

  async function runRequest(action: string) {
    setBusy(true);
    setError(null);
    try {
      await requestAccountDeletion({
        action,
        confirmation: action === requestAction ? confirmation : undefined,
      });
      setConfirmation("");
      await load();
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }

  const ownerProtected = status?.owner_protected === true;
  const pending = status?.pending;

  return (
    <div className="mc-wrap">
      <div className="mc-pagehead">
        <div>
          <h1 className="mc-pagehead__title">{title}</h1>
        </div>
      </div>
      <p style={{ color: "var(--text-mid)", marginBottom: 16 }}>
        {copy.dataHelp}
      </p>
      {error ? <FetchError error={error} onRetry={() => void load()} /> : null}
      {loading && !status ? (
        <p style={{ color: "var(--text-mid)" }}>{nav.loadingLabel}</p>
      ) : null}
      <Section title={copy.dataExportTitle} first>
        <Card>
          <p style={{ color: "var(--text-mid)", marginBottom: 16 }}>
            {copy.dataExportBody}
          </p>
          <Button
            type="button"
            disabled={busy}
            onClick={() => void downloadExport()}
          >
            {copy.dataExportLabel}
          </Button>
          {exported ? (
            <p style={{ color: "var(--text-mid)", marginTop: 12 }}>
              {copy.dataExportDone}
            </p>
          ) : null}
        </Card>
      </Section>
      <Section title={copy.dataDeleteTitle}>
        {ownerProtected ? (
          <Card>
            <EmptyNote text={copy.dataOwnerProtected} />
          </Card>
        ) : (
          <Card>
            <p style={{ color: "var(--text-mid)", marginBottom: 16 }}>
              {copy.dataDeleteBody}
            </p>
            <p style={{ color: "var(--text-mid)", marginBottom: 16 }}>
              {copy.dataDeleteHint}
            </p>
            {pending ? (
              <p style={{ color: "var(--text-mid)", marginBottom: 16 }}>
                {copy.dataDeletePending}
              </p>
            ) : null}
            <Input
              label={copy.dataConfirmationLabel}
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
            />
            <div
              style={{
                display: "flex",
                gap: 8,
                flexWrap: "wrap",
                marginTop: 16,
              }}
            >
              <Button
                type="button"
                variant="danger"
                disabled={busy || confirmation.length === 0}
                onClick={() => void runDelete()}
              >
                {copy.dataDeleteNowLabel}
              </Button>
              {pending ? (
                <Button
                  type="button"
                  disabled={busy}
                  onClick={() => void runRequest(cancelAction)}
                >
                  {copy.dataCancelRequestLabel}
                </Button>
              ) : (
                <Button
                  type="button"
                  disabled={busy || confirmation.length === 0}
                  onClick={() => void runRequest(requestAction)}
                >
                  {copy.dataRequestLabel}
                </Button>
              )}
            </div>
          </Card>
        )}
      </Section>
    </div>
  );
}
