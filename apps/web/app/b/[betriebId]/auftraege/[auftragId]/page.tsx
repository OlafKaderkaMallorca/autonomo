import Link from "next/link";
import { formatBetrag, formatDatum, formatZahl } from "@autonomo/shared";
import { api } from "@/lib/api";
import type { Aufgabe, Auftrag, Zeiteintrag } from "@/lib/typen";
import { aufgabeAnlegen, aufgabeStatus, auftragSpeichern, materialAnlegen } from "../../aktionen";
import { Formular } from "../../_ui/Formular";
import { alsEditorZeilen } from "../../_ui/editorZeilen";
import { PositionsEditor } from "../../_ui/PositionsEditor";
import { Status } from "../../_ui/Status";
import { editorTexte, heute, laden, seitenKontext, standardIva, uhrzeit } from "../../_ui/daten";

interface Material {
  id: string;
  datum: string;
  beschreibung: string;
  menge: string | number;
  einheit: string | null;
  preisCent: string | number;
  rechnungId: string | null;
}

export default async function AuftragSeite({ params }: { params: Promise<{ betriebId: string; auftragId: string }> }) {
  const { betriebId, auftragId } = await params;
  const { t, sprache, b } = await seitenKontext(betriebId);
  const [a, aufgaben, zeiten, material, iva] = await Promise.all([
    laden<Auftrag>(`/betriebe/${b}/auftraege/${auftragId}`),
    api<Aufgabe[]>(`/betriebe/${b}/aufgaben?auftragId=${auftragId}&status=alle`),
    api<Zeiteintrag[]>(`/betriebe/${b}/zeiten?auftragId=${auftragId}`),
    api<Material[]>(`/betriebe/${b}/material?auftragId=${auftragId}`),
    standardIva(b),
  ]);
  const summeMinuten = zeiten.reduce((s, z) => s + (z.laeuft ? 0 : z.dauerMinuten), 0);

  return (
    <>
      <p><Link href={`/b/${b}/auftraege`}>← {t("nav.auftraege")}</Link></p>
      <div className="kopf">
        <h1>{a.titel}</h1>
        <Status status={a.status} t={t} />
      </div>
      <p className="hinweis">
        <Link href={`/b/${b}/kunden/${a.kundeId}`}>{a.kundeName}</Link> · {t("feld.beginn")} {formatDatum(a.beginn, sprache)}
        {a.angebotId && <> · <Link href={`/b/${b}/angebote/${a.angebotId}`}>{t("pdf.angebot")}</Link></>}
      </p>

      <div className="zweispaltig">
        <section>
          <h2>{t("auftraege.aufgaben")}</h2>
          <div className="karte">
            <ul className="liste">
              {aufgaben.length === 0 && <li className="hinweis">{t("allg.keine")}</li>}
              {aufgaben.map((g) => (
                <li key={g.id} className="zeile">
                  <div>
                    <Link href={`/b/${b}/aufgaben/${g.id}`}>{g.titel}</Link>
                    <div className="hinweis klein">
                      <Status status={g.status} t={t} />
                      {g.faelligAm && ` ${formatDatum(g.faelligAm, sprache)}`}
                      {g.erstelltVonRolle === "kunde" && ` · ${t("aufgaben.vomKunden")}`}
                    </div>
                  </div>
                  {g.status !== "erledigt" && <Formular aktion={aufgabeStatus.bind(null, b, g.id, "erledigt")} knopf="✓" leise inline />}
                </li>
              ))}
            </ul>
            <details>
              <summary>{t("auftraege.aufgabeNeu")}</summary>
              <Formular aktion={aufgabeAnlegen.bind(null, b, a.id)} knopf={t("allg.anlegen")}>
                <div className="raster">
                  <label className="breit">{t("feld.titel")}<input name="titel" required /></label>
                  <label className="breit">{t("pdf.beschreibung")}<textarea name="beschreibung" rows={2} /></label>
                  <label>{t("feld.faelligAm")}<input name="faelligAm" type="date" /></label>
                  <label className="haken"><input type="checkbox" name="sichtbar" defaultChecked /> {t("feld.sichtbar")}</label>
                </div>
              </Formular>
            </details>
          </div>

          <h2>{t("auftraege.zeiten")} · {t("uebersicht.stunden", { stunden: formatZahl(summeMinuten / 60, sprache, 1) })}</h2>
          <ul className="liste karte">
            {zeiten.length === 0 && <li className="hinweis">{t("allg.keine")}</li>}
            {zeiten.slice(0, 30).map((z) => (
              <li key={z.id} className="zeile">
                <span>
                  {formatDatum(z.start, sprache)} · {uhrzeit(z.start)}
                  {z.notiz && <span className="hinweis"> · {z.notiz}</span>}
                </span>
                <span className="hinweis klein">
                  {z.laeuft ? "…" : `${formatZahl(z.dauerMinuten / 60, sprache, 2)} h`}
                  {!z.abrechenbar && " · —"}
                  {z.rechnungId && ` · ${t("zeiten.abgerechnet")}`}
                </span>
              </li>
            ))}
          </ul>

          <h2>{t("pos.material")}</h2>
          <div className="karte">
            <ul className="liste">
              {material.map((m) => (
                <li key={m.id} className="zeile">
                  <span>{formatDatum(m.datum, sprache)} · {m.beschreibung} ({formatZahl(Number(m.menge), sprache)} {m.einheit ?? ""})</span>
                  <span className="hinweis klein">
                    {formatBetrag(Math.round(Number(m.menge) * Number(m.preisCent)), sprache)}
                    {m.rechnungId && ` · ${t("zeiten.abgerechnet")}`}
                  </span>
                </li>
              ))}
            </ul>
            <details>
              <summary>{t("auftraege.materialNeu")}</summary>
              <Formular aktion={materialAnlegen.bind(null, b, a.id)} knopf={t("allg.anlegen")}>
                <div className="raster">
                  <label className="breit">{t("pdf.beschreibung")}<input name="beschreibung" required /></label>
                  <label>{t("pdf.datum")}<input name="datum" type="date" defaultValue={heute()} /></label>
                  <label>{t("pdf.menge")}<input name="menge" inputMode="decimal" defaultValue="1" /></label>
                  <label>{t("pos.einheit")}<input name="einheit" /></label>
                  <label>{t("pos.preis")}<input name="preis" inputMode="decimal" required /></label>
                </div>
              </Formular>
            </details>
          </div>
        </section>

        <section>
          <h2>{t("allg.bearbeiten")}</h2>
          <Formular aktion={auftragSpeichern.bind(null, b, a.id)} knopf={t("allg.speichern")} className="karte">
            <div className="raster">
              <label className="breit">{t("feld.titel")}<input name="titel" required defaultValue={a.titel} /></label>
              <label>
                {t("feld.status")}
                <select name="status" defaultValue={a.status}>
                  {(["aktiv", "pausiert", "beendet"] as const).map((s) => <option key={s} value={s}>{t(`status.${s}`)}</option>)}
                </select>
              </label>
            </div>
            <h3>{t("auftraege.positionen")}</h3>
            <PositionsEditor start={alsEditorZeilen((a.positionen ?? []).filter((p) => p.aktiv !== false), sprache)} texte={editorTexte(t)} sprache={sprache} standardIva={iva} />
          </Formular>
        </section>
      </div>
    </>
  );
}
