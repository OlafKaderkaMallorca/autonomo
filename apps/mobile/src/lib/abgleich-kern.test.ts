import { describe, expect, it } from "vitest";
import {
  abgleichen,
  AntwortFehler,
  aufgabenMitAusstehenden,
  OfflineFehler,
  stoppVorgang,
  timerZusammenfuehren,
  zeitenMitAusstehenden,
  type AufgabeKurz,
  type Eintrag,
  type Meldung,
  type Netz,
  type Vorgang,
  type Warteschlange,
} from "./abgleich-kern";

const B = "b1";

function warteschlange(vorgaenge: Vorgang[] = []): Warteschlange & { eintraege: Eintrag[] } {
  let nr = 0;
  const eintraege: Eintrag[] = [];
  const ws = {
    eintraege,
    async alle() {
      return [...eintraege];
    },
    async fuegeHinzu(betriebId: string, vorgang: Vorgang) {
      eintraege.push({ nr: ++nr, betriebId, vorgang, fehler: null, erstelltAm: "2026-11-23T10:00:00.000Z" });
    },
    async ersetze(n: number, vorgang: Vorgang) {
      const e = eintraege.find((x) => x.nr === n)!;
      e.vorgang = vorgang;
    },
    async entferne(n: number) {
      eintraege.splice(eintraege.findIndex((x) => x.nr === n), 1);
    },
    async setzeFehler(n: number, fehler: string) {
      eintraege.find((x) => x.nr === n)!.fehler = fehler;
    },
  };
  for (const v of vorgaenge) void ws.fuegeHinzu(B, v);
  return ws;
}

type Antwort = (method: string, pfad: string, body: unknown) => unknown;
function netz(antwort: Antwort = () => ({})): Netz & { aufrufe: { method: string; pfad: string; body: unknown }[] } {
  const aufrufe: { method: string; pfad: string; body: unknown }[] = [];
  return {
    aufrufe,
    async json(method, pfad, body) {
      aufrufe.push({ method, pfad, body });
      return antwort(method, pfad, body);
    },
    async foto(pfad, uri) {
      aufrufe.push({ method: "FOTO", pfad, body: uri });
      antwort("FOTO", pfad, uri);
    },
  };
}

const T1 = "11111111-1111-4111-8111-111111111111";
const A1 = "22222222-2222-4222-8222-222222222222";
const G1 = "33333333-3333-4333-8333-333333333333";

