"use client";

import { useActionState, useState, useTransition } from "react";
import {
  ueberallAbmelden,
  zweiFaktorAusschalten,
  zweiFaktorEinrichten,
  zweiFaktorEinschalten,
  type ZweiFaktorZustand,
} from "../../../aktionen";

type Texte = Record<
  | "titel" | "zweiFaktor" | "aus" | "an" | "einrichten" | "scannen" | "schluessel" | "einschalten" | "notfallcodes"
  | "ausschalten" | "ausschaltenHinweis" | "alleAbmelden" | "alleAbmeldenFrage" | "alleAbmeldenHinweis" | "code",
  string
>;

/** Zwei-Faktor-Anmeldung (TOTP) einrichten/ausschalten und auf allen Geräten abmelden. */
export function Sicherheit({ aktiv, texte }: { aktiv: boolean; texte: Texte }) {
  const [einrichtung, setEinrichtung] = useState<ZweiFaktorZustand>({});
  const [laedt, starte] = useTransition();
  const [ein, einAktion, einLaeuft] = useActionState(zweiFaktorEinschalten, {});
  const [aus, ausAktion, ausLaeuft] = useActionState(zweiFaktorAusschalten, {});

  const istAn = (aktiv || ein.schritt === "codes") && aus.schritt !== "aus";

  return (
    <div className="karte">
      <h2 className="ohne-abstand">{texte.titel}</h2>
      <h3>{texte.zweiFaktor}</h3>

      {ein.schritt === "codes" && ein.notfallcodes ? (
        <>
          <p className="hinweis">{texte.notfallcodes}</p>
          <ul className="notfallcodes">
            {ein.notfallcodes.map((c) => <li key={c}><code>{c}</code></li>)}
          </ul>
        </>
      ) : istAn ? (
        <>
          <p>{texte.an}</p>
          <details>
            <summary>{texte.ausschalten}</summary>
            <form action={ausAktion}>
              <p className="hinweis klein">{texte.ausschaltenHinweis}</p>
              <label>{texte.code}<input name="code" autoComplete="one-time-code" required maxLength={20} /></label>
              <button className="leise gefahr" disabled={ausLaeuft}>{texte.ausschalten}</button>
              {aus.fehler && <p className="fehler">{aus.fehler}</p>}
            </form>
          </details>
        </>
      ) : einrichtung.schritt === "scannen" ? (
        <form action={einAktion}>
          <p className="hinweis">{texte.scannen}</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={einrichtung.qr} alt="QR" width={200} height={200} className="qr" />
          <p className="hinweis klein">
            {texte.schluessel} <code>{einrichtung.geheimnis?.match(/.{1,4}/g)?.join(" ")}</code>
          </p>
          <label>{texte.code}<input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required /></label>
          <button disabled={einLaeuft}>{texte.einschalten}</button>
          {ein.fehler && <p className="fehler">{ein.fehler}</p>}
        </form>
      ) : (
        <>
          <p className="hinweis">{texte.aus}</p>
          <button className="leise" disabled={laedt} onClick={() => starte(async () => setEinrichtung(await zweiFaktorEinrichten()))}>
            {texte.einrichten}
          </button>
          {einrichtung.fehler && <p className="fehler">{einrichtung.fehler}</p>}
        </>
      )}

      <h3>{texte.alleAbmelden}</h3>
      <p className="hinweis klein">{texte.alleAbmeldenHinweis}</p>
      <form action={ueberallAbmelden} onSubmit={(e) => !window.confirm(texte.alleAbmeldenFrage) && e.preventDefault()}>
        <button className="leise gefahr">{texte.alleAbmelden}</button>
      </form>
    </div>
  );
}
