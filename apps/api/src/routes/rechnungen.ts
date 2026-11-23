import type { FastifyInstance } from "fastify";
import {
  berechneSummen,
  emailSchema,
  formatBetrag,
  formatDatum,
  bezahltSchema,
  formatMonat,
  korrekturSchema,
  monatsEntwuerfeSchema,
  monatsGrenzen,
  pruefeRechnungsregeln,
  rechnungAendernSchema,
  rechnungEntwurfSchema,
  t,
  type Sprache,
} from "@autonomo/shared";
import { z } from "zod";
import type { Deps } from "../app.js";
import { protokolliere } from "../benutzer.js";
import { heuteMadrid } from "../datum.js";
import { mitKontext, type Tx } from "../db.js";
import { HttpFehler, validiere } from "../fehler.js";
import { zahlen } from "../positionen.js";
import { naechsteNummer } from "../serien.js";
import { fehlendeBetriebsdaten } from "./einstellungen.js";
import { rechnungPdf } from "../pdf/index.js";
import { sendeOderFehler } from "../versand.js";

const KOPF = `r.id, r.kunde_id, k.name as kunde_name, r.nummer, r.typ, r.status, r.datum, r.leistung_von, r.leistung_bis,
  r.leistungszeitraum, r.sprache, r.gesendet_am, r.gesendet_an, r.pdf_datei_id, r.korrigiert_rechnung_id, r.korrektur_grund, r.basis_cent, r.iva_cent, r.irpf_satz,
  r.irpf_cent, r.summe_cent, r.faellig_am, r.bezahlt_am, r.ausgestellt_am, r.bemerkung, r.erstellt_am`;
const KOPF_ZAHLEN = ["basisCent", "ivaCent", "irpfSatz", "irpfCent", "summeCent"];

interface PositionNeu {
  quelle: string;
  auftragPositionId?: string | null;
  beschreibung: string;
  menge: number;
  einheit?: string | null;
  preisCent: number;
  ivaSatz: number;
}

const FEHLER_TEXT: Record<string, string> = {
  keine_positionen: "Die Rechnung hat keine Positionen",
  summe_null: "Die Rechnungssumme ist 0",
  nif_und_adresse_noetig:
    "Über 400 € (oder mit IRPF) braucht die Rechnung NIF/NIE und Adresse des Kunden. Bitte beim Kunden ergänzen.",
};

