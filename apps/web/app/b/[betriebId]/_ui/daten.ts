import "server-only";
import { cache } from "react";
import { notFound } from "next/navigation";
import type { Rolle, Sprache } from "@autonomo/shared";
import { api, ApiFehler } from "@/lib/api";
import { ichOderLogin } from "@/lib/ich";
import { aktuelleSprache, uebersetzer } from "@/lib/sprache";

export interface Betrieb {
  id: string;
  name: string;
  meineRolle: Rolle;
}

/** Lädt Benutzer, Betrieb und Sprache einmal pro Anfrage (Layout und Seite teilen sich das Ergebnis). */
export const seitenKontext = cache(async (betriebId: string) => {
  const ich = await ichOderLogin();
  const sprache: Sprache = await aktuelleSprache(ich.sprache);
  let betrieb: Betrieb;
  try {
    betrieb = await api<Betrieb>(`/betriebe/${betriebId}`);
  } catch (e) {
    if (e instanceof ApiFehler && (e.status === 404 || e.status === 403)) notFound();
    throw e;
  }
  return { ich, sprache, t: uebersetzer(sprache), betrieb, b: betriebId };
});

/** API-Aufruf, bei dem „nicht gefunden“ zur 404-Seite führt. */
export async function laden<T>(pfad: string): Promise<T> {
  try {
    return await api<T>(pfad);
  } catch (e) {
    if (e instanceof ApiFehler && (e.status === 404 || e.status === 400)) notFound();
    throw e;
  }
}

export function editorTexte(t: ReturnType<typeof uebersetzer>) {
  return {
    art: t("pos.art"),
    pauschale: t("pos.pauschale"),
    stunden: t("pos.stunden"),
    material: t("pos.material"),
    beschreibung: t("pdf.beschreibung"),
    menge: t("pdf.menge"),
    einheit: t("pos.einheit"),
    preis: t("pos.preis"),
    iva: t("pos.iva"),
    kontingent: t("pos.kontingent"),
    hinzufuegen: t("pos.hinzufuegen"),
    entfernen: t("pos.entfernen"),
    basis: t("pdf.basis"),
    summe: t("pdf.gesamt"),
  };
}

export const heute = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Madrid" }).format(new Date());
export const uhrzeit = (iso: string) => new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Madrid", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

/** Standard-IVA des Betriebs (für neue Positionen). */
export async function standardIva(b: string): Promise<number> {
  try {
    const e = await api<{ betrieb: { standardIva: number } }>(`/betriebe/${b}/einstellungen`);
    return e.betrieb.standardIva;
  } catch {
    return 21;
  }
}

export const inTagen = (tage: number) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Madrid" }).format(new Date(Date.now() + tage * 86400000));
