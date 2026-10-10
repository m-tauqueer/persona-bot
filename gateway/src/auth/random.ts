import { randomBytes } from "node:crypto";

export function randomUrlToken(byteLength: number): string {
  return randomBytes(byteLength).toString("base64url");
}
