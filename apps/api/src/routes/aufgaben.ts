import type { FastifyInstance } from "fastify";
import { aufgabeAendernSchema, aufgabeSchema, notizSchema } from "@autonomo/shared";
import { z } from "zod";
import type { Deps } from "../app.js";
import { protokolliere } from "../benutzer.js";
import { mitKontext, type Tx } from "../db.js";
import { HttpFehler, validiere } from "../fehler.js";

const SPALTEN = `g.id, g.auftrag_id, a.titel as auftrag_titel, a.kunde_id, k.name as kunde_name, g.titel, g.beschreibung,
  g.status, g.faellig_am, g.sichtbar_fuer_kunde, g.erstellt_von_rolle, g.erledigt_am, g.erstellt_am, g.geaendert_am`;

async function ladeAufgabe(tx: Tx, aufgabeId: string) {
  const [g] = await tx`select ${tx.unsafe(SPALTEN)} from aufgabe g join auftrag a on a.id = g.auftrag_id
    join kunde k on k.id = a.kunde_id where g.id = ${aufgabeId}`;
  if (!g) return null;
  const notizen = await tx`select n.id, n.text, n.sichtbar_fuer_kunde, n.erstellt_am, u.name as autor
    from aufgabe_notiz n left join benutzer u on u.id = n.benutzer_id
    where n.aufgabe_id = ${aufgabeId} order by n.erstellt_am`;
  return { ...g, notizen };
}

