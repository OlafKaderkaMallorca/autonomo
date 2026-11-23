import { formatZahl } from "@autonomo/shared";
import { api } from "@/lib/api";
import { einstellungenSpeichern, logoHochladen, serieAnlegen } from "../aktionen";
import { Formular } from "../_ui/Formular";
import { seitenKontext } from "../_ui/daten";
import { Sicherheit } from "./Sicherheit";

interface Einstellungen {
  betrieb: {
    name: string;
    nif: string;
    adresse: string | null;
    iban: string | null;
    email: string | null;
    telefon: string | null;
    standardIva: number;
    irpfSatz: number;
    stundensatzCent: number | null;
    zahlungszielTage: number;
    fusstext: string | null;
    farbe: string | null;
    logoDateiId: string | null;
  };
  serien: { id: string; art: "rechnung" | "korrektur" | "angebot"; praefix: string; naechsteNummer: number; stellen: number; aktiv: boolean }[];
  fehlendFuerRechnungen: string[];
}

export default async function EinstellungenSeite({ params }: { params: Promise<{ betriebId: string }> }) {
  const { betriebId } = await params;
  const { t, sprache, b } = await seitenKontext(betriebId);
  const [{ betrieb: e, serien, fehlendFuerRechnungen }, ich] = await Promise.all([
    api<Einstellungen>(`/betriebe/${b}/einstellungen`),
    api<{ zweiFaktor: boolean }>("/me"),
  ]);
  const sicherheitsTexte = {
    titel: t("sicherheit.titel"), zweiFaktor: t("sicherheit.zweiFaktor"), aus: t("sicherheit.aus"), an: t("sicherheit.an"),
    einrichten: t("sicherheit.einrichten"), scannen: t("sicherheit.scannen"), schluessel: t("sicherheit.schluessel"),
    einschalten: t("sicherheit.einschalten"), notfallcodes: t("sicherheit.notfallcodes"), ausschalten: t("sicherheit.ausschalten"),
    ausschaltenHinweis: t("sicherheit.ausschaltenHinweis"), alleAbmelden: t("sicherheit.alleAbmelden"),
    alleAbmeldenFrage: t("sicherheit.alleAbmeldenFrage"), alleAbmeldenHinweis: t("sicherheit.alleAbmeldenHinweis"), code: t("login.code"),
  };
  const euro = (cent: number | null) => (cent === null ? "" : formatZahl(cent / 100, sprache).replace(/\s/g, ""));
  const feldname: Record<string, string> = { name: t("feld.name"), nif: "NIF", adresse: t("feld.adresse") };

  return (
    <>
      <h1>{t("nav.einstellungen")}</h1>
      {fehlendFuerRechnungen.length > 0 && (
        <p className="karte fehler">{t("einstellungen.fehlt", { felder: fehlendFuerRechnungen.map((f) => feldname[f] ?? f).join(", ") })}</p>
      )}
      <div className="zweispaltig">
        <Formular aktion={einstellungenSpeichern.bind(null, b)} knopf={t("allg.speichern")} className="karte">
          <h2 className="ohne-abstand">{t("einstellungen.firma")}</h2>
          <div className="raster">
            <label className="breit">{t("feld.name")}<input name="name" required defaultValue={e.name} /></label>
            <label>NIF<input value={e.nif} disabled /></label>
            <label>{t("feld.telefon")}<input name="telefon" type="tel" defaultValue={e.telefon ?? ""} /></label>
            <label className="breit">{t("feld.adresse")}<textarea name="adresse" rows={2} defaultValue={e.adresse ?? ""} /></label>
            <label className="breit">{t("feld.email")}<input name="email" type="email" defaultValue={e.email ?? ""} /></label>
            <label className="breit">IBAN<input name="iban" defaultValue={e.iban ?? ""} autoCapitalize="characters" /></label>
          </div>
          <h2>{t("einstellungen.rechnung")}</h2>
          <div className="raster">
            <label>{t("einstellungen.stundensatz")}<input name="stundensatz" inputMode="decimal" defaultValue={euro(e.stundensatzCent)} /></label>
            <label>{t("einstellungen.standardIva")}<input name="standardIva" inputMode="decimal" defaultValue={String(e.standardIva)} /></label>
            <label>{t("einstellungen.irpfSatz")}<input name="irpfSatz" inputMode="decimal" defaultValue={String(e.irpfSatz)} /></label>
            <label>{t("einstellungen.zahlungsziel")}<input name="zahlungszielTage" inputMode="numeric" defaultValue={String(e.zahlungszielTage)} /></label>
            <label>{t("einstellungen.farbe")}<input name="farbe" type="color" defaultValue={e.farbe ?? "#059669"} /></label>
            <label className="breit">{t("einstellungen.fusstext")}<textarea name="fusstext" rows={2} defaultValue={e.fusstext ?? ""} /></label>
          </div>
        </Formular>

        <section>
          <div className="karte">
            <h2 className="ohne-abstand">{t("einstellungen.logo")}</h2>
            {e.logoDateiId && <img src={`/b/${b}/logo?v=${e.logoDateiId}`} alt="" className="betrieb-logo" />}
            <Formular aktion={logoHochladen.bind(null, b)} knopf={t("einstellungen.logoHochladen")} leise>
              <input type="file" name="logo" accept="image/png,image/jpeg" required />
            </Formular>
          </div>

          <div className="karte">
            <h2 className="ohne-abstand">{t("einstellungen.serien")}</h2>
            <ul className="liste">
              {serien.map((s) => (
                <li key={s.id} className="zeile">
                  <span>
                    {t(`einstellungen.art.${s.art}`)}: <strong>{s.praefix}{String(s.naechsteNummer).padStart(s.stellen, "0")}</strong>
                  </span>
                  <span className="hinweis klein">{s.aktiv ? t("status.aktiv") : "—"}</span>
                </li>
              ))}
            </ul>
            <details>
              <summary>{t("einstellungen.serieNeu")}</summary>
              <Formular aktion={serieAnlegen.bind(null, b)} knopf={t("allg.anlegen")}>
                <div className="raster">
                  <label>
                    {t("pos.art")}
                    <select name="art">
                      {(["rechnung", "korrektur", "angebot"] as const).map((a) => <option key={a} value={a}>{t(`einstellungen.art.${a}`)}</option>)}
                    </select>
                  </label>
                  <label>{t("einstellungen.praefix")}<input name="praefix" required placeholder="2027-" /></label>
                  <label>{t("einstellungen.naechste")}<input name="naechsteNummer" inputMode="numeric" defaultValue="1" /></label>
                </div>
              </Formular>
            </details>
          </div>

          <Sicherheit aktiv={ich.zweiFaktor} texte={sicherheitsTexte} />
        </section>
      </div>
    </>
  );
}
