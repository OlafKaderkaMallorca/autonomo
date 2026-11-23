import Link from "next/link";
import { formatDatum, formatZahl } from "@autonomo/shared";
import { api } from "@/lib/api";
import type { Auftrag, Zeiteintrag } from "@/lib/typen";
import { timerStarten, timerStoppen, zeitLoeschen, zeitNachtragen } from "../aktionen";
import { Formular } from "../_ui/Formular";
import { heute, inTagen, seitenKontext, uhrzeit } from "../_ui/daten";

export default async function ZeitenSeite({ params, searchParams }: { params: Promise<{ betriebId: string }>; searchParams: Promise<{ von?: string; bis?: string }> }) {
  const { betriebId } = await params;
  const sp = await searchParams;
  const { t, sprache, b } = await seitenKontext(betriebId);
  const von = /^\d{4}-\d{2}-\d{2}$/.test(sp.von ?? "") ? sp.von! : inTagen(-13);
  const bis = /^\d{4}-\d{2}-\d{2}$/.test(sp.bis ?? "") ? sp.bis! : heute();
  const [zeiten, auftraege, timer] = await Promise.all([
    api<Zeiteintrag[]>(`/betriebe/${b}/zeiten?von=${von}&bis=${bis}`),
    api<Auftrag[]>(`/betriebe/${b}/auftraege?status=aktiv`),
    api<{ timer: Zeiteintrag | null }>(`/betriebe/${b}/timer`),
  ]);

  // Nach Tagen gruppieren
  const tage = new Map<string, Zeiteintrag[]>();
  for (const z of zeiten) {
    const tag = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Madrid" }).format(new Date(z.start));
    tage.set(tag, [...(tage.get(tag) ?? []), z]);
  }
  const summe = zeiten.reduce((s, z) => s + (z.laeuft ? 0 : z.dauerMinuten), 0);
  const auftragsAuswahl = (
    <select name="auftragId" required aria-label={t("feld.auftrag")}>
      {auftraege.map((a) => <option key={a.id} value={a.id}>{a.kundeName} · {a.titel}</option>)}
    </select>
  );

  return (
    <>
      <h1>{t("nav.zeiten")}</h1>
      <section className="karte">
        {timer.timer ? (
          <Formular aktion={timerStoppen.bind(null, b)} knopf={t("timer.stopp")} inline>
            <span><strong>{timer.timer.kundeName}</strong> · {timer.timer.auftragTitel} · {t("timer.laeuft", { zeit: uhrzeit(timer.timer.start) })}</span>
          </Formular>
        ) : (
          <Formular aktion={timerStarten.bind(null, b)} knopf={t("timer.start")} inline>{auftragsAuswahl}</Formular>
        )}
      </section>

      <details className="karte">
        <summary>{t("zeiten.neu")}</summary>
        <Formular aktion={zeitNachtragen.bind(null, b)} knopf={t("allg.speichern")}>
          <div className="raster">
            <label className="breit">{t("feld.auftrag")}{auftragsAuswahl}</label>
            <label>{t("pdf.datum")}<input name="datum" type="date" required defaultValue={heute()} /></label>
            <label>{t("zeiten.von")}<input name="von" type="time" required defaultValue="08:00" /></label>
            <label>{t("zeiten.bis")}<input name="bis" type="time" /></label>
            <label>{t("feld.dauer")}<input name="dauer" inputMode="numeric" placeholder="180" /></label>
            <label className="breit">{t("feld.notiz")}<input name="notiz" /></label>
            <label>
              {t("feld.abrechenbar")}
              <select name="abrechenbar" defaultValue="">
                <option value="">auto</option>
                <option value="ja">{t("allg.ja")}</option>
                <option value="nein">{t("allg.nein")}</option>
              </select>
            </label>
          </div>
        </Formular>
      </details>

      <form className="filter">
        <label>{t("zeiten.von")}<input name="von" type="date" defaultValue={von} /></label>
        <label>{t("zeiten.bis")}<input name="bis" type="date" defaultValue={bis} /></label>
        <button className="leise">{t("allg.suchen")}</button>
      </form>
      <p><strong>{t("zeiten.summe")}: {t("uebersicht.stunden", { stunden: formatZahl(summe / 60, sprache, 2) })}</strong></p>

      {[...tage.entries()].map(([tag, eintraege]) => (
        <section key={tag}>
          <h3>{formatDatum(tag, sprache)} · {formatZahl(eintraege.reduce((s, z) => s + (z.laeuft ? 0 : z.dauerMinuten), 0) / 60, sprache, 2)} h</h3>
          <ul className="liste karte">
            {eintraege.map((z) => (
              <li key={z.id} className="zeile">
                <div>
                  <Link href={`/b/${b}/auftraege/${z.auftragId}`}>{z.kundeName} · {z.auftragTitel}</Link>
                  <div className="hinweis klein">
                    {uhrzeit(z.start)}–{z.ende ? uhrzeit(z.ende) : "…"}
                    {z.notiz && ` · ${z.notiz}`}
                    {!z.abrechenbar && ` · ${t("allg.nein")} ${t("feld.abrechenbar")}`}
                    {z.rechnungId && ` · ${t("zeiten.abgerechnet")}`}
                  </div>
                </div>
                <span className="rechts">
                  {z.laeuft ? "…" : `${formatZahl(z.dauerMinuten / 60, sprache, 2)} h`}
                  {!z.rechnungId && !z.laeuft && <Formular aktion={zeitLoeschen.bind(null, b, z.id)} knopf="✕" leise inline bestaetigen={`${t("allg.loeschen")}?`} />}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}
