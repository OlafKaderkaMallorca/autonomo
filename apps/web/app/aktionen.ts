"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { istSprache } from "@autonomo/shared";
import { api, ApiFehler, SITZUNGS_COOKIE, setzeSitzung } from "@/lib/api";

export interface LoginZustand {
  fehler?: boolean;
  linkGesendet?: boolean;
  /** Zwei-Faktor-Anmeldung ist eingeschaltet: Code abfragen */
  codeNoetig?: boolean;
  codeFalsch?: boolean;
}

export async function passwortLogin(_: LoginZustand, form: FormData): Promise<LoginZustand> {
  try {
    const code = String(form.get("code") ?? "").trim();
    const { token } = await api<{ token: string }>("/auth/login", {
      method: "POST",
      body: { email: String(form.get("email") ?? ""), passwort: String(form.get("passwort") ?? ""), ...(code ? { code } : {}) },
    });
    await setzeSitzung(token);
  } catch (e) {
    if (e instanceof ApiFehler && e.code === "zweiter_faktor") return { codeNoetig: true };
    if (e instanceof ApiFehler && e.code === "code_falsch") return { codeNoetig: true, codeFalsch: true };
    if (e instanceof ApiFehler && e.status < 500) return { fehler: true };
    throw e;
  }
  redirect("/");
}

/** Anmeldelink einlösen, wenn die Zwei-Faktor-Anmeldung einen Code verlangt (siehe /login/code). */
export async function linkMitCode(token: string, _: LoginZustand, form: FormData): Promise<LoginZustand> {
  try {
    const { token: sitzung } = await api<{ token: string }>("/auth/magic-link/einloesen", {
      method: "POST",
      body: { token, code: String(form.get("code") ?? "").trim() },
    });
    await setzeSitzung(sitzung);
  } catch (e) {
    if (e instanceof ApiFehler && e.code === "code_falsch") return { codeNoetig: true, codeFalsch: true };
    if (e instanceof ApiFehler && e.status < 500) redirect("/login?fehler=link");
    throw e;
  }
  redirect("/");
}

export async function magicLinkAnfordern(_: LoginZustand, form: FormData): Promise<LoginZustand> {
  try {
    await api("/auth/magic-link", { method: "POST", body: { email: String(form.get("email") ?? "") } });
  } catch (e) {
    if (!(e instanceof ApiFehler && e.status < 500)) throw e;
  }
  return { linkGesendet: true };
}

export async function abmelden() {
  try {
    await api("/auth/logout", { method: "POST" });
  } catch {
    // Sitzung war schon ungültig
  }
  (await cookies()).delete(SITZUNGS_COOKIE);
  redirect("/login");
}

export async function spracheWechseln(form: FormData) {
  const sprache = String(form.get("sprache"));
  if (!istSprache(sprache)) return;
  (await cookies()).set("sprache", sprache, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  try {
    await api("/me", { method: "PATCH", body: { sprache } });
  } catch {
    // nicht angemeldet: Cookie reicht
  }
}

// --- Sicherheit: Zwei-Faktor-Anmeldung und Abmelden überall -------------------------------

export interface ZweiFaktorZustand {
  schritt?: "scannen" | "codes" | "aus";
  qr?: string;
  geheimnis?: string;
  notfallcodes?: string[];
  fehler?: string;
}

function fehlerText(e: unknown): string {
  if (e instanceof ApiFehler && e.status < 500) return e.message;
  throw e;
}

export async function zweiFaktorEinrichten(): Promise<ZweiFaktorZustand> {
  try {
    const { geheimnis, otpauthUrl } = await api<{ geheimnis: string; otpauthUrl: string }>("/me/2fa/einrichten", { method: "POST" });
    const qr = await QRCode.toString(otpauthUrl, { type: "svg", margin: 1, width: 200 });
    return { schritt: "scannen", geheimnis, qr: `data:image/svg+xml;base64,${Buffer.from(qr).toString("base64")}` };
  } catch (e) {
    return { fehler: fehlerText(e) };
  }
}

export async function zweiFaktorEinschalten(vorher: ZweiFaktorZustand, form: FormData): Promise<ZweiFaktorZustand> {
  try {
    const { notfallcodes } = await api<{ notfallcodes: string[] }>("/me/2fa/aktivieren", {
      method: "POST",
      body: { code: String(form.get("code") ?? "").replace(/\s/g, "") },
    });
    return { schritt: "codes", notfallcodes };
  } catch (e) {
    return { ...vorher, fehler: fehlerText(e) };
  }
}

export async function zweiFaktorAusschalten(_: ZweiFaktorZustand, form: FormData): Promise<ZweiFaktorZustand> {
  try {
    await api("/me/2fa/ausschalten", { method: "POST", body: { code: String(form.get("code") ?? "").trim() } });
    return { schritt: "aus" };
  } catch (e) {
    return { fehler: fehlerText(e) };
  }
}

export async function ueberallAbmelden() {
  try {
    await api("/auth/logout-alle", { method: "POST" });
  } catch {
    // Sitzung war schon ungültig
  }
  (await cookies()).delete(SITZUNGS_COOKIE);
  redirect("/login");
}
