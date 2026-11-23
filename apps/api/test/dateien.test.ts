import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { angebotHtml, rechnungHtml } from "../src/pdf/vorlagen.js";
import { anmeldenPerLink, auth, legeAdminAn, testUmgebung, type TestUmgebung } from "./hilfen.js";

let u: TestUmgebung;
let olaf: { token: string; betriebId: string };
let kundeId: string;
let kundeToken: string;
let aufgabeId: string;

const JAHR = new Date().getFullYear();
const b = (pfad: string) => `/betriebe/${olaf.betriebId}${pfad}`;

async function rufe(token: string | null, method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", url: string, payload?: unknown, headers: Record<string, string> = {}) {
  const res = await u.app.inject({ method, url, headers: { ...(token ? auth(token) : {}), ...headers }, payload: payload as never });
  const json = res.headers["content-type"]?.toString().includes("json") ? res.json() : undefined;
  return { status: res.statusCode, body: json, raw: res.rawPayload, typ: res.headers["content-type"] };
}

async function angebotAnlegen(titel = "Gartenpflege") {
  const r = await rufe(olaf.token, "POST", b("/angebote"), {
    kundeId,
    titel,
    gueltigBis: `${JAHR + 1}-01-31`,
    positionen: [
      { art: "pauschale", beschreibung: "Gartenpflege 2× pro Woche", menge: 1, einheit: "Monat", preisCent: 70000, ivaSatz: 21, stundenkontingent: 26 },
      { art: "stunden", beschreibung: "Zusatzarbeiten", menge: 0, einheit: "h", preisCent: 3500, ivaSatz: 21 },
    ],
  });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.id as string;
}

const linkToken = (text: string) => /\/angebot\/([A-Za-z0-9_-]{43})/.exec(text)![1]!;
const UNTERSCHRIFT = `data:image/png;base64,${(await sharp({ create: { width: 200, height: 80, channels: 4, background: "#ffffff00" } }).png().toBuffer()).toString("base64")}`;

beforeAll(async () => {
  u = await testUmgebung();
  const admin = await legeAdminAn(u);
  const res = await u.app.inject({
    method: "POST", url: "/admin/betriebe", headers: auth(admin),
    payload: { name: "Olaf Garten", nif: "X1234567L", inhaberEmail: "olaf@test.es", inhaberName: "Olaf", sprache: "de" },
  });
  olaf = { betriebId: res.json().betriebId, token: await anmeldenPerLink(u, "olaf@test.es") };
  await rufe(olaf.token, "PATCH", b("/einstellungen"), { adresse: "Carrer Major 1, 07001 Palma", iban: "ES9121000418450200051332", email: "olaf@garten.es" });
  kundeId = (await rufe(olaf.token, "POST", b("/kunden"), {
    typ: "privat", name: "Familie Müller", steuernummer: "12345678Z", adresse: "Camí de Son Vida 12, Palma", sprache: "de", email: "mueller@kunde.es",
  })).body.id;
  await rufe(olaf.token, "POST", b("/einladungen"), { email: "hans@mueller.de", name: "Hans Müller", rolle: "kunde", kundeId, sprache: "de" });
  kundeToken = await anmeldenPerLink(u, "hans@mueller.de");
}, 60_000);

afterAll(async () => {
  await u?.schliessen();
});

describe("Logo", () => {
  it("wird verkleinert als PNG gespeichert und ist für Kunden lesbar", async () => {
    const bild = await sharp({ create: { width: 2000, height: 600, channels: 3, background: "#059669" } }).jpeg().toBuffer();
    const r = await rufe(olaf.token, "PUT", b("/logo"), bild, { "content-type": "image/jpeg" });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const logo = await rufe(kundeToken, "GET", b("/logo"));
    expect(logo.status).toBe(200);
    const meta = await sharp(logo.raw).metadata();
    expect(meta).toMatchObject({ format: "png", width: 800 });
  });

  it("lehnt kaputte Bilder ab", async () => {
    const r = await rufe(olaf.token, "PUT", b("/logo"), Buffer.from("kein bild"), { "content-type": "image/png" });
    expect(r.status).toBe(400);
  });
});

