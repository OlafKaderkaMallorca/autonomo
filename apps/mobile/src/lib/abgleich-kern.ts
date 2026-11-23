/**
 * Offline-Abgleich ohne Abhängigkeit von Expo, damit er in Node getestet werden kann.
 *
 * Alles, was die App offline ändert, landet als „Vorgang“ in einer Warteschlange (SQLite).
 * Beim Abgleich werden die Vorgänge in Reihenfolge an die API geschickt. Jeder neue Datensatz
 * trägt eine vom Gerät vergebene ID; die API legt ihn bei erneutem Senden nicht doppelt an.
 */

export type FotoArt = "arbeit" | "schaden" | "vorher" | "nachher";

export type Vorgang =
  | { art: "zeit_neu"; daten: { id: string; auftragId: string; aufgabeId?: string | null; start: string; ende: string; notiz?: string | null } }
  | { art: "timer_start"; daten: { id: string; auftragId: string; aufgabeId?: string | null; start: string } }
  | { art: "timer_stopp"; daten: { id: string; ende: string; notiz?: string } }
  | { art: "aufgabe_neu"; daten: { id: string; auftragId: string; titel: string; beschreibung?: string | null } }
  | {
      art: "aufgabe_aendern";
      daten: { aufgabeId: string; titel: string; aenderung: { status?: "offen" | "in_arbeit" | "erledigt"; titel?: string; beschreibung?: string | null }; stand?: string };
    }
  | { art: "notiz_neu"; daten: { id: string; aufgabeId: string; text: string } }
  | { art: "foto_neu"; daten: { id: string; aufgabeId: string; uri: string; fotoArt: FotoArt; beschreibung?: string } };

export interface Eintrag {
  nr: number;
  betriebId: string;
  vorgang: Vorgang;
  /** Dauerhafter Fehler (z. B. Aufgabe gelöscht). Wird übersprungen, bis der Nutzer ihn verwirft. */
  fehler: string | null;
  erstelltAm: string;
}

export interface Warteschlange {
  alle(): Promise<Eintrag[]>;
  fuegeHinzu(betriebId: string, vorgang: Vorgang): Promise<void>;
  ersetze(nr: number, vorgang: Vorgang): Promise<void>;
  entferne(nr: number): Promise<void>;
  setzeFehler(nr: number, fehler: string): Promise<void>;
}

/** Netzwerk nicht erreichbar (oder Server-Fehler 5xx): später erneut versuchen. */
export class OfflineFehler extends Error {}

/** Antwort der API mit Fehlerstatus. */
export class AntwortFehler extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export interface Netz {
  json(method: "POST" | "PATCH", pfad: string, body: unknown): Promise<unknown>;
  foto(pfad: string, uri: string): Promise<void>;
}

export type Meldung =
  | { art: "konflikt_aufgabe"; titel: string }
  | { art: "konflikt_timer" }
  | { art: "fehler"; text: string };

export interface Rueckmeldungen {
  meldung(m: Meldung): void;
  /** Foto ist auf dem Server, die lokale Kopie kann weg. */
  fotoHochgeladen?(uri: string): void;
  /** Timer konnte nicht auf dem Server gestartet werden (lief schon einer) und wird nur lokal geführt. */
  timerNurLokal?(id: string, betriebId: string): void;
}

export type Ergebnis = "fertig" | "offline" | "abgemeldet";

const b = (betriebId: string, rest: string) => `/betriebe/${betriebId}${rest}`;

/** Schickt alle offenen Vorgänge in Reihenfolge. Bricht ab, sobald das Netz fehlt. */
export async function abgleichen(ws: Warteschlange, netz: Netz, r: Rueckmeldungen): Promise<Ergebnis> {
  // Die Liste kann sich während des Abgleichs ändern (Konflikte ersetzen Vorgänge), daher jedes Mal neu lesen.
  const erledigt = new Set<number>();
  for (;;) {
    const eintrag = (await ws.alle()).find((e) => !e.fehler && !erledigt.has(e.nr));
    if (!eintrag) return "fertig";
    erledigt.add(eintrag.nr);
    try {
      await sende(eintrag, ws, netz, r);
    } catch (e) {
      if (e instanceof OfflineFehler) return "offline";
      if (e instanceof AntwortFehler && e.status === 401) return "abgemeldet";
      if (e instanceof AntwortFehler && e.status >= 500) return "offline";
      const text = e instanceof Error ? e.message : String(e);
      await ws.setzeFehler(eintrag.nr, text);
      r.meldung({ art: "fehler", text });
    }
  }
}

