import type { FastifyInstance } from "fastify";
import { betriebAnlegenSchema, istGueltigeSpanischeSteuernummer } from "@autonomo/shared";
import { z } from "zod";
import type { Deps } from "../app.js";
import { sendeAnmeldelink } from "../auth/anmeldelink.js";
import { benutzerFuerEmail, protokolliere } from "../benutzer.js";
import { mitKontext } from "../db.js";
import { HttpFehler, validiere } from "../fehler.js";

/** Plattform-Verwaltung (Olaf): Betriebe anlegen und auflisten. Keine Einsicht in Geschäftsdaten. */
export async function adminRoutes(app: FastifyInstance, { sql, config, mail, auth }: Deps) {
  app.get("/admin/betriebe", { preHandler: auth.nurPlattformAdmin }, async (req) => {
    return mitKontext(sql, { benutzerId: req.benutzer!.id }, (tx) =>
      tx`select id, name, nif, sprache, gesperrt, erstellt_am from betrieb order by erstellt_am desc`,
    );
  });

  app.post("/admin/betriebe", { preHandler: auth.nurPlattformAdmin }, async (req, reply) => {
    const e = validiere(betriebAnlegenSchema, req.body);
    if (!istGueltigeSpanischeSteuernummer(e.nif)) throw new HttpFehler(400, "NIF/CIF ist ungültig");
    const adminId = req.benutzer!.id;
    const ergebnis = await mitKontext(sql, { benutzerId: adminId }, async (tx) => {
      const [vorhanden] = await tx`select 1 from betrieb where nif = ${e.nif}`;
      if (vorhanden) throw new HttpFehler(409, "Für diese NIF gibt es schon einen Betrieb");
      const [betrieb] = await tx<{ id: string }[]>`
        insert into betrieb (name, nif, sprache) values (${e.name}, ${e.nif}, ${e.sprache}) returning id`;
      const inhaber = await benutzerFuerEmail(tx, e.inhaberEmail, e.inhaberName, e.sprache);
      await tx`insert into mitgliedschaft (betrieb_id, benutzer_id, rolle)
        values (${betrieb!.id}, ${inhaber.id}, 'inhaber')`;
      await sendeAnmeldelink(tx, config, mail, inhaber);
      return { betriebId: betrieb!.id, inhaberId: inhaber.id };
    });
    // Protokolleintrag im Kontext des neuen Betriebs (Admin ist dort kein Mitglied, daher als Inhaber-Kontext des Admins nicht erlaubt).
    await mitKontext(sql, { benutzerId: ergebnis.inhaberId, betriebId: ergebnis.betriebId, rolle: "inhaber" }, (tx) =>
      protokolliere(tx, {
        betriebId: ergebnis.betriebId,
        benutzerId: ergebnis.inhaberId,
        aktion: "angelegt",
        objekt: "betrieb",
        objektId: ergebnis.betriebId,
        daten: { durchPlattformAdmin: adminId },
      }),
    );
    return reply.code(201).send(ergebnis);
  });

  /** Betrieb sperren/entsperren (z. B. Abo abgelaufen). Gesperrte Betriebe können sich nicht mehr anmelden. */
  app.patch("/admin/betriebe/:id", { preHandler: auth.nurPlattformAdmin }, async (req) => {
    const { id } = req.params as { id: string };
    const { gesperrt } = validiere(z.object({ gesperrt: z.boolean() }), req.body);
    const [b] = await mitKontext(sql, { benutzerId: req.benutzer!.id }, (tx) =>
      tx`update betrieb set gesperrt = ${gesperrt} where id = ${id} returning id, name, gesperrt`,
    );
    if (!b) throw new HttpFehler(404, "Betrieb nicht gefunden");
    return b;
  });
}
