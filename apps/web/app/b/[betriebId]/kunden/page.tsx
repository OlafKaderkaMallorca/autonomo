import Link from "next/link";
import { api } from "@/lib/api";
import type { KundeVoll } from "@/lib/typen";
import { kundeAnlegen } from "../aktionen";
import { Formular } from "../_ui/Formular";
import { KundenFelder } from "../_ui/KundenFelder";
import { seitenKontext } from "../_ui/daten";

export default async function KundenSeite({ params, searchParams }: { params: Promise<{ betriebId: string }>; searchParams: Promise<{ suche?: string; archiviert?: string }> }) {
  const { betriebId } = await params;
  const { suche = "", archiviert = "nein" } = await searchParams;
  const { t, b } = await seitenKontext(betriebId);
  const q = new URLSearchParams({ archiviert: archiviert === "ja" ? "ja" : "nein", ...(suche ? { suche } : {}) });
  const kunden = await api<KundeVoll[]>(`/betriebe/${b}/kunden?${q}`);

  return (
    <>
      <h1>{t("nav.kunden")}</h1>
      <form className="filter">
        <input name="suche" defaultValue={suche} placeholder={t("allg.suchen")} aria-label={t("allg.suchen")} />
        <select name="archiviert" defaultValue={archiviert}>
          <option value="nein">{t("status.aktiv")}</option>
          <option value="ja">{t("kunden.archiviert")}</option>
        </select>
        <button className="leise">{t("allg.suchen")}</button>
      </form>
      <ul className="liste karte">
        {kunden.length === 0 && <li className="hinweis">{t("allg.keine")}</li>}
        {kunden.map((k) => (
          <li key={k.id} className="zeile">
            <Link href={`/b/${b}/kunden/${k.id}`}>{k.name}</Link>
            <span className="hinweis klein">
              {k.typ === "firma" ? t("feld.firma") : t("feld.privat")} · {k.steuernummer ?? "—"} · {k.sprache.toUpperCase()}
            </span>
          </li>
        ))}
      </ul>
      <details className="karte">
        <summary>{t("kunden.neu")}</summary>
        <Formular aktion={kundeAnlegen.bind(null, b)} knopf={t("allg.anlegen")}>
          <KundenFelder t={t} />
        </Formular>
      </details>
    </>
  );
}
