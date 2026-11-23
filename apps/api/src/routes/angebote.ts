import type { FastifyInstance } from "fastify";
import { angebotSchema, berechneSummen, type PositionDaten } from "@autonomo/shared";
import { z } from "zod";
import type { Deps } from "../app.js";
import { protokolliere } from "../benutzer.js";
import { mitKontext, type Tx } from "../db.js";
import { HttpFehler, validiere } from "../fehler.js";
import { POSITIONS_ZAHLEN, schreibeAngebotsPositionen, zahlen } from "../positionen.js";
import { naechsteNummer } from "../serien.js";

const SPALTEN = `id, kunde_id, nummer, titel, einleitung, gueltig_bis, status, gesendet_am, geoeffnet_am,
  entschieden_am, ablehnungsgrund, unterschrift_name, erstellt_am, geaendert_am`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function ladeAngebot(tx: Tx, angebotId: string): Promise<Record<string, any> | null> {
  const [angebot] = await tx<Record<string, any>[]>`select ${tx.unsafe(SPALTEN)} from angebot where id = ${angebotId}`;
  if (!angebot) return null;
  const positionen = (await tx`
    select id, pos, art, beschreibung, menge, einheit, preis_cent, iva_satz, stundenkontingent
    from angebot_position where angebot_id = ${angebotId} order by pos`).map((p) => zahlen(p, POSITIONS_ZAHLEN));
  const summen = berechneSummen(positionen as unknown as PositionDaten[]);
  return { ...angebot, positionen, summen };
}

/** Legt aus einem angenommenen Angebot einen Auftrag mit denselben Positionen an. */
export async function auftragAusAngebot(tx: Tx, betriebId: string, angebotId: string): Promise<string> {
  const [a] = await tx<{ kundeId: string; titel: string }[]>`select kunde_id, titel from angebot where id = ${angebotId}`;
  const [auftrag] = await tx<{ id: string }[]>`
    insert into auftrag (betrieb_id, kunde_id, angebot_id, titel)
    values (${betriebId}, ${a!.kundeId}, ${angebotId}, ${a!.titel}) returning id`;
  await tx`insert into auftrag_position (betrieb_id, auftrag_id, pos, art, beschreibung, menge, einheit, preis_cent, iva_satz, stundenkontingent)
    select betrieb_id, ${auftrag!.id}, pos, art, beschreibung, menge, einheit, preis_cent, iva_satz, stundenkontingent
    from angebot_position where angebot_id = ${angebotId}`;
  return auftrag!.id;
}

