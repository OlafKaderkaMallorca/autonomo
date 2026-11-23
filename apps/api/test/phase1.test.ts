import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { anmeldenPerLink, auth, legeAdminAn, testUmgebung, type TestUmgebung } from "./hilfen.js";

let u: TestUmgebung;
let adminToken: string;
let olaf: { token: string; betriebId: string };
let kumpel: { token: string; betriebId: string };
let mueller: string; // Privatkunde mit NIF und Adresse
let garcia: string; // Privatkunde ohne NIF
let auftragGarten: string;

const JAHR = new Date().getFullYear();

async function rufe(token: string, method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", pfad: string, payload?: unknown) {
  const res = await u.app.inject({ method, url: pfad, headers: auth(token), payload: payload as never });
  return { status: res.statusCode, body: res.body ? res.json() : undefined };
}
const b = (pfad: string) => `/betriebe/${olaf.betriebId}${pfad}`;

async function betriebAnlegen(name: string, nif: string, email: string) {
  const res = await u.app.inject({
    method: "POST",
    url: "/admin/betriebe",
    headers: auth(adminToken),
    payload: { name, nif, inhaberEmail: email, inhaberName: name, sprache: "de" },
  });
  expect(res.statusCode, res.body).toBe(201);
  const { betriebId } = res.json();
  return { betriebId, token: await anmeldenPerLink(u, email) };
}

beforeAll(async () => {
  u = await testUmgebung();
  adminToken = await legeAdminAn(u);
  olaf = await betriebAnlegen("Olaf Garten", "X1234567L", "olaf@test.es");
  kumpel = await betriebAnlegen("Kumpel Pool", "B12345674", "kumpel@test.es");
  mueller = (await rufe(olaf.token, "POST", b("/kunden"), {
    typ: "privat", name: "Familie Müller", steuernummer: "12345678Z", adresse: "Camí de Son Rapinya 1, Palma", sprache: "de", email: "mueller@kunde.es",
  })).body.id;
  garcia = (await rufe(olaf.token, "POST", b("/kunden"), { typ: "privat", name: "Ana García", sprache: "es" })).body.id;
});

afterAll(async () => {
  await u?.schliessen();
});

describe("Kunden", () => {
  it("IRPF nur bei Firmenkunden", async () => {
    const r = await rufe(olaf.token, "POST", b("/kunden"), { typ: "privat", name: "X", irpf: true });
    expect(r.status).toBe(400);
  });

  it("Suche und Kontakte", async () => {
    const liste = await rufe(olaf.token, "GET", b("/kunden?suche=garc"));
    expect(liste.body.map((k: { name: string }) => k.name)).toEqual(["Ana García"]);
    const k = await rufe(olaf.token, "POST", b(`/kunden/${mueller}/kontakte`), { name: "Hausmeister Toni", telefon: "600000000" });
    expect(k.status).toBe(201);
  });
});

