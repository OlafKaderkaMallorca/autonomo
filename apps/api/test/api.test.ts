import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { anmeldenPerLink, auth, legeAdminAn, testUmgebung, type TestUmgebung } from "./hilfen.js";

let u: TestUmgebung;
let adminToken: string;
let olaf: { token: string; betriebId: string };
let kumpel: { token: string; betriebId: string };

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

async function kundeAnlegen(token: string, betriebId: string, name: string) {
  const res = await u.app.inject({
    method: "POST",
    url: `/betriebe/${betriebId}/kunden`,
    headers: auth(token),
    payload: { typ: "privat", name, steuernummer: "12345678Z", email: `${name.toLowerCase()}@kunde.es` },
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().id as string;
}

beforeAll(async () => {
  u = await testUmgebung();
  adminToken = await legeAdminAn(u);
  olaf = await betriebAnlegen("Olaf Garten", "X1234567L", "olaf@test.es");
  kumpel = await betriebAnlegen("Kumpel Pool", "B12345674", "kumpel@test.es");
});

afterAll(async () => {
  await u?.schliessen();
});

describe("Anmeldung", () => {
  it("lehnt falsches Passwort ab", async () => {
    const res = await u.app.inject({ method: "POST", url: "/auth/login", payload: { email: "admin@test.es", passwort: "falsch" } });
    expect(res.statusCode).toBe(401);
  });

  it("antwortet bei unbekannter Adresse gleich wie bei bekannter (keine Kontenerkennung)", async () => {
    const vorher = u.mails.length;
    const res = await u.app.inject({ method: "POST", url: "/auth/magic-link", payload: { email: "niemand@test.es" } });
    expect(res.statusCode).toBe(202);
    expect(u.mails.length).toBe(vorher);
  });

  it("Anmeldelink funktioniert nur einmal", async () => {
    await u.app.inject({ method: "POST", url: "/auth/magic-link", payload: { email: "olaf@test.es" } });
    const mail = u.mails.at(-1)!;
    expect(mail.betreff).toBe("Dein Anmeldelink für Autónomo");
    const token = decodeURIComponent(/token=([^\s]+)/.exec(mail.text)![1]!);
    const erst = await u.app.inject({ method: "POST", url: "/auth/magic-link/einloesen", payload: { token } });
    expect(erst.statusCode).toBe(200);
    const nochmal = await u.app.inject({ method: "POST", url: "/auth/magic-link/einloesen", payload: { token } });
    expect(nochmal.statusCode).toBe(401);
  });

  it("/me listet die Betriebe mit Rolle", async () => {
    const res = await u.app.inject({ method: "GET", url: "/me", headers: auth(olaf.token) });
    expect(res.json().betriebe).toEqual([
      expect.objectContaining({ id: olaf.betriebId, name: "Olaf Garten", rolle: "inhaber" }),
    ]);
  });

  it("Abmelden beendet die Sitzung", async () => {
    await u.app.inject({ method: "POST", url: "/auth/magic-link", payload: { email: "olaf@test.es" } });
    const token = await anmeldenPerLink(u, "olaf@test.es");
    expect((await u.app.inject({ method: "POST", url: "/auth/logout", headers: auth(token) })).statusCode).toBe(200);
    expect((await u.app.inject({ method: "GET", url: "/me", headers: auth(token) })).statusCode).toBe(401);
  });
});

describe("Plattform-Admin", () => {
  it("nur Admins dürfen Betriebe anlegen", async () => {
    const res = await u.app.inject({
      method: "POST",
      url: "/admin/betriebe",
      headers: auth(olaf.token),
      payload: { name: "X", nif: "12345678Z", inhaberEmail: "x@test.es", inhaberName: "X Y" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("prüft die NIF", async () => {
    const res = await u.app.inject({
      method: "POST",
      url: "/admin/betriebe",
      headers: auth(adminToken),
      payload: { name: "X", nif: "12345678A", inhaberEmail: "x@test.es", inhaberName: "X Y" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("sieht keine Geschäftsdaten fremder Betriebe", async () => {
    const res = await u.app.inject({ method: "GET", url: `/betriebe/${olaf.betriebId}/kunden`, headers: auth(adminToken) });
    expect(res.statusCode).toBe(404);
  });
});

describe("Datentrennung zwischen Betrieben", () => {
  let olafsKunde: string;

  beforeAll(async () => {
    olafsKunde = await kundeAnlegen(olaf.token, olaf.betriebId, "Mueller");
    await kundeAnlegen(kumpel.token, kumpel.betriebId, "Garcia");
  });

  it("jeder sieht nur die eigenen Kunden", async () => {
    const a = await u.app.inject({ method: "GET", url: `/betriebe/${olaf.betriebId}/kunden`, headers: auth(olaf.token) });
    expect(a.json().map((k: { name: string }) => k.name)).toEqual(["Mueller"]);
    const b = await u.app.inject({ method: "GET", url: `/betriebe/${kumpel.betriebId}/kunden`, headers: auth(kumpel.token) });
    expect(b.json().map((k: { name: string }) => k.name)).toEqual(["Garcia"]);
  });

  it("kein Zugriff auf fremden Betrieb über die URL", async () => {
    const res = await u.app.inject({ method: "GET", url: `/betriebe/${olaf.betriebId}/kunden`, headers: auth(kumpel.token) });
    expect(res.statusCode).toBe(404);
  });

  it("kein Zugriff auf fremden Kunden über die ID im eigenen Betrieb", async () => {
    const res = await u.app.inject({ method: "GET", url: `/betriebe/${kumpel.betriebId}/kunden/${olafsKunde}`, headers: auth(kumpel.token) });
    expect(res.statusCode).toBe(404);
    const aendern = await u.app.inject({
      method: "PATCH",
      url: `/betriebe/${kumpel.betriebId}/kunden/${olafsKunde}`,
      headers: auth(kumpel.token),
      payload: { name: "gehackt" },
    });
    expect(aendern.statusCode).toBe(404);
  });

  it("die Datenbank selbst verhindert Zugriffe ohne passenden Kontext (RLS)", async () => {
    // Ohne Kontext: keine Zeilen
    expect(await u.sql`select * from kunde`).toHaveLength(0);
    // Mit Kontext des Kumpels: nur seine Zeilen, Einfügen in Olafs Betrieb scheitert
    const zeilen = await u.sql.begin(async (tx) => {
      const [me] = await tx<{ id: string }[]>`select id from benutzer where email = 'kumpel@test.es'`;
      await tx`select set_config('app.benutzer_id', ${me!.id}, true), set_config('app.betrieb_id', ${kumpel.betriebId}, true), set_config('app.rolle', 'inhaber', true)`;
      return tx`select name from kunde`;
    });
    expect(zeilen.map((z) => z.name)).toEqual(["Garcia"]);
    await expect(
      u.sql.begin(async (tx) => {
        const [me] = await tx<{ id: string }[]>`select id from benutzer where email = 'kumpel@test.es'`;
        await tx`select set_config('app.benutzer_id', ${me!.id}, true), set_config('app.betrieb_id', ${kumpel.betriebId}, true), set_config('app.rolle', 'inhaber', true)`;
        await tx`insert into kunde (betrieb_id, typ, name) values (${olaf.betriebId}, 'privat', 'Eindringling')`;
      }),
    ).rejects.toThrow(/row-level security/);
  });
});

describe("Rollen im Betrieb", () => {
  let kundeA: string;
  let kundeB: string;
  let kundenToken: string;
  let beraterToken: string;

  beforeAll(async () => {
    kundeA = await kundeAnlegen(olaf.token, olaf.betriebId, "Schmidt");
    kundeB = await kundeAnlegen(olaf.token, olaf.betriebId, "Lopez");
    const e1 = await u.app.inject({
      method: "POST",
      url: `/betriebe/${olaf.betriebId}/einladungen`,
      headers: auth(olaf.token),
      payload: { email: "schmidt@kunde.es", name: "Herr Schmidt", rolle: "kunde", kundeId: kundeA, sprache: "de" },
    });
    expect(e1.statusCode, e1.body).toBe(201);
    kundenToken = await anmeldenPerLink(u, "schmidt@kunde.es");
    const e2 = await u.app.inject({
      method: "POST",
      url: `/betriebe/${olaf.betriebId}/einladungen`,
      headers: auth(olaf.token),
      payload: { email: "asesoria@test.es", name: "Asesoría", rolle: "steuerberater", sprache: "es" },
    });
    expect(e2.statusCode, e2.body).toBe(201);
    expect(u.mails.at(-1)!.betreff).toBe("Tu enlace de acceso a Autónomo");
    beraterToken = await anmeldenPerLink(u, "asesoria@test.es");
  });

  it("Kunde sieht nur sich selbst", async () => {
    const res = await u.app.inject({ method: "GET", url: `/betriebe/${olaf.betriebId}/kunden`, headers: auth(kundenToken) });
    expect(res.json().map((k: { id: string }) => k.id)).toEqual([kundeA]);
    const fremd = await u.app.inject({ method: "GET", url: `/betriebe/${olaf.betriebId}/kunden/${kundeB}`, headers: auth(kundenToken) });
    expect(fremd.statusCode).toBe(404);
  });

  it("Kunde und Steuerberaterin dürfen keine Kunden ändern", async () => {
    for (const token of [kundenToken, beraterToken]) {
      const res = await u.app.inject({
        method: "PATCH",
        url: `/betriebe/${olaf.betriebId}/kunden/${kundeA}`,
        headers: auth(token),
        payload: { name: "X" },
      });
      expect(res.statusCode).toBe(403);
    }
  });

  it("Steuerberaterin sieht alle Kunden des Betriebs, aber keine anderen Betriebe", async () => {
    const res = await u.app.inject({ method: "GET", url: `/betriebe/${olaf.betriebId}/kunden`, headers: auth(beraterToken) });
    expect(res.json().length).toBeGreaterThanOrEqual(3);
    const fremd = await u.app.inject({ method: "GET", url: `/betriebe/${kumpel.betriebId}/kunden`, headers: auth(beraterToken) });
    expect(fremd.statusCode).toBe(404);
  });

  it("Kunden-Einladung braucht einen Kunden aus dem eigenen Betrieb", async () => {
    const [garcia] = await u.ownerSql<{ id: string }[]>`select id from kunde where name = 'Garcia'`;
    const res = await u.app.inject({
      method: "POST",
      url: `/betriebe/${olaf.betriebId}/einladungen`,
      headers: auth(olaf.token),
      payload: { email: "garcia@kunde.es", name: "Garcia", rolle: "kunde", kundeId: garcia!.id },
    });
    expect(res.statusCode).toBe(404);
  });

  it("Änderungen landen im Aktivitätslog", async () => {
    const log = await u.ownerSql`select aktion, objekt from aktivitaet where betrieb_id = ${olaf.betriebId}`;
    expect(log).toEqual(expect.arrayContaining([
      expect.objectContaining({ aktion: "angelegt", objekt: "kunde" }),
      expect.objectContaining({ aktion: "eingeladen", objekt: "mitgliedschaft" }),
    ]));
  });
});
