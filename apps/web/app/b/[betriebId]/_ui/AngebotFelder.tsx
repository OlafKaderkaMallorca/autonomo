import type { Sprache, UebersetzungsSchluessel } from "@autonomo/shared";
import type { Angebot, KundeVoll } from "@/lib/typen";
import { editorTexte } from "./daten";
import { alsEditorZeilen } from "./editorZeilen";
import { PositionsEditor } from "./PositionsEditor";

export function AngebotFelder({
  a,
  kunden,
  t,
  sprache,
  standardIva,
  gueltigVorschlag,
  kundeVorauswahl,
}: {
  a?: Angebot;
  kunden: KundeVoll[];
  t: (k: UebersetzungsSchluessel, w?: Record<string, string | number>) => string;
  sprache: Sprache;
  standardIva: number;
  gueltigVorschlag: string;
  kundeVorauswahl?: string;
}) {
  return (
    <>
      <div className="raster">
        <label className="breit">
          {t("pdf.kunde")}
          <select name="kundeId" required defaultValue={a?.kundeId ?? kundeVorauswahl ?? ""}>
            <option value="" disabled>—</option>
            {kunden.map((k) => (
              <option key={k.id} value={k.id}>{k.name}</option>
            ))}
          </select>
        </label>
        <label className="breit">
          {t("feld.titel")}
          <input name="titel" required defaultValue={a?.titel} />
        </label>
        <label>
          {t("pdf.gueltigBis")}
          <input name="gueltigBis" type="date" required defaultValue={a?.gueltigBis ?? gueltigVorschlag} />
        </label>
        <label className="breit">
          {t("feld.einleitung")}
          <textarea name="einleitung" rows={3} defaultValue={a?.einleitung ?? ""} />
        </label>
      </div>
      <PositionsEditor start={a ? alsEditorZeilen(a.positionen, sprache) : []} texte={editorTexte(t)} sprache={sprache} standardIva={standardIva} />
    </>
  );
}
