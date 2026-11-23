import type { PositionDaten } from "@autonomo/shared";
import type { Tx } from "./db.js";

/** Schreibt Positionen eines Angebots oder Auftrags (vorhandene werden vorher entfernt). */
export async function schreibeAngebotsPositionen(tx: Tx, betriebId: string, angebotId: string, positionen: PositionDaten[]) {
  await tx`delete from angebot_position where angebot_id = ${angebotId}`;
  if (positionen.length === 0) return;
  await tx`insert into angebot_position ${tx(
    positionen.map((p, i) => ({
      betrieb_id: betriebId,
      angebot_id: angebotId,
      pos: i + 1,
      art: p.art,
      beschreibung: p.beschreibung,
      menge: p.menge,
      einheit: p.einheit ?? null,
      preis_cent: p.preisCent,
      iva_satz: p.ivaSatz,
      stundenkontingent: p.stundenkontingent ?? null,
    })),
  )}`;
}

export function zahl(wert: unknown): number {
  return typeof wert === "number" ? wert : Number(wert);
}

/** Wandelt numeric-Spalten (kommen als Text aus Postgres) in Zahlen um. */
export function zahlen<T extends Record<string, unknown>>(zeile: T, felder: string[]): T {
  const kopie: Record<string, unknown> = { ...zeile };
  for (const f of felder) if (kopie[f] !== null && kopie[f] !== undefined) kopie[f] = Number(kopie[f]);
  return kopie as T;
}

export const POSITIONS_ZAHLEN = ["menge", "preisCent", "ivaSatz", "stundenkontingent", "basisCent"];