/** Schreibt die Positionen eines Entwurfs neu und aktualisiert die vorläufigen Summen. */
async function schreibePositionen(tx: Tx, betriebId: string, rechnungId: string, positionen: PositionNeu[]) {
  await tx`delete from rechnung_position where rechnung_id = ${rechnungId}`;
  const summen = berechneSummen(positionen);
  if (positionen.length) {
    await tx`insert into rechnung_position ${tx(
      positionen.map((p, i) => ({
        betrieb_id: betriebId,
        rechnung_id: rechnungId,
        pos: i + 1,
        quelle: p.quelle,
        auftrag_position_id: p.auftragPositionId ?? null,
        beschreibung: p.beschreibung,
        menge: p.menge,
        einheit: p.einheit ?? null,
        preis_cent: p.preisCent,
        iva_satz: p.ivaSatz,
        basis_cent: summen.positionen[i]!,
      })),
    )}`;
  }
  await tx`update rechnung set basis_cent = ${summen.basisCent}, iva_cent = ${summen.ivaCent},
    summe_cent = ${summen.basisCent + summen.ivaCent}, geaendert_am = now() where id = ${rechnungId}`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function ladeRechnung(tx: Tx, rechnungId: string): Promise<Record<string, any> | null> {
  const [r] = await tx<Record<string, any>[]>`select ${tx.unsafe(KOPF)}, r.kunde_snapshot, r.betrieb_snapshot
    from rechnung r join kunde k on k.id = r.kunde_id where r.id = ${rechnungId}`;
  if (!r) return null;
  const positionen = (await tx`
    select id, pos, quelle, auftrag_position_id, beschreibung, menge, einheit, preis_cent, iva_satz, basis_cent
    from rechnung_position where rechnung_id = ${rechnungId} order by pos`).map((p) =>
    zahlen(p, ["menge", "preisCent", "ivaSatz", "basisCent"]),
  );
  const summen = berechneSummen(positionen as never, Number(r.irpfSatz));
  return { ...zahlen(r, KOPF_ZAHLEN), positionen, ivaGruppen: summen.ivaGruppen };
}


export async function rechnungenRoutes(app: FastifyInstance, deps: Deps) {
  const { sql, auth, mail } = deps;
  const nurInhaber = { preHandler: [auth.imBetrieb, auth.nurRolle("inhaber")] };
  const lesen = { preHandler: auth.imBetrieb };

  app.get("/betriebe/:betriebId/rechnungen", lesen, async (req) => {
    const q = validiere(
      z.object({
        status: z.enum(["entwurf", "ausgestellt", "bezahlt", "offen", "ueberfaellig"]).optional(),
        kundeId: z.string().uuid().optional(),
      }),
      req.query,
    );
    const zeilen = await mitKontext(sql, req.kontext!, (tx) => tx`
      select ${tx.unsafe(KOPF)} from rechnung r join kunde k on k.id = r.kunde_id
      where (${q.kundeId ?? null}::uuid is null or r.kunde_id = ${q.kundeId ?? null})
        and (${q.status ?? null}::text is null
             or (${q.status ?? null} = 'offen' and r.status = 'ausgestellt')
             or (${q.status ?? null} = 'ueberfaellig' and r.status = 'ausgestellt' and r.faellig_am < ${heuteMadrid()}::date)
             or r.status = ${q.status ?? null})
      order by r.status = 'entwurf' desc, r.datum desc nulls first, r.nummer desc`);
    return zeilen.map((z) => zahlen(z, KOPF_ZAHLEN));
  });

  app.get("/betriebe/:betriebId/rechnungen/:rechnungId", lesen, async (req) => {
    const { rechnungId } = req.params as { rechnungId: string };
    const r = await mitKontext(sql, req.kontext!, (tx) => ladeRechnung(tx, rechnungId));
    if (!r) throw new HttpFehler(404, "Rechnung nicht gefunden");
    return r;
  });

  /** Leeren oder manuell befüllten Entwurf anlegen. */
  app.post("/betriebe/:betriebId/rechnungen", nurInhaber, async (req, reply) => {
    const e = validiere(rechnungEntwurfSchema, req.body);
    const k = req.kontext!;
    const r = await mitKontext(sql, k, async (tx) => {
      const [kunde] = await tx<{ sprache: Sprache }[]>`select sprache from kunde where id = ${e.kundeId}`;
      if (!kunde) throw new HttpFehler(404, "Kunde nicht gefunden");
      const [neu] = await tx<{ id: string }[]>`
        insert into rechnung (betrieb_id, kunde_id, sprache, leistung_von, leistung_bis, leistungszeitraum, bemerkung)
        values (${k.betriebId}, ${e.kundeId}, ${kunde.sprache}, ${e.leistungVon ?? null}, ${e.leistungBis ?? null},
                ${e.leistungszeitraum ?? null}, ${e.bemerkung ?? null})
        returning id`;
      await schreibePositionen(tx, k.betriebId, neu!.id, e.positionen.map((p) => ({ ...p, quelle: "manuell" })));
      await protokolliere(tx, { betriebId: k.betriebId, benutzerId: k.benutzerId, aktion: "angelegt", objekt: "rechnung", objektId: neu!.id });
      return ladeRechnung(tx, neu!.id);
    });
    return reply.code(201).send(r);
  });

  /** Entwurf ändern. Positionen werden komplett ersetzt; Herkunft (Pauschale/Stunden) bleibt per id erhalten. */
  app.patch("/betriebe/:betriebId/rechnungen/:rechnungId", nurInhaber, async (req) => {
    const { rechnungId } = req.params as { rechnungId: string };
    const e = validiere(rechnungAendernSchema.extend({
      positionen: z.array(z.object({
        id: z.string().uuid().optional(),
        beschreibung: z.string().trim().min(1).max(1000),
        menge: z.number().min(-1_000_000).max(1_000_000),
        einheit: z.string().trim().max(20).nullish(),
        preisCent: z.number().int(),
        ivaSatz: z.number().min(0).max(100),
      })).max(200).optional(),
    }), req.body);
    const k = req.kontext!;
    return mitKontext(sql, k, async (tx) => {
      const [r] = await tx<{ status: string; korrigiertRechnungId: string | null }[]>`
        select status, korrigiert_rechnung_id from rechnung where id = ${rechnungId} for update`;
      if (!r) throw new HttpFehler(404, "Rechnung nicht gefunden");
      if (r.status !== "entwurf") throw new HttpFehler(409, "Nur Entwürfe können geändert werden", undefined, "nicht_entwurf");
      await tx`update rechnung set
        leistung_von = ${e.leistungVon === undefined ? tx`leistung_von` : e.leistungVon},
        leistung_bis = ${e.leistungBis === undefined ? tx`leistung_bis` : e.leistungBis},
        leistungszeitraum = ${e.leistungszeitraum === undefined ? tx`leistungszeitraum` : e.leistungszeitraum},
        bemerkung = ${e.bemerkung === undefined ? tx`bemerkung` : e.bemerkung}
        where id = ${rechnungId}`;
      if (e.positionen) {
        const alt = new Map(
          (await tx<{ id: string; quelle: string; auftragPositionId: string | null }[]>`
            select id, quelle, auftrag_position_id from rechnung_position where rechnung_id = ${rechnungId}`).map((p) => [p.id, p]),
        );
        const neu = e.positionen.map((p) => {
          const herkunft = p.id ? alt.get(p.id) : undefined;
          return {
            ...p,
            quelle: herkunft?.quelle ?? (r.korrigiertRechnungId ? "korrektur" : "manuell"),
            auftragPositionId: herkunft?.auftragPositionId ?? null,
          };
        });
        await schreibePositionen(tx, k.betriebId, rechnungId, neu);
        // Stunden/Material, deren Position entfernt wurde, wieder freigeben
        if (!neu.some((p) => p.quelle === "stunden")) await tx`update zeiteintrag set rechnung_id = null where rechnung_id = ${rechnungId}`;
        if (!neu.some((p) => p.quelle === "material")) await tx`update material set rechnung_id = null where rechnung_id = ${rechnungId}`;
      }
      return ladeRechnung(tx, rechnungId);
    });
  });

  app.delete("/betriebe/:betriebId/rechnungen/:rechnungId", nurInhaber, async (req) => {
    const { rechnungId } = req.params as { rechnungId: string };
    const k = req.kontext!;
    await mitKontext(sql, k, async (tx) => {
      const [r] = await tx<{ status: string }[]>`select status from rechnung where id = ${rechnungId}`;
      if (!r) throw new HttpFehler(404, "Rechnung nicht gefunden");
      if (r.status !== "entwurf") throw new HttpFehler(409, "Ausgestellte Rechnungen können nicht gelöscht werden. Bitte eine Korrekturrechnung erstellen.", undefined, "nicht_entwurf");
      await tx`delete from rechnung where id = ${rechnungId}`;
      await protokolliere(tx, { betriebId: k.betriebId, benutzerId: k.benutzerId, aktion: "geloescht", objekt: "rechnung", objektId: rechnungId });
    });
    return { ok: true };
  });

  /**
   * Monatsentwürfe: pro Kunde ein Entwurf mit Pauschalen, abrechenbaren Stunden und Material des Monats.
   * Bereits abgerechnete Pauschalen, Stunden und Materialien werden nicht doppelt aufgenommen.
   */
  app.post("/betriebe/:betriebId/rechnungen/monatsentwuerfe", nurInhaber, async (req) => {
    const { monat } = validiere(monatsEntwuerfeSchema, req.body);
    const { von, bis } = monatsGrenzen(monat);
    const k = req.kontext!;
    return mitKontext(sql, k, async (tx) => {
      const [betrieb] = await tx<{ stundensatzCent: string | null; standardIva: string }[]>`
        select stundensatz_cent, standard_iva from betrieb where id = ${k.betriebId}`;
      const kunden = await tx<{ id: string; name: string; sprache: Sprache }[]>`
        select distinct k.id, k.name, k.sprache from kunde k join auftrag a on a.kunde_id = k.id
        where a.beginn <= ${bis}::date and (a.ende is null or a.ende >= ${von}::date)
        order by k.name`;
      const erstellt: { rechnungId: string; kundeId: string; kundeName: string; positionen: number }[] = [];
      const uebersprungen: { kundeId: string; kundeName: string; grund: string }[] = [];

      for (const kunde of kunden) {
        const [vorhanden] = await tx`select id from rechnung where kunde_id = ${kunde.id} and status = 'entwurf' and leistung_von = ${von}::date`;
        if (vorhanden) {
          uebersprungen.push({ kundeId: kunde.id, kundeName: kunde.name, grund: "entwurf_existiert" });
          continue;
        }
        const monatText = formatMonat(monat, kunde.sprache);
        const positionen: PositionNeu[] = [];

        // Pauschalen aktiver Aufträge, die für diesen Monat noch nicht abgerechnet sind
        const pauschalen = await tx<{ id: string; beschreibung: string; menge: string; einheit: string | null; preisCent: string; ivaSatz: string }[]>`
          select p.id, p.beschreibung, p.menge, p.einheit, p.preis_cent, p.iva_satz
          from auftrag_position p join auftrag a on a.id = p.auftrag_id
          where a.kunde_id = ${kunde.id} and p.aktiv and p.art = 'pauschale' and a.status <> 'pausiert'
            and a.beginn <= ${bis}::date and (a.ende is null or a.ende >= ${von}::date)
            and not exists (
              select 1 from rechnung_position rp join rechnung r on r.id = rp.rechnung_id
              where rp.auftrag_position_id = p.id and r.leistung_von = ${von}::date and r.korrigiert_rechnung_id is null)
          order by a.titel, p.pos`;
        for (const p of pauschalen) {
          positionen.push({
            quelle: "pauschale",
            auftragPositionId: p.id,
            beschreibung: t(kunde.sprache, "rechnung.pos.pauschale", { beschreibung: p.beschreibung, monat: monatText }),
            menge: Number(p.menge),
            einheit: p.einheit,
            preisCent: Number(p.preisCent),
            ivaSatz: Number(p.ivaSatz),
          });
        }

        // Abrechenbare Stunden je Auftrag
        const stunden = await tx<{ auftragId: string; titel: string; minuten: string; positionId: string | null; preisCent: string | null; ivaSatz: string | null }[]>`
          select a.id as auftrag_id, a.titel, sum(extract(epoch from (z.ende - z.start)) / 60) as minuten,
            sp.id as position_id, sp.preis_cent, sp.iva_satz
          from zeiteintrag z join auftrag a on a.id = z.auftrag_id
          left join lateral (select id, preis_cent, iva_satz from auftrag_position
                             where auftrag_id = a.id and aktiv and art = 'stunden' order by pos limit 1) sp on true
          where a.kunde_id = ${kunde.id} and z.abrechenbar and z.ende is not null and z.rechnung_id is null
            and (z.start at time zone 'Europe/Madrid')::date between ${von}::date and ${bis}::date
          group by a.id, a.titel, sp.id, sp.preis_cent, sp.iva_satz
          order by a.titel`;
        const stundenAuftraege: string[] = [];
        for (const s of stunden) {
          const satz = s.preisCent ?? betrieb!.stundensatzCent;
          if (satz === null) {
            uebersprungen.push({ kundeId: kunde.id, kundeName: kunde.name, grund: "kein_stundensatz" });
            continue;
          }
          stundenAuftraege.push(s.auftragId);
          positionen.push({
            quelle: "stunden",
            auftragPositionId: s.positionId,
            beschreibung: t(kunde.sprache, "rechnung.pos.stunden", { auftrag: s.titel }),
            menge: Math.round((Number(s.minuten) / 60) * 100) / 100,
            einheit: "h",
            preisCent: Number(satz),
            ivaSatz: Number(s.ivaSatz ?? betrieb!.standardIva),
          });
        }

        const material = await tx<{ id: string; beschreibung: string; menge: string; einheit: string | null; preisCent: string; ivaSatz: string }[]>`
          select m.id, m.beschreibung, m.menge, m.einheit, m.preis_cent, m.iva_satz
          from material m join auftrag a on a.id = m.auftrag_id
          where a.kunde_id = ${kunde.id} and m.rechnung_id is null and m.datum between ${von}::date and ${bis}::date
          order by m.datum`;
        for (const m of material) {
          positionen.push({
            quelle: "material",
            beschreibung: t(kunde.sprache, "rechnung.pos.material", { beschreibung: m.beschreibung }),
            menge: Number(m.menge),
            einheit: m.einheit,
            preisCent: Number(m.preisCent),
            ivaSatz: Number(m.ivaSatz),
          });
        }

        if (positionen.length === 0) {
          uebersprungen.push({ kundeId: kunde.id, kundeName: kunde.name, grund: "nichts_abzurechnen" });
          continue;
        }
        const [r] = await tx<{ id: string }[]>`
          insert into rechnung (betrieb_id, kunde_id, sprache, leistung_von, leistung_bis, leistungszeitraum)
          values (${k.betriebId}, ${kunde.id}, ${kunde.sprache}, ${von}, ${bis}, ${monatText}) returning id`;
        await schreibePositionen(tx, k.betriebId, r!.id, positionen);
        if (stundenAuftraege.length) {
          await tx`update zeiteintrag set rechnung_id = ${r!.id}
            where auftrag_id = any(${stundenAuftraege}::uuid[]) and abrechenbar and ende is not null and rechnung_id is null
              and (start at time zone 'Europe/Madrid')::date between ${von}::date and ${bis}::date`;
        }
        if (material.length) {
          await tx`update material set rechnung_id = ${r!.id} where id = any(${material.map((m) => m.id)}::uuid[])`;
        }
        erstellt.push({ rechnungId: r!.id, kundeId: kunde.id, kundeName: kunde.name, positionen: positionen.length });
      }
      if (erstellt.length) {
        await protokolliere(tx, { betriebId: k.betriebId, benutzerId: k.benutzerId, aktion: "monatsentwuerfe", objekt: "rechnung", daten: { monat, anzahl: erstellt.length } });
      }
      return { monat, erstellt, uebersprungen };
    });
  });

  /**
   * Freigabe: prüft die Rechnungsregeln, vergibt die endgültige Nummer lückenlos und friert
   * Kunden- und Betriebsdaten ein. Danach ist die Rechnung unveränderbar (Datenbank-Trigger).
   */
  app.post("/betriebe/:betriebId/rechnungen/:rechnungId/freigeben", nurInhaber, async (req) => {
    const { rechnungId } = req.params as { rechnungId: string };
    const k = req.kontext!;
    return mitKontext(sql, k, async (tx) => {
      const [r] = await tx<{ status: string; kundeId: string; korrigiertRechnungId: string | null }[]>`
        select status, kunde_id, korrigiert_rechnung_id from rechnung where id = ${rechnungId} for update`;
      if (!r) throw new HttpFehler(404, "Rechnung nicht gefunden");
      if (r.status !== "entwurf") throw new HttpFehler(409, "Rechnung ist schon ausgestellt", undefined, "nicht_entwurf");

      const [betrieb] = await tx`select name, nif, adresse, iban, email, telefon, irpf_satz, zahlungsziel_tage, fusstext
        from betrieb where id = ${k.betriebId}`;
      const fehlend = fehlendeBetriebsdaten(betrieb as never);
      if (fehlend.length) throw new HttpFehler(400, `Bitte zuerst in den Einstellungen ergänzen: ${fehlend.join(", ")}`, { fehlend }, "betrieb_daten_fehlen");

      const [kunde] = await tx<{ typ: "privat" | "firma"; name: string; steuernummer: string | null; adresse: string | null; email: string | null; irpf: boolean; sprache: Sprache }[]>`
        select typ, name, steuernummer, adresse, email, irpf, sprache from kunde where id = ${r.kundeId}`;
      const positionen = (await tx`select menge, preis_cent, iva_satz from rechnung_position where rechnung_id = ${rechnungId}`).map(
        (p) => ({ menge: Number(p.menge), preisCent: Number(p.preisCent), ivaSatz: Number(p.ivaSatz) }),
      );
      const ohneIrpf = berechneSummen(positionen);
      const regeln = pruefeRechnungsregeln(kunde!, ohneIrpf.basisCent + ohneIrpf.ivaCent, positionen.length, Boolean(r.korrigiertRechnungId));
      if (!regeln.ok) throw new HttpFehler(400, FEHLER_TEXT[regeln.fehler!] ?? regeln.fehler!, undefined, regeln.fehler);

      let irpfSatz = regeln.irpf ? Number(betrieb!.irpfSatz) : 0;
      if (r.korrigiertRechnungId) {
        // Korrektur übernimmt den IRPF-Satz der Originalrechnung
        const [orig] = await tx<{ irpfSatz: string }[]>`select irpf_satz from rechnung where id = ${r.korrigiertRechnungId}`;
        irpfSatz = Number(orig!.irpfSatz);
      }
      const summen = berechneSummen(positionen, irpfSatz);
      const { serieId, nummer } = await naechsteNummer(tx, k.betriebId, r.korrigiertRechnungId ? "korrektur" : "rechnung");
      const datum = heuteMadrid();

      await tx`update rechnung set
        status = 'ausgestellt', nummer = ${nummer}, serie_id = ${serieId}, typ = ${regeln.typ!}, datum = ${datum},
        faellig_am = ${datum}::date + ${Number(betrieb!.zahlungszielTage)}::int,
        sprache = ${kunde!.sprache},
        kunde_snapshot = ${tx.json({ typ: kunde!.typ, name: kunde!.name, steuernummer: kunde!.steuernummer, adresse: kunde!.adresse, email: kunde!.email })},
        betrieb_snapshot = ${tx.json({ name: betrieb!.name, nif: betrieb!.nif, adresse: betrieb!.adresse, iban: betrieb!.iban, email: betrieb!.email, telefon: betrieb!.telefon, fusstext: betrieb!.fusstext })},
        basis_cent = ${summen.basisCent}, iva_cent = ${summen.ivaCent}, irpf_satz = ${irpfSatz},
        irpf_cent = ${summen.irpfCent}, summe_cent = ${summen.summeCent}, ausgestellt_am = now(), geaendert_am = now()
        where id = ${rechnungId}`;
      await protokolliere(tx, { betriebId: k.betriebId, benutzerId: k.benutzerId, aktion: "ausgestellt", objekt: "rechnung", objektId: rechnungId, daten: { nummer, summeCent: summen.summeCent } });
      return ladeRechnung(tx, rechnungId);
    });
  });

  app.post("/betriebe/:betriebId/rechnungen/:rechnungId/bezahlt", nurInhaber, async (req) => {
    const { rechnungId } = req.params as { rechnungId: string };
    const { bezahltAm } = validiere(bezahltSchema, req.body);
    const k = req.kontext!;
    return mitKontext(sql, k, async (tx) => {
      const [r] = await tx<{ status: string }[]>`select status from rechnung where id = ${rechnungId} for update`;
      if (!r) throw new HttpFehler(404, "Rechnung nicht gefunden");
      if (r.status === "entwurf") throw new HttpFehler(409, "Entwürfe können nicht bezahlt sein", undefined, "nicht_ausgestellt");
      await tx`update rechnung set status = ${bezahltAm ? "bezahlt" : "ausgestellt"}, bezahlt_am = ${bezahltAm}, geaendert_am = now()
        where id = ${rechnungId}`;
      await protokolliere(tx, { betriebId: k.betriebId, benutzerId: k.benutzerId, aktion: bezahltAm ? "bezahlt" : "offen", objekt: "rechnung", objektId: rechnungId, daten: { bezahltAm } });
      return ladeRechnung(tx, rechnungId);
    });
  });

  /** Korrekturrechnung (factura rectificativa) als Entwurf anlegen; ohne Positionen wird die ganze Rechnung storniert. */
  app.post("/betriebe/:betriebId/rechnungen/:rechnungId/korrektur", nurInhaber, async (req, reply) => {
    const { rechnungId } = req.params as { rechnungId: string };
    const e = validiere(korrekturSchema, req.body);
    const k = req.kontext!;
    const r = await mitKontext(sql, k, async (tx) => {
      const orig = await ladeRechnung(tx, rechnungId);
      if (!orig) throw new HttpFehler(404, "Rechnung nicht gefunden");
      if (orig.status === "entwurf") throw new HttpFehler(409, "Entwürfe werden direkt geändert, nicht korrigiert", undefined, "nicht_ausgestellt");
      const sprache = orig.sprache as Sprache;
      const positionen: PositionNeu[] = e.positionen
        ? e.positionen.map((p) => ({ ...p, quelle: "korrektur" }))
        : (orig.positionen as unknown as { beschreibung: string; menge: number; einheit: string | null; preisCent: number; ivaSatz: number }[]).map((p) => ({
            quelle: "korrektur",
            beschreibung: t(sprache, "rechnung.storno", { nummer: orig.nummer as string, beschreibung: p.beschreibung }),
            menge: -p.menge,
            einheit: p.einheit,
            preisCent: p.preisCent,
            ivaSatz: p.ivaSatz,
          }));
      const [neu] = await tx<{ id: string }[]>`
        insert into rechnung (betrieb_id, kunde_id, sprache, korrigiert_rechnung_id, korrektur_grund, leistung_von, leistung_bis, leistungszeitraum, irpf_satz)
        values (${k.betriebId}, ${orig.kundeId as string}, ${sprache}, ${rechnungId}, ${e.grund},
                ${(orig.leistungVon as string | null) ?? null}, ${(orig.leistungBis as string | null) ?? null},
                ${(orig.leistungszeitraum as string | null) ?? null}, ${orig.irpfSatz as number})
        returning id`;
      await schreibePositionen(tx, k.betriebId, neu!.id, positionen);
      await protokolliere(tx, { betriebId: k.betriebId, benutzerId: k.benutzerId, aktion: "korrektur_angelegt", objekt: "rechnung", objektId: neu!.id, daten: { zu: rechnungId } });
      return ladeRechnung(tx, neu!.id);
    });
    return reply.code(201).send(r);
  });

  /** PDF: Entwürfe als Vorschau mit Wasserzeichen; ausgestellte Rechnungen einmal erzeugt und unverändert gespeichert. */
  app.get("/betriebe/:betriebId/rechnungen/:rechnungId/pdf", lesen, async (req, reply) => {
    const { rechnungId } = req.params as { rechnungId: string };
    const k = req.kontext!;
    const pdf = await mitKontext(sql, k, async (tx) => {
      const [r] = await tx`select 1 from rechnung where id = ${rechnungId}`;
      if (!r) throw new HttpFehler(404, "Rechnung nicht gefunden");
      // Nur der Inhaber legt das endgültige PDF ab; Kunde/Steuerberatung lesen nur
      return rechnungPdf(tx, deps, k.betriebId, rechnungId, k.rolle === "inhaber" ? k.benutzerId : undefined);
    });
    return reply.type("application/pdf").header("content-disposition", `inline; filename="${pdf.dateiname}"`).send(pdf.inhalt);
  });

  app.post("/betriebe/:betriebId/rechnungen/:rechnungId/senden", nurInhaber, async (req) => {
    const { rechnungId } = req.params as { rechnungId: string };
    const e = validiere(z.object({ an: emailSchema.optional() }), req.body ?? {});
    const k = req.kontext!;
    return mitKontext(sql, k, async (tx) => {
      const [r] = await tx<{ status: string; nummer: string; sprache: Sprache; summeCent: string; faelligAm: string; kundeId: string; kundeSnapshot: { name: string } }[]>`
        select status, nummer, sprache, summe_cent, faellig_am, kunde_id, kunde_snapshot from rechnung where id = ${rechnungId} for update`;
      if (!r) throw new HttpFehler(404, "Rechnung nicht gefunden");
      if (r.status === "entwurf") throw new HttpFehler(409, "Bitte die Rechnung zuerst freigeben", undefined, "nicht_ausgestellt");
      const [kunde] = await tx<{ email: string | null }[]>`select email from kunde where id = ${r.kundeId}`;
      const empfaenger = e.an ?? kunde?.email;
      if (!empfaenger) throw new HttpFehler(400, "Beim Kunden ist keine E-Mail-Adresse hinterlegt", undefined, "keine_email");
      const [betrieb] = await tx<{ name: string; email: string | null }[]>`select name, email from betrieb where id = ${k.betriebId}`;
      const pdf = await rechnungPdf(tx, deps, k.betriebId, rechnungId, k.benutzerId);
      const s = r.sprache;
      await sendeOderFehler(mail, {
        an: empfaenger,
        antwortAn: betrieb!.email,
        betreff: t(s, "mail.rechnung.betreff", { nummer: r.nummer, betrieb: betrieb!.name }),
        text: t(s, "mail.rechnung.text", {
          name: r.kundeSnapshot.name,
          nummer: r.nummer,
          betrag: formatBetrag(Number(r.summeCent), s),
          datum: formatDatum(r.faelligAm, s),
          betrieb: betrieb!.name,
        }),
        anhaenge: [{ dateiname: pdf.dateiname, inhalt: pdf.inhalt, mime: "application/pdf" }],
      });
      await tx`update rechnung set gesendet_am = now(), gesendet_an = ${empfaenger} where id = ${rechnungId}`;
      await protokolliere(tx, { betriebId: k.betriebId, benutzerId: k.benutzerId, aktion: "gesendet", objekt: "rechnung", objektId: rechnungId, daten: { an: empfaenger } });
      return ladeRechnung(tx, rechnungId);
    });
  });
}
