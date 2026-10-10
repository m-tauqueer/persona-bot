import { z } from "zod";
import { DELETION_STATUS, type DeletionStatus } from "../schema.js";

const deletionStatusValues = new Set<string>(Object.values(DELETION_STATUS));

export function parseDeletionStatus(raw: string): DeletionStatus | null {
  if (!deletionStatusValues.has(raw)) {
    return null;
  }
  return raw as DeletionStatus;
}

const deletionCursorSchema = z.object({
  requested_at: z.string(),
  id: z.string().uuid(),
});

export type DeletionCursor = {
  requestedAt: Date;
  id: string;
};

export function encodeDeletionCursor(row: {
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

export function decodeDeletionCursor(raw: string): DeletionCursor | null {
  try {
    const parsed = deletionCursorSchema.safeParse(
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
