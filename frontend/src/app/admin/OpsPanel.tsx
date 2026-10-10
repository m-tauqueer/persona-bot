import { useCallback, useEffect, useState } from "react";
import { formatDateTime } from "../../lib/format";
import { fetchOpsSnapshot, type OpsEvent, type OpsSnapshot } from "../../lib/insights";
import { loadNavConfig } from "../../lib/nav";
import { navigate } from "../../lib/router";
import { ROUTES } from "../../lib/routes";
import {
  fetchPublicStatus,
  groupIncidentsByDay,
  incidentTime,
  type PublicStatus,
} from "../../lib/status";
import { loadUiCopy } from "../../lib/uiCopy";
import { EmptyNote, FetchError } from "../dashboard/FetchState";

export function OpsPanel() {
  const nav = loadNavConfig();
  const copy = loadUiCopy();
  const [status, setStatus] = useState<PublicStatus | null>(null);
  const [snapshot, setSnapshot] = useState<OpsSnapshot | null>(null);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [nextStatus, nextSnapshot] = await Promise.all([
        fetchPublicStatus(),
        fetchOpsSnapshot(),
      ]);
      setStatus(nextStatus);
      setSnapshot(nextSnapshot);
    } catch (caught) {
      setError(caught);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const ok = status?.overall.ok === true;
  const days = snapshot
    ? groupIncidentsByDay(
        snapshot.events.map((event) => ({
          ...event,
          at: event.created_at,
        })),
      )
    : [];

  return (
    <div className="st-embed">
      {error ? <FetchError error={error} onRetry={() => void load()} /> : null}
      {!status && !snapshot && !error ? (
        <p className="st__loading">{nav.loadingLabel}</p>
      ) : null}

      {status ? (
        <>
          <section
            className={`st__banner${ok ? " is-ok" : " is-down"}`}
            aria-live="polite"
          >
            <div className="st__orb" aria-hidden="true">
              <span className="st__orb-core" />
            </div>
            <div>
              <h2 className="st__headline">{status.overall.label}</h2>
              <p className="st__updated">
                {copy.statusUpdated} {formatDateTime(status.checked_at)}
                {" · "}
                <button
                  type="button"
                  className="st-link"
                  onClick={() => navigate(ROUTES.status)}
                >
                  {copy.statusLink}
                </button>
              </p>
            </div>
          </section>

          <section className="st__block">
            <h3 className="st__h">{copy.statusComponents}</h3>
            <ul className="st__list">
              {status.components.map((row, index) => {
                const name = snapshot?.health[index]?.name;
                return (
                  <li key={row.label} className="st__row">
                    <span className="st__name-block">
                      <span className="st__name">{row.label}</span>
                      {name && name !== row.label ? (
                        <span className="st__caption">{name}</span>
                      ) : null}
                    </span>
                    <span className="st__badge">
                      <span
                        className={`st__dot${row.ok ? " is-ok" : " is-down"}`}
                        aria-hidden="true"
                      />
                      {row.status}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        </>
      ) : null}

      {snapshot ? (
        <section className="st__block">
          <h3 className="st__h">{copy.overviewOps}</h3>
          {days.length === 0 ? (
            <EmptyNote text={copy.overviewOpsEmpty} />
          ) : (
            days.map((group) => (
              <div key={group.day} className="st__day-group">
                <h4 className="st__day">{group.day}</h4>
                <ul className="st__list">
                  {group.items.map((event) => (
                    <AlertRow key={event.id} event={event} />
                  ))}
                </ul>
              </div>
            ))
          )}
        </section>
      ) : null}
    </div>
  );
}

function AlertRow({ event }: { event: OpsEvent & { at: string } }) {
  const copy = loadUiCopy();
  return (
    <li className="st__incident">
      <time dateTime={event.created_at}>{incidentTime(event.created_at)}</time>
      <p>{event.message}</p>
      <p className="st__meta">
        {event.code} · {event.service}
        {event.correlation_id
          ? ` · ${copy.correlationLabel} ${event.correlation_id}`
          : ""}
      </p>
    </li>
  );
}
