import { requiredVite } from "./env";
import { api } from "./gateway";

export type PublicStatusComponent = {
  label: string;
  ok: boolean;
  status: string;
};

export type PublicStatusIncident = {
  id: string;
  at: string;
  title: string;
};

export type PublicStatus = {
  checked_at: string;
  overall: {
    ok: boolean;
    status: string;
    label: string;
  };
  components: PublicStatusComponent[];
  incidents: PublicStatusIncident[];
};

export function fetchPublicStatus() {
  return api<PublicStatus>(requiredVite("VITE_STATUS_API_PATH"));
}

export function incidentDay(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    return iso;
  }
  return parsed.toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function incidentTime(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    return iso;
  }
  return parsed.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function groupIncidentsByDay<T extends { at: string }>(
  incidents: T[],
): { day: string; items: T[] }[] {
  const groups: { day: string; items: T[] }[] = [];
  for (const incident of incidents) {
    const day = incidentDay(incident.at);
    const last = groups[groups.length - 1];
    if (last && last.day === day) {
      last.items.push(incident);
    } else {
      groups.push({ day, items: [incident] });
    }
  }
  return groups;
}
