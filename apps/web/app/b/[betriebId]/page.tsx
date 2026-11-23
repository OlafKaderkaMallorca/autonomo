import Link from "next/link";
import { notFound } from "next/navigation";
import type { Rolle } from "@autonomo/shared";
import { api, ApiFehler } from "@/lib/api";
import { ichOderLogin } from "@/lib/ich";
import { aktuelleSprache, uebersetzer } from "@/lib/sprache";
import type { Kunde } from "@/lib/typen";
import { abmelden } from "../../aktionen";
import { SprachWahl } from "../../SprachWahl";

export default async function BetriebSeite({ params }: { params: Promise<{ betriebId: string }> }) {
  const { betriebId } = await params;
  const ich = await ichOderLogin();
  const sprache = await aktuelleSprache(ich.sprache);
  const t = uebersetzer(sprache);

  let betrieb: { id: string; name: string; meineRolle: Rolle };
  let kunden: Kunde[];
  try {
    [betrieb, kunden] = await Promise.all([
      api<typeof betrieb>(`/betriebe/${betriebId}`),
      api<Kunde[]>(`/betriebe/${betriebId}/kunden`),
    ]);
  } catch (e) {
    if (e instanceof ApiFehler && e.status === 404) notFound();
    throw e;
  }

  return (
    <main>
      <div className="kopf">
        <h1>{betrieb.name}</h1>
        <SprachWahl sprache={sprache} />
      </div>
      <p className="hinweis">
        {ich.name} · {t(`rolle.${betrieb.meineRolle}`)}
        {ich.betriebe.length > 1 && <> · <Link href="/">{t("betrieb.waehlen")}</Link></>}
      </p>
      <h2>{t("kunden.titel")}</h2>
      <div className="karte">
        {kunden.length === 0 ? (
          <p className="hinweis">{t("kunden.leer")}</p>
        ) : (
          <ul className="liste">
            {kunden.map((k) => (
              <li key={k.id}>
                {k.name} <span className="hinweis">{k.steuernummer ?? ""}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <form action={abmelden}>
        <button className="leise">{t("abmelden")}</button>
      </form>
    </main>
  );
}
