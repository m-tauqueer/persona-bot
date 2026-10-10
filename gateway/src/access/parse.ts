import { z } from "zod";
import { ACCESS_STATUS, type AccessStatus } from "../schema.js";

const accessCursorSchema = z.object({
  requested_at: z.string(),
  id: z.string().uuid(),
});

export type AccessCursor = {
  requestedAt: Date;
  id: string;
};

const accessStatusValues = new Set<string>(Object.values(ACCESS_STATUS));

export function parseAccessStatus(raw: string): AccessStatus | null {
  if (!accessStatusValues.has(raw)) {
    return null;
  }
  return raw as AccessStatus;
}

export function encodeAccessCursor(row: {
  requested_at: Date;
  id: string;
}): string {
  return Buffer.from(
    JSON.stringify({
      requested_at: row.requested_at.toISOString(),
      id: row.id,
    }),
    "utf8",
  ).toString("base64url");
}

export function decodeAccessCursor(raw: string): AccessCursor | null {
  try {
    const parsed = accessCursorSchema.safeParse(
      JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as unknown,
    );
    if (!parsed.success) {
      return null;
    }
    const requestedAt = new Date(parsed.data.requested_at);
    if (Number.isNaN(requestedAt.getTime())) {
      return null;
    }
    return { requestedAt, id: parsed.data.id };
  } catch {
    return null;
  }
}
