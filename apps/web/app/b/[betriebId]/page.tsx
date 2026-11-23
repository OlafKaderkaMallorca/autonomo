import Link from "next/link";
import { formatBetrag, formatDatum, formatMonat, formatZahl } from "@autonomo/shared";
import { api } from "@/lib/api";
import type { Angebot, Auftrag, Rechnung, Uebersicht } from "@/lib/typen";
import { aufgabeStatus, timerStarten, timerStoppen } from "./aktionen";
import { Formular } from "./_ui/Formular";
import { Status } from "./_ui/Status";
import { seitenKontext, uhrzeit } from "./_ui/daten";

export default async function Startseite({ params }: { params: Promise<{ betriebId: string }> }) {
  const { betriebId } = await params;
  const { t, sprache, betrieb, b } = await seitenKontext(betriebId);
  if (betrieb.meineRolle !== "inhaber") return <Unterlagen betriebId={betriebId} />;

  const [u, auftraege] = await Promise.all([
    api<Uebersicht>(`/betriebe/${b}/uebersicht`),
    api<Auftrag[]>(`/betriebe/${b}/auftraege?status=aktiv`).catch(() => [] as Auftrag[]),
  ]);
  const stunden = (min: number) => formatZahl(min / 60, sprache, 1);

  return (
    <>
      <h1>{t("nav.uebersicht")} · {formatMonat(u.monat, sprache)}</h1>

      <section className="karte">
        <h2 className="ohne-abstand">{t("timer.titel")}</h2>
        {u.laufenderTimer ? (
          <Formular aktion={timerStoppen.bind(null, b)} knopf={t("timer.stopp")} inline>
            <span>
              <strong>{u.laufenderTimer.kundeName}</strong> · {u.laufenderTimer.auftragTitel} ·{" "}
              {t("timer.laeuft", { zeit: uhrzeit(u.laufenderTimer.start) })}
            </span>
          </Formular>
        ) : (
          <Formular aktion={timerStarten.bind(null, b)} knopf={t("timer.start")} inline>
            <select name="auftragId" required aria-label={t("feld.auftrag")}>
              {auftraege.map((a) => (
                <option key={a.id} value={a.id}>{a.kundeName} · {a.titel}</option>
              ))}
            </select>
          </Formular>
        )}
      </section>

      <div className="kacheln">
        <Link href={`/b/${b}/rechnungen?status=offen`} className="kachel">
          <span className="hinweis">{t("uebersicht.offeneRechnungen")}</span>
          <strong>{formatBetrag(u.rechnungen.offenCent, sprache)}</strong>
          <span className={u.rechnungen.ueberfaelligAnzahl ? "fehler klein" : "hinweis klein"}>
            {u.rechnungen.offenAnzahl} · {t("uebersicht.ueberfaellig", { anzahl: u.rechnungen.ueberfaelligAnzahl })}
          </span>
        </Link>
        <Link href={`/b/${b}/rechnungen?status=entwurf`} className="kachel">
          <span className="hinweis">{t("uebersicht.entwuerfe")}</span>
          <strong>{u.rechnungen.entwuerfe}</strong>
        </Link>
        <Link href={`/b/${b}/angebote?status=gesendet`} className="kachel">
          <span className="hinweis">{t("uebersicht.angeboteOffen")}</span>
          <strong>{u.angeboteOffen}</strong>
        </Link>
        <div className="kachel">
          <span className="hinweis">{t("uebersicht.umsatz")}</span>
          <strong>{formatBetrag(u.rechnungen.umsatzMonatBasisCent, sprache)}</strong>
        </div>
      </div>

      <h2>{t("uebersicht.stundenJeKunde")}</h2>
      <div className="karte">
        {u.kunden.length === 0 ? (
          <p className="hinweis">{t("allg.keine")}</p>
        ) : (
          <ul className="liste">
            {u.kunden.map((k) => (
              <li key={k.kundeId} className="zeile">
                <div>
                  <Link href={`/b/${b}/kunden/${k.kundeId}`}>{k.name}</Link>
                  {k.effektiverStundensatzCent !== null && (
                    <div className={u.stundensatzCent && k.effektiverStundensatzCent < u.stundensatzCent ? "fehler klein" : "hinweis klein"}>
                      {t("uebersicht.effektiv", { betrag: formatBetrag(k.effektiverStundensatzCent, sprache) })}
                      {u.stundensatzCent && k.effektiverStundensatzCent < u.stundensatzCent ? ` · ${t("uebersicht.unterSatz")}` : ""}
                    </div>
                  )}
                </div>
                <div className="rechts">
                  {t("uebersicht.stunden", { stunden: stunden(k.minuten) })}
                  {k.pauschaleCent > 0 && <div className="hinweis klein">{formatBetrag(k.pauschaleCent, sprache)}</div>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <h2>{t("uebersicht.aufgaben")}</h2>
      <div className="karte">
        {u.offeneAufgaben.length === 0 ? (
          <p className="hinweis">{t("allg.keine")}</p>
        ) : (
          <ul className="liste">
            {u.offeneAufgaben.map((g) => (
              <li key={g.id} className="zeile">
                <div>
                  <Link href={`/b/${b}/aufgaben/${g.id}`}>{g.titel}</Link>
                  <div className="hinweis klein">
                    {g.kundeName} · {g.auftragTitel}
                    {g.faelligAm && ` · ${formatDatum(g.faelligAm, sprache)}`}
                    {g.erstelltVonRolle === "kunde" && ` · ${t("aufgaben.vomKunden")}`}
                  </div>
                </div>
                <Formular aktion={aufgabeStatus.bind(null, b, g.id, "erledigt")} knopf="✓" leise inline />
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

/** Ansicht für Kunden und Steuerberatung, bis das Portal in Phase 2 ausgebaut wird. */
async function Unterlagen({ betriebId }: { betriebId: string }) {
  const { t, sprache, betrieb, b } = await seitenKontext(betriebId);
  const [rechnungen, angebote] = await Promise.all([
    api<Rechnung[]>(`/betriebe/${b}/rechnungen`),
    betrieb.meineRolle === "kunde" ? api<Angebot[]>(`/betriebe/${b}/angebote`) : Promise.resolve([] as Angebot[]),
  ]);
  return (
    <>
      <h1>{t("portal.titel")}</h1>
      {angebote.length > 0 && (
        <>
          <h2>{t("nav.angebote")}</h2>
          <ul className="liste karte">
            {angebote.map((a) => (
              <li key={a.id} className="zeile">
                <a href={`/b/${b}/pdf/angebote/${a.id}`} target="_blank" rel="noopener">{a.nummer} · {a.titel}</a>
                <Status status={a.status} t={t} />
              </li>
            ))}
          </ul>
        </>
      )}
      <h2>{t("nav.rechnungen")}</h2>
      <ul className="liste karte">
        {rechnungen.length === 0 && <li className="hinweis">{t("allg.keine")}</li>}
        {rechnungen.map((r) => (
          <li key={r.id} className="zeile">
            <a href={`/b/${b}/pdf/rechnungen/${r.id}`} target="_blank" rel="noopener">
              {r.nummer} · {r.datum && formatDatum(r.datum, sprache)}
              {betrieb.meineRolle === "steuerberater" && ` · ${r.kundeName}`}
            </a>
            <span>{formatBetrag(r.summeCent, sprache)} <Status status={r.status} t={t} /></span>
          </li>
        ))}
      </ul>
    </>
  );
}
