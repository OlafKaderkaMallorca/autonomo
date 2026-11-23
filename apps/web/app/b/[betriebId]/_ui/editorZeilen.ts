import type { Sprache } from "@autonomo/shared";
import type { PositionsArt } from "@/lib/typen";

export interface EditorPosition {
  id?: string;
  art: PositionsArt;
  beschreibung: string;
  menge: string;
  einheit: string;
  preis: string;
  ivaSatz: string;
  stundenkontingent: string;
}

/** Wandelt gespeicherte Positionen in Editorzeilen (Cent → Euro-Text in der Sprache). */
export function alsEditorZeilen(
  positionen: { id?: string; art?: PositionsArt; beschreibung: string; menge: number; einheit: string | null; preisCent: number; ivaSatz: number; stundenkontingent?: number | null }[],
  sprache: Sprache,
): EditorPosition[] {
  // Ohne Tausendertrennzeichen, damit die Eingabe eindeutig zurückgelesen wird
  const zahl = (n: number) => (sprache === "en" ? String(n) : String(n).replace(".", ","));
  return positionen.map((p) => ({
    id: p.id,
    art: p.art ?? "pauschale",
    beschreibung: p.beschreibung,
    menge: zahl(p.menge),
    einheit: p.einheit ?? "",
    preis: zahl(p.preisCent / 100),
    ivaSatz: zahl(p.ivaSatz),
    stundenkontingent: p.stundenkontingent ? zahl(p.stundenkontingent) : "",
  }));
}
