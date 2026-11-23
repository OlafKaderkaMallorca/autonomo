import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import postgres from "postgres";

const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../migrations");

/** Spielt alle noch nicht ausgeführten SQL-Migrationen in Dateinamen-Reihenfolge ein. */
export async function migriere(url: string, log: (m: string) => void = console.log): Promise<void> {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await sql`create table if not exists schema_migration (
      name text primary key, ausgefuehrt_am timestamptz not null default now())`;
    const erledigt = new Set((await sql<{ name: string }[]>`select name from schema_migration`).map((r) => r.name));
    const dateien = (await readdir(MIGRATIONS_DIR)).filter((d) => d.endsWith(".sql")).sort();
    for (const datei of dateien) {
      if (erledigt.has(datei)) continue;
      const inhalt = await readFile(path.join(MIGRATIONS_DIR, datei), "utf8");
      await sql.begin(async (tx) => {
        await tx.unsafe(inhalt);
        await tx`insert into schema_migration (name) values (${datei})`;
      });
      log(`Migration ausgeführt: ${datei}`);
    }
  } finally {
    await sql.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error("MIGRATION_DATABASE_URL fehlt");
  await migriere(url);
}
