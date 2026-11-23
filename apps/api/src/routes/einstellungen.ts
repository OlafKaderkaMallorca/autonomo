import type { FastifyInstance } from "fastify";
import { betriebEinstellungenSchema, serieSchema } from "@autonomo/shared";
import { z } from "zod";
import type { Deps } from "../app.js";
import { protokolliere } from "../benutzer.js";
import { mitKontext } from "../db.js";
import { HttpFehler, validiere } from "../fehler.js";
import { zahlen } from "../positionen.js";

const BETRIEB_SPALTEN =
  "id, name, nif, sprache, adresse, iban, email, telefon, standard_iva, irpf_satz, stundensatz_cent, zahlungsziel_tage, fusstext, farbe";

/** Für Rechnungen nötige Betriebsdaten. Fehlt etwas, kann keine Rechnung ausgestellt werden. */
export function fehlendeBetriebsdaten(b: { name?: string | null; nif?: string | null; adresse?: string | null }): string[] {
  return (["name", "nif", "adresse"] as const).filter((f) => !b[f]);
}

export async function einstellungenRoutes(app: FastifyInstance, { sql, auth }: Deps) {
  const nurInhaber = { preHandler: [auth.imBetrieb, auth.nurRolle("inhaber")] };

  app.get("/betriebe/:betriebId/einstellungen", nurInhaber, async (req) =>
    mitKontext(sql, req.kontext!, async (tx) => {
      const [b] = await tx`select ${tx.unsafe(BETRIEB_SPALTEN)} from betrieb where id = ${req.kontext!.betriebId}`;
      const serien = await tx`select id, art, praefix, naechste_nummer, stellen, aktiv from rechnungsserie order by art, erstellt_am`;
      const betrieb = zahlen(b!, ["standardIva", "irpfSatz", "stundensatzCent"]);
      return { betrieb, serien, fehlendFuerRechnungen: fehlendeBetriebsdaten(betrieb as never) };
    }),
  );

  app.patch("/betriebe/:betriebId/einstellungen", nurInhaber, async (req) => {
    const e = validiere(betriebEinstellungenSchema, req.body);
    const k = req.kontext!;
    const felder = Object.fromEntries(
      Object.entries({
        name: e.name,
        sprache: e.sprache,
        adresse: e.adresse,
        iban: e.iban?.replace(/\s+/g, ""),
        email: e.email,
        telefon: e.telefon,
        standard_iva: e.standardIva,
        irpf_satz: e.irpfSatz,
        stundensatz_cent: e.stundensatzCent,
        zahlungsziel_tage: e.zahlungszielTage,
        fusstext: e.fusstext,
        farbe: e.farbe,
      }).filter(([, v]) => v !== undefined),
    );
    if (Object.keys(felder).length === 0) throw new HttpFehler(400, "Keine Änderungen");
    return mitKontext(sql, k, async (tx) => {
      const [b] = await tx`update betrieb set ${tx(felder)} where id = ${k.betriebId} returning ${tx.unsafe(BETRIEB_SPALTEN)}`;
      await protokolliere(tx, { betriebId: k.betriebId, benutzerId: k.benutzerId, aktion: "geaendert", objekt: "einstellungen", objektId: k.betriebId, daten: felder });
      return zahlen(b!, ["standardIva", "irpfSatz", "stundensatzCent"]);
    });
  });

  /** Neue Serie anlegen. Sie wird die aktive Serie ihrer Art; die bisherige wird deaktiviert. */
  app.post("/betriebe/:betriebId/serien", nurInhaber, async (req, reply) => {
    const e = validiere(serieSchema, req.body);
    const k = req.kontext!;
    const serie = await mitKontext(sql, k, async (tx) => {
      const [vorhanden] = await tx`select 1 from rechnungsserie where praefix = ${e.praefix}`;
      if (vorhanden) throw new HttpFehler(409, "Diese Serie gibt es schon", undefined, "serie_existiert");
      await tx`update rechnungsserie set aktiv = false where art = ${e.art} and aktiv`;
      const [s] = await tx`insert into rechnungsserie (betrieb_id, art, praefix, naechste_nummer, stellen)
        values (${k.betriebId}, ${e.art}, ${e.praefix}, ${e.naechsteNummer}, ${e.stellen})
        returning id, art, praefix, naechste_nummer, stellen, aktiv`;
      await protokolliere(tx, { betriebId: k.betriebId, benutzerId: k.benutzerId, aktion: "angelegt", objekt: "rechnungsserie", objektId: s!.id, daten: e });
      return s;
    });
    return reply.code(201).send(serie);
  });

  app.patch("/betriebe/:betriebId/serien/:serieId", nurInhaber, async (req) => {
    const { serieId } = req.params as { serieId: string };
    const { aktiv } = validiere(z.object({ aktiv: z.literal(true) }), req.body);
    const k = req.kontext!;
    return mitKontext(sql, k, async (tx) => {
      const [s] = await tx<{ art: string }[]>`select art from rechnungsserie where id = ${serieId}`;
      if (!s) throw new HttpFehler(404, "Serie nicht gefunden");
      await tx`update rechnungsserie set aktiv = false where art = ${s.art} and aktiv and id <> ${serieId}`;
      const [neu] = await tx`update rechnungsserie set aktiv = ${aktiv} where id = ${serieId}
        returning id, art, praefix, naechste_nummer, stellen, aktiv`;
      return neu;
    });
  });
}
