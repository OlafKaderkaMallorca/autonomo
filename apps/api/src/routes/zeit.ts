import type { FastifyInstance } from "fastify";
import { materialSchema, timerStartSchema, zeiteintragSchema } from "@autonomo/shared";
import { z } from "zod";
import type { Deps } from "../app.js";
import { protokolliere } from "../benutzer.js";
import { mitKontext, type Tx } from "../db.js";
import { HttpFehler, validiere } from "../fehler.js";
import { zahlen } from "../positionen.js";

const SPALTEN = `z.id, z.auftrag_id, a.titel as auftrag_titel, a.kunde_id, k.name as kunde_name, z.aufgabe_id,
  z.start, z.ende, round(extract(epoch from (coalesce(z.ende, now()) - z.start)) / 60)::int as dauer_minuten,
  z.notiz, z.abrechenbar, z.rechnung_id, (z.ende is null) as laeuft`;

/** Ohne ausdrückliche Angabe sind Stunden abrechenbar, wenn der Auftrag eine Stunden-Position hat (bei Pauschalen nur Nachweis). */
async function standardAbrechenbar(tx: Tx, auftragId: string): Promise<boolean> {
  const [a] = await tx<{ stunden: boolean }[]>`
    select exists(select 1 from auftrag_position where auftrag_id = ${auftragId} and aktiv and art = 'stunden') as stunden
    from auftrag where id = ${auftragId}`;
  if (!a) throw new HttpFehler(404, "Auftrag nicht gefunden");
  return a.stunden;
}

async function pruefeAufgabe(tx: Tx, auftragId: string, aufgabeId: string | null | undefined) {
  if (!aufgabeId) return;
  const [g] = await tx`select 1 from aufgabe where id = ${aufgabeId} and auftrag_id = ${auftragId}`;
  if (!g) throw new HttpFehler(400, "Aufgabe gehört nicht zu diesem Auftrag", undefined, "aufgabe_falscher_auftrag");
}

async function ladeEintrag(tx: Tx, id: string) {
  const [z] = await tx`select ${tx.unsafe(SPALTEN)} from zeiteintrag z join auftrag a on a.id = z.auftrag_id
    join kunde k on k.id = a.kunde_id where z.id = ${id}`;
  return z ?? null;
}

