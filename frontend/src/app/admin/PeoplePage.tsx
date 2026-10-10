import { useCallback, useEffect, useState } from "react";
import { Section } from "../../components/Section";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { requiredVite } from "../../lib/env";
import { formatDateTime } from "../../lib/format";
import {
  fetchAccessRequests,
  fetchOwnerUsers,
  postAccessBatch,
  type AccessRequest,
  type InsightsUser,
} from "../../lib/insights";
import { loadNavConfig } from "../../lib/nav";
import { navigate } from "../../lib/router";
import { ROUTES } from "../../lib/routes";
import { loadUiCopy } from "../../lib/uiCopy";
import { EmptyNote, FetchError } from "../dashboard/FetchState";

const rowButtonStyle = {
  flex: 1,
  minWidth: 0,
  width: "100%",
  textAlign: "left" as const,
  background: "transparent",
  border: 0,
  color: "var(--text-hi)",
  cursor: "pointer",
  padding: "10px 0",
};

export function PeoplePage() {
  const nav = loadNavConfig();
  const copy = loadUiCopy();
  const title =
    nav.adminItems.find((item) => item.to === ROUTES.adminPeople)?.label ??
    copy.peopleTitle;
  const queueStatus = requiredVite("VITE_ACCESS_QUEUE_STATUS");
  const approveAction = requiredVite("VITE_ACCESS_ACTION_APPROVE");
  const denyAction = requiredVite("VITE_ACCESS_ACTION_DENY");
  const revokeAction = requiredVite("VITE_ACCESS_ACTION_REVOKE");
  const [rows, setRows] = useState<InsightsUser[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [queue, setQueue] = useState<AccessRequest[]>([]);
  const [queueCursor, setQueueCursor] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const loadMembers = useCallback(async (nextCursor?: string) => {
    const page = await fetchOwnerUsers(nextCursor);
    setRows((current) =>
      nextCursor ? [...current, ...page.users] : page.users,
    );
    setCursor(page.next_cursor);
  }, []);

  const loadQueue = useCallback(
    async (nextCursor?: string) => {
      const page = await fetchAccessRequests({
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
        await loadMembers(nextCursor);
        if (!nextCursor) {
          await loadQueue();
        }
      } catch (caught) {
        setError(caught);
      } finally {
        setLoading(false);
      }
    },
    [loadMembers, loadQueue],
  );

  useEffect(() => {
    void load();
  }, [load]);

  async function runBatch(action: string, ids: string[]) {
    if (ids.length === 0) {
      setError(new Error(copy.waitlistSelectedNone));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await postAccessBatch({ action, ids });
      await loadQueue();
      await loadMembers();
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
      <p style={{ color: "var(--text-mid)", marginBottom: 16 }}>
        {copy.subscriptionNote}
      </p>
      {error ? <FetchError error={error} onRetry={() => void load()} /> : null}
      {loading && rows.length === 0 && queue.length === 0 ? (
        <p style={{ color: "var(--text-mid)" }}>{nav.loadingLabel}</p>
      ) : null}
      <Section
        title={copy.waitlistQueueTitle}
        count={queue.length}
        first
        action={
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Button
              type="button"
              disabled={busy || selectedIds.length === 0}
              onClick={() => void runBatch(approveAction, selectedIds)}
            >
              {copy.waitlistApproveLabel}
            </Button>
            <Button
              type="button"
              variant="danger"
              disabled={busy || selectedIds.length === 0}
              onClick={() => void runBatch(denyAction, selectedIds)}
            >
              {copy.waitlistDenyLabel}
            </Button>
          </div>
        }
      >
        {!error && queue.length === 0 && !loading ? (
          <Card>
            <EmptyNote text={copy.waitlistEmptyQueue} />
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
      <Section title={copy.peopleTitle} count={rows.length}>
        {!error && rows.length === 0 && !loading ? (
          <Card>
            <EmptyNote text={copy.emptyList} />
          </Card>
        ) : null}
        {!error && rows.length > 0 ? (
          <Card>
            {rows.map((row) => (
              <div
                key={row.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  width: "100%",
                }}
              >
                <button
                  type="button"
                  className="mc-activity__row"
                  style={rowButtonStyle}
                  onClick={() =>
                    navigate(
                      `${ROUTES.adminConversations}?user_id=${encodeURIComponent(row.id)}`,
                    )
                  }
                >
                  <span className="mc-activity__rail">
                    <span className="mc-activity__dot" />
                  </span>
                  <div className="mc-activity__main">
                    <div className="mc-activity__title">{row.email}</div>
                    <span className="mc-tag">
                      {row.subscription_status ?? copy.subscriptionNone} ·{" "}
                      {row.session_count}
                    </span>
                  </div>
                  <span className="mc-activity__time">
                    {formatDateTime(row.last_seen_at)}
                  </span>
                </button>
                {row.access_request_id && !row.owner ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="danger"
                    disabled={busy}
                    onClick={() =>
                      void runBatch(revokeAction, [row.access_request_id ?? ""])
                    }
                  >
                    {copy.waitlistRevokeLabel}
                  </Button>
                ) : null}
              </div>
            ))}
          </Card>
        ) : null}
        {cursor ? (
          <div style={{ marginTop: 16 }}>
            <Button
              type="button"
              disabled={loading}
              onClick={() => void load(cursor)}
            >
              {copy.loadMore}
            </Button>
          </div>
        ) : null}
      </Section>
    </div>
  );
}
