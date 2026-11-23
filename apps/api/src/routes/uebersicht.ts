import type { FastifyInstance } from "fastify";
import { monatSchema, monatsGrenzen } from "@autonomo/shared";
import { z } from "zod";
import type { Deps } from "../app.js";
import { heuteMadrid } from "../datum.js";
import { mitKontext } from "../db.js";
import { validiere } from "../fehler.js";


/** Startseite des Inhabers: das Wichtigste des Monats auf einen Blick. */
export async function uebersichtRoutes(app: FastifyInstance, { sql, auth }: Deps) {
  app.get("/betriebe/:betriebId/uebersicht", { preHandler: [auth.imBetrieb, auth.nurRolle("inhaber")] }, async (req) => {
    const q = validiere(z.object({ monat: monatSchema.optional() }), req.query);
    const monat = q.monat ?? heuteMadrid().slice(0, 7);
    const { von, bis } = monatsGrenzen(monat);
    const k = req.kontext!;
    return mitKontext(sql, k, async (tx) => {
      const [offen] = await tx<{ anzahl: string; summe: string; ueberfaelligAnzahl: string; ueberfaelligSumme: string }[]>`
        select count(*) as anzahl, coalesce(sum(summe_cent), 0) as summe,
          count(*) filter (where faellig_am < ${heuteMadrid()}::date) as ueberfaellig_anzahl,
          coalesce(sum(summe_cent) filter (where faellig_am < ${heuteMadrid()}::date), 0) as ueberfaellig_summe
        from rechnung where status = 'ausgestellt'`;
      const [entwuerfe] = await tx<{ anzahl: string }[]>`select count(*) as anzahl from rechnung where status = 'entwurf'`;
      const [umsatz] = await tx<{ basis: string }[]>`
        select coalesce(sum(basis_cent), 0) as basis from rechnung where status <> 'entwurf' and datum between ${von}::date and ${bis}::date`;

      // Stunden je Kunde im Monat, dazu Pauschalen → effektiver Stundensatz
      const kunden = await tx<{ kundeId: string; name: string; minuten: string; abrechenbarMinuten: string; pauschaleCent: string }[]>`
        with zeit as (
          select a.kunde_id, sum(extract(epoch from (z.ende - z.start)) / 60) as minuten,
            sum(extract(epoch from (z.ende - z.start)) / 60) filter (where z.abrechenbar) as abrechenbar_minuten
          from zeiteintrag z join auftrag a on a.id = z.auftrag_id
          where z.ende is not null and (z.start at time zone 'Europe/Madrid')::date between ${von}::date and ${bis}::date
          group by a.kunde_id),
        pauschale as (
          select a.kunde_id, sum(round(p.menge * p.preis_cent)) as cent
          from auftrag_position p join auftrag a on a.id = p.auftrag_id
          where p.aktiv and p.art = 'pauschale' and a.status <> 'pausiert'
            and a.beginn <= ${bis}::date and (a.ende is null or a.ende >= ${von}::date)
          group by a.kunde_id)
        select k.id as kunde_id, k.name, coalesce(zeit.minuten, 0) as minuten,
          coalesce(zeit.abrechenbar_minuten, 0) as abrechenbar_minuten, coalesce(pauschale.cent, 0) as pauschale_cent
        from kunde k left join zeit on zeit.kunde_id = k.id left join pauschale on pauschale.kunde_id = k.id
        where zeit.kunde_id is not null or pauschale.kunde_id is not null
        order by k.name`;
      const [betrieb] = await tx<{ stundensatzCent: string | null }[]>`select stundensatz_cent from betrieb where id = ${k.betriebId}`;
      const stundensatz = betrieb?.stundensatzCent == null ? null : Number(betrieb.stundensatzCent);

      const [timer] = await tx`
        select z.id, z.start, z.auftrag_id, a.titel as auftrag_titel, k.name as kunde_name
        from zeiteintrag z join auftrag a on a.id = z.auftrag_id join kunde k on k.id = a.kunde_id
        where z.ende is null and z.benutzer_id = ${k.benutzerId}`;
      const aufgaben = await tx`
        select g.id, g.titel, g.auftrag_id, a.titel as auftrag_titel, g.status, g.faellig_am, g.erstellt_von_rolle, k.name as kunde_name
        from aufgabe g join auftrag a on a.id = g.auftrag_id join kunde k on k.id = a.kunde_id
        where g.status <> 'erledigt'
        order by g.faellig_am nulls last, g.erstellt_am limit 10`;
      const [angebote] = await tx<{ offen: string }[]>`select count(*) as offen from angebot where status = 'gesendet'`;

      return {
        monat,
        rechnungen: {
          offenAnzahl: Number(offen!.anzahl),
          offenCent: Number(offen!.summe),
          ueberfaelligAnzahl: Number(offen!.ueberfaelligAnzahl),
          ueberfaelligCent: Number(offen!.ueberfaelligSumme),
          entwuerfe: Number(entwuerfe!.anzahl),
          umsatzMonatBasisCent: Number(umsatz!.basis),
        },
        angeboteOffen: Number(angebote!.offen),
        stundensatzCent: stundensatz,
        kunden: kunden.map((z) => {
          const minuten = Math.round(Number(z.minuten));
          const pauschaleCent = Number(z.pauschaleCent);
          return {
            kundeId: z.kundeId,
            name: z.name,
            minuten,
            abrechenbarMinuten: Math.round(Number(z.abrechenbarMinuten)),
            pauschaleCent,
            // Wie viel bringt die Pauschale pro tatsächlich gearbeiteter Stunde?
            // erst ab einer Stunde aussagekräftig, sonst entstehen absurde Werte
            effektiverStundensatzCent: pauschaleCent > 0 && minuten >= 60 ? Math.round((pauschaleCent * 60) / minuten) : null,
          };
        }),
        laufenderTimer: timer ?? null,
        offeneAufgaben: aufgaben,
      };
    });
  });
}
