import { useCallback, useEffect, useState } from "react";
import { Section } from "../../components/Section";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { Input } from "../../components/ui/Input";
import {
  fetchQuotaSettings,
  saveQuotaSettings,
  type QuotaSettings,
} from "../../lib/insights";
import { loadNavConfig } from "../../lib/nav";
import { loadUiCopy } from "../../lib/uiCopy";
import { FetchError } from "../dashboard/FetchState";

export function QuotaPanel() {
  const nav = loadNavConfig();
  const copy = loadUiCopy();
  const [form, setForm] = useState<QuotaSettings | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    setSaved(false);
    try {
      setForm(await fetchQuotaSettings());
    } catch (caught) {
      setError(caught);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function onSave() {
    if (!form) {
      return;
    }
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const next = await saveQuotaSettings({
        turns_per_day: Number(form.turns_per_day),
        voice_minutes_per_day: Number(form.voice_minutes_per_day),
        timezone: form.timezone,
        warn_ratio: Number(form.warn_ratio),
      });
      setForm(next);
      setSaved(true);
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title={copy.quotaTitle}>
      <p style={{ color: "var(--text-mid)", marginBottom: 16 }}>{copy.quotaHelp}</p>
      {error ? <FetchError error={error} onRetry={() => void load()} /> : null}
      {!form && !error ? (
        <p style={{ color: "var(--text-mid)" }}>{nav.loadingLabel}</p>
      ) : null}
      {form ? (
        <Card>
          <div
            style={{
              display: "grid",
              gap: 14,
              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            }}
          >
            <Input
              label={copy.quotaTurnsLabel}
              type="number"
              min={0}
              step={1}
              value={String(form.turns_per_day)}
              onChange={(event) =>
                setForm({
                  ...form,
                  turns_per_day: Number(event.target.value),
                })
              }
            />
            <Input
              label={copy.quotaMinutesLabel}
              type="number"
              min={0}
              step="0.1"
              value={String(form.voice_minutes_per_day)}
              onChange={(event) =>
                setForm({
                  ...form,
                  voice_minutes_per_day: Number(event.target.value),
                })
              }
            />
            <Input
              label={copy.quotaTimezoneLabel}
              type="text"
              value={form.timezone}
              onChange={(event) =>
                setForm({ ...form, timezone: event.target.value })
              }
            />
            <Input
              label={copy.quotaWarnLabel}
              type="number"
              min={0}
              max={1}
              step="0.05"
              value={String(form.warn_ratio)}
              onChange={(event) =>
                setForm({ ...form, warn_ratio: Number(event.target.value) })
              }
            />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 16 }}>
            <Button type="button" disabled={busy} onClick={() => void onSave()}>
              {copy.quotaSaveLabel}
            </Button>
            {saved ? (
              <span style={{ color: "var(--text-mid)" }}>{copy.quotaSaved}</span>
            ) : null}
          </div>
        </Card>
      ) : null}
    </Section>
  );
}
