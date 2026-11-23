import Link from "next/link";
import { abmelden } from "../../aktionen";
import { SprachWahl } from "../../SprachWahl";
import { seitenKontext } from "./_ui/daten";

export default async function BetriebLayout({ children, params }: { children: React.ReactNode; params: Promise<{ betriebId: string }> }) {
  const { betriebId } = await params;
  const { ich, sprache, t, betrieb } = await seitenKontext(betriebId);
  const inhaber = betrieb.meineRolle === "inhaber";
  const b = `/b/${betriebId}`;
  const navigation = inhaber
    ? ([
        ["", t("nav.uebersicht")],
        ["/kunden", t("nav.kunden")],
        ["/angebote", t("nav.angebote")],
        ["/auftraege", t("nav.auftraege")],
        ["/zeiten", t("nav.zeiten")],
        ["/rechnungen", t("nav.rechnungen")],
        ["/einstellungen", t("nav.einstellungen")],
      ] as const)
    : ([] as const);

  return (
    <div className={inhaber ? "app breit" : "app"}>
      <header className="kopfleiste">
        <Link href={b} className="betriebsname">{betrieb.name}</Link>
        <div className="kopf-rechts">
          <SprachWahl sprache={sprache} />
          {ich.betriebe.length > 1 && <Link href="/" className="klein">{t("betrieb.waehlen")}</Link>}
          <form action={abmelden}>
            <button className="leise klein">{t("abmelden")}</button>
          </form>
        </div>
      </header>
      {navigation.length > 0 && (
        <nav className="hauptnav">
          {navigation.map(([pfad, name]) => (
            <Link key={pfad} href={`${b}${pfad}`}>{name}</Link>
          ))}
        </nav>
      )}
      <main>{children}</main>
    </div>
  );
}
