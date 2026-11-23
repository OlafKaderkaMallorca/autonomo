import type { UebersetzungsSchluessel } from "@autonomo/shared";
import type { KundeVoll } from "@/lib/typen";

/** Eingabefelder für einen Kunden (Neuanlage und Bearbeiten). */
export function KundenFelder({ k, t }: { k?: KundeVoll; t: (s: UebersetzungsSchluessel) => string }) {
  return (
    <div className="raster">
      <label>
        {t("feld.typ")}
        <select name="typ" defaultValue={k?.typ ?? "privat"}>
          <option value="privat">{t("feld.privat")}</option>
          <option value="firma">{t("feld.firma")}</option>
        </select>
      </label>
      <label className="breit">
        {t("feld.name")}
        <input name="name" required defaultValue={k?.name} />
      </label>
      <label>
        {t("feld.steuernummer")}
        <input name="steuernummer" defaultValue={k?.steuernummer ?? ""} autoCapitalize="characters" />
      </label>
      <label>
        {t("sprache")}
        <select name="sprache" defaultValue={k?.sprache ?? "es"}>
          <option value="es">Español</option>
          <option value="de">Deutsch</option>
          <option value="en">English</option>
        </select>
      </label>
      <label>
        {t("feld.email")}
        <input name="email" type="email" defaultValue={k?.email ?? ""} />
      </label>
      <label>
        {t("feld.telefon")}
        <input name="telefon" type="tel" defaultValue={k?.telefon ?? ""} />
      </label>
      <label className="breit">
        {t("feld.adresse")}
        <textarea name="adresse" rows={2} defaultValue={k?.adresse ?? ""} />
      </label>
      <label className="breit">
        {t("feld.notizen")}
        <textarea name="notizen" rows={2} defaultValue={k?.notizen ?? ""} />
      </label>
      <label className="haken breit">
        <input type="checkbox" name="irpf" defaultChecked={k?.irpf} /> {t("feld.irpf")}
        <span className="hinweis klein"> · {t("kunden.irpfHinweis")}</span>
      </label>
    </div>
  );
}
