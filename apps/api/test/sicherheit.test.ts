import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { aktuellesFenster, totpCode } from "../src/auth/totp.js";
import { anmeldenPerLink, auth, legeAdminAn, testUmgebung, type TestUmgebung } from "./hilfen.js";

let u: TestUmgebung;
let olaf: { token: string; betriebId: string };
let auftragId: string;

async function rufe(token: string, method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", pfad: string, payload?: unknown) {
  const res = await u.app.inject({ method, url: pfad, headers: auth(token), payload: payload as never });
  return { status: res.statusCode, body: res.body ? res.json() : undefined };
}
const b = (pfad: string) => `/betriebe/${olaf.betriebId}${pfad}`;

beforeAll(async () => {
  u = await testUmgebung();
  const admin = await legeAdminAn(u);
  const res = await u.app.inject({
    method: "POST",
    url: "/admin/betriebe",
    headers: auth(admin),
    payload: { name: "Olaf Garten", nif: "X1234567L", inhaberEmail: "olaf@test.es", inhaberName: "Olaf", sprache: "de" },
  });
  olaf = { betriebId: res.json().betriebId, token: await anmeldenPerLink(u, "olaf@test.es") };
  const kunde = await rufe(olaf.token, "POST", b("/kunden"), { typ: "privat", name: "Familie Müller" });
  const auftrag = await rufe(olaf.token, "POST", b("/auftraege"), {
    kundeId: kunde.body.id,
    titel: "Garten",
    positionen: [{ art: "stunden", beschreibung: "Arbeit", menge: 0, einheit: "h", preisCent: 3500, ivaSatz: 21 }],
  });
  auftragId = auftrag.body.id;
  // Passwort setzen, damit der Login mit Passwort getestet werden kann
  await rufe(olaf.token, "PATCH", "/me", { neuesPasswort: "geheim-geheim-123" });
});

afterAll(async () => {
  await u?.schliessen();
});

