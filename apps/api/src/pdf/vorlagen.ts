import {
  formatBetrag,
  formatDatum,
  formatZahl,
  type IvaGruppe,
  t,
  type Sprache,
  type UebersetzungsSchluessel,
} from "@autonomo/shared";

/** Gemeinsame Daten für den Briefkopf. */
export interface Absender {
  name: string;
  nif: string;
  adresse: string | null;
  email: string | null;
  telefon: string | null;
  iban: string | null;
  fusstext: string | null;
  farbe: string | null;
  logo: { mime: string; inhalt: Buffer } | null;
}

export interface Empfaenger {
  name: string;
  steuernummer: string | null;
  adresse: string | null;
}

export interface PdfPosition {
  art?: string;
  beschreibung: string;
  menge: number;
  einheit: string | null;
  preisCent: number;
  ivaSatz: number;
  basisCent?: number;
  stundenkontingent?: number | null;
}

export interface RechnungPdf {
  sprache: Sprache;
  entwurf: boolean;
  typ: "vollstaendig" | "vereinfacht" | "korrektur";
  nummer: string | null;
  datum: string | null;
  leistungszeitraum: string | null;
  faelligAm: string | null;
  absender: Absender;
  kunde: Empfaenger;
  positionen: PdfPosition[];
  ivaGruppen: IvaGruppe[];
  basisCent: number;
  irpfSatz: number;
  irpfCent: number;
  summeCent: number;
  korrektur: { nummer: string; datum: string; grund: string } | null;
  bemerkung: string | null;
}

export interface AngebotPdf {
  sprache: Sprache;
  entwurf: boolean;
  nummer: string;
  titel: string;
  einleitung: string | null;
  datum: string;
  gueltigBis: string;
  absender: Absender;
  kunde: Empfaenger;
  positionen: PdfPosition[];
  ivaGruppen: IvaGruppe[];
  basisCent: number;
  summeCent: number;
  unterschrift: { name: string; datum: string; bild: string | null } | null;
}

const esc = (s: string | null | undefined) =>
  (s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const zeilen = (s: string | null | undefined) => esc(s).replace(/\n/g, "<br>");

/**
 * Beschriftung in Kundensprache; bei DE/EN steht die spanische Bezeichnung klein darunter,
 * weil die Rechnung in Spanien rechtlich auf Spanisch gelesen wird.
 */
function beschrifter(sprache: Sprache) {
  return (schluessel: UebersetzungsSchluessel, werte?: Record<string, string | number>) => {
    const haupt = esc(t(sprache, schluessel, werte));
    return sprache === "es" ? haupt : `${haupt}<span class="es">${esc(t("es", schluessel, werte))}</span>`;
  };
}

function farbe(f: string | null) {
  return f && /^#[0-9A-Fa-f]{6}$/.test(f) ? f : "#059669";
}

/** Text für eine CSS-Zeichenkette (content: "…"), Zeilenumbrüche bleiben erhalten. */
const cssText = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/</g, "\\3C ").replace(/\r?\n/g, "\\A ")}"`;

function stil(akzent: string, fuss: string) {
  return `
  @page {
    size: A4; margin: 16mm 16mm 22mm 16mm;
    @bottom-center { content: ${cssText(fuss)}; white-space: pre; font-family: "Segoe UI", Arial, sans-serif; font-size: 7.5pt; color: #6B7280; text-align: center; }
    @bottom-right { content: counter(page) " / " counter(pages); font-family: "Segoe UI", Arial, sans-serif; font-size: 7.5pt; color: #9CA3AF; }
  }
  * { box-sizing: border-box; }
  body { font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif; font-size: 9.5pt; color: #1F2937; margin: 0; line-height: 1.4; }
  .es { display: block; font-size: 7pt; color: #6B7280; font-weight: normal; }
  .kopf { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; margin-bottom: 18mm; }
  .kopf img { max-height: 22mm; max-width: 60mm; }
  .firma { text-align: right; font-size: 8.5pt; color: #374151; }
  .firma strong { font-size: 11pt; color: #111827; }
  .bloecke { display: flex; justify-content: space-between; gap: 24px; margin-bottom: 10mm; }
  .kunde { width: 55%; }
  .kunde .label, .meta .label { font-size: 7.5pt; text-transform: uppercase; letter-spacing: .04em; color: #6B7280; }
  .meta table td { padding: 1px 0 1px 12px; vertical-align: top; }
  .meta table td:first-child { padding-left: 0; color: #6B7280; }
  h1 { font-size: 18pt; margin: 0 0 6mm; color: ${akzent}; font-weight: 600; }
  h1 .es { font-size: 9pt; }
  h2.titel { font-size: 13pt; margin: -2mm 0 4mm; font-weight: 600; }
  table.pos { width: 100%; border-collapse: collapse; margin-top: 4mm; }
  table.pos th { text-align: left; font-size: 7.5pt; text-transform: uppercase; color: #6B7280; border-bottom: 1.5px solid ${akzent}; padding: 4px 6px; font-weight: 600; }
  table.pos td { border-bottom: 1px solid #E5E7EB; padding: 6px; vertical-align: top; }
  .r { text-align: right; white-space: nowrap; }
  .klein { font-size: 8pt; color: #6B7280; }
  .summen { margin-left: auto; width: 55%; margin-top: 4mm; border-collapse: collapse; }
  .summen td { padding: 3px 6px; }
  .summen tr.gesamt td { border-top: 1.5px solid ${akzent}; font-weight: 700; font-size: 11pt; padding-top: 6px; }
  .hinweis { margin-top: 8mm; font-size: 8.5pt; }
  .wasserzeichen { position: fixed; top: 40%; left: 0; right: 0; text-align: center; font-size: 80pt; color: rgba(220, 38, 38, .12); transform: rotate(-30deg); font-weight: 800; }
  .verifactu { width: 32mm; height: 32mm; border: 1px dashed #D1D5DB; display: none; }
  .unterschrift { margin-top: 10mm; }
  .unterschrift img { max-height: 25mm; max-width: 70mm; display: block; }
  `;
}

