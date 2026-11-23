import * as SQLite from "expo-sqlite";
import type { Eintrag, Vorgang, Warteschlange } from "./abgleich-kern";

/**
 * Lokale Datenbank (SQLite): Zwischenspeicher der zuletzt geladenen Daten (für die Anzeige ohne Netz)
 * und die Warteschlange der noch nicht übertragenen Änderungen.
 */
let db: SQLite.SQLiteDatabase | null = null;

async function oeffne(): Promise<SQLite.SQLiteDatabase> {
  if (db) return db;
  const d = await SQLite.openDatabaseAsync("apuntapro.db");
  await d.execAsync(`
    pragma journal_mode = wal;
    create table if not exists zwischenspeicher (schluessel text primary key, json text not null, stand text not null);
    create table if not exists warteschlange (
      nr integer primary key autoincrement,
      betrieb_id text not null,
      vorgang text not null,
      fehler text,
      erstellt_am text not null
    );
  `);
  db = d;
  return d;
}

export async function leseZwischenspeicher<T>(schluessel: string): Promise<{ daten: T; stand: string } | null> {
  const d = await oeffne();
  const z = await d.getFirstAsync<{ json: string; stand: string }>("select json, stand from zwischenspeicher where schluessel = ?", schluessel);
  return z ? { daten: JSON.parse(z.json) as T, stand: z.stand } : null;
}

export async function schreibeZwischenspeicher(schluessel: string, daten: unknown): Promise<void> {
  const d = await oeffne();
  if (daten === null || daten === undefined) {
    await d.runAsync("delete from zwischenspeicher where schluessel = ?", schluessel);
    return;
  }
  await d.runAsync(
    "insert into zwischenspeicher (schluessel, json, stand) values (?, ?, ?) on conflict (schluessel) do update set json = excluded.json, stand = excluded.stand",
    schluessel,
    JSON.stringify(daten),
    new Date().toISOString(),
  );
}

/** Beim Abmelden: Zwischenspeicher leeren. Die Warteschlange bleibt, damit nichts verloren geht. */
export async function leereZwischenspeicher(): Promise<void> {
  const d = await oeffne();
  await d.runAsync("delete from zwischenspeicher");
}

export const sqliteWarteschlange: Warteschlange = {
  async alle() {
    const d = await oeffne();
    const zeilen = await d.getAllAsync<{ nr: number; betrieb_id: string; vorgang: string; fehler: string | null; erstellt_am: string }>(
      "select nr, betrieb_id, vorgang, fehler, erstellt_am from warteschlange order by nr",
    );
    return zeilen.map<Eintrag>((z) => ({
      nr: z.nr,
      betriebId: z.betrieb_id,
      vorgang: JSON.parse(z.vorgang) as Vorgang,
      fehler: z.fehler,
      erstelltAm: z.erstellt_am,
    }));
  },
  async fuegeHinzu(betriebId, vorgang) {
    const d = await oeffne();
    await d.runAsync(
      "insert into warteschlange (betrieb_id, vorgang, erstellt_am) values (?, ?, ?)",
      betriebId,
      JSON.stringify(vorgang),
      new Date().toISOString(),
    );
  },
  async ersetze(nr, vorgang) {
    const d = await oeffne();
    await d.runAsync("update warteschlange set vorgang = ? where nr = ?", JSON.stringify(vorgang), nr);
  },
  async entferne(nr) {
    const d = await oeffne();
    await d.runAsync("delete from warteschlange where nr = ?", nr);
  },
  async setzeFehler(nr, fehler) {
    const d = await oeffne();
    await d.runAsync("update warteschlange set fehler = ? where nr = ?", fehler, nr);
  },
};
