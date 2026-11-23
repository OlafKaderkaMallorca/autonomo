import type { FastifyInstance } from "fastify";
import { istGueltigeSpanischeSteuernummer, kundeSchema } from "@autonomo/shared";
import type { Deps } from "../app.js";
import { protokolliere } from "../benutzer.js";
import { mitKontext } from "../db.js";
import { HttpFehler, validiere } from "../fehler.js";

const SPALTEN = "id, typ, name, steuernummer, email, sprache, irpf, adresse, notizen, erstellt_am, geaendert_am";

function pruefeSteuernummer(nr: string | undefined) {
  if (nr && !istGueltigeSpanischeSteuernummer(nr)) throw new HttpFehler(400, "NIF/NIE/CIF ist ungültig");
}

export async function kundenRoutes(app: FastifyInstance, { sql, auth }: Deps) {
  const lesen = { preHandler: auth.imBetrieb };
  const schreiben = { preHandler: [auth.imBetrieb, auth.nurRolle("inhaber")] };

  // Die Sichtbarkeit (Kunde sieht nur sich selbst) erzwingt die Datenbank per RLS.
  app.get("/betriebe/:betriebId/kunden", lesen, async (req) =>
    mitKontext(sql, req.kontext!, (tx) => tx`select ${tx.unsafe(SPALTEN)} from kunde order by name`),
  );

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
    const k = req.kontext!;
    const kunde = await mitKontext(sql, k, async (tx) => {
      const [neu] = await tx<{ id: string }[]>`
        insert into kunde (betrieb_id, typ, name, steuernummer, email, sprache, irpf, adresse, notizen)
        values (${k.betriebId}, ${e.typ}, ${e.name}, ${e.steuernummer ?? null}, ${e.email ?? null},
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
      const [weg] = await tx`delete from kunde where id = ${kundeId} returning id`;
      if (!weg) throw new HttpFehler(404, "Kunde nicht gefunden");
      await protokolliere(tx, { betriebId: k.betriebId, benutzerId: k.benutzerId, aktion: "geloescht", objekt: "kunde", objektId: kundeId });
    });
    return { ok: true };
  });
}
