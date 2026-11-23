import Link from "next/link";
import { formatDatum } from "@autonomo/shared";
import { api } from "@/lib/api";
import type { Aufgabe, Foto } from "@/lib/typen";
import { aufgabeStatus, fotoAendern, fotoHochladen, fotoLoeschen, notizAnlegen } from "../../aktionen";
import { Formular } from "../../_ui/Formular";
import { Status } from "../../_ui/Status";
import { laden, seitenKontext } from "../../_ui/daten";

export default async function AufgabeSeite({ params }: { params: Promise<{ betriebId: string; aufgabeId: string }> }) {
  const { betriebId, aufgabeId } = await params;
  const { t, sprache, b } = await seitenKontext(betriebId);
  const [g, fotos] = await Promise.all([laden<Aufgabe>(`/betriebe/${b}/aufgaben/${aufgabeId}`), api<Foto[]>(`/betriebe/${b}/aufgaben/${aufgabeId}/fotos`)]);

  return (
    <>
      <p><Link href={`/b/${b}/auftraege/${g.auftragId}`}>← {g.auftragTitel}</Link></p>
      <div className="kopf">
        <h1>{g.titel}</h1>
        <Status status={g.status} t={t} />
      </div>
      <p className="hinweis">
        {g.kundeName}
        {g.faelligAm && ` · ${t("feld.faelligAm")} ${formatDatum(g.faelligAm, sprache)}`}
        {g.erstelltVonRolle === "kunde" && ` · ${t("aufgaben.vomKunden")}`}
      </p>
      {g.beschreibung && <p className="karte absatz">{g.beschreibung}</p>}
      <div className="aktionen">
        {(["offen", "in_arbeit", "erledigt"] as const)
          .filter((s) => s !== g.status)
          .map((s) => (
            <Formular key={s} aktion={aufgabeStatus.bind(null, b, g.id, s)} knopf={t(`status.${s}`)} leise inline />
          ))}
      </div>

      <h2>{t("aufgaben.fotos")}</h2>
      <div className="karte">
        <div className="fotos">
          {fotos.map((f) => (
            <figure key={f.id}>
              <a href={`/b/${b}/foto/${f.id}`} target="_blank" rel="noopener">
                <img src={`/b/${b}/foto/${f.id}?groesse=klein`} alt={f.beschreibung ?? ""} loading="lazy" />
              </a>
              <figcaption className="klein">
                {f.beschreibung}
                <div className="foto-aktionen">
                  <Formular
                    aktion={fotoAendern.bind(null, b, g.id, f.id, !f.sichtbarFuerKunde)}
                    knopf={f.sichtbarFuerKunde ? "👁" : "🚫"}
                    leise
                    inline
                  />
                  <Formular aktion={fotoLoeschen.bind(null, b, g.id, f.id)} knopf="✕" leise inline bestaetigen={`${t("allg.loeschen")}?`} />
                </div>
              </figcaption>
            </figure>
          ))}
        </div>
        <Formular aktion={fotoHochladen.bind(null, b, g.id)} knopf={t("aufgaben.fotoHochladen")} leise>
          <div className="raster">
            <label className="breit"><input type="file" name="foto" accept="image/jpeg,image/png,image/webp,image/heic" capture="environment" required /></label>
            <label>
              {t("pos.art")}
              <select name="art" defaultValue="arbeit">
                {(["arbeit", "vorher", "nachher", "schaden"] as const).map((a) => (
                  <option key={a} value={a}>{t(`foto.${a}`)}</option>
                ))}
              </select>
            </label>
            <label>{t("pdf.beschreibung")}<input name="beschreibung" /></label>
            <label className="haken"><input type="checkbox" name="sichtbar" defaultChecked /> {t("feld.sichtbar")}</label>
          </div>
        </Formular>
      </div>

      <h2>{t("aufgaben.notizen")}</h2>
      <div className="karte">
        <ul className="liste">
          {(g.notizen ?? []).map((n) => (
            <li key={n.id}>
              <span className="absatz">{n.text}</span>
              <div className="hinweis klein">{formatDatum(n.erstelltAm, sprache)}{n.sichtbarFuerKunde && ` · ${t("feld.sichtbar")}`}</div>
            </li>
          ))}
        </ul>
        <Formular aktion={notizAnlegen.bind(null, b, g.id)} knopf={t("allg.anlegen")} leise>
          <textarea name="text" rows={2} required aria-label={t("feld.notiz")} />
          <label className="haken"><input type="checkbox" name="sichtbar" /> {t("feld.sichtbar")}</label>
        </Formular>
      </div>
    </>
  );
}