describe("PDF-Vorlagen", () => {
  const absender = { name: "Olaf Garten", nif: "X1234567L", adresse: "Carrer Major 1", email: null, telefon: null, iban: "ES91 2100", fusstext: null, farbe: null, logo: null };
  const basis = {
    entwurf: false, typ: "vollstaendig" as const, nummer: "2026-0001", datum: "2026-11-30", leistungszeitraum: "November 2026", faelligAm: "2026-12-14",
    absender, kunde: { name: "Familie <Müller>", steuernummer: "12345678Z", adresse: "Palma" },
    positionen: [{ beschreibung: "Garten", menge: 1, einheit: null, preisCent: 70000, ivaSatz: 21 }],
    ivaGruppen: [{ ivaSatz: 21, basisCent: 70000, ivaCent: 14700 }], basisCent: 70000, irpfSatz: 0, irpfCent: 0, summeCent: 84700,
    korrektur: null, bemerkung: null,
  };

  it("Rechnung auf Deutsch mit spanischen Pflichtbezeichnungen", () => {
    const html = rechnungHtml({ ...basis, sprache: "de" });
    for (const text of ["Rechnung", "Factura", "Bemessungsgrundlage", "Base imponible", "X1234567L", "12345678Z", "ES91 2100", "November 2026"]) {
      expect(html).toContain(text);
    }
    expect(html).toContain("Familie &lt;Müller&gt;");
  });

  it("Korrekturrechnung auf Spanisch nennt die berichtigte Rechnung", () => {
    const html = rechnungHtml({ ...basis, sprache: "es", typ: "korrektur", korrektur: { nummer: "2026-0001", datum: "2026-11-30", grund: "Error" } });
    expect(html).toContain("Factura rectificativa");
    expect(html).toContain("Rectifica la factura 2026-0001");
    expect(html).not.toContain("Rechnung");
  });

  it("Angebot zeigt Pauschale pro Monat und Stunden nach Aufwand", () => {
    const html = angebotHtml({
      sprache: "en", entwurf: false, nummer: "A-2026-0001", titel: "Garden", einleitung: null, datum: "2026-11-23", gueltigBis: "2026-12-31",
      absender, kunde: basis.kunde,
      positionen: [
        { art: "pauschale", beschreibung: "Garden", menge: 1, einheit: null, preisCent: 70000, ivaSatz: 21, stundenkontingent: 26 },
        { art: "stunden", beschreibung: "Extra", menge: 0, einheit: "h", preisCent: 3500, ivaSatz: 21 },
      ],
      ivaGruppen: basis.ivaGruppen, basisCent: 70000, summeCent: 84700, unterschrift: null,
    });
    expect(html).toContain("per month");
    expect(html).toContain("as per hours worked");
    expect(html).toContain("Presupuesto");
  });
});

