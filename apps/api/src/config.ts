import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(4002),
  HOST: z.string().default("0.0.0.0"),
  /** Verbindung als App-Rolle (unterliegt Row-Level-Security). */
  DATABASE_URL: z.string().url(),
  /** Verbindung als Eigentümer der Tabellen, nur für Migrationen. */
  MIGRATION_DATABASE_URL: z.string().url().optional(),
  /** Öffentliche Adresse des Web-Portals, für Anmeldelinks. */
  WEB_URL: z.string().url().default("http://localhost:3002"),
  /** SMTP-Verbindung, z. B. smtp://user:pass@smtp-relay.brevo.com:587. Leer = Mails nur ins Log. */
  SMTP_URL: z.string().optional(),
  MAIL_ABSENDER: z.string().default("ApuntaPro <no-reply@localhost>"),
  /** Ordner für Fotos, PDFs und Logos (lokal). Später S3/Hetzner Object Storage. */
  DATEI_ORDNER: z.string().default("daten"),
  /** Optional: Pfad zu Chrome/Edge/Chromium für die PDF-Erzeugung. Leer = automatisch suchen. */
  PDF_BROWSER: z.string().optional(),
  SITZUNG_TAGE: z.coerce.number().default(30),
  MAGIC_LINK_MINUTEN: z.coerce.number().default(15),
});

export type Config = z.infer<typeof schema>;

export function ladeConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return schema.parse(env);
}
