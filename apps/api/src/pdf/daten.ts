import { berechneSummen, type Sprache } from "@autonomo/shared";
import type { Tx } from "../db.js";
import { ladeDatei } from "../dateien.js";
import { HttpFehler } from "../fehler.js";
import type { Speicher } from "../speicher.js";
import { ladeAngebot } from "../routes/angebote.js";
import { ladeRechnung } from "../routes/rechnungen.js";
import type { Absender, AngebotPdf, PdfPosition, RechnungPdf } from "./vorlagen.js";

async function ladeAbsender(tx: Tx, speicher: Speicher, betriebId: string, snapshot?: Record<string, string | null> | null): Promise<Absender> {
  const [b] = await tx<(Absender & { logoDateiId: string | null })[]>`
    select name, nif, adresse, email, telefon, iban, fusstext, farbe, logo_datei_id from betrieb where id = ${betriebId}`;
  if (!b) throw new HttpFehler(404, "Betrieb nicht gefunden");
  const logo = b.logoDateiId ? await ladeDatei(tx, speicher, b.logoDateiId).catch(() => null) : null;
  // Ausgestellte Rechnungen: Firmendaten wie zum Zeitpunkt der Ausstellung
  const quelle = snapshot ?? b;
  return {
    name: quelle.name ?? b.name,
    nif: quelle.nif ?? b.nif,
    adresse: quelle.adresse ?? null,
    email: quelle.email ?? null,
    telefon: quelle.telefon ?? null,
    iban: quelle.iban ?? null,
    fusstext: quelle.fusstext ?? null,
    farbe: b.farbe,
    logo: logo ? { mime: logo.mime, inhalt: logo.inhalt } : null,
  };
}

export async function rechnungPdfDaten(tx: Tx, speicher: Speicher, betriebId: string, rechnungId: string): Promise<RechnungPdf> {
  const r = await ladeRechnung(tx, rechnungId);
  if (!r) throw new HttpFehler(404, "Rechnung nicht gefunden");
  const entwurf = r.status === "entwurf";
  let kunde = r.kundeSnapshot as RechnungPdf["kunde"] | null;
  if (!kunde) {
    const [k] = await tx<RechnungPdf["kunde"][]>`select name, steuernummer, adresse from kunde where id = ${r.kundeId}`;
    kunde = k!;
  }
  let korrektur: RechnungPdf["korrektur"] = null;
  if (r.korrigiertRechnungId) {
    const [o] = await tx<{ nummer: string; datum: string }[]>`select nummer, datum from rechnung where id = ${r.korrigiertRechnungId}`;
    if (o) korrektur = { nummer: o.nummer, datum: o.datum, grund: r.korrekturGrund ?? "" };
  }
  return {
    sprache: r.sprache as Sprache,
    entwurf,
    typ: entwurf ? (r.korrigiertRechnungId ? "korrektur" : "vollstaendig") : r.typ,
    nummer: r.nummer,
    datum: r.datum,
    leistungszeitraum: r.leistungszeitraum,
    faelligAm: r.faelligAm,
    absender: await ladeAbsender(tx, speicher, betriebId, r.betriebSnapshot),
    kunde,
    positionen: r.positionen as PdfPosition[],
    ivaGruppen: r.ivaGruppen,
    basisCent: r.basisCent,
    irpfSatz: r.irpfSatz,
    irpfCent: r.irpfCent,
    summeCent: r.summeCent,
    korrektur,
    bemerkung: r.bemerkung,
  };
}

export async function angebotPdfDaten(tx: Tx, speicher: Speicher, betriebId: string, angebotId: string): Promise<AngebotPdf> {
  const a = await ladeAngebot(tx, angebotId);
  if (!a) throw new HttpFehler(404, "Angebot nicht gefunden");
  const [k] = await tx<(RechnungPdf["kunde"] & { sprache: Sprache })[]>`select name, steuernummer, adresse, sprache from kunde where id = ${a.kundeId}`;
  const summen = berechneSummen(a.positionen);
  const datum = (a.gesendetAm ?? a.erstelltAm) as Date | string;
  let bild: string | null = null;
  if (a.status === "angenommen") {
    const [u] = await tx<{ unterschriftBild: string | null }[]>`select unterschrift_bild from angebot where id = ${angebotId}`;
    bild = u?.unterschriftBild ?? null;
  }
  return {
    sprache: k!.sprache,
    entwurf: a.status === "entwurf",
    nummer: a.nummer,
    titel: a.titel,
    einleitung: a.einleitung,
    datum: typeof datum === "string" ? datum : datum.toISOString(),
    gueltigBis: a.gueltigBis,
    absender: await ladeAbsender(tx, speicher, betriebId),
    kunde: k!,
    positionen: a.positionen as PdfPosition[],
    ivaGruppen: summen.ivaGruppen,
    basisCent: summen.basisCent,
    summeCent: summen.basisCent + summen.ivaCent,
    unterschrift: a.status === "angenommen" && a.unterschriftName
      ? { name: a.unterschriftName, datum: (a.unterschriftAm ?? a.entschiedenAm).toISOString(), bild }
      : null,
  };
}
