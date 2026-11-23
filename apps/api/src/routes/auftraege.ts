import type { FastifyInstance } from "fastify";
import { auftragSchema, positionSchema } from "@autonomo/shared";
import { z } from "zod";
import type { Deps } from "../app.js";
import { protokolliere } from "../benutzer.js";
import { mitKontext, type Tx } from "../db.js";
import { HttpFehler, validiere } from "../fehler.js";
import { POSITIONS_ZAHLEN, zahlen } from "../positionen.js";

const datum = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const auftragAendernSchema = z.object({
  titel: z.string().trim().min(1).max(200).optional(),
  status: z.enum(["aktiv", "pausiert", "beendet"]).optional(),
  ende: datum.nullish(),
  /** Positionen mit id werden geändert, ohne id neu angelegt; fehlende werden deaktiviert (nie gelöscht, wegen Abrechnungsbezug). */
  positionen: z.array(positionSchema.extend({ id: z.string().uuid().optional(), aktiv: z.boolean().default(true) })).max(200).optional(),
});

async function ladeAuftrag(tx: Tx, auftragId: string) {
  const [a] = await tx`
    select a.id, a.kunde_id, k.name as kunde_name, a.angebot_id, a.titel, a.status, a.beginn, a.ende, a.erstellt_am
    from auftrag a join kunde k on k.id = a.kunde_id where a.id = ${auftragId}`;
  if (!a) return null;
  const positionen = (await tx`
    select id, pos, art, beschreibung, menge, einheit, preis_cent, iva_satz, stundenkontingent, aktiv
    from auftrag_position where auftrag_id = ${auftragId} order by pos`).map((p) => zahlen(p, POSITIONS_ZAHLEN));
  return { ...a, positionen };
}

export async function auftraegeRoutes(app: FastifyInstance, { sql, auth }: Deps) {
  const nurInhaber = { preHandler: [auth.imBetrieb, auth.nurRolle("inhaber")] };
  const lesen = { preHandler: [auth.imBetrieb, auth.nurRolle("inhaber", "kunde")] };

  app.get("/betriebe/:betriebId/auftraege", lesen, async (req) => {
    const q = validiere(
      z.object({ status: z.enum(["aktiv", "pausiert", "beendet"]).optional(), kundeId: z.string().uuid().optional() }),
      req.query,
    );
    return mitKontext(sql, req.kontext!, (tx) => tx`
      select a.id, a.kunde_id, k.name as kunde_name, a.titel, a.status, a.beginn, a.ende,
        (select count(*) from aufgabe g where g.auftrag_id = a.id and g.status <> 'erledigt')::int as offene_aufgaben,
        exists(select 1 from auftrag_position p where p.auftrag_id = a.id and p.aktiv and p.art = 'pauschale') as hat_pauschale,
        exists(select 1 from auftrag_position p where p.auftrag_id = a.id and p.aktiv and p.art = 'stunden') as hat_stunden
      from auftrag a join kunde k on k.id = a.kunde_id
      where (${q.status ?? null}::text is null or a.status = ${q.status ?? null})
        and (${q.kundeId ?? null}::uuid is null or a.kunde_id = ${q.kundeId ?? null})
      order by a.status = 'beendet', k.name, a.titel`);
  });

  app.get("/betriebe/:betriebId/auftraege/:auftragId", lesen, async (req) => {
    const { auftragId } = req.params as { auftragId: string };
    const a = await mitKontext(sql, req.kontext!, (tx) => ladeAuftrag(tx, auftragId));
    if (!a) throw new HttpFehler(404, "Auftrag nicht gefunden");
    return a;
  });

  app.post("/betriebe/:betriebId/auftraege", nurInhaber, async (req, reply) => {
    const e = validiere(auftragSchema, req.body);
    const k = req.kontext!;
    const auftrag = await mitKontext(sql, k, async (tx) => {
      const [kunde] = await tx`select 1 from kunde where id = ${e.kundeId} and not archiviert`;
      if (!kunde) throw new HttpFehler(404, "Kunde nicht gefunden");
      const [neu] = await tx<{ id: string }[]>`
        insert into auftrag (betrieb_id, kunde_id, titel, beginn, ende)
        values (${k.betriebId}, ${e.kundeId}, ${e.titel}, ${e.beginn ?? tx`current_date`}, ${e.ende ?? null})
        returning id`;
      if (e.positionen.length) {
        await tx`insert into auftrag_position ${tx(
          e.positionen.map((p, i) => ({
            betrieb_id: k.betriebId, auftrag_id: neu!.id, pos: i + 1, art: p.art, beschreibung: p.beschreibung,
            menge: p.menge, einheit: p.einheit ?? null, preis_cent: p.preisCent, iva_satz: p.ivaSatz,
            stundenkontingent: p.stundenkontingent ?? null,
          })),
        )}`;
      }
      await protokolliere(tx, { betriebId: k.betriebId, benutzerId: k.benutzerId, aktion: "angelegt", objekt: "auftrag", objektId: neu!.id });
      return ladeAuftrag(tx, neu!.id);
    });
    return reply.code(201).send(auftrag);
  });

  app.patch("/betriebe/:betriebId/auftraege/:auftragId", nurInhaber, async (req) => {
    const { auftragId } = req.params as { auftragId: string };
    const e = validiere(auftragAendernSchema, req.body);
    const k = req.kontext!;
    return mitKontext(sql, k, async (tx) => {
      const [alt] = await tx`select id from auftrag where id = ${auftragId} for update`;
      if (!alt) throw new HttpFehler(404, "Auftrag nicht gefunden");
      const ende = e.status === "beendet" && e.ende === undefined ? tx`coalesce(ende, current_date)` : e.ende === undefined ? tx`ende` : e.ende;
      await tx`update auftrag set
        titel = coalesce(${e.titel ?? null}, titel),
        status = coalesce(${e.status ?? null}, status),
        ende = ${ende},
        geaendert_am = now()
        where id = ${auftragId}`;
      if (e.positionen) {
        const behalten = e.positionen.filter((p) => p.id).map((p) => p.id!);
        await tx`update auftrag_position set aktiv = false where auftrag_id = ${auftragId} and not (id = any(${behalten}::uuid[]))`;
        for (const [i, p] of e.positionen.entries()) {
          const werte = {
            pos: i + 1, art: p.art, beschreibung: p.beschreibung, menge: p.menge, einheit: p.einheit ?? null,
            preis_cent: p.preisCent, iva_satz: p.ivaSatz, stundenkontingent: p.stundenkontingent ?? null, aktiv: p.aktiv,
          };
          if (p.id) {
            const [ok] = await tx`update auftrag_position set ${tx(werte)} where id = ${p.id} and auftrag_id = ${auftragId} returning id`;
            if (!ok) throw new HttpFehler(404, "Position nicht gefunden");
          } else {
            await tx`insert into auftrag_position ${tx({ ...werte, betrieb_id: k.betriebId, auftrag_id: auftragId })}`;
          }
        }
      }
      await protokolliere(tx, { betriebId: k.betriebId, benutzerId: k.benutzerId, aktion: "geaendert", objekt: "auftrag", objektId: auftragId, daten: { titel: e.titel, status: e.status } });
      return ladeAuftrag(tx, auftragId);
    });
  });
}
