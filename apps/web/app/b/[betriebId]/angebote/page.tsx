import Link from "next/link";
import { formatBetrag, formatDatum } from "@autonomo/shared";
import { api } from "@/lib/api";
import type { Angebot } from "@/lib/typen";
import { Status } from "../_ui/Status";
import { seitenKontext } from "../_ui/daten";

const STATUS = ["entwurf", "gesendet", "angenommen", "abgelehnt"] as const;

export default async function AngeboteSeite({ params, searchParams }: { params: Promise<{ betriebId: string }>; searchParams: Promise<{ status?: string }> }) {
  const { betriebId } = await params;
  const { status } = await searchParams;
  const { t, sprache, b } = await seitenKontext(betriebId);
  const filter = STATUS.find((s) => s === status);
  const angebote = await api<Angebot[]>(`/betriebe/${b}/angebote${filter ? `?status=${filter}` : ""}`);

  return (
    <>
      <div className="kopf">
        <h1>{t("nav.angebote")}</h1>
        <Link href={`/b/${b}/angebote/neu`} className="knopf">+ {t("angebote.neu")}</Link>
      </div>
      <nav className="reiter">
        <Link href={`/b/${b}/angebote`} aria-current={!filter ? "page" : undefined}>{t("allg.alle")}</Link>
        {STATUS.map((s) => (
          <Link key={s} href={`/b/${b}/angebote?status=${s}`} aria-current={filter === s ? "page" : undefined}>{t(`status.${s}`)}</Link>
        ))}
      </nav>
      <ul className="liste karte">
        {angebote.length === 0 && <li className="hinweis">{t("allg.keine")}</li>}
        {angebote.map((a) => (
          <li key={a.id} className="zeile">
            <div>
              <Link href={`/b/${b}/angebote/${a.id}`}>{a.nummer} · {a.titel}</Link>
              <div className="hinweis klein">{a.kundeName} · {t("pdf.gueltigBis")} {formatDatum(a.gueltigBis, sprache)}</div>
            </div>
            <span className="rechts">
              {formatBetrag(a.basisCent ?? 0, sprache)} <Status status={a.status} t={t} />
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}
