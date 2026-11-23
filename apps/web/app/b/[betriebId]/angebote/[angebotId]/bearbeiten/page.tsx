import Link from "next/link";
import { redirect } from "next/navigation";
import { api } from "@/lib/api";
import type { Angebot, KundeVoll } from "@/lib/typen";
import { angebotSpeichern } from "../../../aktionen";
import { AngebotFelder } from "../../../_ui/AngebotFelder";
import { Formular } from "../../../_ui/Formular";
import { inTagen, laden, seitenKontext, standardIva } from "../../../_ui/daten";

export default async function AngebotBearbeiten({ params }: { params: Promise<{ betriebId: string; angebotId: string }> }) {
  const { betriebId, angebotId } = await params;
  const { t, sprache, b } = await seitenKontext(betriebId);
  const [a, kunden, iva] = await Promise.all([laden<Angebot>(`/betriebe/${b}/angebote/${angebotId}`), api<KundeVoll[]>(`/betriebe/${b}/kunden`), standardIva(b)]);
  if (a.status !== "entwurf") redirect(`/b/${b}/angebote/${a.id}`);
  return (
    <>
      <p><Link href={`/b/${b}/angebote/${a.id}`}>← {a.nummer}</Link></p>
      <h1>{a.nummer}</h1>
      <Formular aktion={angebotSpeichern.bind(null, b, a.id)} knopf={t("allg.speichern")} className="karte">
        <AngebotFelder a={a} kunden={kunden} t={t} sprache={sprache} standardIva={iva} gueltigVorschlag={inTagen(30)} />
      </Formular>
    </>
  );
}
