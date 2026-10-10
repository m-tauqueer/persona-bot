import { parseList } from "../insights/parse.js";
import { OPS_SERVICE, type OpsService } from "../schema.js";

export type OpsHealthRow = {
  name: string;
  status: string;
  ok: boolean;
};

export type OpsEventInput = {
  service: OpsService;
  code: string;
  message: string;
  correlationId?: string | null;
};

export function parseOpsService(raw: string): OpsService | null {
  if (raw === OPS_SERVICE.GATEWAY || raw === OPS_SERVICE.WORKER) {
    return raw;
  }
  return null;
}

export function opsRecordCodes(raw: string): Set<string> {
  return new Set(parseList(raw));
}

export function shouldRecordOpsCode(
  code: string,
  recordCodes: Set<string>,
): boolean {
  return recordCodes.has(code);
}

export function healthRow(
  name: string,
  ok: boolean,
  okStatus: string,
  failStatus: string,
): OpsHealthRow {
  return {
    name,
    status: ok ? okStatus : failStatus,
    ok,
  };
}

export function allHealthOk(rows: OpsHealthRow[]): boolean {
  return rows.length > 0 && rows.every((row) => row.ok);
}

export type OpsForceConfig = {
  OPS_SERVICE_GATEWAY: string;
  OPS_FORCE_CODE: string;
  OPS_FORCE_MESSAGE: string;
};

export function forcedOpsEvent(config: OpsForceConfig): OpsEventInput | null {
  const service = parseOpsService(config.OPS_SERVICE_GATEWAY);
  if (!service) {
    return null;
  }
  return {
    service,
    code: config.OPS_FORCE_CODE,
    message: config.OPS_FORCE_MESSAGE,
  };
}

export function validateOpsConfig(config: {
  OPS_SERVICE_GATEWAY: string;
  OPS_SERVICE_WORKER: string;
  OPS_HEALTH_OK: string;
  OPS_HEALTH_FAIL: string;
  OPS_HEALTH_POSTGRES: string;
  OPS_HEALTH_REDIS: string;
  OPS_HEALTH_WORKER: string;
}): void {
  if (!parseOpsService(config.OPS_SERVICE_GATEWAY)) {
    throw new Error("OPS_SERVICE_GATEWAY must be gateway or worker");
  }
  if (!parseOpsService(config.OPS_SERVICE_WORKER)) {
    throw new Error("OPS_SERVICE_WORKER must be gateway or worker");
  }
  if (config.OPS_SERVICE_GATEWAY === config.OPS_SERVICE_WORKER) {
    throw new Error("OPS_SERVICE_GATEWAY and OPS_SERVICE_WORKER must differ");
  }
  if (config.OPS_HEALTH_OK === config.OPS_HEALTH_FAIL) {
    throw new Error("OPS_HEALTH_OK and OPS_HEALTH_FAIL must differ");
  }
  const names = [
    config.OPS_HEALTH_POSTGRES,
    config.OPS_HEALTH_REDIS,
    config.OPS_HEALTH_WORKER,
  ];
  if (new Set(names).size !== names.length) {
    throw new Error("ops health names must be unique");
  }
}

export type StatusCopyConfig = {
  OPS_HEALTH_POSTGRES: string;
  OPS_HEALTH_REDIS: string;
  OPS_HEALTH_WORKER: string;
  OPS_FORCE_CODE: string;
  STATUS_OVERALL_OK: string;
  STATUS_OVERALL_FAIL: string;
  STATUS_OVERALL_OK_LABEL: string;
  STATUS_OVERALL_FAIL_LABEL: string;
  STATUS_COMPONENT_OK: string;
  STATUS_COMPONENT_FAIL: string;
  STATUS_COMPONENT_LABELS: string;
};

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

export type PublicStatusPayload = {
  checked_at: string;
  overall: {
    ok: boolean;
    status: string;
    label: string;
  };
  components: PublicStatusComponent[];
  incidents: PublicStatusIncident[];
};

export function parseStatusLabels(raw: string): Map<string, string> {
  const items = new Map<string, string>();
  for (const entry of raw.split(/[;\n]+/)) {
    const trimmed = entry.trim();
    if (trimmed.length === 0) {
      continue;
    }
    const parts = trimmed.split("|").map((part) => part.trim());
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      throw new Error(`Invalid STATUS_COMPONENT_LABELS entry: ${trimmed}`);
    }
    if (items.has(parts[0])) {
      throw new Error(`Duplicate STATUS_COMPONENT_LABELS id: ${parts[0]}`);
    }
    items.set(parts[0], parts[1]);
  }
  if (items.size === 0) {
    throw new Error("STATUS_COMPONENT_LABELS is empty");
  }
  return items;
}

export function validateStatusCopy(config: StatusCopyConfig): void {
  if (config.STATUS_OVERALL_OK === config.STATUS_OVERALL_FAIL) {
    throw new Error("STATUS_OVERALL_OK and STATUS_OVERALL_FAIL must differ");
  }
  if (config.STATUS_COMPONENT_OK === config.STATUS_COMPONENT_FAIL) {
    throw new Error(
      "STATUS_COMPONENT_OK and STATUS_COMPONENT_FAIL must differ",
    );
  }
  const labels = parseStatusLabels(config.STATUS_COMPONENT_LABELS);
  const names = new Set([
    config.OPS_HEALTH_POSTGRES,
    config.OPS_HEALTH_REDIS,
    config.OPS_HEALTH_WORKER,
  ]);
  for (const name of names) {
    if (!labels.has(name)) {
      throw new Error(`STATUS_COMPONENT_LABELS missing ${name}`);
    }
  }
  for (const id of labels.keys()) {
    if (!names.has(id)) {
      throw new Error(`STATUS_COMPONENT_LABELS unknown ${id}`);
    }
  }
}

export function publicStatusPayload(
  config: StatusCopyConfig,
  health: OpsHealthRow[],
  events: ReadonlyArray<{
    id: string;
    created_at: string;
    code: string;
    message: string;
  }>,
  checkedAt = new Date(),
): PublicStatusPayload {
  const labels = parseStatusLabels(config.STATUS_COMPONENT_LABELS);
  const ok = allHealthOk(health);
  return {
    checked_at: checkedAt.toISOString(),
    overall: {
      ok,
      status: ok ? config.STATUS_OVERALL_OK : config.STATUS_OVERALL_FAIL,
      label: ok
        ? config.STATUS_OVERALL_OK_LABEL
        : config.STATUS_OVERALL_FAIL_LABEL,
    },
    components: health.map((row) => ({
      label: labels.get(row.name) ?? row.name,
      ok: row.ok,
      status: row.ok
        ? config.STATUS_COMPONENT_OK
        : config.STATUS_COMPONENT_FAIL,
    })),
    incidents: events
      .filter((event) => event.code !== config.OPS_FORCE_CODE)
      .map((event) => ({
        id: event.id,
        at: event.created_at,
        title: event.message,
      })),
  };
}
