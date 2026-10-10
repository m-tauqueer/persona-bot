import { loadUiCopy } from "./uiCopy";

export function formatDateTime(iso: string | null): string {
  if (!iso) {
    return "";
  }
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    return iso;
  }
  return parsed.toLocaleString();
}

export function formatMs(value: number | null): string {
  const copy = loadUiCopy();
  if (value === null) {
    return "";
  }
  return `${Math.round(value)} ${copy.msUnit}`;
}

export function formatPercent(value: number): string {
  const copy = loadUiCopy();
  return `${Math.round(value * 1000) / 10}${copy.percentUnit}`;
}

export function formatDuration(durationMs: number | null): string {
  const copy = loadUiCopy();
  if (durationMs === null) {
    return "";
  }
  const seconds = Math.max(0, Math.round(durationMs / 1000));
  return `${seconds} ${copy.secondUnit}`;
}
