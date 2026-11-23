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
import { hashNotfallcode, neueNotfallcodes, neuesTotpGeheimnis, otpauthUrl, pruefeTotp } from "../auth/totp.js";
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

  /**
   * Prüft den zweiten Faktor, falls eingeschaltet: TOTP-Code (nicht zweimal im selben Zeitfenster)
   * oder ein Notfallcode (wird dabei verbraucht). Wirft 401 mit code „zweiter_faktor“ bzw. „code_falsch“.
   */
  async function pruefeZweitenFaktor(benutzerId: string, code: string | undefined): Promise<void> {
    const [b] = await sql<{ totpGeheimnis: string | null; totpAktivSeit: Date | null; totpLetztesFenster: string | null }[]>`
      select totp_geheimnis, totp_aktiv_seit, totp_letztes_fenster from benutzer where id = ${benutzerId}`;
    if (!b?.totpAktivSeit || !b.totpGeheimnis) return;
    if (!code) throw new HttpFehler(401, "Bitte den Code aus der Authenticator-App eingeben", undefined, "zweiter_faktor");
    const fenster = pruefeTotp(b.totpGeheimnis, code);
    if (fenster !== null) {
      const [ok] = await sql`update benutzer set totp_letztes_fenster = ${fenster}
        where id = ${benutzerId} and (totp_letztes_fenster is null or totp_letztes_fenster < ${fenster}) returning id`;
      if (ok) return;
    } else if (!/^\d{6}$/.test(code)) {
      const hash = hashNotfallcode(code);
      const [ok] = await sql`update benutzer set totp_notfallcodes = array_remove(totp_notfallcodes, ${hash})
        where id = ${benutzerId} and ${hash} = any(totp_notfallcodes) returning id`;
      if (ok) return;
    }
    throw new HttpFehler(401, "Code falsch oder schon verwendet", undefined, "code_falsch");
  }

  app.post("/auth/login", begrenzt, async (req) => {
    const { email, passwort, code } = validiere(passwortLoginSchema, req.body);
    const [b] = await sql<{ id: string; passwortHash: string | null }[]>`
      select id, passwort_hash from benutzer where email = ${email}`;
    const ok = await pruefePasswort(passwort, b?.passwortHash ?? (await DUMMY_HASH_PROMISE));
    if (!b || !b.passwortHash || !ok) throw new HttpFehler(401, "E-Mail oder Passwort falsch");
    await pruefeZweitenFaktor(b.id, code);
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
    const { token, code } = validiere(magicLinkEinloesenSchema, req.body);
    const [offen] = await sql<{ benutzerId: string }[]>`
      select benutzer_id from login_token where token_hash = ${hashToken(token)} and eingeloest_am is null and laeuft_ab_am > now()`;
    if (!offen) throw new HttpFehler(401, "Link ungültig oder abgelaufen");
    // Zweiter Faktor vor dem Einlösen, damit der Link bei fehlendem Code gültig bleibt
    await pruefeZweitenFaktor(offen.benutzerId, code);
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

  /** Auf allen Geräten abmelden (z. B. wenn das Handy verloren ging). */
  app.post("/auth/logout-alle", { preHandler: auth.angemeldet }, async (req, reply) => {
    await sql`delete from sitzung where benutzer_id = ${req.benutzer!.id}`;
    reply.clearCookie(SITZUNGS_COOKIE, { path: "/" });
    return { ok: true };
  });

  // --- Zwei-Faktor-Anmeldung (TOTP) ----------------------------------------------------------

  app.post("/me/2fa/einrichten", { ...begrenzt, preHandler: auth.angemeldet }, async (req) => {
    const b = req.benutzer!;
    const [z] = await sql<{ totpAktivSeit: Date | null }[]>`select totp_aktiv_seit from benutzer where id = ${b.id}`;
    if (z?.totpAktivSeit) throw new HttpFehler(409, "Zwei-Faktor-Anmeldung ist schon eingeschaltet", undefined, "2fa_aktiv");
    const geheimnis = neuesTotpGeheimnis();
    await sql`update benutzer set totp_geheimnis = ${geheimnis}, totp_notfallcodes = '{}', totp_letztes_fenster = null where id = ${b.id}`;
    return { geheimnis, otpauthUrl: otpauthUrl(geheimnis, b.email) };
  });

  app.post("/me/2fa/aktivieren", { ...begrenzt, preHandler: auth.angemeldet }, async (req) => {
    const { code } = validiere(z.object({ code: z.string().trim().regex(/^\d{6}$/) }), req.body);
    const b = req.benutzer!;
    const [z1] = await sql<{ totpGeheimnis: string | null; totpAktivSeit: Date | null }[]>`
      select totp_geheimnis, totp_aktiv_seit from benutzer where id = ${b.id}`;
    if (z1?.totpAktivSeit) throw new HttpFehler(409, "Zwei-Faktor-Anmeldung ist schon eingeschaltet", undefined, "2fa_aktiv");
    if (!z1?.totpGeheimnis) throw new HttpFehler(400, "Bitte zuerst einrichten", undefined, "2fa_nicht_eingerichtet");
    const fenster = pruefeTotp(z1.totpGeheimnis, code);
    if (fenster === null) throw new HttpFehler(400, "Code falsch", undefined, "code_falsch");
    const notfallcodes = neueNotfallcodes();
    await sql`update benutzer set totp_aktiv_seit = now(), totp_letztes_fenster = ${fenster},
      totp_notfallcodes = ${notfallcodes.map(hashNotfallcode)}::bytea[] where id = ${b.id}`;
    // Andere Geräte müssen sich neu anmelden – jetzt mit Code
    await sql`delete from sitzung where benutzer_id = ${b.id} and id <> ${b.sitzungId}`;
    return { notfallcodes };
  });

  app.post("/me/2fa/ausschalten", { ...begrenzt, preHandler: auth.angemeldet }, async (req) => {
    const { code } = validiere(z.object({ code: z.string().trim().min(6).max(20) }), req.body);
    const b = req.benutzer!;
    await pruefeZweitenFaktor(b.id, code);
    await sql`update benutzer set totp_geheimnis = null, totp_aktiv_seit = null, totp_notfallcodes = '{}', totp_letztes_fenster = null
      where id = ${b.id}`;
    return { ok: true };
  });

  app.get("/me", { preHandler: auth.angemeldet }, async (req) => {
    const b = req.benutzer!;
    const betriebe = await mitKontext(sql, { benutzerId: b.id }, (tx) => tx`
      select b.id, b.name, m.rolle, m.kunde_id
      from mitgliedschaft m join betrieb b on b.id = m.betrieb_id
      where m.benutzer_id = ${b.id} and not b.gesperrt
      order by b.name`);
    const [zf] = await sql<{ totpAktivSeit: Date | null }[]>`select totp_aktiv_seit from benutzer where id = ${b.id}`;
    return {
      id: b.id,
      email: b.email,
      name: b.name,
      sprache: b.sprache,
      plattformAdmin: b.plattformAdmin,
      zweiFaktor: zf?.totpAktivSeit != null,
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
