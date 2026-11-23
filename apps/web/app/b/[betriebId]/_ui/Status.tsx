import type { UebersetzungsSchluessel } from "@autonomo/shared";

/** Farbiges Etikett für einen Status (Entwurf, gesendet, bezahlt …). */
export function Status({ status, t }: { status: string; t: (k: UebersetzungsSchluessel) => string }) {
  return <span className={`etikett etikett-${status}`}>{t(`status.${status}` as UebersetzungsSchluessel)}</span>;
}