export async function aufgabenRoutes(app: FastifyInstance, { sql, auth }: Deps) {
  const nurInhaber = { preHandler: [auth.imBetrieb, auth.nurRolle("inhaber")] };
  const lesen = { preHandler: [auth.imBetrieb, auth.nurRolle("inhaber", "kunde")] };

  /** Ohne Filter: alle offenen Aufgaben über alle Kunden. */
  app.get("/betriebe/:betriebId/aufgaben", lesen, async (req) => {
    const q = validiere(
      z.object({
        status: z.enum(["offen", "in_arbeit", "erledigt", "nicht_erledigt", "alle"]).default("nicht_erledigt"),
        auftragId: z.string().uuid().optional(),
      }),
      req.query,
    );
    return mitKontext(sql, req.kontext!, (tx) => tx`
      select ${tx.unsafe(SPALTEN)} from aufgabe g join auftrag a on a.id = g.auftrag_id join kunde k on k.id = a.kunde_id
      where (${q.auftragId ?? null}::uuid is null or g.auftrag_id = ${q.auftragId ?? null})
        and (${q.status} = 'alle' or (${q.status} = 'nicht_erledigt' and g.status <> 'erledigt') or g.status = ${q.status})
      order by g.status = 'erledigt', g.faellig_am nulls last, g.erstellt_am desc`);
  });

  app.get("/betriebe/:betriebId/aufgaben/:aufgabeId", lesen, async (req) => {
    const { aufgabeId } = req.params as { aufgabeId: string };
    const g = await mitKontext(sql, req.kontext!, (tx) => ladeAufgabe(tx, aufgabeId));
    if (!g) throw new HttpFehler(404, "Aufgabe nicht gefunden");
    return g;
  });

  app.post("/betriebe/:betriebId/aufgaben", nurInhaber, async (req, reply) => {
    const e = validiere(aufgabeSchema, req.body);
    const k = req.kontext!;
    const g = await mitKontext(sql, k, async (tx) => {
      const [auftrag] = await tx`select 1 from auftrag where id = ${e.auftragId}`;
      if (!auftrag) throw new HttpFehler(404, "Auftrag nicht gefunden");
      if (e.id) {
        // Erneut gesendet (Offline-Abgleich): vorhandene Aufgabe zurückgeben statt doppelt anlegen
        const vorhanden = await ladeAufgabe(tx, e.id);
        if (vorhanden) return vorhanden;
      }
      const [neu] = await tx<{ id: string }[]>`
        insert into aufgabe (id, betrieb_id, auftrag_id, titel, beschreibung, faellig_am, sichtbar_fuer_kunde, erstellt_von, erstellt_von_rolle)
        values (${e.id ?? tx`gen_random_uuid()`}, ${k.betriebId}, ${e.auftragId}, ${e.titel}, ${e.beschreibung ?? null}, ${e.faelligAm ?? null},
                ${e.sichtbarFuerKunde}, ${k.benutzerId}, 'inhaber')
        returning id`;
      await protokolliere(tx, { betriebId: k.betriebId, benutzerId: k.benutzerId, aktion: "angelegt", objekt: "aufgabe", objektId: neu!.id });
      return ladeAufgabe(tx, neu!.id);
    });
    return reply.code(201).send(g);
  });

  app.patch("/betriebe/:betriebId/aufgaben/:aufgabeId", nurInhaber, async (req) => {
    const { aufgabeId } = req.params as { aufgabeId: string };
    const e = validiere(aufgabeAendernSchema, req.body);
    const k = req.kontext!;
    const felder: Record<string, unknown> = Object.fromEntries(
      Object.entries({
        titel: e.titel,
        beschreibung: e.beschreibung,
        faellig_am: e.faelligAm,
        sichtbar_fuer_kunde: e.sichtbarFuerKunde,
        status: e.status,
      }).filter(([, v]) => v !== undefined),
    );
    if (Object.keys(felder).length === 0) throw new HttpFehler(400, "Keine Änderungen");
    return mitKontext(sql, k, async (tx) => {
      if (e.stand) {
        const [alt] = await tx<{ geaendertAm: Date }[]>`select geaendert_am from aufgabe where id = ${aufgabeId} for update`;
        if (!alt) throw new HttpFehler(404, "Aufgabe nicht gefunden");
        if (alt.geaendertAm.getTime() > new Date(e.stand).getTime()) {
          throw new HttpFehler(409, "Die Aufgabe wurde inzwischen woanders geändert", await ladeAufgabe(tx, aufgabeId), "konflikt");
        }
      }
      const [ok] = await tx`update aufgabe set ${tx(felder)}, geaendert_am = now(),
          erledigt_am = case when ${e.status ?? null}::text is null then erledigt_am
                             when ${e.status ?? null} = 'erledigt' then coalesce(erledigt_am, now()) else null end
        where id = ${aufgabeId} returning id`;
      if (!ok) throw new HttpFehler(404, "Aufgabe nicht gefunden");
      await protokolliere(tx, { betriebId: k.betriebId, benutzerId: k.benutzerId, aktion: "geaendert", objekt: "aufgabe", objektId: aufgabeId, daten: felder });
      return ladeAufgabe(tx, aufgabeId);
    });
  });

  app.delete("/betriebe/:betriebId/aufgaben/:aufgabeId", nurInhaber, async (req) => {
    const { aufgabeId } = req.params as { aufgabeId: string };
    const k = req.kontext!;
    await mitKontext(sql, k, async (tx) => {
      const [weg] = await tx`delete from aufgabe where id = ${aufgabeId} returning id`;
      if (!weg) throw new HttpFehler(404, "Aufgabe nicht gefunden");
      await protokolliere(tx, { betriebId: k.betriebId, benutzerId: k.benutzerId, aktion: "geloescht", objekt: "aufgabe", objektId: aufgabeId });
    });
    return { ok: true };
  });

  app.post("/betriebe/:betriebId/aufgaben/:aufgabeId/notizen", nurInhaber, async (req, reply) => {
    const { aufgabeId } = req.params as { aufgabeId: string };
    const e = validiere(notizSchema, req.body);
    const k = req.kontext!;
    const notiz = await mitKontext(sql, k, async (tx) => {
      const [g] = await tx`select 1 from aufgabe where id = ${aufgabeId}`;
      if (!g) throw new HttpFehler(404, "Aufgabe nicht gefunden");
      if (e.id) {
        const [vorhanden] = await tx`select id, text, sichtbar_fuer_kunde, erstellt_am from aufgabe_notiz where id = ${e.id} and aufgabe_id = ${aufgabeId}`;
        if (vorhanden) return vorhanden;
      }
      const [n] = await tx`insert into aufgabe_notiz (id, betrieb_id, aufgabe_id, benutzer_id, text, sichtbar_fuer_kunde)
        values (${e.id ?? tx`gen_random_uuid()`}, ${k.betriebId}, ${aufgabeId}, ${k.benutzerId}, ${e.text}, ${e.sichtbarFuerKunde})
        returning id, text, sichtbar_fuer_kunde, erstellt_am`;
      return n;
    });
    return reply.code(201).send(notiz);
  });
}
