"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { istSprache } from "@autonomo/shared";
import { api, ApiFehler, SITZUNGS_COOKIE, setzeSitzung } from "@/lib/api";

export interface LoginZustand {
  fehler?: boolean;
  linkGesendet?: boolean;
}

export async function passwortLogin(_: LoginZustand, form: FormData): Promise<LoginZustand> {
  try {
    const { token } = await api<{ token: string }>("/auth/login", {
      method: "POST",
      body: { email: String(form.get("email") ?? ""), passwort: String(form.get("passwort") ?? "") },
    });
    await setzeSitzung(token);
  } catch (e) {
    if (e instanceof ApiFehler && e.status < 500) return { fehler: true };
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
