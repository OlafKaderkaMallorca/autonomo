import { formatRechnungsnummer } from "@autonomo/shared";
import type { Tx } from "./db.js";

type Art = "rechnung" | "korrektur" | "angebot";

const STANDARD_PRAEFIX: Record<Art, (jahr: number) => string> = {
  rechnung: (j) => `${j}-`,
  korrektur: (j) => `R-${j}-`,
  angebot: (j) => `A-${j}-`,
};

/**
 * Vergibt die nächste Nummer der aktiven Serie. Die Zeile der Serie wird dabei gesperrt,
 * sodass gleichzeitige Freigaben nacheinander laufen. Da alles in derselben Transaktion
 * passiert, entsteht bei einem Fehler auch keine Lücke.
 * Gibt es noch keine Serie, wird eine Standard-Serie für das laufende Jahr angelegt.
 */
export async function naechsteNummer(tx: Tx, betriebId: string, art: Art): Promise<{ serieId: string; nummer: string }> {
  let [serie] = await tx<{ id: string; praefix: string; nummer: number; stellen: number }[]>`
    update rechnungsserie set naechste_nummer = naechste_nummer + 1
    where betrieb_id = ${betriebId} and art = ${art} and aktiv
    returning id, praefix, naechste_nummer - 1 as nummer, stellen`;
  if (!serie) {
    const jahr = Number(new Intl.DateTimeFormat("en", { year: "numeric", timeZone: "Europe/Madrid" }).format(new Date()));
    [serie] = await tx<{ id: string; praefix: string; nummer: number; stellen: number }[]>`
      insert into rechnungsserie (betrieb_id, art, praefix, naechste_nummer)
      values (${betriebId}, ${art}, ${STANDARD_PRAEFIX[art](jahr)}, 2)
      on conflict (betrieb_id, praefix) do update set aktiv = true, naechste_nummer = rechnungsserie.naechste_nummer + 1
      returning id, praefix, naechste_nummer - 1 as nummer, stellen`;
  }
  return { serieId: serie!.id, nummer: formatRechnungsnummer(serie!.praefix, serie!.nummer, serie!.stellen) };
}
