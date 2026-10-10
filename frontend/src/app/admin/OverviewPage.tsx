import { useCallback, useEffect, useState } from "react";
import { BarMeter } from "../../components/ui/Meter";
import { Button } from "../../components/ui/Button";
import { Segmented } from "../../components/ui/Segmented";
import { Section } from "../../components/Section";
import { KpiStrip, type KpiTileData } from "../../components/KpiStrip";
import { ActivityGraph } from "../../components/viz/ActivityGraph";
import { loadNavConfig } from "../../lib/nav";
import { navigate } from "../../lib/router";
import { ROUTES } from "../../lib/routes";
import {
  fetchOwnerActivity,
  fetchOwnerLatency,
  fetchOwnerOverview,
  type ActivitySeries,
  type LatencyReport,
  type OwnerOverview,
} from "../../lib/insights";
import { formatDateTime, formatMs, formatPercent } from "../../lib/format";
import {
  brainModeLabel,
  loadUiCopy,
  stageLabel,
} from "../../lib/uiCopy";
import { EmptyNote, FetchError } from "../dashboard/FetchState";
import { OpsPanel } from "./OpsPanel";
import { QuotaPanel } from "./QuotaPanel";

export function OverviewPage() {
  const nav = loadNavConfig();
  const copy = loadUiCopy();
  const title =
    nav.adminItems.find((item) => item.to === ROUTES.admin)?.label ?? "";
  const [range, setRange] = useState(copy.defaultRange);
  const [overview, setOverview] = useState<OwnerOverview | null>(null);
  const [activity, setActivity] = useState<ActivitySeries | null>(null);
  const [latency, setLatency] = useState<LatencyReport | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [nextOverview, nextActivity, nextLatency] = await Promise.all([
        fetchOwnerOverview(range),
        fetchOwnerActivity(range, copy.defaultBucket),
        fetchOwnerLatency(range),
      ]);
      setOverview(nextOverview);
      setActivity(nextActivity);
      setLatency(nextLatency);
    } catch (caught) {
      setError(caught);
    } finally {
      setLoading(false);
    }
  }, [copy.defaultBucket, range]);

  useEffect(() => {
    void load();
  }, [load]);

  const empty = overview !== null && overview.sessions === 0 && overview.turns === 0;
  const spark = activity?.points.map((point) => point.turns) ?? [];
  const kpis: KpiTileData[] = overview
    ? [
        {
          id: "calls",
          label: copy.kpi.calls,
          icon: copy.kpi.callsIcon,
          value: empty ? "—" : String(overview.sessions),
          caption: empty ? copy.emptyRange : "",
          spark,
        },
        {
          id: "turns",
          label: copy.kpi.turns,
          icon: copy.kpi.turnsIcon,
          value: empty ? "—" : String(overview.turns),
          caption: empty ? copy.emptyRange : "",
          spark,
        },
        {
          id: "first-word",
          label: copy.kpi.firstWord,
          icon: copy.kpi.firstWordIcon,
          value: empty || overview.median_first_word_ms === null
            ? "—"
            : formatMs(overview.median_first_word_ms),
          caption: formatMs(overview.p90_first_word_ms),
          spark,
        },
        {
          id: "errors",
          label: copy.kpi.errorRate,
          icon: copy.kpi.errorRateIcon,
          value: empty ? "—" : formatPercent(overview.error_rate),
          caption: empty ? copy.emptyRange : "",
          spark,
          accent: !empty && overview.error_rate > 0,
        },
      ]
    : [];

  const graphPoints =
    activity?.points.map((point) => ({
      label: formatDateTime(point.bucket_start),
      tick: formatDateTime(point.bucket_start),
      primary: point.turns,
      secondary: point.sessions,
    })) ?? [];

  const firstWordP50 = latency?.first_word.p50 ?? null;
  const budget = latency?.budget_first_word_ms ?? copy.budgetFirstWordMs;
  const meterValue =
    firstWordP50 === null || budget <= 0
      ? null
      : Math.max(0, Math.min(100, (firstWordP50 / budget) * 100));

  return (
    <div className="mc-wrap">
      <div className="mc-pagehead">
        <div>
          <h1 className="mc-pagehead__title">{title}</h1>
        </div>
        <div className="mc-pagehead__actions">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => navigate(ROUTES.status)}
          >
            {copy.statusLink}
          </Button>
          <Segmented
            options={copy.ranges.map((item) => ({
              value: item.id,
              label: item.label,
            }))}
            value={range}
            onChange={setRange}
          />
        </div>
      </div>
      <OpsPanel />
      <QuotaPanel />
      {error ? <FetchError error={error} onRetry={() => void load()} /> : null}
      {loading && !overview ? <p>{nav.loadingLabel}</p> : null}
      {!error && overview ? (
        <>
          <KpiStrip items={kpis} />
          <Section title={copy.overviewActivity}>
            {graphPoints.length === 0 || empty ? (
              <EmptyNote text={copy.emptyRange} />
            ) : (
              <ActivityGraph
                points={graphPoints}
                primaryLabel={copy.graphTurns}
                secondaryLabel={copy.graphSessions}
              />
            )}
          </Section>
          <Section title={copy.overviewLatency}>
            {empty || !latency || latency.first_word.p50 === null ? (
              <EmptyNote text={copy.emptyRange} />
            ) : (
              <div style={{ display: "grid", gap: 16 }}>
                {meterValue !== null ? (
                  <BarMeter
                    value={meterValue}
                    label={`${copy.overviewBudget} ${formatMs(budget)}`}
                    accent={firstWordP50 !== null && firstWordP50 > budget}
                  />
                ) : null}
                {latency.by_brain_mode.map((row) => (
                  <div key={row.brain_mode}>
                    <h3 className="mc-sec__title" style={{ marginBottom: 8 }}>
                      {brainModeLabel(row.brain_mode)}
                    </h3>
                    <p style={{ color: "var(--text-mid)" }}>
                      {formatMs(row.first_word.p50)} / {formatMs(row.first_word.p90)}
                    </p>
                    {row.stages.map((stage) => (
                      <p key={stage.stage} style={{ color: "var(--text-mid)" }}>
                        {stageLabel(stage.stage)}: {formatMs(stage.p50)} /{" "}
                        {formatMs(stage.p90)}
                      </p>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </Section>
        </>
      ) : null}
    </div>
  );
}