describe("Angebot → Auftrag", () => {
  let angebotId: string;

  it("legt ein Angebot mit fortlaufender Nummer an", async () => {
    const r = await rufe(olaf.token, "POST", b("/angebote"), {
      kundeId: mueller,
      titel: "Gartenpflege",
      gueltigBis: `${JAHR + 1}-01-31`,
      positionen: [
        { art: "pauschale", beschreibung: "Gartenpflege 2× pro Woche", menge: 1, einheit: "Monat", preisCent: 70000, ivaSatz: 21, stundenkontingent: 26 },
        { art: "stunden", beschreibung: "Zusatzarbeiten", menge: 0, einheit: "h", preisCent: 3500, ivaSatz: 21 },
      ],
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.nummer).toBe(`A-${JAHR}-0001`);
    expect(r.body.summen.basisCent).toBe(70000);
    angebotId = r.body.id;
  });

  it("Annahme erzeugt einen Auftrag mit denselben Positionen; danach ist das Angebot fest", async () => {
    const r = await rufe(olaf.token, "POST", b(`/angebote/${angebotId}/angenommen`), { name: "Hans Müller" });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    auftragGarten = r.body.auftragId;
    const auftrag = await rufe(olaf.token, "GET", b(`/auftraege/${auftragGarten}`));
    expect(auftrag.body.positionen.map((p: { art: string }) => p.art)).toEqual(["pauschale", "stunden"]);
    const aendern = await rufe(olaf.token, "PUT", b(`/angebote/${angebotId}`), {
      kundeId: mueller, titel: "Neu", gueltigBis: `${JAHR + 1}-01-31`,
      positionen: [{ art: "pauschale", beschreibung: "x", preisCent: 1, ivaSatz: 21 }],
    });
    expect(aendern.status).toBe(409);
    const nochmal = await rufe(olaf.token, "POST", b(`/angebote/${angebotId}/angenommen`), { name: "Hans" });
    expect(nochmal.status).toBe(409);
  });

  it("Beginn des Auftrags lässt sich für die Tests in den Vormonat legen", async () => {
    await u.ownerSql`update auftrag set beginn = ${`${JAHR}-01-01`} where id = ${auftragGarten}`;
  });
});

describe("Aufgaben", () => {
  it("anlegen, Notiz, erledigen", async () => {
    const a = await rufe(olaf.token, "POST", b("/aufgaben"), { auftragId: auftragGarten, titel: "Hecke schneiden" });
    expect(a.status, JSON.stringify(a.body)).toBe(201);
    expect((await rufe(olaf.token, "POST", b(`/aufgaben/${a.body.id}/notizen`), { text: "Leiter mitnehmen" })).status).toBe(201);
    const e = await rufe(olaf.token, "PATCH", b(`/aufgaben/${a.body.id}`), { status: "erledigt" });
    expect(e.body.erledigtAm).toBeTruthy();
  });
});

describe("Zeiterfassung", () => {
  it("Timer: nur einer gleichzeitig, Stopp schreibt das Ende", async () => {
    const s = await rufe(olaf.token, "POST", b("/timer/start"), { auftragId: auftragGarten });
    expect(s.status, JSON.stringify(s.body)).toBe(201);
    expect((await rufe(olaf.token, "POST", b("/timer/start"), { auftragId: auftragGarten })).status).toBe(409);
    const stopp = await rufe(olaf.token, "POST", b("/timer/stopp"), {});
    expect(stopp.body.ende).toBeTruthy();
    expect((await rufe(olaf.token, "GET", b("/timer"))).body.timer).toBeNull();
    await rufe(olaf.token, "DELETE", b(`/zeiten/${stopp.body.id}`));
  });

  it("nachträgliche Einträge im Oktober, abrechenbar wegen Stundenposition", async () => {
    for (const tag of ["07", "14", "21"]) {
      const r = await rufe(olaf.token, "POST", b("/zeiten"), { auftragId: auftragGarten, start: `${JAHR}-10-${tag}T08:00:00+02:00`, dauerMinuten: 180 });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      expect(r.body.abrechenbar).toBe(true);
    }
    const sum = await rufe(olaf.token, "GET", b(`/zeiten/summen?einheit=monat&von=${JAHR}-10-01&bis=${JAHR}-10-31`));
    expect(sum.status, JSON.stringify(sum.body)).toBe(200);
    expect(sum.body[0].minuten).toBe(540);
  });

  it("Material", async () => {
    const r = await rufe(olaf.token, "POST", b("/material"), { auftragId: auftragGarten, datum: `${JAHR}-10-10`, beschreibung: "Rindenmulch", menge: 2, einheit: "Sack", preisCent: 899 });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
  });
});

describe("Rechnungen", () => {
  let oktober: string;

  it("Monatsentwurf: Pauschale, Stunden und Material; zweiter Lauf erzeugt nichts doppelt", async () => {
    const r = await rufe(olaf.token, "POST", b("/rechnungen/monatsentwuerfe"), { monat: `${JAHR}-10` });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.erstellt).toHaveLength(1);
    oktober = r.body.erstellt[0].rechnungId;
    const re = await rufe(olaf.token, "GET", b(`/rechnungen/${oktober}`));
    expect(re.body.leistungszeitraum).toBe(`Oktober ${JAHR}`);
    expect(re.body.positionen.map((p: { quelle: string }) => p.quelle)).toEqual(["pauschale", "stunden", "material"]);
    expect(re.body.positionen[1]).toMatchObject({ menge: 9, preisCent: 3500, beschreibung: "Arbeitsstunden – Gartenpflege" });
    expect(re.body.basisCent).toBe(70000 + 31500 + 1798);

    const zweiter = await rufe(olaf.token, "POST", b("/rechnungen/monatsentwuerfe"), { monat: `${JAHR}-10` });
    expect(zweiter.body.erstellt).toHaveLength(0);
    expect(zweiter.body.uebersprungen[0].grund).toBe("entwurf_existiert");
  });

  it("Freigabe verlangt vollständige Betriebsdaten", async () => {
    const r = await rufe(olaf.token, "POST", b(`/rechnungen/${oktober}/freigeben`));
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("betrieb_daten_fehlen");
    const e = await rufe(olaf.token, "PATCH", b("/einstellungen"), { adresse: "Carrer Major 1, 07001 Palma", iban: "ES9121000418450200051332", zahlungszielTage: 10 });
    expect(e.status, JSON.stringify(e.body)).toBe(200);
  });

  it("Freigabe vergibt die Nummer, friert Daten ein und sperrt die Rechnung", async () => {
    const r = await rufe(olaf.token, "POST", b(`/rechnungen/${oktober}/freigeben`));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toMatchObject({ nummer: `${JAHR}-0001`, status: "ausgestellt", typ: "vollstaendig", sprache: "de" });
    expect(r.body.summeCent).toBe(Math.round(103298 * 1.21));
    expect(r.body.kundeSnapshot.name).toBe("Familie Müller");

    expect((await rufe(olaf.token, "PATCH", b(`/rechnungen/${oktober}`), { bemerkung: "x" })).status).toBe(409);
    expect((await rufe(olaf.token, "DELETE", b(`/rechnungen/${oktober}`))).status).toBe(409);
    // Auch direkt in der Datenbank nicht änderbar
    await expect(u.ownerSql`update rechnung set summe_cent = 1 where id = ${oktober}`).rejects.toThrow();
    await expect(u.ownerSql`update rechnung_position set preis_cent = 1 where rechnung_id = ${oktober}`).rejects.toThrow();
    // Abgerechnete Stunden sind gesperrt
    const zeiten = await rufe(olaf.token, "GET", b(`/zeiten?von=${JAHR}-10-01&bis=${JAHR}-10-31`));
    const geloescht = await rufe(olaf.token, "DELETE", b(`/zeiten/${zeiten.body[0].id}`));
    expect(geloescht.status).toBe(409);
  });

  it("vereinfachte Rechnung nur bis 400 €, darüber braucht der Kunde NIF und Adresse", async () => {
    const klein = await rufe(olaf.token, "POST", b("/rechnungen"), {
      kundeId: garcia, positionen: [{ beschreibung: "Rasen mähen", menge: 2, einheit: "h", preisCent: 3500, ivaSatz: 21 }],
    });
    expect(klein.status, JSON.stringify(klein.body)).toBe(201);
    const f = await rufe(olaf.token, "POST", b(`/rechnungen/${klein.body.id}/freigeben`));
    expect(f.body).toMatchObject({ typ: "vereinfacht", nummer: `${JAHR}-0002` });

    const gross = await rufe(olaf.token, "POST", b("/rechnungen"), {
      kundeId: garcia, positionen: [{ beschreibung: "Pool", menge: 1, preisCent: 50000, ivaSatz: 21 }],
    });
    const g = await rufe(olaf.token, "POST", b(`/rechnungen/${gross.body.id}/freigeben`));
    expect(g.status).toBe(400);
    expect(g.body.code).toBe("nif_und_adresse_noetig");
    await rufe(olaf.token, "DELETE", b(`/rechnungen/${gross.body.id}`));
  });

  it("parallele Freigaben vergeben lückenlose, eindeutige Nummern", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) {
      const r = await rufe(olaf.token, "POST", b("/rechnungen"), {
        kundeId: mueller, positionen: [{ beschreibung: `Einsatz ${i}`, menge: 1, preisCent: 1000 * (i + 1), ivaSatz: 21 }],
      });
      ids.push(r.body.id);
    }
    const ergebnisse = await Promise.all(ids.map((id) => rufe(olaf.token, "POST", b(`/rechnungen/${id}/freigeben`))));
    expect(ergebnisse.every((e) => e.status === 200)).toBe(true);
    const nummern = ergebnisse.map((e) => e.body.nummer as string).sort();
    expect(nummern).toEqual([3, 4, 5, 6, 7, 8].map((n) => `${JAHR}-${String(n).padStart(4, "0")}`));
  });

  it("Korrekturrechnung storniert mit eigener Serie und Bezug aufs Original", async () => {
    const k = await rufe(olaf.token, "POST", b(`/rechnungen/${oktober}/korrektur`), { grund: "Pauschale doppelt berechnet" });
    expect(k.status, JSON.stringify(k.body)).toBe(201);
    expect(k.body.positionen).toHaveLength(3);
    expect(k.body.positionen[0].menge).toBe(-1);
    expect(k.body.positionen[0].beschreibung).toContain(`${JAHR}-0001`);
    const f = await rufe(olaf.token, "POST", b(`/rechnungen/${k.body.id}/freigeben`));
    expect(f.status, JSON.stringify(f.body)).toBe(200);
    expect(f.body).toMatchObject({ nummer: `R-${JAHR}-0001`, typ: "korrektur", korrigiertRechnungId: oktober });
    expect(f.body.summeCent).toBe(-Math.round(103298 * 1.21));
  });

  it("bezahlt markieren und wieder zurücksetzen", async () => {
    const r = await rufe(olaf.token, "POST", b(`/rechnungen/${oktober}/bezahlt`), { bezahltAm: `${JAHR}-11-02` });
    expect(r.body).toMatchObject({ status: "bezahlt", bezahltAm: `${JAHR}-11-02` });
    const zurueck = await rufe(olaf.token, "POST", b(`/rechnungen/${oktober}/bezahlt`), { bezahltAm: null });
    expect(zurueck.body.status).toBe("ausgestellt");
  });

  it("Übersicht zeigt offene Rechnungen und den effektiven Stundensatz der Pauschale", async () => {
    const r = await rufe(olaf.token, "GET", b(`/uebersicht?monat=${JAHR}-10`));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.rechnungen.offenAnzahl).toBeGreaterThan(0);
    const m = r.body.kunden.find((k: { name: string }) => k.name === "Familie Müller");
    expect(m).toMatchObject({ minuten: 540, pauschaleCent: 70000, effektiverStundensatzCent: Math.round(70000 / 9) });
  });
});

