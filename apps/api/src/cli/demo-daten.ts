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
await sql`update betrieb set adresse = coalesce(adresse, 'Carrer de Sant Miquel 1, 07002 Palma'),
  iban = coalesce(iban, 'ES9121000418450200051332'), email = coalesce(email, 'olaf@demo.local'),
  stundensatz_cent = coalesce(stundensatz_cent, 3500) where id = ${betrieb!.id}`;
const b = betrieb!.id;
async function demoKunde(typ: string, name: string, nif: string, adresse: string, sprache: string) {
  const [vorhanden] = await sql<{ id: string }[]>`select id from kunde where betrieb_id = ${b} and name = ${name}`;
  if (vorhanden) {
    await sql`update kunde set adresse = coalesce(adresse, ${adresse}) where id = ${vorhanden.id}`;
    return vorhanden;
  }
  const [neu] = await sql<{ id: string }[]>`insert into kunde (betrieb_id, typ, name, steuernummer, adresse, sprache)
    values (${b}, ${typ}, ${name}, ${nif}, ${adresse}, ${sprache}) returning id`;
  return neu!;
}
const mueller = await demoKunde("privat", "Finca Son Vida (Familie Müller)", "12345678Z", "Camí de Son Vida 12, 07013 Palma", "de");
const hotel = await demoKunde("firma", "Hotel Cala Blava S.L.", "B12345674", "Carrer de la Mar 5, 07610 Llucmajor", "es");

const [{ auftraege }] = (await sql`select count(*)::int as auftraege from auftrag where betrieb_id = ${b}`) as unknown as [{ auftraege: number }];
if (auftraege === 0) {
  // Laufende Aufträge seit Anfang des Vormonats: Garten-Pauschale und Hausmeister-Stunden
  const beginn = new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1).toLocaleDateString("sv-SE");
  const [garten] = await sql<{ id: string }[]>`insert into auftrag (betrieb_id, kunde_id, titel, beginn)
    values (${b}, ${mueller!.id}, 'Gartenpflege', ${beginn}) returning id`;
  await sql`insert into auftrag_position (betrieb_id, auftrag_id, pos, art, beschreibung, menge, einheit, preis_cent, iva_satz, stundenkontingent) values
    (${b}, ${garten!.id}, 1, 'pauschale', 'Gartenpflege 2× pro Woche à 3 Stunden', 1, 'Monat', 70000, 21, 26),
    (${b}, ${garten!.id}, 2, 'stunden', 'Zusatzarbeiten nach Aufwand', 0, 'h', 3500, 21, null)`;
  const [service] = await sql<{ id: string }[]>`insert into auftrag (betrieb_id, kunde_id, titel, beginn)
    values (${b}, ${hotel!.id}, 'Mantenimiento', ${beginn}) returning id`;
  await sql`insert into auftrag_position (betrieb_id, auftrag_id, pos, art, beschreibung, menge, einheit, preis_cent, iva_satz)
    values (${b}, ${service!.id}, 1, 'stunden', 'Mantenimiento por horas', 0, 'h', 3800, 21)`;
  await sql`insert into aufgabe (betrieb_id, auftrag_id, titel, erstellt_von, erstellt_von_rolle) values
    (${b}, ${garten!.id}, 'Hecke am Pool schneiden', ${benutzer!.id}, 'inhaber'),
    (${b}, ${service!.id}, 'Revisar riego habitación 12', ${benutzer!.id}, 'inhaber')`;

  // Gearbeitete Stunden im Vormonat: dienstags und freitags je 3 h Garten, montags 2 h Hotel
  const zeiten: { auftrag: string; start: string; minuten: number }[] = [];
  const tag = new Date(beginn + "T00:00:00");
  while (tag.getMonth() === new Date(beginn + "T00:00:00").getMonth()) {
    const datum = tag.toLocaleDateString("sv-SE");
    if (tag.getDay() === 2 || tag.getDay() === 5) zeiten.push({ auftrag: garten!.id, start: `${datum}T08:00:00+01:00`, minuten: 180 });
    if (tag.getDay() === 1) zeiten.push({ auftrag: service!.id, start: `${datum}T14:00:00+01:00`, minuten: 120 });
    tag.setDate(tag.getDate() + 1);
  }
  for (const z of zeiten) {
    await sql`insert into zeiteintrag (betrieb_id, benutzer_id, auftrag_id, start, ende, abrechenbar)
      values (${b}, ${benutzer!.id}, ${z.auftrag}, ${z.start}, ${z.start}::timestamptz + ${z.minuten + " minutes"}::interval,
              ${z.auftrag === service!.id})`;
  }
}
await sql.end();
console.log(`Demo-Daten bereit. Anmelden unter http://localhost:3002 mit ${EMAIL} / ${PASSWORT}`);
