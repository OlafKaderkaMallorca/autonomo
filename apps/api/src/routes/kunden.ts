import type { FastifyInstance } from "fastify";
import { istGueltigeSpanischeSteuernummer, kontaktSchema, kundeErweitertSchema as kundeSchema } from "@autonomo/shared";
import { z } from "zod";
import type { Deps } from "../app.js";
import { protokolliere } from "../benutzer.js";
import { mitKontext } from "../db.js";
import { HttpFehler, validiere } from "../fehler.js";

const SPALTEN = "id, typ, name, steuernummer, email, telefon, sprache, irpf, adresse, notizen, archiviert, erstellt_am, geaendert_am";

function pruefeIrpf(typ: string | undefined, irpf: boolean | undefined) {
  if (irpf && typ !== "firma") throw new HttpFehler(400, "IRPF-Einbehalt ist nur bei Firmenkunden möglich", undefined, "irpf_nur_firma");
}

function pruefeSteuernummer(nr: string | null | undefined) {
  if (nr && !istGueltigeSpanischeSteuernummer(nr)) throw new HttpFehler(400, "NIF/NIE/CIF ist ungültig");
}

export async function kundenRoutes(app: FastifyInstance, { sql, auth }: Deps) {
  const lesen = { preHandler: auth.imBetrieb };
  const schreiben = { preHandler: [auth.imBetrieb, auth.nurRolle("inhaber")] };

  // Die Sichtbarkeit (Kunde sieht nur sich selbst) erzwingt die Datenbank per RLS.
  const listeSchema = z.object({ suche: z.string().max(100).optional(), archiviert: z.enum(["ja", "nein", "alle"]).default("nein") });

  app.get("/betriebe/:betriebId/kunden", lesen, async (req) => {
    const { suche, archiviert } = validiere(listeSchema, req.query);
    const muster = suche ? `%${suche.replace(/[%_\\]/g, (z) => `\\${z}`)}%` : null;
    return mitKontext(sql, req.kontext!, (tx) => tx`
      select ${tx.unsafe(SPALTEN)} from kunde
      where (${archiviert} = 'alle' or archiviert = ${archiviert === "ja"})
        and (${muster}::text is null or name ilike ${muster} or steuernummer ilike ${muster} or email ilike ${muster})
      order by name`);
  });

  app.get("/betriebe/:betriebId/kunden/:kundeId", lesen, async (req) => {
    const { kundeId } = req.params as { kundeId: string };
    const [k] = await mitKontext(sql, req.kontext!, (tx) =>
      tx`select ${tx.unsafe(SPALTEN)} from kunde where id = ${kundeId}`,
    );
    if (!k) throw new HttpFehler(404, "Kunde nicht gefunden");
    return k;
  });

  app.post("/betriebe/:betriebId/kunden", schreiben, async (req, reply) => {
    const e = validiere(kundeSchema, req.body);
    pruefeSteuernummer(e.steuernummer);
    pruefeIrpf(e.typ, e.irpf);
    const k = req.kontext!;
    const kunde = await mitKontext(sql, k, async (tx) => {
      const [neu] = await tx<{ id: string }[]>`
        insert into kunde (betrieb_id, typ, name, steuernummer, email, telefon, sprache, irpf, adresse, notizen)
        values (${k.betriebId}, ${e.typ}, ${e.name}, ${e.steuernummer ?? null}, ${e.email ?? null}, ${e.telefon ?? null},
                ${e.sprache}, ${e.irpf}, ${e.adresse ?? null}, ${e.notizen ?? null})
        returning ${tx.unsafe(SPALTEN)}`;
      await protokolliere(tx, { betriebId: k.betriebId, benutzerId: k.benutzerId, aktion: "angelegt", objekt: "kunde", objektId: neu!.id });
      return neu;
    });
    return reply.code(201).send(kunde);
  });

  app.patch("/betriebe/:betriebId/kunden/:kundeId", schreiben, async (req) => {
    const { kundeId } = req.params as { kundeId: string };
    const e = validiere(kundeSchema.partial(), req.body);
    pruefeSteuernummer(e.steuernummer);
    const k = req.kontext!;
    return mitKontext(sql, k, async (tx) => {
      if (e.irpf !== undefined || e.typ !== undefined) {
        const [alt] = await tx<{ typ: string; irpf: boolean }[]>`select typ, irpf from kunde where id = ${kundeId}`;
        if (alt) pruefeIrpf(e.typ ?? alt.typ, e.irpf ?? (e.typ === "privat" ? false : alt.irpf));
        if (e.typ === "privat") e.irpf = false;
      }
      const felder = Object.fromEntries(Object.entries(e).filter(([, v]) => v !== undefined));
      if (Object.keys(felder).length === 0) throw new HttpFehler(400, "Keine Änderungen");
      const [geaendert] = await tx`
        update kunde set ${tx(felder)}, geaendert_am = now() where id = ${kundeId}
        returning ${tx.unsafe(SPALTEN)}`;
      if (!geaendert) throw new HttpFehler(404, "Kunde nicht gefunden");
      await protokolliere(tx, { betriebId: k.betriebId, benutzerId: k.benutzerId, aktion: "geaendert", objekt: "kunde", objektId: kundeId, daten: felder });
      return geaendert;
    });
  });

  app.delete("/betriebe/:betriebId/kunden/:kundeId", schreiben, async (req) => {
    const { kundeId } = req.params as { kundeId: string };
    const k = req.kontext!;
    await mitKontext(sql, k, async (tx) => {
      const [benutzt] = await tx`select 1 from auftrag where kunde_id = ${kundeId}
        union all select 1 from angebot where kunde_id = ${kundeId}
        union all select 1 from rechnung where kunde_id = ${kundeId} limit 1`;
      if (benutzt) throw new HttpFehler(409, "Kunde hat Angebote, Aufträge oder Rechnungen. Bitte archivieren statt löschen.", undefined, "kunde_benutzt");
      const [weg] = await tx`delete from kunde where id = ${kundeId} returning id`;
      if (!weg) throw new HttpFehler(404, "Kunde nicht gefunden");
      await protokolliere(tx, { betriebId: k.betriebId, benutzerId: k.benutzerId, aktion: "geloescht", objekt: "kunde", objektId: kundeId });
    });
    return { ok: true };
  });

  // Kontaktpersonen
  app.get("/betriebe/:betriebId/kunden/:kundeId/kontakte", lesen, async (req) => {
    const { kundeId } = req.params as { kundeId: string };
    return mitKontext(sql, req.kontext!, (tx) => tx`
      select id, name, email, telefon, funktion from kontakt where kunde_id = ${kundeId} order by name`);
  });

  app.post("/betriebe/:betriebId/kunden/:kundeId/kontakte", schreiben, async (req, reply) => {
    const { kundeId } = req.params as { kundeId: string };
    const e = validiere(kontaktSchema, req.body);
    const k = req.kontext!;
    const kontakt = await mitKontext(sql, k, async (tx) => {
      const [kunde] = await tx`select 1 from kunde where id = ${kundeId}`;
      if (!kunde) throw new HttpFehler(404, "Kunde nicht gefunden");
      const [neu] = await tx`insert into kontakt (betrieb_id, kunde_id, name, email, telefon, funktion)
        values (${k.betriebId}, ${kundeId}, ${e.name}, ${e.email ?? null}, ${e.telefon ?? null}, ${e.funktion ?? null})
        returning id, name, email, telefon, funktion`;
      return neu;
    });
    return reply.code(201).send(kontakt);
  });

  app.delete("/betriebe/:betriebId/kunden/:kundeId/kontakte/:kontaktId", schreiben, async (req) => {
    const { kontaktId } = req.params as { kontaktId: string };
    const [weg] = await mitKontext(sql, req.kontext!, (tx) => tx`delete from kontakt where id = ${kontaktId} returning id`);
    if (!weg) throw new HttpFehler(404, "Kontakt nicht gefunden");
    return { ok: true };
  });
}
