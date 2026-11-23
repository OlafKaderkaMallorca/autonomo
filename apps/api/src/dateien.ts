import { createHash, randomUUID } from "node:crypto";
import type { Tx } from "./db.js";
import { HttpFehler } from "./fehler.js";
import type { Speicher } from "./speicher.js";

export type DateiArt = "foto" | "foto_klein" | "pdf" | "logo";

const ENDUNG: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

export const sha256 = (inhalt: Buffer) => createHash("sha256").update(inhalt).digest("hex");

/** Legt den Inhalt im Speicher ab und die Metadaten in der Datenbank (im Kontext des Betriebs). */
export async function speichereDatei(
  tx: Tx,
  speicher: Speicher,
  d: { betriebId: string; art: DateiArt; inhalt: Buffer; mime: string; benutzerId?: string | null },
): Promise<{ id: string; sha256: string }> {
  const id = randomUUID();
  const schluessel = `${d.betriebId}/${d.art}/${id}.${ENDUNG[d.mime] ?? "bin"}`;
  const hash = sha256(d.inhalt);
  await speicher.schreibe(schluessel, d.inhalt);
  await tx`insert into datei (id, betrieb_id, art, schluessel, mime, groesse, sha256, erstellt_von)
    values (${id}, ${d.betriebId}, ${d.art}, ${schluessel}, ${d.mime}, ${d.inhalt.length}, ${hash}, ${d.benutzerId ?? null})`;
  return { id, sha256: hash };
}

/** Liest eine Datei, sofern der aktuelle Kontext sie sehen darf (Row-Level-Security). */
export async function ladeDatei(tx: Tx, speicher: Speicher, id: string): Promise<{ inhalt: Buffer; mime: string; sha256: string }> {
  const [d] = await tx<{ schluessel: string; mime: string; sha256: string }[]>`select schluessel, mime, sha256 from datei where id = ${id}`;
  if (!d) throw new HttpFehler(404, "Datei nicht gefunden");
  return { inhalt: await speicher.lese(d.schluessel), mime: d.mime, sha256: d.sha256 };
}

/** Entfernt Datei-Eintrag und Inhalt. Der Inhalt wird erst nach erfolgreichem Löschen des Eintrags entfernt. */
export async function loescheDateien(tx: Tx, speicher: Speicher, ids: string[]): Promise<() => Promise<void>> {
  const zeilen = await tx<{ schluessel: string }[]>`delete from datei where id = any(${ids}::uuid[]) returning schluessel`;
  return async () => {
    for (const z of zeilen) await speicher.loesche(z.schluessel).catch(() => {});
  };
}