describe("Sichtbarkeit (Row-Level-Security)", () => {
  let kundeToken: string;

  beforeAll(async () => {
    await rufe(olaf.token, "POST", b("/einladungen"), { email: "hans@mueller.de", name: "Hans Müller", rolle: "kunde", kundeId: mueller, sprache: "de" });
    kundeToken = await anmeldenPerLink(u, "hans@mueller.de");
  });

  it("Kunde sieht nur eigene ausgestellte Rechnungen, keine Entwürfe", async () => {
    await rufe(olaf.token, "POST", b("/rechnungen"), { kundeId: mueller, positionen: [{ beschreibung: "Entwurf", menge: 1, preisCent: 100, ivaSatz: 21 }] });
    const r = await rufe(kundeToken, "GET", b("/rechnungen"));
    expect(r.status).toBe(200);
    expect(r.body.length).toBeGreaterThan(0);
    expect(r.body.every((x: { status: string; kundeName: string }) => x.status !== "entwurf" && x.kundeName === "Familie Müller")).toBe(true);
  });

  it("Kunde darf keine Rechnungen anlegen oder freigeben", async () => {
    const r = await rufe(kundeToken, "POST", b("/rechnungen"), { kundeId: mueller, positionen: [] });
    expect(r.status).toBe(403);
  });

  it("anderer Betrieb sieht nichts von Olaf", async () => {
    const r = await rufe(kumpel.token, "GET", `/betriebe/${kumpel.betriebId}/rechnungen`);
    expect(r.body).toEqual([]);
    const fremd = await rufe(kumpel.token, "GET", b("/rechnungen"));
    expect(fremd.status).toBe(404);
  });
});

describe("Plattform-Admin", () => {
  it("kann einen Betrieb sperren und entsperren", async () => {
    expect((await rufe(adminToken, "PATCH", `/admin/betriebe/${kumpel.betriebId}`, { gesperrt: true })).status).toBe(200);
    expect((await rufe(kumpel.token, "GET", `/betriebe/${kumpel.betriebId}/kunden`)).status).toBe(423);
    await rufe(adminToken, "PATCH", `/admin/betriebe/${kumpel.betriebId}`, { gesperrt: false });
    expect((await rufe(kumpel.token, "GET", `/betriebe/${kumpel.betriebId}/kunden`)).status).toBe(200);
  });
});