describe("Angebot per Link", () => {
  let angebotId: string;
  let token: string;

  it("PDF-Vorschau des Entwurfs", async () => {
    angebotId = await angebotAnlegen();
    const r = await rufe(olaf.token, "GET", b(`/angebote/${angebotId}/pdf`));
    expect(r.status).toBe(200);
    expect(r.typ).toContain("application/pdf");
    expect(r.raw.subarray(0, 4).toString()).toBe("%PDF");
  }, 30_000);

  it("Senden: Mail in Kundensprache mit PDF und Link, verschickte Fassung wird mit Hash gespeichert", async () => {
    const r = await rufe(olaf.token, "POST", b(`/angebote/${angebotId}/senden`), {});
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.gesendetAn).toBe("mueller@kunde.es");
    expect(r.body.pdfHash).toMatch(/^[0-9a-f]{64}$/);
    const m = u.mails.at(-1)!;
    expect(m.an).toBe("mueller@kunde.es");
    expect(m.antwortAn).toBe("olaf@garten.es");
    expect(m.betreff).toBe("Angebot A-" + JAHR + "-0001 von Olaf Garten");
    expect(m.anhaenge?.[0]?.dateiname).toBe(`presupuesto-A-${JAHR}-0001.pdf`);
    token = linkToken(m.text);
    expect(r.body.link).toBe(`https://portal.test/angebot/${token}`);
    const a = await rufe(olaf.token, "GET", b(`/angebote/${angebotId}`));
    expect(a.body.status).toBe("gesendet");
    // Kunde im Portal sieht das Angebot jetzt (vorher Entwurf)
    expect((await rufe(kundeToken, "GET", b(`/angebote/${angebotId}`))).status).toBe(200);
  }, 30_000);

  it("Öffnen des Links wird vermerkt, ohne Login", async () => {
    const r = await rufe(null, "GET", `/oeffentlich/angebote/${token}`);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toMatchObject({ sprache: "de", abgelaufen: false, kunde: { name: "Familie Müller" }, betrieb: { name: "Olaf Garten", hatLogo: true } });
    expect(r.body.angebot.positionen).toHaveLength(2);
    const a = await rufe(olaf.token, "GET", b(`/angebote/${angebotId}`));
    expect(a.body.geoeffnetAm).toBeTruthy();
    const pdf = await rufe(null, "GET", `/oeffentlich/angebote/${token}/pdf`);
    expect(pdf.raw.subarray(0, 4).toString()).toBe("%PDF");
    expect((await rufe(null, "GET", `/oeffentlich/angebote/${token}/logo`)).typ).toBe("image/png");
  });

  it("falsche Links liefern nichts", async () => {
    expect((await rufe(null, "GET", `/oeffentlich/angebote/${"A".repeat(43)}`)).status).toBe(404);
    expect((await rufe(null, "GET", "/oeffentlich/angebote/kurz")).status).toBe(404);
  });

  it("Annahme mit Unterschrift legt den Auftrag an und benachrichtigt Olaf", async () => {
    const ohne = await rufe(null, "POST", `/oeffentlich/angebote/${token}/annehmen`, { name: "Hans Müller", unterschrift: "data:image/png;base64," });
    expect(ohne.status).toBe(400);
    const r = await rufe(null, "POST", `/oeffentlich/angebote/${token}/annehmen`, { name: "Hans Müller", unterschrift: UNTERSCHRIFT });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.angebot).toMatchObject({ status: "angenommen", unterschriftName: "Hans Müller" });
    const auftraege = await rufe(olaf.token, "GET", b("/auftraege"));
    expect(auftraege.body.some((x: { titel: string }) => x.titel === "Gartenpflege")).toBe(true);
    expect(u.mails.at(-1)).toMatchObject({ an: "olaf@test.es", betreff: `Angebot A-${JAHR}-0001: angenommen` });
    const nochmal = await rufe(null, "POST", `/oeffentlich/angebote/${token}/annehmen`, { name: "Hans", unterschrift: UNTERSCHRIFT });
    expect(nochmal.status).toBe(409);
    // PDF enthält jetzt die Unterschrift (neu erzeugt)
    const pdf = await rufe(olaf.token, "GET", b(`/angebote/${angebotId}/pdf`));
    expect(pdf.raw.subarray(0, 4).toString()).toBe("%PDF");
  }, 30_000);

  it("erneutes Senden macht den alten Link ungültig; nur Link (für WhatsApp) schickt keine Mail", async () => {
    const id = await angebotAnlegen("Poolreinigung");
    const erst = await rufe(olaf.token, "POST", b(`/angebote/${id}/senden`), { ohneMail: true });
    const mailsVorher = u.mails.length;
    const zweit = await rufe(olaf.token, "POST", b(`/angebote/${id}/senden`), { ohneMail: true });
    expect(u.mails.length).toBe(mailsVorher);
    const alt = erst.body.link.split("/").pop();
    const neu = zweit.body.link.split("/").pop();
    expect((await rufe(null, "GET", `/oeffentlich/angebote/${alt}`)).status).toBe(404);
    const ab = await rufe(null, "POST", `/oeffentlich/angebote/${neu}/ablehnen`, { grund: "Zu teuer" });
    expect(ab.body.angebot.status).toBe("abgelehnt");
    expect(u.mails.at(-1)!.text).toContain("Zu teuer");
  }, 30_000);

  it("abgelaufene Angebote können nicht mehr angenommen werden", async () => {
    const id = await angebotAnlegen("Hecke");
    const s = await rufe(olaf.token, "POST", b(`/angebote/${id}/senden`), { ohneMail: true });
    await u.ownerSql`update angebot set gueltig_bis = '2020-01-01' where id = ${id}`;
    const t = s.body.link.split("/").pop();
    expect((await rufe(null, "GET", `/oeffentlich/angebote/${t}`)).body.abgelaufen).toBe(true);
    expect((await rufe(null, "POST", `/oeffentlich/angebote/${t}/annehmen`, { name: "Hans", unterschrift: UNTERSCHRIFT })).status).toBe(410);
  }, 30_000);
});

