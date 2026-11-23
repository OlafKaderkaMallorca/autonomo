import type { Rolle, Sprache } from "@autonomo/shared";

export interface Ich {
  id: string;
  email: string;
  name: string;
  sprache: Sprache;
  plattformAdmin: boolean;
  betriebe: { id: string; name: string; rolle: Rolle; kundeId: string | null }[];
}

export interface Kunde {
  id: string;
  typ: "privat" | "firma";
  name: string;
  steuernummer: string | null;
  email: string | null;
  sprache: Sprache;
}

export type PositionsArt = "pauschale" | "stunden" | "material";

export interface Position {
  id?: string;
  art: PositionsArt;
  beschreibung: string;
  menge: number;
  einheit: string | null;
  preisCent: number;
  ivaSatz: number;
  stundenkontingent?: number | null;
  aktiv?: boolean;
}

export interface IvaGruppe {
  ivaSatz: number;
  basisCent: number;
  ivaCent: number;
}

export interface KundeVoll extends Kunde {
  telefon: string | null;
  adresse: string | null;
  notizen: string | null;
  irpf: boolean;
  archiviert: boolean;
}

export interface Kontakt {
  id: string;
  name: string;
  email: string | null;
  telefon: string | null;
  funktion: string | null;
}

export interface Angebot {
  id: string;
  kundeId: string;
  kundeName?: string;
  nummer: string;
  titel: string;
  einleitung: string | null;
  gueltigBis: string;
  status: "entwurf" | "gesendet" | "angenommen" | "abgelehnt";
  gesendetAm: string | null;
  geoeffnetAm: string | null;
  entschiedenAm: string | null;
  ablehnungsgrund: string | null;
  unterschriftName: string | null;
  erstelltAm: string;
  positionen: Position[];
  summen: { basisCent: number; ivaCent: number; ivaGruppen: IvaGruppe[] };
  basisCent?: number;
  auftragId?: string | null;
}

export interface Auftrag {
  id: string;
  kundeId: string;
  kundeName: string;
  angebotId: string | null;
  titel: string;
  status: "aktiv" | "pausiert" | "beendet";
  beginn: string;
  ende: string | null;
  positionen?: Position[];
  offeneAufgaben?: number;
  hatPauschale?: boolean;
  hatStunden?: boolean;
}

export interface Aufgabe {
  id: string;
  auftragId: string;
  auftragTitel?: string;
  kundeName?: string;
  titel: string;
  beschreibung: string | null;
  status: "offen" | "in_arbeit" | "erledigt";
  faelligAm: string | null;
  sichtbarFuerKunde: boolean;
  erstelltVonRolle: "inhaber" | "kunde";
  erledigtAm: string | null;
  notizen?: { id: string; text: string; sichtbarFuerKunde: boolean; erstelltAm: string }[];
}

export interface Foto {
  id: string;
  art: string;
  beschreibung: string | null;
  sichtbarFuerKunde: boolean;
  erstelltAm: string;
}

export interface Zeiteintrag {
  id: string;
  auftragId: string;
  auftragTitel: string;
  kundeName: string;
  start: string;
  ende: string | null;
  dauerMinuten: number;
  laeuft: boolean;
  notiz: string | null;
  abrechenbar: boolean;
  rechnungId: string | null;
}

export interface Rechnung {
  id: string;
  kundeId: string;
  kundeName: string;
  nummer: string | null;
  typ: "vollstaendig" | "vereinfacht" | "korrektur";
  status: "entwurf" | "ausgestellt" | "bezahlt";
  datum: string | null;
  leistungVon: string | null;
  leistungBis: string | null;
  leistungszeitraum: string | null;
  sprache: string;
  korrigiertRechnungId: string | null;
  korrekturGrund: string | null;
  basisCent: number;
  ivaCent: number;
  irpfSatz: number;
  irpfCent: number;
  summeCent: number;
  faelligAm: string | null;
  bezahltAm: string | null;
  gesendetAm: string | null;
  gesendetAn: string | null;
  bemerkung: string | null;
  positionen?: (Omit<Position, "art"> & { quelle: string; basisCent: number })[];
  ivaGruppen?: IvaGruppe[];
}

export interface Uebersicht {
  monat: string;
  rechnungen: { offenAnzahl: number; offenCent: number; ueberfaelligAnzahl: number; ueberfaelligCent: number; entwuerfe: number; umsatzMonatBasisCent: number };
  angeboteOffen: number;
  stundensatzCent: number | null;
  kunden: { kundeId: string; name: string; minuten: number; abrechenbarMinuten: number; pauschaleCent: number; effektiverStundensatzCent: number | null }[];
  laufenderTimer: { id: string; start: string; auftragId: string; auftragTitel: string; kundeName: string } | null;
  offeneAufgaben: { id: string; titel: string; status: string; faelligAm: string | null; erstelltVonRolle: string; kundeName: string; auftragId: string; auftragTitel: string }[];
}
