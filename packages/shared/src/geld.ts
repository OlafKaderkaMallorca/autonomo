import type { Sprache } from "./rollen.js";

const LOCALE: Record<Sprache, string> = { de: "de-DE", es: "es-ES", en: "en-GB" };

/** Betrag in Cent als Euro-Text in der jeweiligen Sprache, z. B. 70000 → „700,00 €“. */
export function formatBetrag(cent: number, sprache: Sprache): string {
  return new Intl.NumberFormat(LOCALE[sprache], { style: "currency", currency: "EUR" }).format(cent / 100);
}

export function formatZahl(wert: number, sprache: Sprache, nachkomma = 2): string {
  return new Intl.NumberFormat(LOCALE[sprache], { minimumFractionDigits: 0, maximumFractionDigits: nachkomma }).format(wert);
}

/** Datum (ISO „2026-11-23“ oder Date) in der jeweiligen Sprache, z. B. „23.11.2026“ bzw. „23/11/2026“. */
export function formatDatum(datum: string | Date, sprache: Sprache): string {
  const d = typeof datum === "string" ? new Date(`${datum.slice(0, 10)}T12:00:00Z`) : datum;
  return new Intl.DateTimeFormat(LOCALE[sprache], { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Madrid" }).format(d);
}

/** Monat „2026-11“ als Text, z. B. „November 2026“ / „noviembre 2026“. */
export function formatMonat(monat: string, sprache: Sprache): string {
  const d = new Date(`${monat}-15T12:00:00Z`);
  return new Intl.DateTimeFormat(LOCALE[sprache], { month: "long", year: "numeric", timeZone: "UTC" }).format(d);
}

/** Kaufmännisch runden (halbe Cent vom Nullpunkt weg). */
export function rundeCent(wert: number): number {
  // Erst auf 1/1000 Cent glätten (Gleitkomma-Reste wie 4997.4999999), dann runden
  const betrag = Math.round(Math.abs(wert) * 1000) / 1000;
  return Math.sign(wert) * Math.round(betrag) || 0;
}

/**
 * Eingabe in Euro (Komma oder Punkt, z. B. „1.234,50“, „35.5“, „700“) in Cent.
 * Gibt null zurück, wenn die Eingabe keine Zahl ist.
 */
export function parseBetrag(eingabe: string): number | null {
  const zahl = parseZahl(eingabe);
  return zahl === null ? null : rundeCent(zahl * 100);
}

/** Zahl mit Komma oder Punkt als Dezimaltrenner; Tausenderpunkte werden erkannt. */
export function parseZahl(eingabe: string): number | null {
  let s = eingabe.trim().replace(/\s|€/g, "");
  if (!s) return null;
  const komma = s.lastIndexOf(",");
  const punkt = s.lastIndexOf(".");
  if (komma > punkt) s = s.replace(/\./g, "").replace(",", ".");
  else if (punkt > komma && komma >= 0) s = s.replace(/,/g, "");
  else if (komma < 0 && (s.match(/\./g)?.length ?? 0) > 1) s = s.replace(/\./g, "");
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  return Number(s);
}
