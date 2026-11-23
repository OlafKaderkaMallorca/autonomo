import type { Sprache } from "../rollen.js";
import { de } from "./de.js";
import { en } from "./en.js";
import { es } from "./es.js";

export type UebersetzungsSchluessel = keyof typeof de;
/** Jede Sprache muss alle Schlüssel der deutschen Vorlage enthalten (prüft der Compiler). */
export type Uebersetzungen = Record<UebersetzungsSchluessel, string>;

export const UEBERSETZUNGEN: Record<Sprache, Uebersetzungen> = { de, es, en };

export function t(
  sprache: Sprache,
  schluessel: UebersetzungsSchluessel,
  werte: Record<string, string | number> = {},
): string {
  const text = UEBERSETZUNGEN[sprache][schluessel] ?? UEBERSETZUNGEN.de[schluessel];
  return text.replace(/\{(\w+)\}/g, (_, name: string) => String(werte[name] ?? `{${name}}`));
}
