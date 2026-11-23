import { createHash, randomBytes } from "node:crypto";

/** Zufälliges Token für Sitzungen und Anmeldelinks. Gespeichert wird nur der SHA-256-Hash. */
export function neuesToken(): { token: string; hash: Buffer } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): Buffer {
  return createHash("sha256").update(token).digest();
}
