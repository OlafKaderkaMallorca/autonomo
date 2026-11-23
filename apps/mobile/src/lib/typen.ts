import type { AufgabeKurz, FotoArt, ServerTimer, ZeitKurz } from "./abgleich-kern";

export interface Auftrag {
  id: string;
  kundeId: string;
  kundeName: string;
  titel: string;
  status: "aktiv" | "pausiert" | "beendet";
  offeneAufgaben: number;
}

export interface Aufgabe extends AufgabeKurz {
  kundeName: string;
  auftragTitel: string;
  beschreibung: string | null;
  faelligAm: string | null;
  erstelltVonRolle: "inhaber" | "kunde";
  geaendertAm: string;
  notizen?: { id: string; text: string; erstelltAm: string; autor: string | null; ausstehend?: boolean }[];
}

export interface Foto {
  id: string;
  aufgabeId: string;
  art: FotoArt;
  beschreibung: string | null;
  erstelltAm: string;
}

export type Zeiteintrag = ZeitKurz & { laeuft?: boolean; notiz?: string | null };
export type { ServerTimer };
