import type { FastifyReply, FastifyRequest } from "fastify";
import type { Rolle, Sprache } from "@autonomo/shared";
import { mitKontext, type Kontext, type Sql } from "../db.js";
import { HttpFehler } from "../fehler.js";
import { hashToken } from "./tokens.js";

export interface AngemeldeterBenutzer {
  id: string;
  email: string;
  name: string;
  sprache: Sprache;
  plattformAdmin: boolean;
  sitzungId: string;
}

declare module "fastify" {
  interface FastifyRequest {
    benutzer?: AngemeldeterBenutzer;
    kontext?: Kontext & { betriebId: string; rolle: Rolle };
  }
}

export const SITZUNGS_COOKIE = "sitzung";

function leseToken(req: FastifyRequest): string | undefined {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) return header.slice(7).trim();
  return req.cookies?.[SITZUNGS_COOKIE];
}

export function erstelleAuth(sql: Sql, { inaktivTage = 14 }: { inaktivTage?: number } = {}) {
  /** preHandler: verlangt eine gültige Sitzung. */
  async function angemeldet(req: FastifyRequest, _reply: FastifyReply): Promise<void> {
    const token = leseToken(req);
    if (!token) throw new HttpFehler(401, "Nicht angemeldet");
    const [zeile] = await sql<(Omit<AngemeldeterBenutzer, "sitzungId"> & { sitzungId: string; zuletztAktivAm: Date })[]>`
      select b.id, b.email, b.name, b.sprache, b.plattform_admin, s.id as sitzung_id, s.zuletzt_aktiv_am
      from sitzung s join benutzer b on b.id = s.benutzer_id
      where s.token_hash = ${hashToken(token)} and s.laeuft_ab_am > now()
        and s.zuletzt_aktiv_am > now() - make_interval(days => ${inaktivTage})`;
    if (!zeile) throw new HttpFehler(401, "Sitzung abgelaufen", undefined, "sitzung_abgelaufen");
    // Aktivität höchstens alle 5 Minuten schreiben, nicht bei jeder Anfrage
    if (Date.now() - zeile.zuletztAktivAm.getTime() > 5 * 60_000) {
      await sql`update sitzung set zuletzt_aktiv_am = now() where id = ${zeile.sitzungId}`;
    }
    const { zuletztAktivAm: _z, ...benutzer } = zeile;
    req.benutzer = benutzer;
  }

  /** preHandler: verlangt Mitgliedschaft im Betrieb aus :betriebId und setzt den RLS-Kontext. */
  async function imBetrieb(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    await angemeldet(req, reply);
    const betriebId = (req.params as { betriebId?: string }).betriebId;
    if (!betriebId || !/^[0-9a-f-]{36}$/i.test(betriebId)) throw new HttpFehler(404, "Betrieb nicht gefunden");
    const benutzerId = req.benutzer!.id;
    const [m] = await mitKontext(sql, { benutzerId }, (tx) =>
      tx<{ rolle: Rolle; kundeId: string | null; gesperrt: boolean }[]>`
        select m.rolle, m.kunde_id, b.gesperrt from mitgliedschaft m join betrieb b on b.id = m.betrieb_id
        where m.betrieb_id = ${betriebId} and m.benutzer_id = ${benutzerId}`,
    );
    if (!m) throw new HttpFehler(404, "Betrieb nicht gefunden");
    if (m.gesperrt) throw new HttpFehler(423, "Betrieb gesperrt");
    req.kontext = { benutzerId, betriebId, rolle: m.rolle, kundeId: m.kundeId };
  }

  function nurRolle(...rollen: Rolle[]) {
    return async (req: FastifyRequest) => {
      if (!req.kontext || !rollen.includes(req.kontext.rolle)) throw new HttpFehler(403, "Keine Berechtigung");
    };
  }

  async function nurPlattformAdmin(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    await angemeldet(req, reply);
    if (!req.benutzer!.plattformAdmin) throw new HttpFehler(403, "Keine Berechtigung");
  }

  return { angemeldet, imBetrieb, nurRolle, nurPlattformAdmin };
}

export type Auth = ReturnType<typeof erstelleAuth>;
