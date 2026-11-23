import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { emailSchema, rolleSchema, spracheSchema } from "@autonomo/shared";
import type { Deps } from "../app.js";
import { sendeAnmeldelink } from "../auth/anmeldelink.js";
import { benutzerFuerEmail, protokolliere } from "../benutzer.js";
import { mitKontext } from "../db.js";
import { HttpFehler, validiere } from "../fehler.js";

const einladungSchema = z
  .object({
    email: emailSchema,
    name: z.string().trim().min(2).max(200),
    rolle: rolleSchema,
    sprache: spracheSchema.default("es"),
    kundeId: z.string().uuid().optional(),
  })
  .refine((e) => (e.rolle === "kunde") === Boolean(e.kundeId), {
    message: "kundeId ist genau für die Rolle 'kunde' nötig",
  });

const betriebAendernSchema = z.object({
  name: z.string().trim().min(2).max(200).optional(),
  sprache: spracheSchema.optional(),
});

export async function betriebRoutes(app: FastifyInstance, { sql, config, mail, auth }: Deps) {
  app.get("/betriebe/:betriebId", { preHandler: auth.imBetrieb }, async (req) => {
    const k = req.kontext!;
    const [betrieb] = await mitKontext(sql, k, (tx) =>
      tx`select id, name, nif, sprache from betrieb where id = ${k.betriebId}`,
    );
    return { ...betrieb, meineRolle: k.rolle };
  });

  app.patch("/betriebe/:betriebId", { preHandler: [auth.imBetrieb, auth.nurRolle("inhaber")] }, async (req) => {
    const e = validiere(betriebAendernSchema, req.body);
    const k = req.kontext!;
    return mitKontext(sql, k, async (tx) => {
      const [b] = await tx`update betrieb set
        name = coalesce(${e.name ?? null}, name), sprache = coalesce(${e.sprache ?? null}, sprache)
        where id = ${k.betriebId} returning id, name, nif, sprache`;
      await protokolliere(tx, { betriebId: k.betriebId, benutzerId: k.benutzerId, aktion: "geaendert", objekt: "betrieb", objektId: k.betriebId, daten: e });
      return b;
    });
  });

  app.get("/betriebe/:betriebId/mitglieder", { preHandler: [auth.imBetrieb, auth.nurRolle("inhaber")] }, async (req) => {
    return mitKontext(sql, req.kontext!, (tx) => tx`
      select m.id, m.rolle, m.kunde_id, u.email, u.name
      from mitgliedschaft m join benutzer u on u.id = m.benutzer_id
      where m.betrieb_id = ${req.kontext!.betriebId} order by m.rolle, u.name`);
  });

  /** Kunde oder Steuerberaterin einladen: legt bei Bedarf den Benutzer an und schickt einen Anmeldelink. */
  app.post("/betriebe/:betriebId/einladungen", { preHandler: [auth.imBetrieb, auth.nurRolle("inhaber")] }, async (req, reply) => {
    const e = validiere(einladungSchema, req.body);
    const k = req.kontext!;
    const id = await mitKontext(sql, k, async (tx) => {
      if (e.kundeId) {
        const [kunde] = await tx`select 1 from kunde where id = ${e.kundeId}`;
        if (!kunde) throw new HttpFehler(404, "Kunde nicht gefunden");
      }
      const benutzer = await benutzerFuerEmail(tx, e.email, e.name, e.sprache);
      const [m] = await tx<{ id: string }[]>`
        insert into mitgliedschaft (betrieb_id, benutzer_id, rolle, kunde_id)
        values (${k.betriebId}, ${benutzer.id}, ${e.rolle}, ${e.kundeId ?? null})
        on conflict (betrieb_id, benutzer_id) do nothing returning id`;
      if (!m) throw new HttpFehler(409, "Diese Person ist schon Mitglied");
      await sendeAnmeldelink(tx, config, mail, benutzer);
      await protokolliere(tx, { betriebId: k.betriebId, benutzerId: k.benutzerId, aktion: "eingeladen", objekt: "mitgliedschaft", objektId: m.id, daten: { email: e.email, rolle: e.rolle } });
      return m.id;
    });
    return reply.code(201).send({ id });
  });

  app.delete("/betriebe/:betriebId/mitglieder/:mitgliedId", { preHandler: [auth.imBetrieb, auth.nurRolle("inhaber")] }, async (req) => {
    const { mitgliedId } = req.params as { mitgliedId: string };
    const k = req.kontext!;
    await mitKontext(sql, k, async (tx) => {
      const [m] = await tx`delete from mitgliedschaft where id = ${mitgliedId} and benutzer_id <> ${k.benutzerId} returning id`;
      if (!m) throw new HttpFehler(404, "Mitglied nicht gefunden");
      await protokolliere(tx, { betriebId: k.betriebId, benutzerId: k.benutzerId, aktion: "entfernt", objekt: "mitgliedschaft", objektId: mitgliedId });
    });
    return { ok: true };
  });
}