describe("Rechnung als PDF und per E-Mail", () => {
  let rechnungId: string;

  it("Entwurf: Vorschau wird nicht gespeichert", async () => {
    rechnungId = (await rufe(olaf.token, "POST", b("/rechnungen"), {
      kundeId, leistungszeitraum: `November ${JAHR}`, positionen: [{ beschreibung: "Gartenpflege", menge: 1, preisCent: 70000, ivaSatz: 21 }],
    })).body.id;
    const vorher = u.speicher.dateien.size;
    const r = await rufe(olaf.token, "GET", b(`/rechnungen/${rechnungId}/pdf`));
    expect(r.raw.subarray(0, 4).toString()).toBe("%PDF");
    expect(u.speicher.dateien.size).toBe(vorher);
    expect((await rufe(olaf.token, "POST", b(`/rechnungen/${rechnungId}/senden`), {})).status).toBe(409);
  }, 30_000);

  it("ausgestellt: PDF wird einmal erzeugt und danach unverändert ausgeliefert", async () => {
    await rufe(olaf.token, "POST", b(`/rechnungen/${rechnungId}/freigeben`));
    const erst = await rufe(olaf.token, "GET", b(`/rechnungen/${rechnungId}/pdf`));
    const zweit = await rufe(kundeToken, "GET", b(`/rechnungen/${rechnungId}/pdf`));
    expect(zweit.status).toBe(200);
    expect(Buffer.compare(erst.raw, zweit.raw)).toBe(0);
    const [r] = await u.ownerSql`select pdf_datei_id from rechnung where id = ${rechnungId}`;
    expect(r!.pdfDateiId).toBeTruthy();
    await expect(u.ownerSql`update rechnung set pdf_datei_id = null where id = ${rechnungId}`).rejects.toThrow();
  }, 30_000);

  it("Senden verschickt das gespeicherte PDF und vermerkt den Versand", async () => {
    const r = await rufe(olaf.token, "POST", b(`/rechnungen/${rechnungId}/senden`), {});
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toMatchObject({ gesendetAn: "mueller@kunde.es" });
    expect(r.body.gesendetAm).toBeTruthy();
    const m = u.mails.at(-1)!;
    expect(m.betreff).toBe(`Rechnung ${JAHR}-0001 von Olaf Garten`);
    expect(m.text).toContain("847,00");
    expect(m.anhaenge?.[0]?.dateiname).toBe(`factura-${JAHR}-0001.pdf`);
  });
});

describe("Fotos", () => {
  let fotoId: string;

  beforeAll(async () => {
    const auftrag = await rufe(olaf.token, "POST", b("/auftraege"), { kundeId, titel: "Garten" });
    aufgabeId = (await rufe(olaf.token, "POST", b("/aufgaben"), { auftragId: auftrag.body.id, titel: "Hecke" })).body.id;
  });

  it("Upload verkleinert, entfernt GPS-Daten und legt eine Vorschau an", async () => {
    const bild = await sharp({ create: { width: 4000, height: 3000, channels: 3, background: "#22aa55" } })
      .withExif({ IFD0: { Make: "TestPhone" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "39/1 34/1 0/1" } })
      .jpeg()
      .toBuffer();
    expect((await sharp(bild).metadata()).exif).toBeTruthy();
    const r = await rufe(olaf.token, "POST", b(`/aufgaben/${aufgabeId}/fotos?art=nachher&beschreibung=Hecke%20fertig`), bild, { "content-type": "image/jpeg" });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body).toMatchObject({ art: "nachher", beschreibung: "Hecke fertig", breite: 2560, hoehe: 1920, sichtbarFuerKunde: true });
    fotoId = r.body.id;

    const gross = await rufe(olaf.token, "GET", b(`/fotos/${fotoId}/bild`));
    expect((await sharp(gross.raw).metadata()).exif).toBeUndefined();
    const klein = await rufe(olaf.token, "GET", b(`/fotos/${fotoId}/bild?groesse=klein`));
    expect((await sharp(klein.raw).metadata()).width).toBe(480);
  });

  it("Kunde sieht nur freigegebene Fotos", async () => {
    expect((await rufe(kundeToken, "GET", b(`/aufgaben/${aufgabeId}/fotos`))).body).toHaveLength(1);
    expect((await rufe(kundeToken, "GET", b(`/fotos/${fotoId}/bild?groesse=klein`))).status).toBe(200);
    await rufe(olaf.token, "PATCH", b(`/fotos/${fotoId}`), { sichtbarFuerKunde: false });
    expect((await rufe(kundeToken, "GET", b(`/aufgaben/${aufgabeId}/fotos`))).body).toHaveLength(0);
    expect((await rufe(kundeToken, "GET", b(`/fotos/${fotoId}/bild`))).status).toBe(404);
    expect((await rufe(kundeToken, "POST", b(`/aufgaben/${aufgabeId}/fotos`), Buffer.from("x"), { "content-type": "image/jpeg" })).status).toBe(403);
  });

  it("Löschen entfernt auch die Dateien", async () => {
    const vorher = u.speicher.dateien.size;
    expect((await rufe(olaf.token, "DELETE", b(`/fotos/${fotoId}`))).status).toBe(200);
    expect(u.speicher.dateien.size).toBe(vorher - 2);
  });

  it("ohne Bild oder mit falschem Typ", async () => {
    expect((await rufe(olaf.token, "POST", b(`/aufgaben/${aufgabeId}/fotos`), Buffer.from("kaputt"), { "content-type": "image/jpeg" })).status).toBe(400);
    expect((await rufe(olaf.token, "POST", b(`/aufgaben/${aufgabeId}/fotos`), { a: 1 })).status).toBe(415);
  });
});