export async function angeboteRoutes(app: FastifyInstance, { sql, auth }: Deps) {
  const nurInhaber = { preHandler: [auth.imBetrieb, auth.nurRolle("inhaber")] };
  const lesen = { preHandler: [auth.imBetrieb, auth.nurRolle("inhaber", "kunde")] };

  const listeSchema = z.object({
    status: z.enum(["entwurf", "gesendet", "angenommen", "abgelehnt"]).optional(),
    kundeId: z.string().uuid().optional(),
  });

  app.get("/betriebe/:betriebId/angebote", lesen, async (req) => {
    const q = validiere(listeSchema, req.query);
    return mitKontext(sql, req.kontext!, async (tx) => {
      const zeilen = await tx`
        select a.id, a.kunde_id, k.name as kunde_name, a.nummer, a.titel, a.gueltig_bis, a.status, a.erstellt_am,
          coalesce((select sum(round(p.menge * p.preis_cent)) from angebot_position p where p.angebot_id = a.id), 0)::bigint as basis_cent
        from angebot a join kunde k on k.id = a.kunde_id
        where (${q.status ?? null}::text is null or a.status = ${q.status ?? null})
          and (${q.kundeId ?? null}::uuid is null or a.kunde_id = ${q.kundeId ?? null})
        order by a.erstellt_am desc`;
      return zeilen.map((z) => zahlen(z, ["basisCent"]));
    });
  });

  app.get("/betriebe/:betriebId/angebote/:angebotId", lesen, async (req) => {
    const { angebotId } = req.params as { angebotId: string };
    const angebot = await mitKontext(sql, req.kontext!, (tx) => ladeAngebot(tx, angebotId));
    if (!angebot) throw new HttpFehler(404, "Angebot nicht gefunden");
    return angebot;
  });

  app.post("/betriebe/:betriebId/angebote", nurInhaber, async (req, reply) => {
    const e = validiere(angebotSchema, req.body);
    const k = req.kontext!;
    const angebot = await mitKontext(sql, k, async (tx) => {
      const [kunde] = await tx`select 1 from kunde where id = ${e.kundeId} and not archiviert`;
      if (!kunde) throw new HttpFehler(404, "Kunde nicht gefunden");
      const { nummer } = await naechsteNummer(tx, k.betriebId, "angebot");
      const [neu] = await tx<{ id: string }[]>`
        insert into angebot (betrieb_id, kunde_id, nummer, titel, einleitung, gueltig_bis)
        values (${k.betriebId}, ${e.kundeId}, ${nummer}, ${e.titel}, ${e.einleitung ?? null}, ${e.gueltigBis})
        returning id`;
      await schreibeAngebotsPositionen(tx, k.betriebId, neu!.id, e.positionen);
      await protokolliere(tx, { betriebId: k.betriebId, benutzerId: k.benutzerId, aktion: "angelegt", objekt: "angebot", objektId: neu!.id });
      return ladeAngebot(tx, neu!.id);
    });
    return reply.code(201).send(angebot);
  });

  app.put("/betriebe/:betriebId/angebote/:angebotId", nurInhaber, async (req) => {
    const { angebotId } = req.params as { angebotId: string };
    const e = validiere(angebotSchema, req.body);
    const k = req.kontext!;
    return mitKontext(sql, k, async (tx) => {
      const [alt] = await tx<{ status: string }[]>`select status from angebot where id = ${angebotId} for update`;
      if (!alt) throw new HttpFehler(404, "Angebot nicht gefunden");
      if (alt.status !== "entwurf") throw new HttpFehler(409, "Nur Entwürfe können geändert werden", undefined, "nicht_entwurf");
      await tx`update angebot set kunde_id = ${e.kundeId}, titel = ${e.titel}, einleitung = ${e.einleitung ?? null},
        gueltig_bis = ${e.gueltigBis}, geaendert_am = now() where id = ${angebotId}`;
      await schreibeAngebotsPositionen(tx, k.betriebId, angebotId, e.positionen);
      await protokolliere(tx, { betriebId: k.betriebId, benutzerId: k.benutzerId, aktion: "geaendert", objekt: "angebot", objektId: angebotId });
      return ladeAngebot(tx, angebotId);
    });
  });

  app.delete("/betriebe/:betriebId/angebote/:angebotId", nurInhaber, async (req) => {
    const { angebotId } = req.params as { angebotId: string };
    const k = req.kontext!;
    await mitKontext(sql, k, async (tx) => {
      const [weg] = await tx`delete from angebot where id = ${angebotId} and status = 'entwurf' returning id`;
      if (!weg) throw new HttpFehler(409, "Nur Entwürfe können gelöscht werden", undefined, "nicht_entwurf");
      await protokolliere(tx, { betriebId: k.betriebId, benutzerId: k.benutzerId, aktion: "geloescht", objekt: "angebot", objektId: angebotId });
    });
    return { ok: true };
  });

  /** Angebot als Vorlage kopieren, optional für einen anderen Kunden. */
  app.post("/betriebe/:betriebId/angebote/:angebotId/kopie", nurInhaber, async (req, reply) => {
    const { angebotId } = req.params as { angebotId: string };
    const { kundeId, gueltigBis } = validiere(
      z.object({ kundeId: z.string().uuid().optional(), gueltigBis: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }),
      req.body ?? {},
    );
    const k = req.kontext!;
    const kopie = await mitKontext(sql, k, async (tx) => {
      const quelle = await ladeAngebot(tx, angebotId);
      if (!quelle) throw new HttpFehler(404, "Angebot nicht gefunden");
      const { nummer } = await naechsteNummer(tx, k.betriebId, "angebot");
      const [neu] = await tx<{ id: string }[]>`
        insert into angebot (betrieb_id, kunde_id, nummer, titel, einleitung, gueltig_bis)
        values (${k.betriebId}, ${kundeId ?? (quelle.kundeId as string)}, ${nummer}, ${quelle.titel as string},
                ${(quelle.einleitung as string | null) ?? null},
                ${gueltigBis ?? new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10)})
        returning id`;
      await tx`insert into angebot_position (betrieb_id, angebot_id, pos, art, beschreibung, menge, einheit, preis_cent, iva_satz, stundenkontingent)
        select betrieb_id, ${neu!.id}, pos, art, beschreibung, menge, einheit, preis_cent, iva_satz, stundenkontingent
        from angebot_position where angebot_id = ${angebotId}`;
      return ladeAngebot(tx, neu!.id);
    });
    return reply.code(201).send(kopie);
  });

  /**
   * Angebot von Hand als angenommen markieren (z. B. auf Papier unterschrieben).
   * Die Annahme mit Unterschrift im Kundenportal folgt in Phase 2.
   */
  app.post("/betriebe/:betriebId/angebote/:angebotId/angenommen", nurInhaber, async (req) => {
    const { angebotId } = req.params as { angebotId: string };
    const { name } = validiere(z.object({ name: z.string().trim().min(1).max(200) }), req.body);
    const k = req.kontext!;
    return mitKontext(sql, k, async (tx) => {
      const [a] = await tx<{ status: string }[]>`select status from angebot where id = ${angebotId} for update`;
      if (!a) throw new HttpFehler(404, "Angebot nicht gefunden");
      if (a.status === "angenommen" || a.status === "abgelehnt") throw new HttpFehler(409, "Angebot ist schon entschieden", undefined, "schon_entschieden");
      await tx`update angebot set status = 'angenommen', entschieden_am = now(), unterschrift_name = ${name} where id = ${angebotId}`;
      const auftragId = await auftragAusAngebot(tx, k.betriebId, angebotId);
      await protokolliere(tx, { betriebId: k.betriebId, benutzerId: k.benutzerId, aktion: "angenommen", objekt: "angebot", objektId: angebotId, daten: { auftragId, von: "inhaber" } });
      return { auftragId };
    });
  });

  app.post("/betriebe/:betriebId/angebote/:angebotId/abgelehnt", nurInhaber, async (req) => {
    const { angebotId } = req.params as { angebotId: string };
    const { grund } = validiere(z.object({ grund: z.string().max(1000).optional() }), req.body ?? {});
    const k = req.kontext!;
    await mitKontext(sql, k, async (tx) => {
      const [a] = await tx`update angebot set status = 'abgelehnt', entschieden_am = now(), ablehnungsgrund = ${grund ?? null}
        where id = ${angebotId} and status in ('entwurf','gesendet') returning id`;
      if (!a) throw new HttpFehler(409, "Angebot ist schon entschieden", undefined, "schon_entschieden");
      await protokolliere(tx, { betriebId: k.betriebId, benutzerId: k.benutzerId, aktion: "abgelehnt", objekt: "angebot", objektId: angebotId });
    });
    return { ok: true };
  });
}
