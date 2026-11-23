import "server-only";
import { cookies } from "next/headers";

export const SITZUNGS_COOKIE = "sitzung";
const API_URL = process.env.API_URL ?? "http://localhost:4000";

export class ApiFehler extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Ruft die API serverseitig auf und reicht das Sitzungs-Token aus dem httpOnly-Cookie weiter. */
export async function api<T>(pfad: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const token = (await cookies()).get(SITZUNGS_COOKIE)?.value;
  const res = await fetch(`${API_URL}${pfad}`, {
    method: init.method ?? "GET",
    headers: {
      ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });
  if (!res.ok) {
    const daten = (await res.json().catch(() => ({}))) as { fehler?: string };
    throw new ApiFehler(res.status, daten.fehler ?? res.statusText);
  }
  return (await res.json()) as T;
}

export async function setzeSitzung(token: string) {
  (await cookies()).set(SITZUNGS_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}
