import Link from "next/link";
import { formatBetrag, formatDatum, formatZahl } from "@autonomo/shared";
import type { Rechnung } from "@/lib/typen";
import { rechnungBezahlt, rechnungFreigeben, rechnungKorrektur, rechnungLoeschen, rechnungSenden, rechnungSpeichern } from "../../aktionen";
import { Formular } from "../../_ui/Formular";
import { alsEditorZeilen } from "../../_ui/editorZeilen";
import { PositionsEditor } from "../../_ui/PositionsEditor";
import { Status } from "../../_ui/Status";
import { editorTexte, heute, laden, seitenKontext, standardIva } from "../../_ui/daten";

export default async function RechnungSeite({ params }: { params: Promise<{ betriebId: string; rechnungId: string }> }) {
  const { betriebId, rechnungId } = await params;
  const { t, sprache, b } = await seitenKontext(betriebId);
  const [r, iva] = await Promise.all([laden<Rechnung>(`/betriebe/${b}/rechnungen/${rechnungId}`), standardIva(b)]);
  const entwurf = r.status === "entwurf";

  return (
    <>
      <p><Link href={`/b/${b}/rechnungen`}>← {t("nav.rechnungen")}</Link></p>
      <div className="kopf">
        <h1>{r.nummer ?? t("status.entwurf")} · {r.kundeName}</h1>
        <Status status={r.status} t={t} />
      </div>
      <p className="hinweis">
        {r.typ === "korrektur" && <>{t("pdf.rechnung.korrektur")} · </>}
        {r.korrigiertRechnungId && <><Link href={`/b/${b}/rechnungen/${r.korrigiertRechnungId}`}>{t("rechnungen.zurKorrektur", { nummer: "←" })}</Link> · </>}
        {r.datum && `${t("pdf.datum")} ${formatDatum(r.datum, sprache)} · `}
        {r.faelligAm && `${t("pdf.faellig")} ${formatDatum(r.faelligAm, sprache)} · `}
        {r.sprache.toUpperCase()}
        {r.gesendetAn && r.gesendetAm && ` · ${t("rechnungen.gesendet", { email: r.gesendetAn, datum: formatDatum(r.gesendetAm, sprache) })}`}
        {r.bezahltAm && ` · ${t("status.bezahlt")} ${formatDatum(r.bezahltAm, sprache)}`}
      </p>

      {entwurf ? (
        <Formular aktion={rechnungSpeichern.bind(null, b, r.id)} knopf={t("allg.speichern")} className="karte">
          <div className="raster">
            <label>{t("rechnungen.leistungszeitraum")}<input name="leistungszeitraum" defaultValue={r.leistungszeitraum ?? ""} /></label>
            <label className="breit">{t("feld.bemerkung")}<input name="bemerkung" defaultValue={r.bemerkung ?? ""} /></label>
          </div>
          <PositionsEditor start={alsEditorZeilen(r.positionen ?? [], sprache)} texte={editorTexte(t)} sprache={sprache} standardIva={iva} mitArt={false} />
        </Formular>
      ) : (
        <div className="karte">
          {r.leistungszeitraum && <p className="hinweis">{t("rechnungen.leistungszeitraum")}: {r.leistungszeitraum}</p>}
          <ul className="liste">
            {(r.positionen ?? []).map((p) => (
              <li key={p.id} className="zeile">
                <div>
                  {p.beschreibung}
                  <div className="hinweis klein">{formatZahl(p.menge, sprache)} {p.einheit ?? ""} × {formatBetrag(p.preisCent, sprache)} · IVA {formatZahl(p.ivaSatz, sprache)} %</div>
                </div>
                <span className="betrag">{formatBetrag(p.basisCent, sprache)}</span>
              </li>
            ))}
          </ul>
          <div className="summen">
            <div><span>{t("pdf.basis")}</span><span>{formatBetrag(r.basisCent, sprache)}</span></div>
            {(r.ivaGruppen ?? []).map((g) => (
              <div key={g.ivaSatz}><span>IVA {formatZahl(g.ivaSatz, sprache)} %</span><span>{formatBetrag(g.ivaCent, sprache)}</span></div>
            ))}
            {r.irpfCent > 0 && <div><span>IRPF {formatZahl(r.irpfSatz, sprache)} %</span><span>−{formatBetrag(r.irpfCent, sprache)}</span></div>}
            <div className="gesamt"><span>{t("pdf.summe")}</span><span>{formatBetrag(r.summeCent, sprache)}</span></div>
          </div>
        </div>
      )}

      <div className="aktionen">
        <a href={`/b/${b}/pdf/rechnungen/${r.id}`} target="_blank" rel="noopener" className="knopf leise">{t("rechnungen.pdf")}</a>
        {entwurf && (
          <>
            <Formular aktion={rechnungFreigeben.bind(null, b, r.id)} knopf={t("rechnungen.freigeben")} bestaetigen={t("rechnungen.freigebenHinweis")}>
              <p className="hinweis klein">{t("rechnungen.freigebenHinweis")}</p>
            </Formular>
            <Formular aktion={rechnungLoeschen.bind(null, b, r.id)} knopf={t("allg.loeschen")} leise gefahr bestaetigen={`${t("allg.loeschen")}?`} />
          </>
        )}
        {!entwurf && (
          <>
            <Formular aktion={rechnungSenden.bind(null, b, r.id)} knopf={t("allg.perMail")} className="karte">
              <label>{t("allg.an")}<input name="an" type="email" /></label>
            </Formular>
            {r.status === "ausgestellt" ? (
              <Formular aktion={rechnungBezahlt.bind(null, b, r.id)} knopf={t("rechnungen.bezahlt")} className="karte">
                <label>{t("pdf.datum")}<input name="bezahltAm" type="date" required defaultValue={heute()} /></label>
              </Formular>
            ) : (
              <Formular aktion={rechnungBezahlt.bind(null, b, r.id)} knopf={t("rechnungen.offen")} leise />
            )}
            {r.typ !== "korrektur" && (
              <details className="karte">
                <summary>{t("rechnungen.korrektur")}</summary>
                <Formular aktion={rechnungKorrektur.bind(null, b, r.id)} knopf={t("rechnungen.korrektur")}>
                  <label>{t("rechnungen.grund")}<input name="grund" required /></label>
                </Formular>
              </details>
            )}
          </>
        )}
      </div>
    </>
  );
}
