import type { FastifyInstance } from "fastify";
import { t, type Sprache } from "@autonomo/shared";
import { z } from "zod";
import type { Deps } from "../app.js";
import { hashToken } from "../auth/tokens.js";
import { protokolliere } from "../benutzer.js";
import { ladeDatei } from "../dateien.js";
import { heuteMadrid } from "../datum.js";
import { mitKontext, type Kontext, type Tx } from "../db.js";
import { HttpFehler, validiere } from "../fehler.js";
import { angebotPdf } from "../pdf/index.js";
import { auftragAusAngebot, ladeAngebot } from "./angebote.js";

/** Unterschrift als PNG-Data-URL, höchstens ca. 300 KB. */
const unterschriftSchema = z
  .string()
  .max(400_000)
  .regex(/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/, "Unterschrift fehlt");

/**
 * Öffentliche Angebotsseite ohne Login. Der Zugriff hängt allein am zufälligen Link-Token
 * (nur der Hash ist gespeichert). Die Datenbank löst das Token zum Betrieb auf; danach
 * wird ausschließlich dieses eine Angebot gelesen bzw. entschieden.
 */
export async function oeffentlichRoutes(app: FastifyInstance, deps: Deps) {
  const { sql, mail, speicher } = deps;
  const begrenzt = { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } };
  const entscheidenBegrenzt = { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } };

  async function imLink<T>(token: string, fn: (tx: Tx, ctx: { angebotId: string; kontext: Kontext & { betriebId: string } }) => Promise<T>) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new HttpFehler(404, "Link ungültig", undefined, "link_ungueltig");
    const [ziel] = await sql<{ angebotId: string; betriebId: string; inhaberId: string }[]>`
      select * from app_angebot_link(${hashToken(token)})`;
    if (!ziel) throw new HttpFehler(404, "Link ungültig", undefined, "link_ungueltig");
    const kontext = { benutzerId: ziel.inhaberId, betriebId: ziel.betriebId, rolle: "inhaber" as const };
    return mitKontext(sql, kontext, (tx) => fn(tx, { angebotId: ziel.angebotId, kontext }));
  }

  async function ansicht(tx: Tx, angebotId: string) {
    const a = (await ladeAngebot(tx, angebotId))!;
    const [k] = await tx<{ name: string; sprache: Sprache }[]>`select name, sprache from kunde where id = ${a.kundeId}`;
    const [b] = await tx<{ name: string; email: string | null; telefon: string | null; farbe: string | null; logoDateiId: string | null }[]>`
      select b.name, b.email, b.telefon, b.farbe, b.logo_datei_id from betrieb b join angebot a on a.betrieb_id = b.id where a.id = ${angebotId}`;
    return {
      angebot: {
        nummer: a.nummer,
        titel: a.titel,
        einleitung: a.einleitung,
        gueltigBis: a.gueltigBis,
        status: a.status,
        entschiedenAm: a.entschiedenAm,
        unterschriftName: a.unterschriftName,
        positionen: a.positionen.map((p: Record<string, unknown>) => ({
          art: p.art, beschreibung: p.beschreibung, menge: p.menge, einheit: p.einheit,
          preisCent: p.preisCent, ivaSatz: p.ivaSatz, stundenkontingent: p.stundenkontingent,
        })),
        summen: a.summen,
      },
      abgelaufen: a.status === "gesendet" && a.gueltigBis < heuteMadrid(),
      kunde: { name: k!.name },
      sprache: k!.sprache,
      betrieb: { name: b!.name, email: b!.email, telefon: b!.telefon, farbe: b!.farbe, hatLogo: Boolean(b!.logoDateiId) },
    };
  }

  app.get("/oeffentlich/angebote/:token", begrenzt, async (req) => {
    const { token } = req.params as { token: string };
    return imLink(token, async (tx, { angebotId, kontext }) => {
      const [neu] = await tx`update angebot set geoeffnet_am = now() where id = ${angebotId} and geoeffnet_am is null returning id`;
      if (neu) await protokolliere(tx, { betriebId: kontext.betriebId, benutzerId: kontext.benutzerId, aktion: "geoeffnet", objekt: "angebot", objektId: angebotId, daten: { von: "kunde_link" } });
      return ansicht(tx, angebotId);
    });
  });

  app.get("/oeffentlich/angebote/:token/pdf", begrenzt, async (req, reply) => {
    const { token } = req.params as { token: string };
    const pdf = await imLink(token, (tx, { angebotId, kontext }) => angebotPdf(tx, deps, kontext.betriebId, angebotId));
    return reply.type("application/pdf").header("content-disposition", `inline; filename="${pdf.dateiname}"`).send(pdf.inhalt);
  });

  app.get("/oeffentlich/angebote/:token/logo", begrenzt, async (req, reply) => {
    const { token } = req.params as { token: string };
    const datei = await imLink(token, async (tx, { kontext }) => {
      const [b] = await tx<{ logoDateiId: string | null }[]>`select logo_datei_id from betrieb where id = ${kontext.betriebId}`;
      if (!b?.logoDateiId) throw new HttpFehler(404, "Kein Logo");
      return ladeDatei(tx, speicher, b.logoDateiId);
    });
    return reply.type(datei.mime).header("cache-control", "public, max-age=3600").send(datei.inhalt);
  });

  /** Benachrichtigt den Inhaber in seiner Sprache über die Entscheidung des Kunden. */
  async function benachrichtige(tx: Tx, inhaberId: string, angebotId: string, angenommen: boolean, details: { name?: string; grund?: string }) {
    const [i] = await tx<{ email: string; sprache: Sprache }[]>`select email, sprache from benutzer where id = ${inhaberId}`;
    const [a] = await tx<{ nummer: string; titel: string; kundeName: string }[]>`
      select a.nummer, a.titel, k.name as kunde_name from angebot a join kunde k on k.id = a.kunde_id where a.id = ${angebotId}`;
    if (!i || !a) return;
    const s = i.sprache;
    const ergebnis = t(s, angenommen ? "angebot.status.angenommen" : "angebot.status.abgelehnt");
    // Die Entscheidung ist gespeichert; ein Fehler beim Benachrichtigen darf sie nicht rückgängig machen
    await mail
      .sende({
        an: i.email,
        betreff: t(s, "mail.angebotEntschieden.betreff", { nummer: a.nummer, ergebnis }),
        text: angenommen
          ? t(s, "mail.angebotAngenommen.text", { kunde: a.kundeName, titel: a.titel, name: details.name ?? "" })
          : t(s, "mail.angebotAbgelehnt.text", { kunde: a.kundeName, titel: a.titel, grund: details.grund || "–" }),
      })
      .catch((e) => app.log.warn({ err: e }, "Benachrichtigung an Inhaber fehlgeschlagen"));
  }

  async function pruefeOffen(tx: Tx, angebotId: string) {
    const [a] = await tx<{ status: string; gueltigBis: string }[]>`select status, gueltig_bis from angebot where id = ${angebotId} for update`;
    if (a!.status !== "gesendet") throw new HttpFehler(409, "Das Angebot ist bereits entschieden", undefined, "schon_entschieden");
    if (a!.gueltigBis < heuteMadrid()) throw new HttpFehler(410, "Das Angebot ist abgelaufen", undefined, "abgelaufen");
  }

  app.post("/oeffentlich/angebote/:token/annehmen", entscheidenBegrenzt, async (req) => {
    const { token } = req.params as { token: string };
    const e = validiere(z.object({ name: z.string().trim().min(2).max(200), unterschrift: unterschriftSchema }), req.body);
    return imLink(token, async (tx, { angebotId, kontext }) => {
      await pruefeOffen(tx, angebotId);
      await tx`update angebot set status = 'angenommen', entschieden_am = now(), unterschrift_am = now(),
        unterschrift_name = ${e.name}, unterschrift_bild = ${e.unterschrift}, unterschrift_ip = ${req.ip}, geaendert_am = now()
        where id = ${angebotId}`;
      const auftragId = await auftragAusAngebot(tx, kontext.betriebId, angebotId);
      const [h] = await tx<{ pdfHash: string | null }[]>`select pdf_hash from angebot where id = ${angebotId}`;
      await protokolliere(tx, {
        betriebId: kontext.betriebId,
        benutzerId: kontext.benutzerId,
        aktion: "angenommen",
        objekt: "angebot",
        objektId: angebotId,
        daten: { von: "kunde_link", name: e.name, ip: req.ip, userAgent: req.headers["user-agent"] ?? null, pdfHash: h?.pdfHash, auftragId },
      });
      await benachrichtige(tx, kontext.benutzerId, angebotId, true, { name: e.name });
      return ansicht(tx, angebotId);
    });
  });

  app.post("/oeffentlich/angebote/:token/ablehnen", entscheidenBegrenzt, async (req) => {
    const { token } = req.params as { token: string };
    const { grund } = validiere(z.object({ grund: z.string().trim().max(1000).optional() }), req.body ?? {});
    return imLink(token, async (tx, { angebotId, kontext }) => {
      await pruefeOffen(tx, angebotId);
      await tx`update angebot set status = 'abgelehnt', entschieden_am = now(), ablehnungsgrund = ${grund || null}, geaendert_am = now()
        where id = ${angebotId}`;
      await protokolliere(tx, { betriebId: kontext.betriebId, benutzerId: kontext.benutzerId, aktion: "abgelehnt", objekt: "angebot", objektId: angebotId, daten: { von: "kunde_link", grund } });
      await benachrichtige(tx, kontext.benutzerId, angebotId, false, { grund });
      return ansicht(tx, angebotId);
    });
  });
}

