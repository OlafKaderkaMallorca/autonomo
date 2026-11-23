import { SPRACHEN, type Sprache } from "@autonomo/shared";
import { spracheWechseln } from "./aktionen";

const NAMEN: Record<Sprache, string> = { de: "Deutsch", es: "Español", en: "English" };

export function SprachWahl({ sprache }: { sprache: Sprache }) {
  return (
    <form action={spracheWechseln} style={{ display: "flex", gap: 4 }}>
      {SPRACHEN.map((s) => (
        <button key={s} name="sprache" value={s} className="leise" style={{ marginTop: 0, fontWeight: s === sprache ? 700 : 400 }} aria-pressed={s === sprache} title={NAMEN[s]}>
          {s.toUpperCase()}
        </button>
      ))}
    </form>
  );
}