describe("abgleichen", () => {
  it("schickt alle Vorgänge in Reihenfolge und leert die Warteschlange", async () => {
    const ws = warteschlange([
      { art: "timer_start", daten: { id: T1, auftragId: A1, start: "2026-11-23T08:00:00.000Z" } },
      { art: "timer_stopp", daten: { id: T1, ende: "2026-11-23T10:00:00.000Z" } },
      { art: "foto_neu", daten: { id: G1, aufgabeId: G1, uri: "file:///x.jpg", fotoArt: "vorher" } },
    ]);
    const n = netz();
    const hochgeladen: string[] = [];
    expect(await abgleichen(ws, n, { meldung: () => {}, fotoHochgeladen: (u) => hochgeladen.push(u) })).toBe("fertig");
    expect(n.aufrufe.map((a) => `${a.method} ${a.pfad}`)).toEqual([
      "POST /betriebe/b1/timer/start",
      "POST /betriebe/b1/timer/stopp",
      `FOTO /betriebe/b1/aufgaben/${G1}/fotos?id=${G1}&art=vorher`,
    ]);
    expect(ws.eintraege).toHaveLength(0);
    expect(hochgeladen).toEqual(["file:///x.jpg"]);
  });

  it("bricht ohne Netz ab und behält alles", async () => {
    const ws = warteschlange([{ art: "aufgabe_neu", daten: { id: G1, auftragId: A1, titel: "Hecke" } }]);
    const n = netz(() => {
      throw new OfflineFehler("offline");
    });
    expect(await abgleichen(ws, n, { meldung: () => {} })).toBe("offline");
    expect(ws.eintraege).toHaveLength(1);
    expect(ws.eintraege[0]!.fehler).toBeNull();
  });

  it("Serverfehler 5xx zählt wie offline, 4xx wird als Fehler markiert und übersprungen", async () => {
    const ws = warteschlange([
      { art: "notiz_neu", daten: { id: G1, aufgabeId: G1, text: "x" } },
      { art: "aufgabe_neu", daten: { id: G1, auftragId: A1, titel: "Hecke" } },
    ]);
    const meldungen: Meldung[] = [];
    let erster = true;
    const n = netz(() => {
      if (erster) {
        erster = false;
        throw new AntwortFehler(404, "Aufgabe nicht gefunden");
      }
      return {};
    });
    expect(await abgleichen(ws, n, { meldung: (m) => meldungen.push(m) })).toBe("fertig");
    expect(ws.eintraege).toHaveLength(1);
    expect(ws.eintraege[0]!.fehler).toBe("Aufgabe nicht gefunden");
    expect(meldungen).toEqual([{ art: "fehler", text: "Aufgabe nicht gefunden" }]);

    const ws2 = warteschlange([{ art: "notiz_neu", daten: { id: G1, aufgabeId: G1, text: "x" } }]);
    expect(await abgleichen(ws2, netz(() => { throw new AntwortFehler(503, "weg"); }), { meldung: () => {} })).toBe("offline");
    expect(ws2.eintraege[0]!.fehler).toBeNull();
  });

  it("401 meldet abgemeldet und lässt die Vorgänge liegen", async () => {
    const ws = warteschlange([{ art: "notiz_neu", daten: { id: G1, aufgabeId: G1, text: "x" } }]);
    expect(await abgleichen(ws, netz(() => { throw new AntwortFehler(401, "weg"); }), { meldung: () => {} })).toBe("abgemeldet");
    expect(ws.eintraege).toHaveLength(1);
  });

  it("Timer-Konflikt: lief schon woanders → gestoppte Zeit wird eigener Eintrag", async () => {
    const ws = warteschlange([
      { art: "timer_start", daten: { id: T1, auftragId: A1, start: "2026-11-23T08:00:00.000Z" } },
      { art: "timer_stopp", daten: { id: T1, ende: "2026-11-23T09:30:00.000Z", notiz: "Rasen" } },
    ]);
    const meldungen: Meldung[] = [];
    const n = netz((_m, pfad) => {
      if (pfad.endsWith("/timer/start")) throw new AntwortFehler(409, "Es läuft schon ein Timer", "timer_laeuft");
      return {};
    });
    expect(await abgleichen(ws, n, { meldung: (m) => meldungen.push(m) })).toBe("fertig");
    expect(n.aufrufe.map((a) => a.pfad)).toEqual(["/betriebe/b1/timer/start", "/betriebe/b1/zeiten"]);
    expect(n.aufrufe[1]!.body).toEqual({ id: T1, auftragId: A1, start: "2026-11-23T08:00:00.000Z", ende: "2026-11-23T09:30:00.000Z", notiz: "Rasen" });
    expect(meldungen).toEqual([{ art: "konflikt_timer" }]);
  });

  it("Timer-Konflikt bei noch laufendem Timer → nur lokal weiterführen", async () => {
    const ws = warteschlange([{ art: "timer_start", daten: { id: T1, auftragId: A1, start: "2026-11-23T08:00:00.000Z" } }]);
    const lokal: string[] = [];
    const n = netz(() => {
      throw new AntwortFehler(409, "läuft", "timer_laeuft");
    });
    await abgleichen(ws, n, { meldung: () => {}, timerNurLokal: (id) => lokal.push(id) });
    expect(lokal).toEqual([T1]);
    expect(ws.eintraege).toHaveLength(0);
  });

  it("Stopp für schon gestoppten Timer wird still verworfen", async () => {
    const ws = warteschlange([{ art: "timer_stopp", daten: { id: T1, ende: "2026-11-23T09:30:00.000Z" } }]);
    const meldungen: Meldung[] = [];
    await abgleichen(ws, netz(() => { throw new AntwortFehler(404, "kein Timer", "kein_timer"); }), { meldung: (m) => meldungen.push(m) });
    expect(ws.eintraege).toHaveLength(0);
    expect(meldungen).toEqual([]);
  });

  it("Aufgaben-Konflikt: Abhaken gewinnt und wird mit neuem Stand wiederholt", async () => {
    const ws = warteschlange([
      { art: "aufgabe_aendern", daten: { aufgabeId: G1, titel: "Hecke", aenderung: { status: "erledigt" }, stand: "2026-11-23T08:00:00.000Z" } },
    ]);
    let versuch = 0;
    const n = netz(() => {
      if (versuch++ === 0) throw new AntwortFehler(409, "geändert", "konflikt", { geaendertAm: "2026-11-23T09:00:00.000Z", titel: "Hecke!" });
      return {};
    });
    await abgleichen(ws, n, { meldung: () => {} });
    expect(n.aufrufe[1]!.body).toEqual({ status: "erledigt", stand: "2026-11-23T09:00:00.000Z" });
    expect(ws.eintraege).toHaveLength(0);
  });

  it("Aufgaben-Konflikt bei Textänderung: Server-Fassung bleibt, eigene Änderung wird Notiz", async () => {
    const ws = warteschlange([
      { art: "aufgabe_aendern", daten: { aufgabeId: G1, titel: "Hecke", aenderung: { titel: "Hecke + Zaun" }, stand: "2026-11-23T08:00:00.000Z" } },
    ]);
    const meldungen: Meldung[] = [];
    const n = netz((m) => {
      if (m === "PATCH") throw new AntwortFehler(409, "geändert", "konflikt", { geaendertAm: "2026-11-23T09:00:00.000Z", titel: "Hecke (Web)" });
      return {};
    });
    await abgleichen(ws, n, { meldung: (x) => meldungen.push(x) });
    expect(n.aufrufe[1]!.pfad).toBe(`/betriebe/b1/aufgaben/${G1}/notizen`);
    expect((n.aufrufe[1]!.body as { text: string }).text).toContain("Titel: Hecke + Zaun");
    expect((n.aufrufe[1]!.body as { id: string }).id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(meldungen).toEqual([{ art: "konflikt_aufgabe", titel: "Hecke (Web)" }]);
  });
});

describe("Anzeige mit ausstehenden Änderungen", () => {
  const auftraege = [{ id: A1, titel: "Garten", kundeName: "Müller" }];

  it("neue und abgehakte Aufgaben erscheinen sofort", () => {
    const ws = warteschlange([
      { art: "aufgabe_neu", daten: { id: G1, auftragId: A1, titel: "Neu" } },
      { art: "aufgabe_aendern", daten: { aufgabeId: "alt", titel: "Alt", aenderung: { status: "erledigt" } } },
    ]);
    const liste = aufgabenMitAusstehenden<AufgabeKurz>([{ id: "alt", auftragId: A1, titel: "Alt", status: "offen" }], ws.eintraege, auftraege);
    expect(liste.map((g) => [g.titel, g.status, g.ausstehend, g.kundeName])).toEqual([
      ["Neu", "offen", true, "Müller"],
      ["Alt", "erledigt", true, undefined],
    ]);
  });

  it("offline gestoppter Timer erscheint als Zeiteintrag", () => {
    const ws = warteschlange([
      { art: "timer_start", daten: { id: T1, auftragId: A1, start: "2026-11-23T08:00:00.000Z" } },
      { art: "timer_stopp", daten: { id: T1, ende: "2026-11-23T09:30:00.000Z" } },
    ]);
    const z = zeitenMitAusstehenden([], ws.eintraege, auftraege);
    expect(z).toEqual([expect.objectContaining({ id: T1, dauerMinuten: 90, ausstehend: true, auftragTitel: "Garten" })]);
  });
});

describe("Timer zusammenführen", () => {
  const server = { id: T1, auftragId: A1, aufgabeId: null, auftragTitel: "Garten", kundeName: "Müller", start: "2026-11-23T08:00:00.000Z" };

  it("am Web gestarteten Timer übernehmen", () => {
    expect(timerZusammenfuehren(null, server, [])?.id).toBe(T1);
  });

  it("woanders gestoppt → lokal beenden", () => {
    expect(timerZusammenfuehren({ ...server, aufgabeId: null }, null, [])).toBeNull();
  });

  it("offline gestartet und noch nicht übertragen → behalten", () => {
    const ws = warteschlange([{ art: "timer_start", daten: { id: "neu", auftragId: A1, start: "2026-11-23T08:00:00.000Z" } }]);
    const lokal = { id: "neu", auftragId: A1, auftragTitel: "Garten", kundeName: "Müller", start: "2026-11-23T08:00:00.000Z" };
    expect(timerZusammenfuehren(lokal, null, ws.eintraege)).toBe(lokal);
  });

  it("offline gestoppt, Server weiß es noch nicht → nicht wieder übernehmen", () => {
    const ws = warteschlange([{ art: "timer_stopp", daten: { id: T1, ende: "2026-11-23T09:00:00.000Z" } }]);
    expect(timerZusammenfuehren(null, server, ws.eintraege)).toBeNull();
  });

  it("nur lokaler Timer wird beim Stoppen ein Zeiteintrag", () => {
    const v = stoppVorgang({ id: T1, auftragId: A1, auftragTitel: "", kundeName: "", start: "2026-11-23T08:00:00.000Z", nurLokal: true }, "2026-11-23T09:00:00.000Z");
    expect(v.art).toBe("zeit_neu");
  });
});