describe("Offline-Abgleich: erneutes Senden legt nichts doppelt an", () => {
  it("Zeiteintrag mit Geräte-ID", async () => {
    const id = randomUUID();
    const eintrag = { id, auftragId, start: "2026-11-02T08:00:00+01:00", ende: "2026-11-02T10:30:00+01:00" };
    const a = await rufe(olaf.token, "POST", b("/zeiten"), eintrag);
    const c = await rufe(olaf.token, "POST", b("/zeiten"), eintrag);
    expect(a.status).toBe(201);
    expect(c.body.id).toBe(id);
    const liste = await rufe(olaf.token, "GET", b(`/zeiten?auftragId=${auftragId}`));
    expect(liste.body.filter((z: { id: string }) => z.id === id)).toHaveLength(1);
    expect(a.body.dauerMinuten).toBe(150);
  });

  it("Timer offline gestartet und gestoppt, mit Zeiten vom Gerät", async () => {
    const id = randomUUID();
    const start = new Date(Date.now() - 2 * 3600_000).toISOString();
    const ende = new Date(Date.now() - 30 * 60_000).toISOString();
    const s1 = await rufe(olaf.token, "POST", b("/timer/start"), { id, auftragId, start });
    expect(s1.status, JSON.stringify(s1.body)).toBe(201);
    const s2 = await rufe(olaf.token, "POST", b("/timer/start"), { id, auftragId, start });
    expect(s2.body.id).toBe(id); // erneut gesendet → kein Konflikt
    const stopp = await rufe(olaf.token, "POST", b("/timer/stopp"), { id, ende });
    expect(stopp.status).toBe(200);
    expect(stopp.body.dauerMinuten).toBe(90);
    const nochmal = await rufe(olaf.token, "POST", b("/timer/stopp"), { id, ende });
    expect(nochmal.status).toBe(200);
    expect(nochmal.body.dauerMinuten).toBe(90);
  });

  it("Timer auf anderem Gerät schon gestartet → Konflikt", async () => {
    const web = await rufe(olaf.token, "POST", b("/timer/start"), { auftragId });
    expect(web.status).toBe(201);
    const app = await rufe(olaf.token, "POST", b("/timer/start"), { id: randomUUID(), auftragId, start: new Date(Date.now() - 60_000).toISOString() });
    expect(app.status).toBe(409);
    expect(app.body.code).toBe("timer_laeuft");
    await rufe(olaf.token, "POST", b("/timer/stopp"), {});
  });

  it("Startzeit älter als 24 Stunden wird abgelehnt", async () => {
    const r = await rufe(olaf.token, "POST", b("/timer/start"), { auftragId, start: new Date(Date.now() - 30 * 3600_000).toISOString() });
    expect(r.status).toBe(400);
  });

  it("Aufgabe, Notiz und Foto mit Geräte-ID", async () => {
    const id = randomUUID();
    const g1 = await rufe(olaf.token, "POST", b("/aufgaben"), { id, auftragId, titel: "Hecke schneiden" });
    const g2 = await rufe(olaf.token, "POST", b("/aufgaben"), { id, auftragId, titel: "Hecke schneiden" });
    expect(g1.status).toBe(201);
    expect(g2.body.id).toBe(id);

    const nid = randomUUID();
    await rufe(olaf.token, "POST", b(`/aufgaben/${id}/notizen`), { id: nid, text: "Offline notiert" });
    await rufe(olaf.token, "POST", b(`/aufgaben/${id}/notizen`), { id: nid, text: "Offline notiert" });
    const g = await rufe(olaf.token, "GET", b(`/aufgaben/${id}`));
    expect(g.body.notizen).toHaveLength(1);

    const bild = await sharp({ create: { width: 40, height: 30, channels: 3, background: "#3a7" } }).jpeg().toBuffer();
    const fid = randomUUID();
    for (let i = 0; i < 2; i++) {
      const res = await u.app.inject({
        method: "POST",
        url: b(`/aufgaben/${id}/fotos?id=${fid}`),
        headers: { ...auth(olaf.token), "content-type": "image/jpeg" },
        payload: bild,
      });
      expect(res.statusCode).toBe(i === 0 ? 201 : 200);
      expect(res.json().id).toBe(fid);
    }
    const fotos = await rufe(olaf.token, "GET", b(`/aufgaben/${id}/fotos`));
    expect(fotos.body).toHaveLength(1);
  });

  it("Aufgabe auf zwei Geräten geändert → Konflikt mit aktueller Fassung", async () => {
    const g = await rufe(olaf.token, "POST", b("/aufgaben"), { auftragId, titel: "Pool reinigen" });
    const stand = g.body.geaendertAm;
    await new Promise((r) => setTimeout(r, 5));
    const web = await rufe(olaf.token, "PATCH", b(`/aufgaben/${g.body.id}`), { titel: "Pool reinigen (Filter!)" });
    expect(web.status).toBe(200);
    const app = await rufe(olaf.token, "PATCH", b(`/aufgaben/${g.body.id}`), { titel: "Pool + Filter", stand });
    expect(app.status).toBe(409);
    expect(app.body.code).toBe("konflikt");
    expect(app.body.details.titel).toBe("Pool reinigen (Filter!)");
    // mit aktuellem Stand klappt es
    const neu = await rufe(olaf.token, "PATCH", b(`/aufgaben/${g.body.id}`), { status: "erledigt", stand: web.body.geaendertAm });
    expect(neu.status).toBe(200);
  });
});

