import { z } from "zod";
import { emailSchema, spracheSchema, steuernummerSchema } from "./schemas.js";

const datum = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Datum im Format JJJJ-MM-TT");
const monat = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Monat im Format JJJJ-MM");
const cent = z.number().int().min(0).max(100_000_000_00);
const ivaSatz = z.number().min(0).max(100);
const text = (max: number) => z.string().trim().min(1).max(max);
const optText = (max: number) => z.string().trim().max(max).nullish();

export const monatSchema = monat;
export const datumSchema = datum;

export const betriebEinstellungenSchema = z.object({
  name: text(200).optional(),
  sprache: spracheSchema.optional(),
  adresse: optText(500),
  iban: z.string().trim().toUpperCase().regex(/^[A-Z]{2}\d{2}[A-Z0-9 ]{10,32}$/, "IBAN ungültig").nullish(),
  email: emailSchema.nullish(),
  telefon: optText(50),
  standardIva: ivaSatz.optional(),
  irpfSatz: ivaSatz.optional(),
  stundensatzCent: cent.nullish(),
  zahlungszielTage: z.number().int().min(0).max(365).optional(),
  fusstext: optText(2000),
  farbe: z.string().regex(/^#[0-9A-Fa-f]{6}$/).nullish(),
});

export const serieSchema = z.object({
  art: z.enum(["rechnung", "korrektur", "angebot"]),
  praefix: z.string().trim().min(1).max(20).regex(/^[A-Za-z0-9\-/_.]+$/, "Nur Buchstaben, Ziffern und - / _ ."),
  naechsteNummer: z.number().int().min(1).default(1),
  stellen: z.number().int().min(1).max(8).default(4),
});

export const kundeErweitertSchema = z.object({
  typ: z.enum(["privat", "firma"]),
  name: text(200),
  steuernummer: steuernummerSchema.nullish(),
  email: emailSchema.nullish(),
  telefon: optText(50),
  sprache: spracheSchema.default("es"),
  irpf: z.boolean().default(false),
  adresse: optText(500),
  notizen: z.string().max(5000).nullish(),
  archiviert: z.boolean().optional(),
});

export const kontaktSchema = z.object({
  name: text(200),
  email: emailSchema.nullish(),
  telefon: optText(50),
  funktion: optText(100),
});

export const positionsArtSchema = z.enum(["pauschale", "stunden", "material"]);

export const positionSchema = z.object({
  art: positionsArtSchema,
  beschreibung: text(1000),
  menge: z.number().min(0).max(1_000_000).default(1),
  einheit: optText(20),
  preisCent: cent,
  ivaSatz: ivaSatz,
  stundenkontingent: z.number().min(0).max(10000).nullish(),
});
export type PositionDaten = z.infer<typeof positionSchema>;

export const angebotSchema = z.object({
  kundeId: z.string().uuid(),
  titel: text(200),
  einleitung: z.string().max(5000).nullish(),
  gueltigBis: datum,
  positionen: z.array(positionSchema).min(1).max(200),
});

export const auftragSchema = z.object({
  kundeId: z.string().uuid(),
  titel: text(200),
  beginn: datum.optional(),
  ende: datum.nullish(),
  positionen: z.array(positionSchema).max(200).default([]),
});

export const auftragAendernSchema = z.object({
  titel: text(200).optional(),
  status: z.enum(["aktiv", "pausiert", "beendet"]).optional(),
  ende: datum.nullish(),
  positionen: z.array(positionSchema.extend({ aktiv: z.boolean().default(true) })).max(200).optional(),
});

/** Vom Gerät vergebene ID, damit ein offline erfasster Datensatz beim erneuten Senden nicht doppelt entsteht. */
const geraeteId = z.string().uuid().optional();

export const aufgabeSchema = z.object({
  id: geraeteId,
  auftragId: z.string().uuid(),
  titel: text(200),
  beschreibung: z.string().max(5000).nullish(),
  faelligAm: datum.nullish(),
  sichtbarFuerKunde: z.boolean().default(true),
});

export const aufgabeAendernSchema = z.object({
  titel: text(200).optional(),
  beschreibung: z.string().max(5000).nullish(),
  faelligAm: datum.nullish(),
  sichtbarFuerKunde: z.boolean().optional(),
  status: z.enum(["offen", "in_arbeit", "erledigt"]).optional(),
  /**
   * Stand (geaendertAm), auf dem die Änderung beruht. Ist die Aufgabe inzwischen woanders
   * geändert worden, antwortet die API mit 409 „konflikt“ und der aktuellen Fassung.
   */
  stand: z.string().datetime({ offset: true }).optional(),
});

export const notizSchema = z.object({
  id: geraeteId,
  text: text(5000),
  sichtbarFuerKunde: z.boolean().default(false),
});

export const zeiteintragSchema = z
  .object({
    id: geraeteId,
    auftragId: z.string().uuid(),
    aufgabeId: z.string().uuid().nullish(),
    start: z.string().datetime({ offset: true }),
    ende: z.string().datetime({ offset: true }).nullish(),
    dauerMinuten: z.number().int().min(1).max(24 * 60).nullish(),
    notiz: z.string().max(2000).nullish(),
    abrechenbar: z.boolean().optional(),
  })
  .refine((z) => !(z.ende && z.dauerMinuten), { message: "Entweder Ende oder Dauer angeben" });

export const timerStartSchema = z.object({
  id: geraeteId,
  auftragId: z.string().uuid(),
  aufgabeId: z.string().uuid().nullish(),
  notiz: z.string().max(2000).nullish(),
  /** Offline gestartet: tatsächliche Startzeit vom Gerät (höchstens 24 Stunden zurück). */
  start: z.string().datetime({ offset: true }).optional(),
});

export const timerStoppSchema = z.object({
  notiz: z.string().max(2000).optional(),
  /** Offline gestoppt: tatsächliche Endzeit vom Gerät. */
  ende: z.string().datetime({ offset: true }).optional(),
  /** Nur diesen Timer stoppen (Abgleich vom Gerät). */
  id: z.string().uuid().optional(),
});

export const materialSchema = z.object({
  auftragId: z.string().uuid(),
  datum: datum.optional(),
  beschreibung: text(500),
  menge: z.number().positive().max(1_000_000).default(1),
  einheit: optText(20),
  preisCent: cent,
  ivaSatz: ivaSatz.optional(),
});

export const rechnungsPositionSchema = z.object({
  beschreibung: text(1000),
  menge: z.number().min(-1_000_000).max(1_000_000),
  einheit: optText(20),
  preisCent: z.number().int().min(-100_000_000_00).max(100_000_000_00),
  ivaSatz: ivaSatz,
});

export const rechnungEntwurfSchema = z.object({
  kundeId: z.string().uuid(),
  leistungVon: datum.nullish(),
  leistungBis: datum.nullish(),
  leistungszeitraum: optText(100),
  bemerkung: z.string().max(2000).nullish(),
  positionen: z.array(rechnungsPositionSchema).max(200).default([]),
});

export const rechnungAendernSchema = z.object({
  leistungVon: datum.nullish(),
  leistungBis: datum.nullish(),
  leistungszeitraum: optText(100),
  bemerkung: z.string().max(2000).nullish(),
  positionen: z.array(rechnungsPositionSchema.extend({ quelle: z.string().optional() })).max(200).optional(),
});

export const monatsEntwuerfeSchema = z.object({ monat });

export const korrekturSchema = z.object({
  grund: text(1000),
  /** Ohne Positionen wird die ganze Rechnung storniert (alle Positionen negativ). */
  positionen: z.array(rechnungsPositionSchema).max(200).optional(),
});

export const bezahltSchema = z.object({ bezahltAm: datum.nullable() });
