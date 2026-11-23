import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";

/** API-Adresse: EXPO_PUBLIC_API_URL beim Build, sonst app.json → extra.apiUrl. */
export const API_URL: string =
  process.env.EXPO_PUBLIC_API_URL ?? (Constants.expoConfig?.extra?.apiUrl as string | undefined) ?? "http://localhost:4000";

const TOKEN_SCHLUESSEL = "sitzung";

export async function ladeToken(): Promise<string | null> {
  return SecureStore.getItemAsync(TOKEN_SCHLUESSEL);
}

export async function speichereToken(token: string | null): Promise<void> {
  if (token) await SecureStore.setItemAsync(TOKEN_SCHLUESSEL, token);
  else await SecureStore.deleteItemAsync(TOKEN_SCHLUESSEL);
}

export class ApiFehler extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T>(pfad: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const token = await ladeToken();
  const res = await fetch(`${API_URL}${pfad}`, {
    method: init.method ?? "GET",
    headers: {
      ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  if (!res.ok) {
    const daten = (await res.json().catch(() => ({}))) as { fehler?: string };
    throw new ApiFehler(res.status, daten.fehler ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}