describe("Zwei-Faktor-Anmeldung", () => {
  let geheimnis: string;
  let notfallcodes: string[];
  const login = (payload: Record<string, string>) =>
    u.app.inject({ method: "POST", url: "/auth/login", payload: { email: "olaf@test.es", passwort: "geheim-geheim-123", ...payload } });

  it("einrichten und mit Code bestätigen", async () => {
    const e = await rufe(olaf.token, "POST", "/me/2fa/einrichten");
    expect(e.status).toBe(200);
    geheimnis = e.body.geheimnis;
    expect(e.body.otpauthUrl).toMatch(/^otpauth:\/\/totp\/ApuntaPro:olaf%40test\.es\?secret=/);
    const falsch = await rufe(olaf.token, "POST", "/me/2fa/aktivieren", { code: "000000" === totpCode(geheimnis, aktuellesFenster()) ? "111111" : "000000" });
    expect(falsch.status).toBe(400);
    const ok = await rufe(olaf.token, "POST", "/me/2fa/aktivieren", { code: totpCode(geheimnis, aktuellesFenster()) });
    expect(ok.status).toBe(200);
    notfallcodes = ok.body.notfallcodes;
    expect(notfallcodes).toHaveLength(8);
    expect((await rufe(olaf.token, "GET", "/me")).body.zweiFaktor).toBe(true);
  });

  it("Login verlangt danach den Code, ein Code gilt nur einmal", async () => {
    const ohne = await login({});
    expect(ohne.statusCode).toBe(401);
    expect(ohne.json().code).toBe("zweiter_faktor");
    // Das aktuelle Fenster wurde beim Aktivieren schon verbraucht → nächstes Fenster (Toleranz +1)
    const code = totpCode(geheimnis, aktuellesFenster() + 1);
    const mit = await login({ code });
    expect(mit.statusCode).toBe(200);
    const nochmal = await login({ code });
    expect(nochmal.statusCode).toBe(401);
    expect(nochmal.json().code).toBe("code_falsch");
  });

  it("Notfallcode funktioniert genau einmal", async () => {
    const code = notfallcodes[0]!.toUpperCase();
    expect((await login({ code })).statusCode).toBe(200);
    expect((await login({ code })).statusCode).toBe(401);
  });

  it("Anmeldelink verlangt den Code ebenfalls, ohne den Link zu verbrauchen", async () => {
    await u.app.inject({ method: "POST", url: "/auth/magic-link", payload: { email: "olaf@test.es" } });
    const mail = [...u.mails].reverse().find((m) => m.an === "olaf@test.es")!;
    const token = decodeURIComponent(/token=([^\s]+)/.exec(mail.text)![1]!);
    const ohne = await u.app.inject({ method: "POST", url: "/auth/magic-link/einloesen", payload: { token } });
    expect(ohne.json().code).toBe("zweiter_faktor");
    const mit = await u.app.inject({ method: "POST", url: "/auth/magic-link/einloesen", payload: { token, code: notfallcodes[1] } });
    expect(mit.statusCode).toBe(200);
  });

  it("ausschalten nur mit Code", async () => {
    expect((await rufe(olaf.token, "POST", "/me/2fa/ausschalten", { code: "999999" })).status).toBe(401);
    const ok = await rufe(olaf.token, "POST", "/me/2fa/ausschalten", { code: notfallcodes[2] });
    expect(ok.status).toBe(200);
    expect((await login({})).statusCode).toBe(200);
  });
});

describe("Sitzungen", () => {
  it("laufen nach Inaktivität ab", async () => {
    const t = (await u.app.inject({ method: "POST", url: "/auth/login", payload: { email: "olaf@test.es", passwort: "geheim-geheim-123" } })).json().token;
    expect((await rufe(t, "GET", "/me")).status).toBe(200);
    await u.ownerSql`update sitzung set zuletzt_aktiv_am = now() - interval '15 days'`;
    const r = await rufe(t, "GET", "/me");
    expect(r.status).toBe(401);
    expect(r.body.code).toBe("sitzung_abgelaufen");
  });

  it("auf allen Geräten abmelden", async () => {
    const login = () => u.app.inject({ method: "POST", url: "/auth/login", payload: { email: "olaf@test.es", passwort: "geheim-geheim-123" } });
    const handy = (await login()).json().token;
    const laptop = (await login()).json().token;
    expect((await rufe(laptop, "POST", "/auth/logout-alle")).status).toBe(200);
    expect((await rufe(handy, "GET", "/me")).status).toBe(401);
    expect((await rufe(laptop, "GET", "/me")).status).toBe(401);
  });
});
