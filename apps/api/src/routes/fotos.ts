import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Deps } from "../app.js";
import { protokolliere } from "../benutzer.js";
import { verarbeiteFoto } from "../bilder.js";
import { ladeDatei, loescheDateien, speichereDatei } from "../dateien.js";
import { mitKontext } from "../db.js";
import { HttpFehler, validiere } from "../fehler.js";

const FOTO_SPALTEN = "id, aufgabe_id, art, beschreibung, sichtbar_fuer_kunde, breite, hoehe, erstellt_von_rolle, erstellt_am";
const artSchema = z.enum(["arbeit", "schaden", "vorher", "nachher"]);

/** Fotos zu Aufgaben: Arbeitsnachweis (vorher/nachher) und Schadensmeldungen. */
export async function fotoRoutes(app: FastifyInstance, { sql, auth, speicher }: Deps) {
  const nurInhaber = { preHandler: [auth.imBetrieb, auth.nurRolle("inhaber")] };
  const lesen = { preHandler: [auth.imBetrieb, auth.nurRolle("inhaber", "kunde")] };

  app.get("/betriebe/:betriebId/aufgaben/:aufgabeId/fotos", lesen, async (req) => {
    const { aufgabeId } = req.params as { aufgabeId: string };
    return mitKontext(sql, req.kontext!, (tx) =>
      tx`select ${tx.unsafe(FOTO_SPALTEN)} from foto where aufgabe_id = ${aufgabeId} order by erstellt_am`,
    );
  });

  /**
   * Hochladen als rohe Bilddaten (Content-Type image/jpeg, image/png, image/webp oder image/heic).
   * Angaben zum Foto kommen als Query-Parameter. Das Bild wird verkleinert und ohne Metadaten (GPS) gespeichert.
   */
  app.post("/betriebe/:betriebId/aufgaben/:aufgabeId/fotos", nurInhaber, async (req, reply) => {
    const { aufgabeId } = req.params as { aufgabeId: string };
    const q = validiere(
      z.object({
        art: artSchema.default("arbeit"),
        beschreibung: z.string().trim().max(1000).optional(),
        sichtbar: z.enum(["ja", "nein"]).default("ja"),
        /** Vom Gerät vergebene ID (Offline-Abgleich): erneutes Hochladen legt kein zweites Foto an. */
        id: z.string().uuid().optional(),
      }),
      req.query,
    );
    const k = req.kontext!;
    if (q.id) {
      const [vorhanden] = await mitKontext(sql, k, (tx) => tx`select ${tx.unsafe(FOTO_SPALTEN)} from foto where id = ${q.id!}`);
      if (vorhanden) return reply.code(200).send(vorhanden);
    }
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      throw new HttpFehler(415, "Bitte das Foto als Bilddatei senden (image/jpeg oder image/png)", undefined, "bild_fehlt");
    }
    const bild = await verarbeiteFoto(req.body);
    const foto = await mitKontext(sql, k, async (tx) => {
      const [a] = await tx`select 1 from aufgabe where id = ${aufgabeId}`;
      if (!a) throw new HttpFehler(404, "Aufgabe nicht gefunden");
      const gross = await speichereDatei(tx, speicher, { betriebId: k.betriebId, art: "foto", inhalt: bild.gross, mime: "image/jpeg", benutzerId: k.benutzerId });
      const klein = await speichereDatei(tx, speicher, { betriebId: k.betriebId, art: "foto_klein", inhalt: bild.klein, mime: "image/jpeg", benutzerId: k.benutzerId });
      const [f] = await tx`
        insert into foto (id, betrieb_id, aufgabe_id, datei_id, vorschau_datei_id, art, beschreibung, sichtbar_fuer_kunde, breite, hoehe, erstellt_von, erstellt_von_rolle)
        values (${q.id ?? tx`gen_random_uuid()`}, ${k.betriebId}, ${aufgabeId}, ${gross.id}, ${klein.id}, ${q.art}, ${q.beschreibung || null}, ${q.sichtbar === "ja"},
                ${bild.breite}, ${bild.hoehe}, ${k.benutzerId}, 'inhaber')
        returning ${tx.unsafe(FOTO_SPALTEN)}`;
      await protokolliere(tx, { betriebId: k.betriebId, benutzerId: k.benutzerId, aktion: "angelegt", objekt: "foto", objektId: f!.id, daten: { aufgabeId } });
      return f;
    });
    return reply.code(201).send(foto);
  });

  app.get("/betriebe/:betriebId/fotos/:fotoId/bild", lesen, async (req, reply) => {
    const { fotoId } = req.params as { fotoId: string };
    const { groesse } = validiere(z.object({ groesse: z.enum(["gross", "klein"]).default("gross") }), req.query);
    const datei = await mitKontext(sql, req.kontext!, async (tx) => {
      const [f] = await tx<{ dateiId: string; vorschauDateiId: string }[]>`select datei_id, vorschau_datei_id from foto where id = ${fotoId}`;
      if (!f) throw new HttpFehler(404, "Foto nicht gefunden");
      return ladeDatei(tx, speicher, groesse === "klein" ? f.vorschauDateiId : f.dateiId);
    });
    return reply.type(datei.mime).header("cache-control", "private, max-age=86400").header("etag", `"${datei.sha256}"`).send(datei.inhalt);
  });

  app.patch("/betriebe/:betriebId/fotos/:fotoId", nurInhaber, async (req) => {
    const { fotoId } = req.params as { fotoId: string };
    const e = validiere(
      z.object({ art: artSchema.optional(), beschreibung: z.string().trim().max(1000).nullish(), sichtbarFuerKunde: z.boolean().optional() }),
      req.body,
    );
    const [f] = await mitKontext(sql, req.kontext!, (tx) => tx`
      update foto set
        art = coalesce(${e.art ?? null}, art),
        beschreibung = ${e.beschreibung === undefined ? tx`beschreibung` : e.beschreibung},
        sichtbar_fuer_kunde = coalesce(${e.sichtbarFuerKunde ?? null}, sichtbar_fuer_kunde)
      where id = ${fotoId} returning ${tx.unsafe(FOTO_SPALTEN)}`);
    if (!f) throw new HttpFehler(404, "Foto nicht gefunden");
    return f;
  });

  app.delete("/betriebe/:betriebId/fotos/:fotoId", nurInhaber, async (req) => {
    const { fotoId } = req.params as { fotoId: string };
    const k = req.kontext!;
    const aufraeumen = await mitKontext(sql, k, async (tx) => {
      const [f] = await tx<{ dateiId: string; vorschauDateiId: string }[]>`delete from foto where id = ${fotoId} returning datei_id, vorschau_datei_id`;
      if (!f) throw new HttpFehler(404, "Foto nicht gefunden");
      await protokolliere(tx, { betriebId: k.betriebId, benutzerId: k.benutzerId, aktion: "geloescht", objekt: "foto", objektId: fotoId });
      return loescheDateien(tx, speicher, [f.dateiId, f.vorschauDateiId]);
    });
    await aufraeumen();
    return { ok: true };
  });
}
