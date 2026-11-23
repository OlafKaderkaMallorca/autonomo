import "server-only";
import { cookies, headers } from "next/headers";
import { istSprache, t as tBasis, type Sprache, type UebersetzungsSchluessel } from "@autonomo/shared";

/** Sprache aus Cookie, sonst aus dem Browser (Accept-Language), sonst Spanisch. */
export async function aktuelleSprache(bevorzugt?: string): Promise<Sprache> {
  if (istSprache(bevorzugt)) return bevorzugt;
  const ausCookie = (await cookies()).get("sprache")?.value;
  if (istSprache(ausCookie)) return ausCookie;
  const browser = (await headers()).get("accept-language") ?? "";
  for (const teil of browser.split(",")) {
    const code = teil.trim().slice(0, 2).toLowerCase();
    if (istSprache(code)) return code;
  }
  return "es";
}

export function uebersetzer(sprache: Sprache) {
  return (schluessel: UebersetzungsSchluessel, werte?: Record<string, string | number>) => tBasis(sprache, schluessel, werte);
}
