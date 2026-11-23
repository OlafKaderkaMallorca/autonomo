import Link from "next/link";
import { api } from "@/lib/api";
import type { Auftrag, KundeVoll } from "@/lib/typen";
import { auftragAnlegen } from "../aktionen";
import { Formular } from "../_ui/Formular";
import { PositionsEditor } from "../_ui/PositionsEditor";
import { Status } from "../_ui/Status";
import { editorTexte, heute, seitenKontext, standardIva } from "../_ui/daten";

export default async function AuftraegeSeite({ params, searchParams }: { params: Promise<{ betriebId: string }>; searchParams: Promise<{ status?: string }> }) {
  const { betriebId } = await params;
  const { status = "aktiv" } = await searchParams;
  const { t, sprache, b } = await seitenKontext(betriebId);
  const filter = ["aktiv", "pausiert", "beendet"].includes(status) ? status : "aktiv";
  const [auftraege, kunden, iva] = await Promise.all([
    api<Auftrag[]>(`/betriebe/${b}/auftraege?status=${filter}`),
    api<KundeVoll[]>(`/betriebe/${b}/kunden`),
    standardIva(b),
  ]);

  return (
    <>
      <h1>{t("nav.auftraege")}</h1>
      <nav className="reiter">
        {(["aktiv", "pausiert", "beendet"] as const).map((s) => (
          <Link key={s} href={`/b/${b}/auftraege?status=${s}`} aria-current={filter === s ? "page" : undefined}>{t(`status.${s}`)}</Link>
        ))}
      </nav>
      <ul className="liste karte">
        {auftraege.length === 0 && <li className="hinweis">{t("allg.keine")}</li>}
        {auftraege.map((a) => (
          <li key={a.id} className="zeile">
            <div>
              <Link href={`/b/${b}/auftraege/${a.id}`}>{a.titel}</Link>
              <div className="hinweis klein">
                {a.kundeName}
                {a.hatPauschale && ` · ${t("pos.pauschale")}`}
                {a.hatStunden && ` · ${t("pos.stunden")}`}
                {a.offeneAufgaben ? ` · ${t("uebersicht.aufgaben")}: ${a.offeneAufgaben}` : ""}
              </div>
            </div>
            <Status status={a.status} t={t} />
          </li>
        ))}
      </ul>
      <details className="karte">
        <summary>{t("auftraege.neu")}</summary>
        <Formular aktion={auftragAnlegen.bind(null, b)} knopf={t("allg.anlegen")}>
          <div className="raster">
            <label className="breit">
              {t("pdf.kunde")}
              <select name="kundeId" required defaultValue="">
                <option value="" disabled>—</option>
                {kunden.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
              </select>
            </label>
            <label className="breit">{t("feld.titel")}<input name="titel" required /></label>
            <label>{t("feld.beginn")}<input name="beginn" type="date" defaultValue={heute()} /></label>
          </div>
          <h3>{t("auftraege.positionen")}</h3>
          <PositionsEditor start={[]} texte={editorTexte(t)} sprache={sprache} standardIva={iva} />
        </Formular>
      </details>
    </>
  );
}