function kopf(a: Absender) {
  const logo = a.logo ? `<img src="data:${a.logo.mime};base64,${a.logo.inhalt.toString("base64")}" alt="">` : `<div></div>`;
  return `<div class="kopf">${logo}<div class="firma"><strong>${esc(a.name)}</strong><br>NIF ${esc(a.nif)}<br>${zeilen(a.adresse)}
    ${a.telefon ? `<br>${esc(a.telefon)}` : ""}${a.email ? `<br>${esc(a.email)}` : ""}</div></div>`;
}

function kundenblock(k: Empfaenger, l: ReturnType<typeof beschrifter>) {
  return `<div class="kunde"><div class="label">${l("pdf.kunde")}</div><strong>${esc(k.name)}</strong>
    ${k.steuernummer ? `<br>NIF/NIE ${esc(k.steuernummer)}` : ""}${k.adresse ? `<br>${zeilen(k.adresse)}` : ""}</div>`;
}

function positionsTabelle(positionen: PdfPosition[], sprache: Sprache, l: ReturnType<typeof beschrifter>, angebot: boolean) {
  const reihen = positionen
    .map((p) => {
      let zusatz = "";
      let menge = `${formatZahl(p.menge, sprache)}${p.einheit ? ` ${esc(p.einheit)}` : ""}`;
      let betrag = formatBetrag(p.basisCent ?? Math.round(p.menge * p.preisCent), sprache);
      if (angebot && p.art === "pauschale") {
        zusatz = esc(t(sprache, "pdf.proMonat"));
        if (p.stundenkontingent) zusatz += ` · ${esc(t(sprache, "pdf.kontingent", { stunden: formatZahl(p.stundenkontingent, sprache) }))}`;
      }
      if (angebot && p.art === "stunden" && p.menge === 0) {
        menge = esc(t(sprache, "pdf.nachAufwand"));
        betrag = `${formatBetrag(p.preisCent, sprache)} ${esc(t(sprache, "pdf.proStunde"))}`;
      }
      return `<tr><td>${zeilen(p.beschreibung)}${zusatz ? `<div class="klein">${zusatz}</div>` : ""}</td>
        <td class="r">${menge}</td><td class="r">${formatBetrag(p.preisCent, sprache)}</td>
        <td class="r">${formatZahl(p.ivaSatz, sprache)} %</td><td class="r">${betrag}</td></tr>`;
    })
    .join("");
  return `<table class="pos"><thead><tr><th>${l("pdf.beschreibung")}</th><th class="r">${l("pdf.menge")}</th>
    <th class="r">${l("pdf.preis")}</th><th class="r">IVA</th><th class="r">${l("pdf.betrag")}</th></tr></thead><tbody>${reihen}</tbody></table>`;
}

function summenTabelle(
  d: { basisCent: number; ivaGruppen: IvaGruppe[]; irpfSatz?: number; irpfCent?: number; summeCent: number },
  sprache: Sprache,
  l: ReturnType<typeof beschrifter>,
  summeLabel: UebersetzungsSchluessel = "pdf.summe",
) {
  const iva = d.ivaGruppen
    .map((g) => `<tr><td>${l("pdf.ivaBetrag", { satz: formatZahl(g.ivaSatz, sprache), basis: formatBetrag(g.basisCent, sprache) })}</td>
      <td class="r">${formatBetrag(g.ivaCent, sprache)}</td></tr>`)
    .join("");
  const irpf = d.irpfCent
    ? `<tr><td>${l("pdf.irpf", { satz: formatZahl(d.irpfSatz ?? 0, sprache) })}</td><td class="r">−${formatBetrag(d.irpfCent, sprache)}</td></tr>`
    : "";
  return `<table class="summen"><tr><td>${l("pdf.basis")}</td><td class="r">${formatBetrag(d.basisCent, sprache)}</td></tr>
    ${iva}${irpf}<tr class="gesamt"><td>${l(summeLabel)}</td><td class="r">${formatBetrag(d.summeCent, sprache)}</td></tr></table>`;
}

