import { z } from "zod";
import { ROLLEN, SPRACHEN } from "./rollen.js";

export const spracheSchema = z.enum(SPRACHEN);
export const rolleSchema = z.enum(ROLLEN);

export const emailSchema = z.string().trim().toLowerCase().email().max(254);
export const passwortSchema = z.string().min(10).max(200);

/** Zweiter Faktor: 6-stelliger Code aus der Authenticator-App oder ein Notfallcode (abcd-efgh). */
export const zweiterFaktorSchema = z.string().trim().min(6).max(20);

export const passwortLoginSchema = z.object({
  email: emailSchema,
  passwort: z.string().min(1).max(200),
  code: zweiterFaktorSchema.optional(),
});
export type PasswortLogin = z.infer<typeof passwortLoginSchema>;

export const magicLinkAnfrageSchema = z.object({ email: emailSchema });
export const magicLinkEinloesenSchema = z.object({ token: z.string().min(20).max(200), code: zweiterFaktorSchema.optional() });

/** NIF/NIE/CIF grob prüfen (Format). Die Prüfziffer prüft istGueltigeSpanischeSteuernummer. */
export const steuernummerSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{9}$/, "Steuernummer muss 9 Zeichen haben");

export const betriebAnlegenSchema = z.object({
  name: z.string().trim().min(2).max(200),
  nif: steuernummerSchema,
  sprache: spracheSchema.default("es"),
  inhaberEmail: emailSchema,
  inhaberName: z.string().trim().min(2).max(200),
});
export type BetriebAnlegen = z.infer<typeof betriebAnlegenSchema>;

export const kundeSchema = z.object({
  typ: z.enum(["privat", "firma"]),
  name: z.string().trim().min(1).max(200),
  steuernummer: steuernummerSchema.optional(),
  email: emailSchema.optional(),
  sprache: spracheSchema.default("es"),
  irpf: z.boolean().default(false),
  adresse: z.string().trim().max(500).optional(),
  notizen: z.string().max(5000).optional(),
});
export type KundeEingabe = z.infer<typeof kundeSchema>;

const NIF_BUCHSTABEN = "TRWAGMYFPDXBNJZSQVHLCKE";
const CIF_KONTROLL = "JABCDEFGHI";

/**
 * Prüft DNI/NIF (natürliche Person), NIE (Ausländer) und CIF (Firma) inkl. Prüfziffer.
 */
export function istGueltigeSpanischeSteuernummer(eingabe: string): boolean {
  const wert = eingabe.trim().toUpperCase();
  // DNI: 8 Ziffern + Buchstabe
  if (/^\d{8}[A-Z]$/.test(wert)) {
    return NIF_BUCHSTABEN[Number(wert.slice(0, 8)) % 23] === wert[8];
  }
  // NIE: X/Y/Z + 7 Ziffern + Buchstabe
  if (/^[XYZ]\d{7}[A-Z]$/.test(wert)) {
    const zahl = "XYZ".indexOf(wert[0]!) + wert.slice(1, 8);
    return NIF_BUCHSTABEN[Number(zahl) % 23] === wert[8];
  }
  // CIF: Buchstabe + 7 Ziffern + Kontrollzeichen
  if (/^[ABCDEFGHJNPQRSUVW]\d{7}[0-9A-J]$/.test(wert)) {
    const ziffern = wert.slice(1, 8);
    let summe = 0;
    for (let i = 0; i < 7; i++) {
      let d = Number(ziffern[i]);
      if (i % 2 === 0) {
        d *= 2;
        d = Math.floor(d / 10) + (d % 10);
      }
      summe += d;
    }
    const kontrolle = (10 - (summe % 10)) % 10;
    const zeichen = wert[8]!;
    const erstes = wert[0]!;
    if ("PQRSNW".includes(erstes)) return zeichen === CIF_KONTROLL[kontrolle];
    if ("ABEH".includes(erstes)) return zeichen === String(kontrolle);
    return zeichen === String(kontrolle) || zeichen === CIF_KONTROLL[kontrolle];
  }
  return false;
}
