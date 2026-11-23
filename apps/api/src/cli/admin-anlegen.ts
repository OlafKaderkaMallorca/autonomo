/**
 * Legt einen Plattform-Admin an (oder macht einen bestehenden Benutzer dazu) und setzt das Passwort.
 * Aufruf: node dist/cli/admin-anlegen.js <email> <name>   (Passwort über Umgebungsvariable ADMIN_PASSWORT)
 */
import { emailSchema, passwortSchema } from "@autonomo/shared";
import postgres from "postgres";
import { hashePasswort } from "../auth/passwort.js";

const [email, ...nameTeile] = process.argv.slice(2);
const name = nameTeile.join(" ");
const passwort = process.env.ADMIN_PASSWORT;
const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
if (!email || !name || !passwort || !url) {
  console.error("Aufruf: ADMIN_PASSWORT=... node dist/cli/admin-anlegen.js <email> <name>");
  process.exit(1);
}
const sql = postgres(url, { max: 1 });
const hash = await hashePasswort(passwortSchema.parse(passwort));
await sql`insert into benutzer (email, name, passwort_hash, plattform_admin)
  values (${emailSchema.parse(email)}, ${name}, ${hash}, true)
  on conflict (email) do update set passwort_hash = excluded.passwort_hash, plattform_admin = true`;
await sql.end();
console.log(`Plattform-Admin ${email} ist eingerichtet.`);
