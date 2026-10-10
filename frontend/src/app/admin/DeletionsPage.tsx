import { useCallback, useEffect, useState } from "react";
import { Section } from "../../components/Section";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { Input } from "../../components/ui/Input";
import { requiredVite } from "../../lib/env";
import { formatDateTime } from "../../lib/format";
import {
  fetchDeletionRequests,
  postDeletionBatch,
  type DeletionRequest,
} from "../../lib/insights";
import { loadNavConfig } from "../../lib/nav";
import { ROUTES } from "../../lib/routes";
import { loadUiCopy } from "../../lib/uiCopy";
import { EmptyNote, FetchError } from "../dashboard/FetchState";

export function DeletionsPage() {
  const nav = loadNavConfig();
  const copy = loadUiCopy();
  const title =
    nav.adminItems.find((item) => item.to === ROUTES.adminDeletions)?.label ??
    copy.deletionsTitle;
  const queueStatus = requiredVite("VITE_DELETION_QUEUE_STATUS");
  const completeAction = requiredVite("VITE_LIFECYCLE_ACTION_COMPLETE");
  const cancelAction = requiredVite("VITE_LIFECYCLE_ACTION_CANCEL");
  const [queue, setQueue] = useState<DeletionRequest[]>([]);
  const [queueCursor, setQueueCursor] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const loadQueue = useCallback(
    async (nextCursor?: string) => {
      const page = await fetchDeletionRequests({
        status: queueStatus,
        cursor: nextCursor,
      });
      setQueue((current) =>
        nextCursor ? [...current, ...page.requests] : page.requests,
      );
      setQueueCursor(page.next_cursor);
      if (!nextCursor) {
        setSelected(new Set());
      }
    },
    [queueStatus],
  );

  const load = useCallback(
    async (nextCursor?: string) => {
      setLoading(true);
      setError(null);
      try {
        await loadQueue(nextCursor);
      } catch (caught) {
        setError(caught);
      } finally {
        setLoading(false);
      }
    },
    [loadQueue],
  );

  useEffect(() => {
    void load();
  }, [load]);

  async function runBatch(action: string, ids: string[]) {
    if (ids.length === 0) {
      setError(new Error(copy.deletionsSelectedNone));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await postDeletionBatch({
        action,
        ids,
        confirmation:
          action === completeAction ? confirmation : undefined,
      });
      setConfirmation("");
      await loadQueue();
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  const selectedIds = [...selected];

  return (
    <div className="mc-wrap">
      <div className="mc-pagehead">
        <div>
          <h1 className="mc-pagehead__title">{title}</h1>
        </div>
      </div>
      {error ? <FetchError error={error} onRetry={() => void load()} /> : null}
      {loading && queue.length === 0 ? (
        <p style={{ color: "var(--text-mid)" }}>{nav.loadingLabel}</p>
      ) : null}
      <Section
        title={copy.deletionsQueueTitle}
        count={queue.length}
        first
        action={
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Button
              type="button"
              variant="danger"
              disabled={busy || selectedIds.length === 0}
              onClick={() => void runBatch(completeAction, selectedIds)}
            >
              {copy.deletionsCompleteLabel}
            </Button>
            <Button
              type="button"
              disabled={busy || selectedIds.length === 0}
              onClick={() => void runBatch(cancelAction, selectedIds)}
            >
              {copy.deletionsCancelLabel}
            </Button>
          </div>
        }
      >
        <Card>
          <p style={{ color: "var(--text-mid)", marginBottom: 12 }}>
            {copy.deletionsHelp}
          </p>
          <Input
            label={copy.dataConfirmationLabel}
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
          />
        </Card>
        {!error && queue.length === 0 && !loading ? (
          <Card>
            <EmptyNote text={copy.deletionsEmptyQueue} />
          </Card>
        ) : null}
        {!error && queue.length > 0 ? (
          <Card>
            {queue.map((row) => (
              <label
                key={row.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "auto minmax(0, 1fr) auto",
                  gap: 12,
                  alignItems: "start",
                  width: "100%",
                  padding: "10px 0",
                  cursor: "pointer",
                  color: "var(--text-hi)",
                }}
              >
                <input
                  type="checkbox"
                  checked={selected.has(row.id)}
                  onChange={() => toggle(row.id)}
                  style={{ marginTop: 4 }}
                />
                <div className="mc-activity__main">
                  <div className="mc-activity__title">{row.email}</div>
                  <span className="mc-tag">
                    <Badge>{row.status}</Badge>
                  </span>
                </div>
                <span className="mc-activity__time">
                  {formatDateTime(row.requested_at)}
                </span>
              </label>
            ))}
          </Card>
        ) : null}
        {queueCursor ? (
          <div style={{ marginTop: 16 }}>
            <Button
              type="button"
              disabled={loading}
              onClick={() => void loadQueue(queueCursor)}
            >
              {copy.loadMore}
            </Button>
          </div>
        ) : null}
      </Section>
    </div>
  );
}
