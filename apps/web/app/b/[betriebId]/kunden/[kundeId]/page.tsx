import Link from "next/link";
import { formatBetrag, formatDatum } from "@autonomo/shared";
import { api } from "@/lib/api";
import type { Angebot, Auftrag, Kontakt, KundeVoll, Rechnung } from "@/lib/typen";
import { kontaktAnlegen, kontaktLoeschen, kundeArchivieren, kundeEinladen, kundeSpeichern } from "../../aktionen";
import { Formular } from "../../_ui/Formular";
import { KundenFelder } from "../../_ui/KundenFelder";
import { Status } from "../../_ui/Status";
import { laden, seitenKontext } from "../../_ui/daten";

export default async function KundeSeite({ params }: { params: Promise<{ betriebId: string; kundeId: string }> }) {
  const { betriebId, kundeId } = await params;
  const { t, sprache, b } = await seitenKontext(betriebId);
  const [k, kontakte, angebote, auftraege, rechnungen] = await Promise.all([
    laden<KundeVoll>(`/betriebe/${b}/kunden/${kundeId}`),
    api<Kontakt[]>(`/betriebe/${b}/kunden/${kundeId}/kontakte`),
    api<Angebot[]>(`/betriebe/${b}/angebote?kundeId=${kundeId}`),
    api<Auftrag[]>(`/betriebe/${b}/auftraege?kundeId=${kundeId}`),
    api<Rechnung[]>(`/betriebe/${b}/rechnungen?kundeId=${kundeId}`),
  ]);

  return (
    <>
      <p><Link href={`/b/${b}/kunden`}>← {t("nav.kunden")}</Link></p>
      <h1>{k.name} {k.archiviert && <span className="etikett">{t("kunden.archiviert")}</span>}</h1>

      <div className="zweispaltig">
        <section>
          <h2>{t("nav.auftraege")}</h2>
          <ul className="liste karte">
            {auftraege.length === 0 && <li className="hinweis">{t("allg.keine")}</li>}
            {auftraege.map((a) => (
              <li key={a.id} className="zeile">
                <Link href={`/b/${b}/auftraege/${a.id}`}>{a.titel}</Link>
                <Status status={a.status} t={t} />
              </li>
            ))}
          </ul>
          <h2>{t("nav.angebote")}</h2>
          <ul className="liste karte">
            {angebote.length === 0 && <li className="hinweis">{t("allg.keine")}</li>}
            {angebote.map((a) => (
              <li key={a.id} className="zeile">
                <Link href={`/b/${b}/angebote/${a.id}`}>{a.nummer} · {a.titel}</Link>
                <Status status={a.status} t={t} />
              </li>
            ))}
          </ul>
          <h2>{t("nav.rechnungen")}</h2>
          <ul className="liste karte">
            {rechnungen.length === 0 && <li className="hinweis">{t("allg.keine")}</li>}
            {rechnungen.map((r) => (
              <li key={r.id} className="zeile">
                <Link href={`/b/${b}/rechnungen/${r.id}`}>{r.nummer ?? t("status.entwurf")} {r.datum && `· ${formatDatum(r.datum, sprache)}`}</Link>
                <span>{formatBetrag(r.summeCent, sprache)} <Status status={r.status} t={t} /></span>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h2>{t("allg.bearbeiten")}</h2>
          <Formular aktion={kundeSpeichern.bind(null, b, k.id)} knopf={t("allg.speichern")} className="karte">
            <KundenFelder k={k} t={t} />
          </Formular>

          <h2>{t("kunden.kontakte")}</h2>
          <div className="karte">
            <ul className="liste">
              {kontakte.map((c) => (
                <li key={c.id} className="zeile">
                  <span>
                    {c.name} {c.funktion && <span className="hinweis">· {c.funktion}</span>}
                    <br />
                    <span className="hinweis klein">{[c.email, c.telefon].filter(Boolean).join(" · ")}</span>
                  </span>
                  <Formular aktion={kontaktLoeschen.bind(null, b, k.id, c.id)} knopf="✕" leise inline />
                </li>
              ))}
            </ul>
            <Formular aktion={kontaktAnlegen.bind(null, b, k.id)} knopf={t("allg.anlegen")} leise>
              <div className="raster">
                <label>{t("feld.name")}<input name="name" required /></label>
                <label>{t("feld.funktion")}<input name="funktion" /></label>
                <label>{t("feld.email")}<input name="email" type="email" /></label>
                <label>{t("feld.telefon")}<input name="telefon" type="tel" /></label>
              </div>
            </Formular>
          </div>

          <h2>{t("kunden.portal")}</h2>
          <Formular aktion={kundeEinladen.bind(null, b, k.id, k.sprache)} knopf={t("kunden.portal")} className="karte" leise>
            <div className="raster">
              <label>{t("feld.name")}<input name="name" required defaultValue={k.name} /></label>
              <label>{t("feld.email")}<input name="email" type="email" required defaultValue={k.email ?? ""} /></label>
            </div>
          </Formular>

          <Formular
            aktion={kundeArchivieren.bind(null, b, k.id, !k.archiviert)}
            knopf={k.archiviert ? t("kunden.wiederherstellen") : t("kunden.archivieren")}
            leise
          />
        </section>
      </div>
    </>
  );
}
