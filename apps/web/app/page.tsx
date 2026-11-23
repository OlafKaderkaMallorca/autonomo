import Link from "next/link";
import { redirect } from "next/navigation";
import { ichOderLogin } from "@/lib/ich";
import { aktuelleSprache, uebersetzer } from "@/lib/sprache";
import { abmelden } from "./aktionen";
import { SprachWahl } from "./SprachWahl";

export default async function Start() {
  const ich = await ichOderLogin();
  const sprache = await aktuelleSprache(ich.sprache);
  const t = uebersetzer(sprache);
  if (ich.betriebe.length === 1 && !ich.plattformAdmin) redirect(`/b/${ich.betriebe[0]!.id}`);

  return (
    <main>
      <div className="kopf">
        <h1>{t("betrieb.waehlen")}</h1>
        <SprachWahl sprache={sprache} />
      </div>
      <p className="hinweis">{ich.name} · {ich.email}</p>
      {ich.betriebe.length === 0 ? (
        <p>{t("betrieb.keine")}</p>
      ) : (
        <ul className="liste karte">
          {ich.betriebe.map((b) => (
            <li key={b.id}>
              <Link href={`/b/${b.id}`}>{b.name}</Link> <span className="hinweis">· {t(`rolle.${b.rolle}`)}</span>
            </li>
          ))}
        </ul>
      )}
      <form action={abmelden}>
        <button className="leise">{t("abmelden")}</button>
      </form>
    </main>
  );
}
