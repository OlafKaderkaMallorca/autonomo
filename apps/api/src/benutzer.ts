import type { Sprache } from "@autonomo/shared";
import type { Tx } from "./db.js";

/** Sucht einen Benutzer per E-Mail oder legt ihn (ohne Passwort) an. */
export async function benutzerFuerEmail(
  tx: Tx,
  email: string,
  name: string,
  sprache: Sprache,
): Promise<{ id: string; email: string; sprache: Sprache }> {
  const [b] = await tx<{ id: string; email: string; sprache: Sprache }[]>`
    insert into benutzer (email, name, sprache) values (${email}, ${name}, ${sprache})
    on conflict (email) do update set email = excluded.email
    returning id, email, sprache`;
  return b!;
}

export async function protokolliere(
  tx: Tx,
  eintrag: { betriebId: string; benutzerId: string; aktion: string; objekt: string; objektId?: string; daten?: unknown },
): Promise<void> {
  await tx`insert into aktivitaet (betrieb_id, benutzer_id, aktion, objekt, objekt_id, daten)
    values (${eintrag.betriebId}, ${eintrag.benutzerId}, ${eintrag.aktion}, ${eintrag.objekt},
            ${eintrag.objektId ?? null}, ${eintrag.daten ? tx.json(eintrag.daten as never) : null})`;
}