async function sende(e: Eintrag, ws: Warteschlange, netz: Netz, r: Rueckmeldungen): Promise<void> {
  const v = e.vorgang;
  switch (v.art) {
    case "zeit_neu":
      await netz.json("POST", b(e.betriebId, "/zeiten"), v.daten);
      break;

    case "timer_start":
      try {
        await netz.json("POST", b(e.betriebId, "/timer/start"), v.daten);
      } catch (f) {
        if (!(f instanceof AntwortFehler && f.code === "timer_laeuft")) throw f;
        // Auf einem anderen Gerät läuft schon ein Timer. Die hier erfasste Zeit geht nicht verloren:
        // Ist sie schon gestoppt, wird sie ein normaler Zeiteintrag, sonst läuft sie lokal weiter.
        const stopp = (await ws.alle()).find((x) => x.vorgang.art === "timer_stopp" && x.vorgang.daten.id === v.daten.id);
        if (stopp && stopp.vorgang.art === "timer_stopp") {
          await ws.ersetze(stopp.nr, {
            art: "zeit_neu",
            daten: { ...v.daten, ende: stopp.vorgang.daten.ende, notiz: stopp.vorgang.daten.notiz ?? null },
          });
        } else {
          r.timerNurLokal?.(v.daten.id, e.betriebId);
        }
        r.meldung({ art: "konflikt_timer" });
      }
      break;

    case "timer_stopp":
      try {
        await netz.json("POST", b(e.betriebId, "/timer/stopp"), v.daten);
      } catch (f) {
        // Schon woanders gestoppt: nichts mehr zu tun
        if (!(f instanceof AntwortFehler && f.code === "kein_timer")) throw f;
      }
      break;

    case "aufgabe_neu":
      await netz.json("POST", b(e.betriebId, "/aufgaben"), v.daten);
      break;

    case "aufgabe_aendern":
      try {
        await netz.json("PATCH", b(e.betriebId, `/aufgaben/${v.daten.aufgabeId}`), { ...v.daten.aenderung, stand: v.daten.stand });
      } catch (f) {
        if (!(f instanceof AntwortFehler && f.code === "konflikt")) throw f;
        const aktuell = f.details as { geaendertAm?: string; titel?: string } | undefined;
        const nurStatus = Object.keys(v.daten.aenderung).every((k) => k === "status");
        if (nurStatus && aktuell?.geaendertAm) {
          // Abhaken bzw. Wieder-Öffnen gewinnt: auf dem neuen Stand erneut senden
          await netz.json("PATCH", b(e.betriebId, `/aufgaben/${v.daten.aufgabeId}`), { ...v.daten.aenderung, stand: aktuell.geaendertAm });
        } else {
          // Text wurde woanders geändert: Server-Fassung behalten, eigene Änderung als Notiz sichern
          const teile = [
            v.daten.aenderung.titel ? `Titel: ${v.daten.aenderung.titel}` : null,
            v.daten.aenderung.beschreibung ? `Beschreibung: ${v.daten.aenderung.beschreibung}` : null,
            v.daten.aenderung.status ? `Status: ${v.daten.aenderung.status}` : null,
          ].filter(Boolean);
          await netz.json("POST", b(e.betriebId, `/aufgaben/${v.daten.aufgabeId}/notizen`), {
            id: konfliktNotizId(e),
            text: `Offline-Änderung (nicht übernommen)\n${teile.join("\n")}`,
          });
          r.meldung({ art: "konflikt_aufgabe", titel: aktuell?.titel ?? v.daten.titel });
        }
      }
      break;

    case "notiz_neu":
      await netz.json("POST", b(e.betriebId, `/aufgaben/${v.daten.aufgabeId}/notizen`), { id: v.daten.id, text: v.daten.text });
      break;

    case "foto_neu": {
      const q = new URLSearchParams({ id: v.daten.id, art: v.daten.fotoArt });
      if (v.daten.beschreibung) q.set("beschreibung", v.daten.beschreibung);
      await netz.foto(b(e.betriebId, `/aufgaben/${v.daten.aufgabeId}/fotos?${q}`), v.daten.uri);
      r.fotoHochgeladen?.(v.daten.uri);
      break;
    }
  }
  await ws.entferne(e.nr);
}

