import type { Metadata } from "next";
import { formatBetrag, formatDatum, formatZahl, t } from "@autonomo/shared";
import { oeffentlich, type OeffentlichesAngebot } from "@/lib/oeffentlich";
import { Entscheidung } from "./Unterschrift";

export const metadata: Metadata = { title: "ApuntaPro", robots: { index: false, follow: false } };

export default async function AngebotSeite({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const res = await oeffentlich(`/angebote/${encodeURIComponent(token)}`);
  if (!res.ok) {
    return (
      <main>
        <div className="karte">
          <p>{t("es", "link.ungueltig")}</p>
          <p className="hinweis">{t("de", "link.ungueltig")}</p>
          <p className="hinweis">{t("en", "link.ungueltig")}</p>
        </div>
      </main>
    );
  }
  const d = (await res.json()) as OeffentlichesAngebot;
  const s = d.sprache;
  const a = d.angebot;
  const summe = a.summen.basisCent + a.summen.ivaCent;
  const basis = `/angebot/${encodeURIComponent(token)}`;

  return (
    <main lang={s}>
      <div className="kopf angebot-kopf">
        {d.betrieb.hatLogo ? <img src={`${basis}/logo`} alt={d.betrieb.name} className="betrieb-logo" /> : <strong>{d.betrieb.name}</strong>}
        <div className="hinweis rechts">
          {t(s, "pdf.angebot")} {a.nummer}
          <br />
          {t(s, "pdf.gueltigBis")} {formatDatum(a.gueltigBis, s)}
        </div>
      </div>

      <h1>{a.titel}</h1>
      <p className="hinweis">{d.kunde.name}</p>
      {a.einleitung && <p className="absatz">{a.einleitung}</p>}

      <div className="karte">
        <ul className="liste">
          {a.positionen.map((p, i) => {
            const nachAufwand = p.art === "stunden" && p.menge === 0;
            return (
              <li key={i} className="position">
                <div>
                  <div>{p.beschreibung}</div>
                  <div className="hinweis klein">
                    {nachAufwand
                      ? `${t(s, "pdf.nachAufwand")} · ${formatBetrag(p.preisCent, s)} ${t(s, "pdf.proStunde")}`
                      : `${formatZahl(p.menge, s)}${p.einheit ? ` ${p.einheit}` : ""} × ${formatBetrag(p.preisCent, s)}`}
                    {p.art === "pauschale" && ` · ${t(s, "pdf.proMonat")}`}
                    {p.stundenkontingent ? ` · ${t(s, "pdf.kontingent", { stunden: formatZahl(p.stundenkontingent, s) })}` : ""}
                    {` · IVA ${formatZahl(p.ivaSatz, s)} %`}
                  </div>
                </div>
                <div className="betrag">{nachAufwand ? "" : formatBetrag(Math.round(p.menge * p.preisCent), s)}</div>
              </li>
            );
          })}
        </ul>
        <div className="summen">
          <div><span>{t(s, "pdf.basis")}</span><span>{formatBetrag(a.summen.basisCent, s)}</span></div>
          {a.summen.ivaGruppen.map((g) => (
            <div key={g.ivaSatz}>
              <span>IVA {formatZahl(g.ivaSatz, s)} %</span>
              <span>{formatBetrag(g.ivaCent, s)}</span>
            </div>
          ))}
          <div className="gesamt"><span>{t(s, "pdf.gesamt")}</span><span>{formatBetrag(summe, s)}</span></div>
        </div>
        <a href={`${basis}/pdf`} target="_blank" rel="noopener">{t(s, "link.pdf")}</a>
      </div>

      {a.status === "angenommen" ? (
        <div className="karte erfolg">
          <p>{t(s, "link.danke", { betrieb: d.betrieb.name })}</p>
          <p className="hinweis">{t(s, "pdf.angenommen", { datum: formatDatum(a.entschiedenAm!, s), name: a.unterschriftName ?? "" })}</p>
        </div>
      ) : a.status === "abgelehnt" ? (
        <div className="karte"><p>{t(s, "link.abgelehntDanke")}</p></div>
      ) : d.abgelaufen ? (
        <div className="karte"><p>{t(s, "link.abgelaufen", { betrieb: d.betrieb.name })}</p></div>
      ) : (
        <Entscheidung
          token={token}
          texte={{
            name: t(s, "link.name"),
            unterschrift: t(s, "link.unterschrift"),
            loeschen: t(s, "link.unterschriftLoeschen"),
            zustimmung: t(s, "link.zustimmung"),
            annehmen: t(s, "link.annehmen"),
            ablehnen: t(s, "link.ablehnen"),
            ablehnenFrage: t(s, "link.ablehnenFrage"),
            grund: t(s, "link.grund"),
            fehler: {
              fehlt: t(s, "link.fehlt"),
              abgelaufen: t(s, "link.abgelaufen", { betrieb: d.betrieb.name }),
              entschieden: t(s, "link.ungueltig"),
              allgemein: t(s, "link.ungueltig"),
            },
          }}
        />
      )}

      <p className="hinweis klein fuss">
        {d.betrieb.name}
        {d.betrieb.telefon && ` · ${d.betrieb.telefon}`}
        {d.betrieb.email && (
          <>
            {" · "}
            <a href={`mailto:${d.betrieb.email}`}>{d.betrieb.email}</a>
          </>
        )}
      </p>
    </main>
  );
}
