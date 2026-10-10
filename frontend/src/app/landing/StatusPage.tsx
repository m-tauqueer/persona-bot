import { useCallback, useEffect, useState } from "react";
import Grainient from "../../components/Grainient";
import { loadNavConfig } from "../../lib/nav";
import { formatDateTime } from "../../lib/format";
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

export function StatusPage() {
  const nav = loadNavConfig();
  const copy = loadUiCopy();
  const [snapshot, setSnapshot] = useState<PublicStatus | null>(null);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setSnapshot(await fetchPublicStatus());
    } catch (caught) {
      setError(caught);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const ok = snapshot?.overall.ok === true;
  const days = snapshot ? groupIncidentsByDay(snapshot.incidents) : [];

  return (
    <div className="st-page">
      <Grainient color3="#202028" saturation={0.7} />
      <div className="st">
        <header className="st__top">
          <button
            type="button"
            className="st__brand"
            onClick={() => navigate(ROUTES.home)}
          >
            <span
              className={`st__lamp${snapshot ? (ok ? " is-ok" : " is-down") : ""}`}
              aria-hidden="true"
            />
            {nav.appName}
          </button>
          <p className="st__kicker">{copy.statusTitle}</p>
        </header>

        {error ? <FetchError error={error} onRetry={() => void load()} /> : null}
        {!snapshot && !error ? (
          <p className="st__loading">{nav.loadingLabel}</p>
        ) : null}

        {snapshot ? (
          <>
            <section
              className={`st__banner${ok ? " is-ok" : " is-down"}`}
              aria-live="polite"
            >
              <div className="st__orb" aria-hidden="true">
                <span className="st__orb-core" />
              </div>
              <div>
                <h1 className="st__headline">{snapshot.overall.label}</h1>
                <p className="st__updated">
                  {copy.statusUpdated} {formatDateTime(snapshot.checked_at)}
                </p>
              </div>
            </section>

            <section className="st__block">
              <h2 className="st__h">{copy.statusComponents}</h2>
              <ul className="st__list">
                {snapshot.components.map((row) => (
                  <li key={row.label} className="st__row">
                    <span className="st__name">{row.label}</span>
                    <span className="st__badge">
                      <span
                        className={`st__dot${row.ok ? " is-ok" : " is-down"}`}
                        aria-hidden="true"
                      />
                      {row.status}
                    </span>
                  </li>
                ))}
              </ul>
            </section>

            <section className="st__block">
              <h2 className="st__h">{copy.statusIncidents}</h2>
              {days.length === 0 ? (
                <EmptyNote text={copy.statusEmpty} />
              ) : (
                days.map((group) => (
                  <div key={group.day} className="st__day-group">
                    <h3 className="st__day">{group.day}</h3>
                    <ul className="st__list">
                      {group.items.map((incident) => (
                        <li key={incident.id} className="st__incident">
                          <time dateTime={incident.at}>
                            {incidentTime(incident.at)}
                          </time>
                          <p>{incident.title}</p>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))
              )}
            </section>
          </>
        ) : null}

        <footer className="st__foot">
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
        </footer>
      </div>
    </div>
  );
}
