import postgres from "postgres";
import type { FastifyInstance } from "fastify";
import { baueApp } from "../src/app.js";
import { ladeConfig } from "../src/config.js";
import { verbindeDb, type Sql } from "../src/db.js";
import { hashePasswort } from "../src/auth/passwort.js";
import type { Mail } from "../src/mail.js";
import { migriere } from "../src/migrate.js";
import { erstellePdfDrucker } from "../src/pdf/browser.js";
import { speicherImRam } from "../src/speicher.js";

/**
 * Erwartet eine Postgres-Instanz mit den Rollen autonomo_owner (createdb) und autonomo_app.
 * TEST_OWNER_URL zeigt auf eine beliebige DB des Owners, TEST_APP_URL_BASIS ohne Datenbanknamen.
 */
const OWNER_URL = process.env.TEST_OWNER_URL ?? "postgres://autonomo_owner:owner@localhost:5434/postgres";
const APP_URL_BASIS = process.env.TEST_APP_URL_BASIS ?? "postgres://autonomo_app:app@localhost:5434";

export interface TestUmgebung {
  app: FastifyInstance;
  sql: Sql;
  mails: Mail[];
  speicher: ReturnType<typeof speicherImRam>;
  ownerSql: postgres.Sql;
  schliessen(): Promise<void>;
}

export async function testUmgebung(): Promise<TestUmgebung> {
  const dbName = `autonomo_test_${process.pid}_${Date.now()}`;
  const admin = postgres(OWNER_URL, { max: 1, onnotice: () => {} });
  await admin.unsafe(`create database ${dbName}`);
  await admin.end();

  const ownerUrl = OWNER_URL.replace(/\/[^/]*$/, `/${dbName}`);
  await migriere(ownerUrl, () => {});
  const ownerSql = postgres(ownerUrl, { max: 2, transform: postgres.camel, onnotice: () => {} });

  const config = ladeConfig({ NODE_ENV: "test", DATABASE_URL: `${APP_URL_BASIS}/${dbName}`, WEB_URL: "https://portal.test" });
  const sql = verbindeDb(config.DATABASE_URL);
  const mails: Mail[] = [];
  const speicher = speicherImRam();
  const app = await baueApp({
    sql,
    config,
    mail: { sende: async (m) => void mails.push(m) },
    speicher,
    pdf: erstellePdfDrucker(process.env.PDF_BROWSER),
  });

  return {
    app,
    sql,
    mails,
    speicher,
    ownerSql,
    async schliessen() {
      await app.close();
      await sql.end();
      await ownerSql.end();
      const a = postgres(OWNER_URL, { max: 1, onnotice: () => {} });
      await a.unsafe(`drop database if exists ${dbName} with (force)`);
      await a.end();
    },
  };
}

export async function legeAdminAn(u: TestUmgebung, email = "admin@test.es", passwort = "geheim-geheim-123") {
  await u.ownerSql`insert into benutzer (email, name, passwort_hash, plattform_admin)
    values (${email}, 'Admin', ${await hashePasswort(passwort)}, true)`;
  const res = await u.app.inject({ method: "POST", url: "/auth/login", payload: { email, passwort } });
  return res.json().token as string;
}

/** Liest den Token aus dem letzten Anmeldelink an diese Adresse und meldet an. */
export async function anmeldenPerLink(u: TestUmgebung, email: string): Promise<string> {
  const mail = [...u.mails].reverse().find((m) => m.an === email);
  if (!mail) throw new Error(`Keine Mail an ${email}`);
  const token = decodeURIComponent(/token=([^\s]+)/.exec(mail.text)![1]!);
  const res = await u.app.inject({ method: "POST", url: "/auth/magic-link/einloesen", payload: { token } });
  if (res.statusCode !== 200) throw new Error(`Einlösen fehlgeschlagen: ${res.body}`);
  return res.json().token as string;
}

export const auth = (token: string) => ({ authorization: `Bearer ${token}` });
