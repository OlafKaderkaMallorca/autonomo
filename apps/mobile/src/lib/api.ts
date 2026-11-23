import Constants from "expo-constants";
import { File } from "expo-file-system";
import * as SecureStore from "expo-secure-store";
import { AntwortFehler, OfflineFehler } from "./abgleich-kern";

/** API-Adresse: EXPO_PUBLIC_API_URL beim Build, sonst app.json → extra.apiUrl. */
export const API_URL: string =
  process.env.EXPO_PUBLIC_API_URL ?? (Constants.expoConfig?.extra?.apiUrl as string | undefined) ?? "http://localhost:4002";

const TOKEN_SCHLUESSEL = "sitzung";

let tokenZwischenspeicher: string | null | undefined;

export async function ladeToken(): Promise<string | null> {
  if (tokenZwischenspeicher === undefined) tokenZwischenspeicher = await SecureStore.getItemAsync(TOKEN_SCHLUESSEL);
  return tokenZwischenspeicher;
}

export async function speichereToken(token: string | null): Promise<void> {
  tokenZwischenspeicher = token;
  if (token) await SecureStore.setItemAsync(TOKEN_SCHLUESSEL, token);
  else await SecureStore.deleteItemAsync(TOKEN_SCHLUESSEL);
}

/** Fehlerantwort der API (status, Meldung, maschinenlesbarer code). */
export { AntwortFehler as ApiFehler, OfflineFehler };

/** Wird bei 401 aufgerufen (Sitzung abgelaufen), damit die App zur Anmeldung wechselt. */
let beiAbmeldung: (() => void) | null = null;
export function setzeAbmeldeHandler(fn: (() => void) | null) {
  beiAbmeldung = fn;
}

async function abschicken(pfad: string, init: RequestInit): Promise<Response> {
  const token = await ladeToken();
  let res: Response;
  try {
    res = await fetch(`${API_URL}${pfad}`, {
      ...init,
      headers: { ...(init.headers as Record<string, string>), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    });
  } catch {
    throw new OfflineFehler("Keine Verbindung");
  }
  if (!res.ok) {
    const daten = (await res.json().catch(() => ({}))) as { fehler?: string; code?: string; details?: unknown };
    if (res.status === 401 && token && !pfad.startsWith("/auth/")) beiAbmeldung?.();
    throw new AntwortFehler(res.status, daten.fehler ?? `HTTP ${res.status}`, daten.code, daten.details);
  }
  return res;
}

export async function api<T>(pfad: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await abschicken(pfad, {
    method: init.method ?? "GET",
    headers: init.body !== undefined ? { "content-type": "application/json" } : {},
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  return (await res.json()) as T;
}

/** Foto (JPEG) aus einer lokalen Datei hochladen. */
export async function ladeFotoHoch(pfad: string, uri: string): Promise<void> {
  const datei = new File(uri);
  const inhalt = await datei.bytes();
  await abschicken(pfad, { method: "POST", headers: { "content-type": "image/jpeg" }, body: inhalt as unknown as BodyInit });
}

/** Adresse + Kopfzeile, um geschützte Bilder (Fotos) direkt mit <Image> zu laden. */
export async function bildQuelle(pfad: string): Promise<{ uri: string; headers: Record<string, string> }> {
  const token = await ladeToken();
  return { uri: `${API_URL}${pfad}`, headers: token ? { authorization: `Bearer ${token}` } : {} };
}
