export type JsonValue =
  | null
  | string
  | number
  | boolean
  | JsonValue[]
  | { [key: string]: JsonValue };

export type JsonObject = { [key: string]: JsonValue };

/** Narrow a parsed-JSON value to the shape the database driver accepts. */
export function asJsonValue(value: unknown): JsonValue {
  if (value === null) {
    return null;
  }
  const kind = typeof value;
  if (kind === "string" || kind === "number" || kind === "boolean") {
    return value as JsonValue;
  }
  if (Array.isArray(value)) {
    return value.map(asJsonValue);
  }
  if (kind === "object") {
    const out: JsonObject = {};
    for (const [key, item] of Object.entries(value as object)) {
      out[key] = asJsonValue(item);
    }
    return out;
  }
  return null;
}

/** JSON lists that must never surface as `null` (empty if missing or malformed). */
export function asJsonArray(value: unknown): JsonValue[] {
  const parsed = asJsonValue(value);
  return Array.isArray(parsed) ? parsed : [];
}
