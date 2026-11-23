import type { Tx } from "../db.js";
import { ladeDatei, speichereDatei } from "../dateien.js";
import type { Speicher } from "../speicher.js";
import type { PdfDrucker } from "./browser.js";
import { angebotPdfDaten, rechnungPdfDaten } from "./daten.js";
import { angebotHtml, rechnungHtml } from "./vorlagen.js";

export interface PdfDeps {
  speicher: Speicher;
  pdf: PdfDrucker;
}

export interface PdfErgebnis {
  inhalt: Buffer;
  dateiname: string;
  dateiId: string | null;
  sha256?: string;
}

const dateiname = (art: string, nummer: string | null) => `${art}-${(nummer ?? "entwurf").replace(/[^A-Za-z0-9_-]/g, "-")}.pdf`;

/**
 * PDF einer Rechnung. Entwürfe werden jedes Mal neu erzeugt (mit Wasserzeichen).
 * Ausgestellte Rechnungen werden einmal erzeugt, gespeichert und danach immer genau so ausgeliefert.
 */
export async function rechnungPdf(tx: Tx, d: PdfDeps, betriebId: string, rechnungId: string, benutzerId?: string): Promise<PdfErgebnis> {
  const [r] = await tx<{ status: string; nummer: string | null; pdfDateiId: string | null }[]>`
    select status, nummer, pdf_datei_id from rechnung where id = ${rechnungId}`;
  if (r?.pdfDateiId) {
    const gespeichert = await ladeDatei(tx, d.speicher, r.pdfDateiId);
    return { inhalt: gespeichert.inhalt, dateiname: dateiname("factura", r.nummer), dateiId: r.pdfDateiId, sha256: gespeichert.sha256 };
  }
  const daten = await rechnungPdfDaten(tx, d.speicher, betriebId, rechnungId);
  const inhalt = await d.pdf.drucke(rechnungHtml(daten));
  if (daten.entwurf || !benutzerId) return { inhalt, dateiname: dateiname("factura", daten.nummer), dateiId: null };
  const datei = await speichereDatei(tx, d.speicher, { betriebId, art: "pdf", inhalt, mime: "application/pdf", benutzerId });
  await tx`update rechnung set pdf_datei_id = ${datei.id} where id = ${rechnungId}`;
  return { inhalt, dateiname: dateiname("factura", daten.nummer), dateiId: datei.id, sha256: datei.sha256 };
}

/**
 * PDF eines Angebots. Beim Versand wird die verschickte Fassung gespeichert (Hash = Nachweis, was angeboten wurde).
 * Nach der Annahme wird die Fassung mit Unterschrift erzeugt.
 */
export async function angebotPdf(
  tx: Tx,
  d: PdfDeps,
  betriebId: string,
  angebotId: string,
  opts: { speichern?: boolean; benutzerId?: string } = {},
): Promise<PdfErgebnis> {
  const [a] = await tx<{ status: string; nummer: string; pdfDateiId: string | null }[]>`
    select status, nummer, pdf_datei_id from angebot where id = ${angebotId}`;
  if (a?.pdfDateiId && a.status === "gesendet" && !opts.speichern) {
    const gespeichert = await ladeDatei(tx, d.speicher, a.pdfDateiId);
    return { inhalt: gespeichert.inhalt, dateiname: dateiname("presupuesto", a.nummer), dateiId: a.pdfDateiId, sha256: gespeichert.sha256 };
  }
  const daten = await angebotPdfDaten(tx, d.speicher, betriebId, angebotId);
  const inhalt = await d.pdf.drucke(angebotHtml(daten));
  if (!opts.speichern) return { inhalt, dateiname: dateiname("presupuesto", daten.nummer), dateiId: null };
  const datei = await speichereDatei(tx, d.speicher, { betriebId, art: "pdf", inhalt, mime: "application/pdf", benutzerId: opts.benutzerId });
  await tx`update angebot set pdf_datei_id = ${datei.id}, pdf_hash = ${datei.sha256} where id = ${angebotId}`;
  return { inhalt, dateiname: dateiname("presupuesto", daten.nummer), dateiId: datei.id, sha256: datei.sha256 };
}
