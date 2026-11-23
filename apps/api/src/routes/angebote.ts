import type { FastifyInstance } from "fastify";
import { angebotSchema, berechneSummen, emailSchema, formatDatum, t, type PositionDaten, type Sprache } from "@autonomo/shared";
import { z } from "zod";
import type { Deps } from "../app.js";
import { protokolliere } from "../benutzer.js";
import { mitKontext, type Tx } from "../db.js";
import { HttpFehler, validiere } from "../fehler.js";
import { POSITIONS_ZAHLEN, schreibeAngebotsPositionen, zahlen } from "../positionen.js";
import { naechsteNummer } from "../serien.js";
import { neuesToken } from "../auth/tokens.js";
import { heuteMadrid } from "../datum.js";
import { angebotPdf } from "../pdf/index.js";
import { sendeOderFehler } from "../versand.js";

const SPALTEN = `id, kunde_id, nummer, titel, einleitung, gueltig_bis, status, gesendet_am, geoeffnet_am,
  entschieden_am, ablehnungsgrund, unterschrift_name, unterschrift_am, pdf_datei_id, pdf_hash, erstellt_am, geaendert_am`;

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

export async function angeboteRoutes(app: FastifyInstance, deps: Deps) {
  const { sql, auth, config, mail } = deps;
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

  app.get("/betriebe/:betriebId/angebote/:angebotId/pdf", lesen, async (req, reply) => {
    const { angebotId } = req.params as { angebotId: string };
    const k = req.kontext!;
    const pdf = await mitKontext(sql, k, async (tx) => {
      const [a] = await tx`select 1 from angebot where id = ${angebotId}`;
      if (!a) throw new HttpFehler(404, "Angebot nicht gefunden");
      return angebotPdf(tx, deps, k.betriebId, angebotId);
    });
    return reply.type("application/pdf").header("content-disposition", `inline; filename="${pdf.dateiname}"`).send(pdf.inhalt);
  });

  /**
   * Angebot an den Kunden schicken: erzeugt einen neuen, nicht erratbaren Link (ein früherer wird ungültig),
   * speichert die verschickte PDF-Fassung samt Hash und schickt die Mail in der Kundensprache.
   * Mit ohneMail: true wird nur der Link erzeugt, z. B. zum Weiterleiten per WhatsApp.
   */
  app.post("/betriebe/:betriebId/angebote/:angebotId/senden", nurInhaber, async (req) => {
    const { angebotId } = req.params as { angebotId: string };
    const e = validiere(z.object({ an: emailSchema.optional(), ohneMail: z.boolean().default(false) }), req.body ?? {});
    const k = req.kontext!;
    return mitKontext(sql, k, async (tx) => {
      const [a] = await tx<{ status: string; kundeId: string; nummer: string; titel: string; gueltigBis: string }[]>`
        select status, kunde_id, nummer, titel, gueltig_bis from angebot where id = ${angebotId} for update`;
      if (!a) throw new HttpFehler(404, "Angebot nicht gefunden");
      if (a.status === "angenommen" || a.status === "abgelehnt") throw new HttpFehler(409, "Angebot ist schon entschieden", undefined, "schon_entschieden");
      if (a.gueltigBis < heuteMadrid()) throw new HttpFehler(400, "Das Gültig-bis-Datum liegt in der Vergangenheit. Bitte zuerst verlängern.", undefined, "abgelaufen");
      const [kunde] = await tx<{ name: string; email: string | null; sprache: Sprache }[]>`select name, email, sprache from kunde where id = ${a.kundeId}`;
      const [betrieb] = await tx<{ name: string; email: string | null }[]>`select name, email from betrieb where id = ${k.betriebId}`;
      const empfaenger = e.an ?? kunde!.email;
      if (!e.ohneMail && !empfaenger) throw new HttpFehler(400, "Beim Kunden ist keine E-Mail-Adresse hinterlegt", undefined, "keine_email");

      const { token, hash } = neuesToken();
      await tx`update angebot set status = 'gesendet', gesendet_am = now(), geoeffnet_am = null, link_token_hash = ${hash}, geaendert_am = now()
        where id = ${angebotId}`;
      const pdf = await angebotPdf(tx, deps, k.betriebId, angebotId, { speichern: true, benutzerId: k.benutzerId });
      const link = `${config.WEB_URL}/angebot/${token}`;
      const sprache = kunde!.sprache;
      if (!e.ohneMail) {
        await sendeOderFehler(mail, {
          an: empfaenger!,
          antwortAn: betrieb!.email,
          betreff: t(sprache, "mail.angebot.betreff", { nummer: a.nummer, betrieb: betrieb!.name }),
          text: t(sprache, "mail.angebot.text", { name: kunde!.name, titel: a.titel, datum: formatDatum(a.gueltigBis, sprache), link, betrieb: betrieb!.name }),
          anhaenge: [{ dateiname: pdf.dateiname, inhalt: pdf.inhalt, mime: "application/pdf" }],
        });
      }
      await protokolliere(tx, { betriebId: k.betriebId, benutzerId: k.benutzerId, aktion: "gesendet", objekt: "angebot", objektId: angebotId, daten: { an: e.ohneMail ? null : empfaenger, pdfHash: pdf.sha256 } });
      return { link, gesendetAn: e.ohneMail ? null : empfaenger, pdfHash: pdf.sha256 };
    });
  });
}
