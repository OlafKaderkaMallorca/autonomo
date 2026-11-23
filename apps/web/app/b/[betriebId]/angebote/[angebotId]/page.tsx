import Link from "next/link";
import { formatBetrag, formatDatum, formatZahl } from "@autonomo/shared";
import { api } from "@/lib/api";
import type { Angebot, KundeVoll } from "@/lib/typen";
import { angebotAbgelehnt, angebotAngenommen, angebotKopieren, angebotLoeschen, angebotSenden } from "../../aktionen";
import { Formular } from "../../_ui/Formular";
import { Status } from "../../_ui/Status";
import { laden, seitenKontext } from "../../_ui/daten";

export default async function AngebotSeite({ params }: { params: Promise<{ betriebId: string; angebotId: string }> }) {
  const { betriebId, angebotId } = await params;
  const { t, sprache, b } = await seitenKontext(betriebId);
  const [a, kunden] = await Promise.all([laden<Angebot>(`/betriebe/${b}/angebote/${angebotId}`), api<KundeVoll[]>(`/betriebe/${b}/kunden`)]);
  const kunde = kunden.find((k) => k.id === a.kundeId);
  const offen = a.status === "entwurf" || a.status === "gesendet";

  return (
    <>
      <p><Link href={`/b/${b}/angebote`}>← {t("nav.angebote")}</Link></p>
      <div className="kopf">
        <h1>{a.nummer} · {a.titel}</h1>
        <Status status={a.status} t={t} />
      </div>
      <p className="hinweis">
        <Link href={`/b/${b}/kunden/${a.kundeId}`}>{a.kundeName}</Link> · {t("pdf.gueltigBis")} {formatDatum(a.gueltigBis, sprache)}
        {a.gesendetAm && ` · ${t("angebote.gesendetAm", { datum: formatDatum(a.gesendetAm, sprache) })}`}
        {a.geoeffnetAm && ` · ${t("angebote.geoeffnet", { datum: formatDatum(a.geoeffnetAm, sprache) })}`}
      </p>
      {a.status === "angenommen" && (
        <p className="karte erfolg">
          {t("angebote.unterschrieben")} <strong>{a.unterschriftName}</strong>
          {a.entschiedenAm && ` · ${formatDatum(a.entschiedenAm, sprache)}`}
          {a.auftragId && <> · <Link href={`/b/${b}/auftraege/${a.auftragId}`}>{t("angebote.zumAuftrag")}</Link></>}
        </p>
      )}
      {a.status === "abgelehnt" && a.ablehnungsgrund && <p className="karte">{a.ablehnungsgrund}</p>}

      <div className="karte">
        {a.einleitung && <p className="absatz">{a.einleitung}</p>}
        <ul className="liste">
          {a.positionen.map((p, i) => (
            <li key={i} className="zeile">
              <div>
                {p.beschreibung}
                <div className="hinweis klein">
                  {p.art === "stunden" && p.menge === 0
                    ? `${t("pdf.nachAufwand")} · ${formatBetrag(p.preisCent, sprache)} ${t("pdf.proStunde")}`
                    : `${formatZahl(p.menge, sprache)} ${p.einheit ?? ""} × ${formatBetrag(p.preisCent, sprache)}`}
                  {p.art === "pauschale" && ` · ${t("pdf.proMonat")}`}
                  {` · IVA ${formatZahl(p.ivaSatz, sprache)} %`}
                </div>
              </div>
              <span className="betrag">{formatBetrag(Math.round(p.menge * p.preisCent), sprache)}</span>
            </li>
          ))}
        </ul>
        <div className="summen">
          <div><span>{t("pdf.basis")}</span><span>{formatBetrag(a.summen.basisCent, sprache)}</span></div>
          <div className="gesamt"><span>{t("pdf.gesamt")}</span><span>{formatBetrag(a.summen.basisCent + a.summen.ivaCent, sprache)}</span></div>
        </div>
        <a href={`/b/${b}/pdf/angebote/${a.id}`} target="_blank" rel="noopener">{t("rechnungen.pdf")}</a>
      </div>

      <div className="aktionen">
        {a.status === "entwurf" && <Link href={`/b/${b}/angebote/${a.id}/bearbeiten`} className="knopf leise">{t("allg.bearbeiten")}</Link>}
        {offen && (
          <>
            <Formular aktion={angebotSenden.bind(null, b, a.id)} knopf={t("allg.perMail")} className="karte">
              <label>
                {t("allg.an")}
                <input name="an" type="email" placeholder={kunde?.email ?? ""} />
              </label>
            </Formular>
            <Formular aktion={angebotSenden.bind(null, b, a.id)} knopf={t("angebote.link")} leise>
              <input type="hidden" name="ohneMail" value="ja" />
            </Formular>
            <details className="karte">
              <summary>{t("angebote.manuellAngenommen")}</summary>
              <Formular aktion={angebotAngenommen.bind(null, b, a.id)} knopf={t("angebote.manuellAngenommen")}>
                <label>{t("feld.name")}<input name="name" required defaultValue={kunde?.name} /></label>
              </Formular>
              <Formular aktion={angebotAbgelehnt.bind(null, b, a.id)} knopf={t("angebote.ablehnen")} leise>
                <label>{t("rechnungen.grund")}<input name="grund" /></label>
              </Formular>
            </details>
          </>
        )}
        <details className="karte">
          <summary>{t("angebote.kopieren")}</summary>
          <Formular aktion={angebotKopieren.bind(null, b, a.id)} knopf={t("angebote.kopieren")} leise>
            <select name="kundeId" defaultValue={a.kundeId} aria-label={t("pdf.kunde")}>
              {kunden.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
            </select>
          </Formular>
        </details>
        {a.status === "entwurf" && <Formular aktion={angebotLoeschen.bind(null, b, a.id)} knopf={t("allg.loeschen")} leise gefahr bestaetigen={`${t("allg.loeschen")}?`} />}
      </div>
    </>
  );
}