function dokument(titel: string, a: Absender, body: string) {
  const fuss = a.fusstext?.trim() || `${a.name} · NIF ${a.nif}`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(titel)}</title><style>${stil(farbe(a.farbe), fuss)}</style></head><body>${body}</body></html>`;
}

export function rechnungHtml(r: RechnungPdf): string {
  const s = r.sprache;
  const l = beschrifter(s);
  const titelSchluessel: UebersetzungsSchluessel =
    r.typ === "korrektur" ? "pdf.rechnung.korrektur" : r.typ === "vereinfacht" ? "pdf.rechnung.vereinfacht" : "pdf.rechnung";
  const meta = [
    r.nummer ? `<tr><td>${l("pdf.nummer")}</td><td><strong>${esc(r.nummer)}</strong></td></tr>` : "",
    r.datum ? `<tr><td>${l("pdf.datum")}</td><td>${formatDatum(r.datum, s)}</td></tr>` : "",
    r.leistungszeitraum ? `<tr><td>${l("pdf.leistungszeitraum")}</td><td>${esc(r.leistungszeitraum)}</td></tr>` : "",
    r.faelligAm && r.summeCent > 0 ? `<tr><td>${l("pdf.faellig")}</td><td>${formatDatum(r.faelligAm, s)}</td></tr>` : "",
  ].join("");
  const korrektur = r.korrektur
    ? `<p class="hinweis"><strong>${l("pdf.korrigiert", { nummer: r.korrektur.nummer, datum: formatDatum(r.korrektur.datum, s), grund: r.korrektur.grund })}</strong></p>`
    : "";
  const zahlung =
    r.absender.iban && r.summeCent > 0 && r.faelligAm
      ? `<p class="hinweis">${l("pdf.zahlung", { datum: formatDatum(r.faelligAm, s) })}<strong>IBAN ${esc(r.absender.iban)}</strong></p>`
      : "";
  const body = `
    ${r.entwurf ? `<div class="wasserzeichen">${esc(t(s, "pdf.entwurf"))}</div>` : ""}
    ${kopf(r.absender)}
    <div class="bloecke">${kundenblock(r.kunde, l)}<div class="meta"><table>${meta}</table></div></div>
    <h1>${l(titelSchluessel)}</h1>
    ${korrektur}
    ${positionsTabelle(r.positionen, s, l, false)}
    ${summenTabelle(r, s, l)}
    ${r.bemerkung ? `<p class="hinweis">${zeilen(r.bemerkung)}</p>` : ""}
    ${zahlung}
    <!-- Ab Phase 3: QR-Code und Hinweis „VERI*FACTU“ -->
    <div class="verifactu" title="${esc(t(s, "pdf.verifactu"))}"></div>`;
  return dokument(`${t(s, titelSchluessel)} ${r.nummer ?? ""}`, r.absender, body);
}

export function angebotHtml(a: AngebotPdf): string {
  const s = a.sprache;
  const l = beschrifter(s);
  const meta = `<tr><td>${l("pdf.nummer")}</td><td><strong>${esc(a.nummer)}</strong></td></tr>
    <tr><td>${l("pdf.datum")}</td><td>${formatDatum(a.datum, s)}</td></tr>
    <tr><td>${l("pdf.gueltigBis")}</td><td>${formatDatum(a.gueltigBis, s)}</td></tr>`;
  const unterschrift = a.unterschrift
    ? `<div class="unterschrift">${a.unterschrift.bild?.startsWith("data:image/png;base64,") ? `<img src="${a.unterschrift.bild}" alt="">` : ""}
        <div class="klein">${esc(t(s, "pdf.angenommen", { datum: formatDatum(a.unterschrift.datum, s), name: a.unterschrift.name }))}</div></div>`
    : "";
  const body = `
    ${a.entwurf ? `<div class="wasserzeichen">${esc(t(s, "pdf.entwurf"))}</div>` : ""}
    ${kopf(a.absender)}
    <div class="bloecke">${kundenblock(a.kunde, l)}<div class="meta"><table>${meta}</table></div></div>
    <h1>${l("pdf.angebot")}</h1>
    <h2 class="titel">${esc(a.titel)}</h2>
    ${a.einleitung ? `<p>${zeilen(a.einleitung)}</p>` : ""}
    ${positionsTabelle(a.positionen, s, l, true)}
    ${summenTabelle(a, s, l, "pdf.gesamt")}
    ${unterschrift}`;
  return dokument(`${t(s, "pdf.angebot")} ${a.nummer}`, a.absender, body);
}
