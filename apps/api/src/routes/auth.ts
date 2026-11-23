import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  magicLinkAnfrageSchema,
  magicLinkEinloesenSchema,
  passwortLoginSchema,
  passwortSchema,
  spracheSchema,
  type Sprache,
} from "@autonomo/shared";
import type { Deps } from "../app.js";
import { sendeAnmeldelink } from "../auth/anmeldelink.js";
import { DUMMY_HASH_PROMISE, hashePasswort, pruefePasswort } from "../auth/passwort.js";
import { SITZUNGS_COOKIE } from "../auth/plugin.js";
import { hashToken, neuesToken } from "../auth/tokens.js";
import { mitKontext } from "../db.js";
import { HttpFehler, validiere } from "../fehler.js";

export async function authRoutes(app: FastifyInstance, { sql, config, mail, auth }: Deps) {
  async function neueSitzung(benutzerId: string, geraet: string | undefined) {
    const { token, hash } = neuesToken();
    await sql`insert into sitzung (benutzer_id, token_hash, laeuft_ab_am, geraet)
      values (${benutzerId}, ${hash}, now() + make_interval(days => ${config.SITZUNG_TAGE}), ${geraet ?? null})`;
    return token;
  }

  const begrenzt = { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } };

  app.post("/auth/login", begrenzt, async (req) => {
    const { email, passwort } = validiere(passwortLoginSchema, req.body);
    const [b] = await sql<{ id: string; passwortHash: string | null }[]>`
      select id, passwort_hash from benutzer where email = ${email}`;
    const ok = await pruefePasswort(passwort, b?.passwortHash ?? (await DUMMY_HASH_PROMISE));
    if (!b || !b.passwortHash || !ok) throw new HttpFehler(401, "E-Mail oder Passwort falsch");
    return { token: await neueSitzung(b.id, req.headers["user-agent"]) };
  });

  app.post("/auth/magic-link", begrenzt, async (req, reply) => {
    const { email } = validiere(magicLinkAnfrageSchema, req.body);
    const [b] = await sql<{ id: string; email: string; sprache: Sprache }[]>`
      select id, email, sprache from benutzer where email = ${email}`;
    if (b) await sendeAnmeldelink(sql, config, mail, b);
    // Immer gleiche Antwort, damit niemand herausfinden kann, welche Adressen registriert sind.
    return reply.code(202).send({ ok: true });
  });

  app.post("/auth/magic-link/einloesen", begrenzt, async (req) => {
    const { token } = validiere(magicLinkEinloesenSchema, req.body);
    const [lt] = await sql<{ benutzerId: string }[]>`
      update login_token set eingeloest_am = now()
      where token_hash = ${hashToken(token)} and eingeloest_am is null and laeuft_ab_am > now()
      returning benutzer_id`;
    if (!lt) throw new HttpFehler(401, "Link ungültig oder abgelaufen");
    return { token: await neueSitzung(lt.benutzerId, req.headers["user-agent"]) };
  });

  app.post("/auth/logout", { preHandler: auth.angemeldet }, async (req, reply) => {
    await sql`delete from sitzung where id = ${req.benutzer!.sitzungId}`;
    reply.clearCookie(SITZUNGS_COOKIE, { path: "/" });
    return { ok: true };
  });

  app.get("/me", { preHandler: auth.angemeldet }, async (req) => {
    const b = req.benutzer!;
    const betriebe = await mitKontext(sql, { benutzerId: b.id }, (tx) => tx`
      select b.id, b.name, m.rolle, m.kunde_id
      from mitgliedschaft m join betrieb b on b.id = m.betrieb_id
      where m.benutzer_id = ${b.id} and not b.gesperrt
      order by b.name`);
    return {
      id: b.id,
      email: b.email,
      name: b.name,
      sprache: b.sprache,
      plattformAdmin: b.plattformAdmin,
      betriebe,
    };
  });

  const meAendernSchema = z.object({
    name: z.string().trim().min(2).max(200).optional(),
    sprache: spracheSchema.optional(),
    neuesPasswort: passwortSchema.optional(),
  });

  app.patch("/me", { preHandler: auth.angemeldet }, async (req) => {
    const eingabe = validiere(meAendernSchema, req.body);
    const b = req.benutzer!;
    const hash = eingabe.neuesPasswort ? await hashePasswort(eingabe.neuesPasswort) : null;
    await sql`update benutzer set
      name = coalesce(${eingabe.name ?? null}, name),
      sprache = coalesce(${eingabe.sprache ?? null}, sprache),
      passwort_hash = coalesce(${hash}, passwort_hash)
      where id = ${b.id}`;
    if (hash) {
      // Andere Sitzungen abmelden, wenn das Passwort geändert wurde.
      await sql`delete from sitzung where benutzer_id = ${b.id} and id <> ${b.sitzungId}`;
    }
    return { ok: true };
  });
}
