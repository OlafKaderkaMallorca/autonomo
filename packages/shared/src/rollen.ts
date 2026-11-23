/** Rollen eines Benutzers innerhalb eines Betriebs (Mandant). */
export const ROLLEN = ["inhaber", "kunde", "steuerberater"] as const;
export type Rolle = (typeof ROLLEN)[number];

/** Unterstützte Sprachen für App, Portal und Dokumente. */
export const SPRACHEN = ["de", "es", "en"] as const;
export type Sprache = (typeof SPRACHEN)[number];

export function istSprache(wert: unknown): wert is Sprache {
  return typeof wert === "string" && (SPRACHEN as readonly string[]).includes(wert);
}
