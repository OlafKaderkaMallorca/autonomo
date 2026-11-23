import Link from "next/link";
import { formatBetrag, formatDatum } from "@autonomo/shared";
import { api } from "@/lib/api";
import type { KundeVoll, Rechnung } from "@/lib/typen";
import { monatsentwuerfe, rechnungAnlegen } from "../aktionen";
import { Formular } from "../_ui/Formular";
import { Status } from "../_ui/Status";
import { heute, seitenKontext } from "../_ui/daten";

const FILTER = ["entwurf", "offen", "ueberfaellig", "bezahlt"] as const;

function vormonat(): string {
  const [j, m] = heute().split("-").map(Number) as [number, number];
  return m === 1 ? `${j - 1}-12` : `${j}-${String(m - 1).padStart(2, "0")}`;
}

export default async function RechnungenSeite({ params, searchParams }: { params: Promise<{ betriebId: string }>; searchParams: Promise<{ status?: string }> }) {
  const { betriebId } = await params;
  const { status } = await searchParams;
  const { t, sprache, b } = await seitenKontext(betriebId);
  const filter = FILTER.find((f) => f === status);
  const [rechnungen, kunden] = await Promise.all([
    api<Rechnung[]>(`/betriebe/${b}/rechnungen${filter ? `?status=${filter}` : ""}`),
    api<KundeVoll[]>(`/betriebe/${b}/kunden`),
  ]);
  const heuteText = heute();

  return (
    <>
      <h1>{t("nav.rechnungen")}</h1>
      <div className="zweispaltig">
        <Formular aktion={monatsentwuerfe.bind(null, b)} knopf={t("rechnungen.monatsentwuerfe")} className="karte">
          <p className="hinweis klein">{t("rechnungen.monatHinweis")}</p>
          <label>{t("feld.monat")}<input name="monat" type="month" required defaultValue={vormonat()} /></label>
        </Formular>
        <Formular aktion={rechnungAnlegen.bind(null, b)} knopf={t("rechnungen.neu")} className="karte" leise>
          <label>
            {t("pdf.kunde")}
            <select name="kundeId" required defaultValue="">
              <option value="" disabled>—</option>
              {kunden.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
            </select>
          </label>
        </Formular>
      </div>
      <nav className="reiter">
        <Link href={`/b/${b}/rechnungen`} aria-current={!filter ? "page" : undefined}>{t("allg.alle")}</Link>
        {FILTER.map((f) => (
          <Link key={f} href={`/b/${b}/rechnungen?status=${f}`} aria-current={filter === f ? "page" : undefined}>
            {t(f === "offen" ? "status.ausgestellt" : `status.${f}`)}
          </Link>
        ))}
      </nav>
      <ul className="liste karte">
        {rechnungen.length === 0 && <li className="hinweis">{t("allg.keine")}</li>}
        {rechnungen.map((r) => {
          const ueberfaellig = r.status === "ausgestellt" && r.faelligAm !== null && r.faelligAm < heuteText;
          return (
            <li key={r.id} className="zeile">
              <div>
                <Link href={`/b/${b}/rechnungen/${r.id}`}>{r.nummer ?? t("status.entwurf")} · {r.kundeName}</Link>
                <div className="hinweis klein">
                  {r.datum ? formatDatum(r.datum, sprache) : r.leistungszeitraum ?? ""}
                  {r.typ === "korrektur" && ` · ${t("pdf.rechnung.korrektur")}`}
                </div>
              </div>
              <span className="rechts">
                {formatBetrag(r.summeCent, sprache)} <Status status={ueberfaellig ? "ueberfaellig" : r.status} t={t} />
              </span>
            </li>
          );
        })}
      </ul>
    </>
  );
}
