"use client";

import { useActionState, useState } from "react";
import type { Zustand } from "../aktionen";

/**
 * Formular mit Server-Aktion: zeigt Fehler bzw. Erfolg an und sperrt den Knopf während der Ausführung.
 * Mit `bestaetigen` wird vorher nachgefragt (z. B. vor Freigabe oder Löschen).
 */
export function Formular({
  aktion,
  knopf,
  children,
  leise,
  gefahr,
  bestaetigen,
  className,
  inline,
}: {
  aktion: (vorher: Zustand, daten: FormData) => Promise<Zustand>;
  knopf: string;
  children?: React.ReactNode;
  leise?: boolean;
  gefahr?: boolean;
  bestaetigen?: string;
  className?: string;
  inline?: boolean;
}) {
  const [zustand, ausfuehren, laeuft] = useActionState(aktion, {});
  return (
    <form
      action={ausfuehren}
      className={[className, inline ? "inline" : ""].filter(Boolean).join(" ")}
      onSubmit={bestaetigen ? (e) => !window.confirm(bestaetigen) && e.preventDefault() : undefined}
    >
      {children}
      <button disabled={laeuft} className={[leise ? "leise" : "", gefahr ? "gefahr" : ""].join(" ").trim() || undefined}>
        {knopf}
      </button>
      {zustand.fehler && <p className="fehler">{zustand.fehler}</p>}
      {zustand.ok && <p className="hinweis">{zustand.ok}</p>}
      {zustand.link && <LinkKopieren link={zustand.link} />}
    </form>
  );
}

export function LinkKopieren({ link }: { link: string }) {
  const [kopiert, setKopiert] = useState(false);
  return (
    <div className="link-kopieren">
      <input readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
      <button
        type="button"
        className="leise klein"
        onClick={async () => {
          await navigator.clipboard.writeText(link);
          setKopiert(true);
        }}
      >
        {kopiert ? "✓" : "⧉"}
      </button>
    </div>
  );
}
