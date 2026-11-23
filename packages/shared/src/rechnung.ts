import { rundeCent } from "./geld.js";

/** Grenze für vereinfachte Rechnungen ohne Kunden-NIF (RD 1619/2012, Art. 4): 400 € inkl. IVA. */
export const GRENZE_VEREINFACHT_CENT = 40000;

export interface PositionEingabe {
  menge: number;
  preisCent: number;
  ivaSatz: number;
}

export interface IvaGruppe {
  ivaSatz: number;
  basisCent: number;
  ivaCent: number;
}

export interface Summen {
  positionen: number[]; // Basis je Position in Cent
  ivaGruppen: IvaGruppe[];
  basisCent: number;
  ivaCent: number;
  irpfSatz: number;
  irpfCent: number;
  summeCent: number;
}

/**
 * Berechnet Summen einer Rechnung oder eines Angebots.
 * IVA wird je Steuersatz auf die Summe der Basisbeträge gerechnet (nicht je Position),
 * IRPF auf die gesamte Basis. Summe = Basis + IVA − IRPF.
 */
export function berechneSummen(positionen: PositionEingabe[], irpfSatz = 0): Summen {
  const basisJePosition = positionen.map((p) => rundeCent(p.menge * p.preisCent));
  const gruppen = new Map<number, number>();
  positionen.forEach((p, i) => gruppen.set(p.ivaSatz, (gruppen.get(p.ivaSatz) ?? 0) + basisJePosition[i]!));
  const ivaGruppen = [...gruppen.entries()]
    .sort(([a], [b]) => b - a)
    .map(([ivaSatz, basisCent]) => ({ ivaSatz, basisCent, ivaCent: rundeCent((basisCent * ivaSatz) / 100) }));
  const basisCent = basisJePosition.reduce((a, b) => a + b, 0);
  const ivaCent = ivaGruppen.reduce((a, g) => a + g.ivaCent, 0);
  const irpfCent = rundeCent((basisCent * irpfSatz) / 100);
  return { positionen: basisJePosition, ivaGruppen, basisCent, ivaCent, irpfSatz, irpfCent, summeCent: basisCent + ivaCent - irpfCent };
}

export type Rechnungstyp = "vollstaendig" | "vereinfacht" | "korrektur";

export interface KundeFuerRegeln {
  typ: "privat" | "firma";
  steuernummer: string | null;
  adresse: string | null;
  irpf: boolean;
}

export type RegelFehler =
  | "keine_positionen"
  | "nif_und_adresse_noetig"
  | "summe_null"
  | "betrieb_daten_fehlen";

export interface RegelErgebnis {
  ok: boolean;
  typ?: Rechnungstyp;
  irpf: boolean;
  fehler?: RegelFehler;
}

/**
 * Spanische Rechnungsregeln: Mit NIF/NIE und Adresse des Kunden wird eine vollständige Rechnung
 * ausgestellt. Ohne diese Angaben ist nur eine vereinfachte Rechnung bis 400 € inkl. IVA erlaubt.
 * IRPF wird nur einbehalten, wenn es beim (Firmen-)Kunden eingeschaltet ist.
 */
export function pruefeRechnungsregeln(kunde: KundeFuerRegeln, summeOhneIrpfCent: number, anzahlPositionen: number, korrektur = false): RegelErgebnis {
  const irpf = kunde.irpf && kunde.typ === "firma";
  if (anzahlPositionen === 0) return { ok: false, irpf, fehler: "keine_positionen" };
  if (!korrektur && summeOhneIrpfCent === 0) return { ok: false, irpf, fehler: "summe_null" };
  const hatDaten = Boolean(kunde.steuernummer && kunde.adresse);
  if (korrektur) return { ok: true, typ: "korrektur", irpf };
  if (hatDaten) return { ok: true, typ: "vollstaendig", irpf };
  if (summeOhneIrpfCent <= GRENZE_VEREINFACHT_CENT && !irpf) return { ok: true, typ: "vereinfacht", irpf: false };
  return { ok: false, irpf, fehler: "nif_und_adresse_noetig" };
}

/** Formatiert eine Rechnungsnummer aus Präfix und laufender Nummer, z. B. („2027-“, 7, 4) → „2027-0007“. */
export function formatRechnungsnummer(praefix: string, nummer: number, stellen: number): string {
  return `${praefix}${String(nummer).padStart(stellen, "0")}`;
}

/** Erster und letzter Tag eines Monats „JJJJ-MM“. */
export function monatsGrenzen(monat: string): { von: string; bis: string } {
  const [j, m] = monat.split("-").map(Number) as [number, number];
  const letzter = new Date(Date.UTC(j, m, 0)).getUTCDate();
  return { von: `${monat}-01`, bis: `${monat}-${String(letzter).padStart(2, "0")}` };
}
