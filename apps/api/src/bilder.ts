import sharp from "sharp";
import { HttpFehler } from "./fehler.js";

export const BILD_TYPEN = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];

/**
 * Foto für die Ablage aufbereiten: richtig drehen, verkleinern, als JPEG speichern.
 * Dabei fallen alle Metadaten weg (auch GPS-Position), siehe Plan, Abschnitt Datenschutz.
 */
export async function verarbeiteFoto(eingabe: Buffer) {
  try {
    const basis = sharp(eingabe, { failOn: "error" }).rotate();
    const gross = await basis.clone().resize({ width: 2560, height: 2560, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 82, mozjpeg: true }).toBuffer({ resolveWithObject: true });
    const klein = await basis.clone().resize({ width: 480, height: 480, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 75, mozjpeg: true }).toBuffer();
    return { gross: gross.data, klein, breite: gross.info.width, hoehe: gross.info.height };
  } catch {
    throw new HttpFehler(400, "Das Bild konnte nicht gelesen werden. Bitte als JPEG oder PNG hochladen.", undefined, "bild_ungueltig");
  }
}

/** Logo für Briefkopf und Portal: höchstens 800 px breit, PNG mit Transparenz. */
export async function verarbeiteLogo(eingabe: Buffer) {
  try {
    return await sharp(eingabe, { failOn: "error" }).rotate().resize({ width: 800, height: 400, fit: "inside", withoutEnlargement: true }).png().toBuffer();
  } catch {
    throw new HttpFehler(400, "Das Logo konnte nicht gelesen werden. Bitte als PNG oder JPEG hochladen.", undefined, "bild_ungueltig");
  }
}
