import Link from "next/link";
import { api } from "@/lib/api";
import type { KundeVoll } from "@/lib/typen";
import { angebotAnlegen } from "../../aktionen";
import { AngebotFelder } from "../../_ui/AngebotFelder";
import { Formular } from "../../_ui/Formular";
import { inTagen, seitenKontext, standardIva } from "../../_ui/daten";

export default async function NeuesAngebot({ params, searchParams }: { params: Promise<{ betriebId: string }>; searchParams: Promise<{ kundeId?: string }> }) {
  const { betriebId } = await params;
  const { kundeId } = await searchParams;
  const { t, sprache, b } = await seitenKontext(betriebId);
  const [kunden, iva] = await Promise.all([api<KundeVoll[]>(`/betriebe/${b}/kunden`), standardIva(b)]);
  return (
    <>
      <p><Link href={`/b/${b}/angebote`}>← {t("nav.angebote")}</Link></p>
      <h1>{t("angebote.neu")}</h1>
      <Formular aktion={angebotAnlegen.bind(null, b)} knopf={t("allg.anlegen")} className="karte">
        <AngebotFelder kunden={kunden} t={t} sprache={sprache} standardIva={iva} gueltigVorschlag={inTagen(30)} kundeVorauswahl={kundeId} />
      </Formular>
    </>
  );
}
