import postgres from "postgres";
import type { Rolle } from "@autonomo/shared";

export type Sql = postgres.Sql;
export type Tx = postgres.TransactionSql;

export function verbindeDb(url: string): Sql {
  return postgres(url, { max: 10, transform: postgres.camel });
}

export interface Kontext {
  benutzerId: string;
  betriebId?: string;
  rolle?: Rolle;
  kundeId?: string | null;
}

/**
 * Führt fn in einer Transaktion aus, in der der Sicherheitskontext für
 * Row-Level-Security gesetzt ist. Alle mandantenbezogenen Zugriffe laufen hierüber.
 */
export async function mitKontext<T>(sql: Sql, kontext: Kontext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return sql.begin(async (tx) => {
    await tx`select
      set_config('app.benutzer_id', ${kontext.benutzerId}, true),
      set_config('app.betrieb_id', ${kontext.betriebId ?? ""}, true),
      set_config('app.rolle', ${kontext.rolle ?? ""}, true),
      set_config('app.kunde_id', ${kontext.kundeId ?? ""}, true)`;
    return fn(tx);
  }) as Promise<T>;
}
