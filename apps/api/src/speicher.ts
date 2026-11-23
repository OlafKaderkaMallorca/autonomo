import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";

/**
 * Dateispeicher. Lokal ein Ordner auf der Festplatte; für den Server später
 * eine S3-kompatible Variante (Hetzner Object Storage) mit derselben Schnittstelle.
 * Schlüssel sind immer „<betriebId>/<art>/<id>.<endung>“, also pro Betrieb getrennt.
 */
export interface Speicher {
  schreibe(schluessel: string, inhalt: Buffer): Promise<void>;
  lese(schluessel: string): Promise<Buffer>;
  loesche(schluessel: string): Promise<void>;
}

export function ordnerSpeicher(ordner: string): Speicher {
  const basis = resolve(ordner);
  const pfad = (schluessel: string) => {
    const p = resolve(basis, schluessel);
    if (!p.startsWith(basis + sep)) throw new Error("Ungültiger Dateischlüssel");
    return p;
  };
  return {
    async schreibe(schluessel, inhalt) {
      const p = pfad(schluessel);
      await mkdir(dirname(p), { recursive: true });
      await writeFile(p, inhalt);
    },
    lese: (schluessel) => readFile(pfad(schluessel)),
    loesche: (schluessel) => rm(pfad(schluessel), { force: true }),
  };
}

/** Nur für Tests: alles im Arbeitsspeicher. */
export function speicherImRam(): Speicher & { dateien: Map<string, Buffer> } {
  const dateien = new Map<string, Buffer>();
  return {
    dateien,
    async schreibe(k, inhalt) {
      dateien.set(k, inhalt);
    },
    async lese(k) {
      const d = dateien.get(k);
      if (!d) throw new Error(`Datei fehlt: ${k}`);
      return d;
    },
    async loesche(k) {
      dateien.delete(k);
    },
  };
}