export async function zeitRoutes(app: FastifyInstance, { sql, auth }: Deps) {
  const nurInhaber = { preHandler: [auth.imBetrieb, auth.nurRolle("inhaber")] };
  const lesen = { preHandler: [auth.imBetrieb, auth.nurRolle("inhaber", "kunde")] };

  const listeSchema = z.object({
    von: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    bis: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    auftragId: z.string().uuid().optional(),
    kundeId: z.string().uuid().optional(),
  });

  app.get("/betriebe/:betriebId/zeiten", lesen, async (req) => {
    const q = validiere(listeSchema, req.query);
    return mitKontext(sql, req.kontext!, (tx) => tx`
      select ${tx.unsafe(SPALTEN)} from zeiteintrag z join auftrag a on a.id = z.auftrag_id join kunde k on k.id = a.kunde_id
      where (${q.von ?? null}::date is null or (z.start at time zone 'Europe/Madrid')::date >= ${q.von ?? null}::date)
        and (${q.bis ?? null}::date is null or (z.start at time zone 'Europe/Madrid')::date <= ${q.bis ?? null}::date)
        and (${q.auftragId ?? null}::uuid is null or z.auftrag_id = ${q.auftragId ?? null})
        and (${q.kundeId ?? null}::uuid is null or a.kunde_id = ${q.kundeId ?? null})
      order by z.start desc`);
  });

  /** Summen je Kunde und Woche bzw. Monat. */
  app.get("/betriebe/:betriebId/zeiten/summen", nurInhaber, async (req) => {
    const q = validiere(z.object({ einheit: z.enum(["woche", "monat"]).default("monat"), von: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), bis: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }), req.query);
    const zeilen = await mitKontext(sql, req.kontext!, (tx) => tx`
      select to_char(date_trunc(${q.einheit === "woche" ? "week" : "month"}, z.start at time zone 'Europe/Madrid'), 'YYYY-MM-DD') as zeitraum,
        a.kunde_id, k.name as kunde_name,
        round(sum(extract(epoch from (z.ende - z.start))) / 60)::int as minuten,
        round(sum(extract(epoch from (z.ende - z.start))) filter (where z.abrechenbar) / 60)::int as abrechenbar_minuten
      from zeiteintrag z join auftrag a on a.id = z.auftrag_id join kunde k on k.id = a.kunde_id
      where z.ende is not null
        and (z.start at time zone 'Europe/Madrid')::date between ${q.von}::date and ${q.bis}::date
      group by 1, 2, 3 order by 1, 3`);
    return zeilen.map((z) => zahlen(z, ["abrechenbarMinuten"]));
  });

  app.post("/betriebe/:betriebId/zeiten", nurInhaber, async (req, reply) => {
    const e = validiere(zeiteintragSchema, req.body);
    const k = req.kontext!;
    if (!e.ende && !e.dauerMinuten) throw new HttpFehler(400, "Ende oder Dauer angeben (für laufende Zeit den Timer nutzen)", undefined, "ende_fehlt");
    const start = new Date(e.start);
    const ende = e.ende ? new Date(e.ende) : new Date(start.getTime() + e.dauerMinuten! * 60000);
    if (ende <= start) throw new HttpFehler(400, "Ende muss nach dem Start liegen", undefined, "ende_vor_start");
    const eintrag = await mitKontext(sql, k, async (tx) => {
      const abrechenbar = e.abrechenbar ?? (await standardAbrechenbar(tx, e.auftragId));
      await pruefeAufgabe(tx, e.auftragId, e.aufgabeId);
      const [neu] = await tx<{ id: string }[]>`
        insert into zeiteintrag (betrieb_id, auftrag_id, aufgabe_id, benutzer_id, start, ende, notiz, abrechenbar)
        values (${k.betriebId}, ${e.auftragId}, ${e.aufgabeId ?? null}, ${k.benutzerId}, ${start}, ${ende}, ${e.notiz ?? null}, ${abrechenbar})
        returning id`;
      return ladeEintrag(tx, neu!.id);
    });
    return reply.code(201).send(eintrag);
  });

  app.get("/betriebe/:betriebId/timer", nurInhaber, async (req) => {
    const k = req.kontext!;
    const [t] = await mitKontext(sql, k, (tx) => tx`
      select ${tx.unsafe(SPALTEN)} from zeiteintrag z join auftrag a on a.id = z.auftrag_id join kunde k on k.id = a.kunde_id
      where z.ende is null and z.benutzer_id = ${k.benutzerId}`);
    return { timer: t ?? null };
  });

  app.post("/betriebe/:betriebId/timer/start", nurInhaber, async (req, reply) => {
    const e = validiere(timerStartSchema, req.body);
    const k = req.kontext!;
    const t = await mitKontext(sql, k, async (tx) => {
      const [laeuft] = await tx`select id from zeiteintrag where ende is null and benutzer_id = ${k.benutzerId}`;
      if (laeuft) throw new HttpFehler(409, "Es läuft schon ein Timer", { id: laeuft.id }, "timer_laeuft");
      const abrechenbar = await standardAbrechenbar(tx, e.auftragId);
      await pruefeAufgabe(tx, e.auftragId, e.aufgabeId);
      const [neu] = await tx<{ id: string }[]>`
        insert into zeiteintrag (betrieb_id, auftrag_id, aufgabe_id, benutzer_id, start, notiz, abrechenbar)
        values (${k.betriebId}, ${e.auftragId}, ${e.aufgabeId ?? null}, ${k.benutzerId}, now(), ${e.notiz ?? null}, ${abrechenbar})
        returning id`;
      return ladeEintrag(tx, neu!.id);
    });
    return reply.code(201).send(t);
  });

  app.post("/betriebe/:betriebId/timer/stopp", nurInhaber, async (req) => {
    const { notiz } = validiere(z.object({ notiz: z.string().max(2000).optional() }), req.body ?? {});
    const k = req.kontext!;
    return mitKontext(sql, k, async (tx) => {
      // Mindestens eine Minute, damit ende > start gilt
      const [t] = await tx<{ id: string }[]>`
        update zeiteintrag set ende = greatest(now(), start + interval '1 minute'), notiz = coalesce(${notiz ?? null}, notiz), geaendert_am = now()
        where ende is null and benutzer_id = ${k.benutzerId} returning id`;
      if (!t) throw new HttpFehler(404, "Es läuft kein Timer", undefined, "kein_timer");
      return ladeEintrag(tx, t.id);
    });
  });

  const aendernSchema = z.object({
    start: z.string().datetime({ offset: true }).optional(),
    ende: z.string().datetime({ offset: true }).optional(),
    notiz: z.string().max(2000).nullish(),
    abrechenbar: z.boolean().optional(),
    aufgabeId: z.string().uuid().nullish(),
  });

  app.patch("/betriebe/:betriebId/zeiten/:zeitId", nurInhaber, async (req) => {
    const { zeitId } = req.params as { zeitId: string };
    const e = validiere(aendernSchema, req.body);
    const k = req.kontext!;
    return mitKontext(sql, k, async (tx) => {
      const [alt] = await tx<{ auftragId: string; ende: Date | null }[]>`select auftrag_id, ende from zeiteintrag where id = ${zeitId}`;
      if (!alt) throw new HttpFehler(404, "Eintrag nicht gefunden");
      if (e.aufgabeId) await pruefeAufgabe(tx, alt.auftragId, e.aufgabeId);
      const felder = Object.fromEntries(
        Object.entries({
          start: e.start ? new Date(e.start) : undefined,
          ende: e.ende ? new Date(e.ende) : undefined,
          notiz: e.notiz,
          abrechenbar: e.abrechenbar,
          aufgabe_id: e.aufgabeId,
        }).filter(([, v]) => v !== undefined),
      );
      if (Object.keys(felder).length === 0) throw new HttpFehler(400, "Keine Änderungen");
      await tx`update zeiteintrag set ${tx(felder)}, geaendert_am = now() where id = ${zeitId}`;
      await protokolliere(tx, { betriebId: k.betriebId, benutzerId: k.benutzerId, aktion: "geaendert", objekt: "zeiteintrag", objektId: zeitId });
      return ladeEintrag(tx, zeitId);
    });
  });

  app.delete("/betriebe/:betriebId/zeiten/:zeitId", nurInhaber, async (req) => {
    const { zeitId } = req.params as { zeitId: string };
    const k = req.kontext!;
    await mitKontext(sql, k, async (tx) => {
      const [weg] = await tx`delete from zeiteintrag where id = ${zeitId} returning id`;
      if (!weg) throw new HttpFehler(404, "Eintrag nicht gefunden");
      await protokolliere(tx, { betriebId: k.betriebId, benutzerId: k.benutzerId, aktion: "geloescht", objekt: "zeiteintrag", objektId: zeitId });
    });
    return { ok: true };
  });

  // Material, das am Monatsende mit abgerechnet wird
  app.get("/betriebe/:betriebId/material", nurInhaber, async (req) => {
    const q = validiere(z.object({ auftragId: z.string().uuid().optional(), offen: z.enum(["ja", "nein"]).optional() }), req.query);
    const zeilen = await mitKontext(sql, req.kontext!, (tx) => tx`
      select m.id, m.auftrag_id, a.titel as auftrag_titel, m.datum, m.beschreibung, m.menge, m.einheit, m.preis_cent, m.iva_satz, m.rechnung_id
      from material m join auftrag a on a.id = m.auftrag_id
      where (${q.auftragId ?? null}::uuid is null or m.auftrag_id = ${q.auftragId ?? null})
        and (${q.offen ?? null}::text is null or (m.rechnung_id is null) = (${q.offen ?? null} = 'ja'))
      order by m.datum desc`);
    return zeilen.map((z) => zahlen(z, ["menge", "preisCent", "ivaSatz"]));
  });

  app.post("/betriebe/:betriebId/material", nurInhaber, async (req, reply) => {
    const e = validiere(materialSchema, req.body);
    const k = req.kontext!;
    const m = await mitKontext(sql, k, async (tx) => {
      const [a] = await tx<{ standardIva: string }[]>`select b.standard_iva from auftrag a join betrieb b on b.id = a.betrieb_id where a.id = ${e.auftragId}`;
      if (!a) throw new HttpFehler(404, "Auftrag nicht gefunden");
      const [neu] = await tx`insert into material (betrieb_id, auftrag_id, datum, beschreibung, menge, einheit, preis_cent, iva_satz)
        values (${k.betriebId}, ${e.auftragId}, ${e.datum ?? tx`current_date`}, ${e.beschreibung}, ${e.menge}, ${e.einheit ?? null},
                ${e.preisCent}, ${e.ivaSatz ?? Number(a.standardIva)})
        returning id, auftrag_id, datum, beschreibung, menge, einheit, preis_cent, iva_satz, rechnung_id`;
      return zahlen(neu!, ["menge", "preisCent", "ivaSatz"]);
    });
    return reply.code(201).send(m);
  });

  app.delete("/betriebe/:betriebId/material/:materialId", nurInhaber, async (req) => {
    const { materialId } = req.params as { materialId: string };
    const [weg] = await mitKontext(sql, req.kontext!, (tx) => tx`delete from material where id = ${materialId} returning id`);
    if (!weg) throw new HttpFehler(404, "Material nicht gefunden");
    return { ok: true };
  });
}
