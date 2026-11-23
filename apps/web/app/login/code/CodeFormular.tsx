"use client";

import { useActionState } from "react";
import { linkMitCode, type LoginZustand } from "../../aktionen";
import { CodeFeld } from "../LoginFormulare";

export function CodeFormular({ token, texte }: { token: string; texte: { code: string; codeHinweis: string; codeFalsch: string; weiter: string } }) {
  const [zustand, aktion, laeuft] = useActionState<LoginZustand, FormData>(linkMitCode.bind(null, token), {});
  return (
    <form action={aktion} className="karte">
      <CodeFeld texte={texte} falsch={zustand.codeFalsch} />
      <button disabled={laeuft}>{texte.weiter}</button>
    </form>
  );
}
