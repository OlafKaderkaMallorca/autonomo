/**
 * Nur für die lokale Entwicklung: legt einen Plattform-Admin, einen Demo-Betrieb und Demo-Kunden an.
 * Läuft mehrfach ohne Fehler (vorhandene Daten bleiben).
 */
import postgres from "postgres";
import { hashePasswort } from "../auth/passwort.js";

const url = process.env.MIGRATION_DATABASE_URL;
if (!url) throw new Error("MIGRATION_DATABASE_URL fehlt (apps/api/.env)");
if (process.env.NODE_ENV === "production") throw new Error("Demo-Daten nicht in Produktion anlegen");

const EMAIL = "olaf@demo.local";
const PASSWORT = "demo-passwort";

const sql = postgres(url, { max: 1, onnotice: () => {} });
const [benutzer] = await sql<{ id: string }[]>`
  insert into benutzer (email, name, passwort_hash, plattform_admin, sprache)
  values (${EMAIL}, 'Olaf (Demo)', ${await hashePasswort(PASSWORT)}, true, 'de')
  on conflict (email) do update set plattform_admin = true returning id`;
const [betrieb] = await sql<{ id: string }[]>`
  insert into betrieb (name, nif, sprache) values ('Demo Garten & Service', 'X1234567L', 'de')
  on conflict (nif) do update set name = excluded.name returning id`;
await sql`insert into mitgliedschaft (betrieb_id, benutzer_id, rolle)
  values (${betrieb!.id}, ${benutzer!.id}, 'inhaber') on conflict do nothing`;
const [{ anzahl }] = (await sql`select count(*)::int as anzahl from kunde where betrieb_id = ${betrieb!.id}`) as unknown as [{ anzahl: number }];
if (anzahl === 0) {
  await sql`insert into kunde (betrieb_id, typ, name, steuernummer, sprache) values
    (${betrieb!.id}, 'privat', 'Finca Son Vida (Familie Müller)', '12345678Z', 'de'),
    (${betrieb!.id}, 'firma', 'Hotel Cala Blava S.L.', 'B12345674', 'es')`;
}
await sql.end();
console.log(`Demo-Daten bereit. Anmelden unter http://localhost:3002 mit ${EMAIL} / ${PASSWORT}`);