/** Stabile ID für die Konflikt-Notiz, damit auch sie bei erneutem Senden nicht doppelt entsteht. */
function konfliktNotizId(e: Eintrag): string {
  const hex = (e.nr.toString(16) + e.erstelltAm.replace(/\D/g, "")).padEnd(32, "0").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

// ---------------------------------------------------------------------------------------------
// Anzeige: Server-Daten (bzw. Zwischenspeicher) plus noch nicht übertragene Änderungen
// ---------------------------------------------------------------------------------------------

export interface AufgabeKurz {
  id: string;
  auftragId: string;
  auftragTitel?: string;
  kundeName?: string;
  titel: string;
  status: "offen" | "in_arbeit" | "erledigt";
  geaendertAm?: string;
  ausstehend?: boolean;
}

export function aufgabenMitAusstehenden<T extends AufgabeKurz>(liste: T[], ausstehend: Eintrag[], auftraege: { id: string; titel: string; kundeName: string }[] = []): T[] {
  let ergebnis = [...liste];
  for (const e of ausstehend) {
    const v = e.vorgang;
    if (v.art === "aufgabe_neu" && !ergebnis.some((g) => g.id === v.daten.id)) {
      const a = auftraege.find((x) => x.id === v.daten.auftragId);
      ergebnis.unshift({ id: v.daten.id, auftragId: v.daten.auftragId, auftragTitel: a?.titel, kundeName: a?.kundeName, titel: v.daten.titel, status: "offen", ausstehend: true } as T);
    }
    if (v.art === "aufgabe_aendern") {
      ergebnis = ergebnis.map((g) => (g.id === v.daten.aufgabeId ? { ...g, ...v.daten.aenderung, ausstehend: true } : g));
    }
  }
  return ergebnis;
}

export interface ZeitKurz {
  id: string;
  auftragId: string;
  auftragTitel?: string;
  kundeName?: string;
  start: string;
  ende: string | null;
  dauerMinuten: number;
  ausstehend?: boolean;
}

export function zeitenMitAusstehenden(liste: ZeitKurz[], ausstehend: Eintrag[], auftraege: { id: string; titel: string; kundeName: string }[] = []): ZeitKurz[] {
  const ergebnis = [...liste];
  const starts = new Map<string, Extract<Vorgang, { art: "timer_start" }>["daten"]>();
  const neu = (d: { id: string; auftragId: string; start: string; ende: string }) => {
    const a = auftraege.find((x) => x.id === d.auftragId);
    const vorhanden = ergebnis.findIndex((z) => z.id === d.id);
    const zeile: ZeitKurz = {
      id: d.id,
      auftragId: d.auftragId,
      auftragTitel: a?.titel,
      kundeName: a?.kundeName,
      start: d.start,
      ende: d.ende,
      dauerMinuten: Math.max(1, Math.round((Date.parse(d.ende) - Date.parse(d.start)) / 60000)),
      ausstehend: true,
    };
    if (vorhanden >= 0) ergebnis[vorhanden] = zeile;
    else ergebnis.push(zeile);
  };
  for (const e of ausstehend) {
    const v = e.vorgang;
    if (v.art === "zeit_neu") neu(v.daten);
    if (v.art === "timer_start") starts.set(v.daten.id, v.daten);
    if (v.art === "timer_stopp") {
      const s = starts.get(v.daten.id);
      if (s) neu({ ...s, ende: v.daten.ende });
      else ergebnis.forEach((z, i) => z.id === v.daten.id && (ergebnis[i] = { ...z, ende: v.daten.ende, ausstehend: true }));
    }
  }
  return ergebnis.sort((x, y) => Date.parse(y.start) - Date.parse(x.start));
}

// ---------------------------------------------------------------------------------------------
// Timer: lokal geführt, damit er auch ohne Netz startet und stoppt
// ---------------------------------------------------------------------------------------------

export interface LokalerTimer {
  id: string;
  auftragId: string;
  aufgabeId?: string | null;
  auftragTitel: string;
  kundeName: string;
  start: string;
  /** Konnte wegen eines anderen laufenden Timers nicht auf den Server; beim Stoppen wird ein Zeiteintrag daraus. */
  nurLokal?: boolean;
}

export interface ServerTimer {
  id: string;
  auftragId: string;
  aufgabeId: string | null;
  auftragTitel: string;
  kundeName: string;
  start: string;
}

/**
 * Bringt den lokalen Timer mit dem Stand des Servers zusammen (nur aufrufen, wenn der Server-Stand frisch ist).
 * - Am Web gestartet → übernehmen
 * - Woanders gestoppt (und hier nichts mehr offen) → lokal beenden
 */
export function timerZusammenfuehren(lokal: LokalerTimer | null, server: ServerTimer | null, ausstehend: Eintrag[]): LokalerTimer | null {
  const offen = (id: string) => ausstehend.some((e) => (e.vorgang.art === "timer_start" || e.vorgang.art === "timer_stopp") && e.vorgang.daten.id === id);
  if (lokal?.nurLokal) return lokal;
  if (lokal && offen(lokal.id)) return lokal;
  if (server && !offen(server.id)) {
    return { id: server.id, auftragId: server.auftragId, aufgabeId: server.aufgabeId, auftragTitel: server.auftragTitel, kundeName: server.kundeName, start: server.start };
  }
  return null;
}

/** Vorgänge zum Stoppen: normaler Timer → timer_stopp, nur lokaler Timer → fertiger Zeiteintrag. */
export function stoppVorgang(t: LokalerTimer, ende: string, notiz?: string): Vorgang {
  return t.nurLokal
    ? { art: "zeit_neu", daten: { id: t.id, auftragId: t.auftragId, aufgabeId: t.aufgabeId ?? null, start: t.start, ende, notiz: notiz ?? null } }
    : { art: "timer_stopp", daten: { id: t.id, ende, ...(notiz ? { notiz } : {}) } };
}
