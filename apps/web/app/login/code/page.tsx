import { redirect } from "next/navigation";
import { aktuelleSprache, uebersetzer } from "@/lib/sprache";
import { CodeFormular } from "./CodeFormular";

/** Zweiter Schritt nach dem Anmeldelink, wenn die Zwei-Faktor-Anmeldung eingeschaltet ist. */
export default async function CodeSeite({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  if (!token) redirect("/login");
  const t = uebersetzer(await aktuelleSprache());
  return (
    <main>
      <h1>{t("login.titel")}</h1>
      <CodeFormular
        token={token}
        texte={{ code: t("login.code"), codeHinweis: t("login.codeHinweis"), codeFalsch: t("login.codeFalsch"), weiter: t("login.weiter") }}
      />
    </main>
  );
}
