"use client";

import { useActionState } from "react";
import { magicLinkAnfordern, passwortLogin, type LoginZustand } from "../aktionen";

interface Texte {
  email: string;
  passwort: string;
  absenden: string;
  magicLink: string;
  gesendet: string;
  fehler: string;
}

export function LoginFormulare({ texte }: { texte: Texte }) {
  const [linkZustand, linkAktion, linkLaeuft] = useActionState<LoginZustand, FormData>(magicLinkAnfordern, {});
  const [pwZustand, pwAktion, pwLaeuft] = useActionState<LoginZustand, FormData>(passwortLogin, {});

  return (
    <>
      <form action={linkAktion} className="karte">
        <label htmlFor="link-email">{texte.email}</label>
        <input id="link-email" name="email" type="email" autoComplete="email" required />
        <button disabled={linkLaeuft}>{texte.magicLink}</button>
        {linkZustand.linkGesendet && <p className="hinweis">{texte.gesendet}</p>}
      </form>
      <div className="trenner">—</div>
      <form action={pwAktion} className="karte">
        <label htmlFor="pw-email">{texte.email}</label>
        <input id="pw-email" name="email" type="email" autoComplete="username" required />
        <label htmlFor="pw">{texte.passwort}</label>
        <input id="pw" name="passwort" type="password" autoComplete="current-password" required />
        <button disabled={pwLaeuft}>{texte.absenden}</button>
        {pwZustand.fehler && <p className="fehler">{texte.fehler}</p>}
      </form>
    </>
  );
}
