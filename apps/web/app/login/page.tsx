import { aktuelleSprache, uebersetzer } from "@/lib/sprache";
import { SprachWahl } from "../SprachWahl";
import { LoginFormulare } from "./LoginFormulare";

export default async function LoginSeite({ searchParams }: { searchParams: Promise<{ fehler?: string }> }) {
  const sprache = await aktuelleSprache();
  const t = uebersetzer(sprache);
  const { fehler } = await searchParams;
  return (
    <main>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/schriftzug-hell.svg" alt="ApuntaPro" className="marke marke-hell" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/schriftzug-dunkel.svg" alt="" aria-hidden className="marke marke-dunkel" />
      <div className="kopf">
        <h1>{t("login.titel")}</h1>
        <SprachWahl sprache={sprache} />
      </div>
      {fehler === "link" && <p className="fehler">Link ungültig oder abgelaufen / Enlace no válido o caducado</p>}
      <LoginFormulare
        texte={{
          email: t("login.email"),
          passwort: t("login.passwort"),
          absenden: t("login.absenden"),
          magicLink: t("login.magicLink"),
          gesendet: t("login.magicLinkGesendet"),
          fehler: t("login.fehler"),
        }}
      />
    </main>
  );
}
