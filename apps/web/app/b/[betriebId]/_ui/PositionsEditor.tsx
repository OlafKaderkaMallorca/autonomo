"use client";

import { useState } from "react";
import { formatBetrag, parseBetrag, parseZahl, type Sprache } from "@autonomo/shared";
import type { PositionsArt } from "@/lib/typen";

import type { EditorPosition } from "./editorZeilen";

export interface EditorTexte {
  art: string;
  pauschale: string;
  stunden: string;
  material: string;
  beschreibung: string;
  menge: string;
  einheit: string;
  preis: string;
  iva: string;
  kontingent: string;
  hinzufuegen: string;
  entfernen: string;
  basis: string;
  summe: string;
}

/**
 * Bearbeitet Positionen (Angebot, Auftrag, Rechnung). Das Ergebnis steht als JSON im versteckten Feld „positionen“;
 * Beträge werden in Euro eingegeben (Komma oder Punkt) und erst in der Server-Aktion in Cent umgerechnet.
 */
export function PositionsEditor({
  start,
  texte,
  sprache,
  standardIva,
  mitArt = true,
}: {
  start: EditorPosition[];
  texte: EditorTexte;
  sprache: Sprache;
  standardIva: number;
  mitArt?: boolean;
}) {
  const leer = (): EditorPosition => ({
    art: "pauschale",
    beschreibung: "",
    menge: "1",
    einheit: "",
    preis: "",
    ivaSatz: String(standardIva),
    stundenkontingent: "",
  });
  const [zeilen, setZeilen] = useState<EditorPosition[]>(start.length ? start : [leer()]);
  const aendere = (i: number, feld: keyof EditorPosition, wert: string) =>
    setZeilen((z) => z.map((p, j) => (j === i ? { ...p, [feld]: wert } : p)));

  let basis = 0;
  let iva = 0;
  for (const p of zeilen) {
    const b = Math.round((parseZahl(p.menge) ?? 0) * (parseBetrag(p.preis) ?? 0));
    basis += b;
    iva += Math.round((b * (parseZahl(p.ivaSatz) ?? 0)) / 100);
  }

  return (
    <div className="positionen">
      <input type="hidden" name="positionen" value={JSON.stringify(zeilen)} />
      {zeilen.map((p, i) => (
        <fieldset key={i} className="position-zeile">
          {mitArt && (
            <label className="breit">
              {texte.art}
              <select
                value={p.art}
                onChange={(e) => {
                  const art = e.target.value as PositionsArt;
                  setZeilen((z) =>
                    z.map((x, j) => (j === i ? { ...x, art, einheit: x.einheit || (art === "stunden" ? "h" : ""), menge: art === "stunden" && x.menge === "1" ? "0" : x.menge } : x)),
                  );
                }}
              >
                <option value="pauschale">{texte.pauschale}</option>
                <option value="stunden">{texte.stunden}</option>
                <option value="material">{texte.material}</option>
              </select>
            </label>
          )}
          <label className="breit">
            {texte.beschreibung}
            <input value={p.beschreibung} required onChange={(e) => aendere(i, "beschreibung", e.target.value)} />
          </label>
          <label>
            {texte.menge}
            <input inputMode="decimal" value={p.menge} onChange={(e) => aendere(i, "menge", e.target.value)} />
          </label>
          <label>
            {texte.einheit}
            <input value={p.einheit} maxLength={20} onChange={(e) => aendere(i, "einheit", e.target.value)} />
          </label>
          <label>
            {texte.preis}
            <input inputMode="decimal" value={p.preis} required onChange={(e) => aendere(i, "preis", e.target.value)} />
          </label>
          <label>
            {texte.iva}
            <input inputMode="decimal" value={p.ivaSatz} onChange={(e) => aendere(i, "ivaSatz", e.target.value)} />
          </label>
          {mitArt && p.art === "pauschale" && (
            <label>
              {texte.kontingent}
              <input inputMode="decimal" value={p.stundenkontingent} onChange={(e) => aendere(i, "stundenkontingent", e.target.value)} />
            </label>
          )}
          {zeilen.length > 1 && (
            <button type="button" className="leise klein" onClick={() => setZeilen((z) => z.filter((_, j) => j !== i))}>
              {texte.entfernen}
            </button>
          )}
        </fieldset>
      ))}
      <button type="button" className="leise klein" onClick={() => setZeilen((z) => [...z, leer()])}>
        + {texte.hinzufuegen}
      </button>
      <div className="summen">
        <div>
          <span>{texte.basis}</span>
          <span>{formatBetrag(basis, sprache)}</span>
        </div>
        <div className="gesamt">
          <span>{texte.summe}</span>
          <span>{formatBetrag(basis + iva, sprache)}</span>
        </div>
      </div>
    </div>
  );
}
