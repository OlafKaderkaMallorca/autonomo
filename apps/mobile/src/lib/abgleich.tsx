import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AppState } from "react-native";
import { File } from "expo-file-system";
import { abgleichen as kernAbgleichen, type Eintrag, type LokalerTimer, type Meldung, type Vorgang } from "./abgleich-kern";
import { api, ladeFotoHoch } from "./api";
import { leseZwischenspeicher, schreibeZwischenspeicher, sqliteWarteschlange } from "./speicher";

interface AbgleichWert {
  /** Noch nicht übertragene Änderungen (alle Betriebe). */
  ausstehend: Eintrag[];
  offline: boolean;
  laeuft: boolean;
  meldungen: Meldung[];
  /** Zählt hoch nach jedem erfolgreichen Abgleich, damit Bildschirme neu laden. */
  version: number;
  fuegeHinzu(betriebId: string, v: Vorgang): Promise<void>;
  abgleichen(): Promise<void>;
  verwerfen(nr: number): Promise<void>;
  meldungGelesen(index: number): void;
  setzeOffline(offline: boolean): void;
}

const Kontext = createContext<AbgleichWert | null>(null);

export const timerSchluessel = (betriebId: string) => `timer:${betriebId}`;

export function AbgleichProvider({ children, aktiv }: { children: ReactNode; aktiv: boolean }) {
  const [ausstehend, setAusstehend] = useState<Eintrag[]>([]);
  const [offline, setOffline] = useState(false);
  const [laeuft, setLaeuft] = useState(false);
  const [meldungen, setMeldungen] = useState<Meldung[]>([]);
  const [version, setVersion] = useState(0);
  const sperre = useRef(false);

  const neuLesen = useCallback(async () => setAusstehend(await sqliteWarteschlange.alle()), []);

  const abgleichen = useCallback(async () => {
    if (sperre.current || !aktiv) return;
    sperre.current = true;
    setLaeuft(true);
    try {
      const vorher = (await sqliteWarteschlange.alle()).length;
      const ergebnis = await kernAbgleichen(
        sqliteWarteschlange,
        { json: (method, pfad, body) => api(pfad, { method, body }), foto: ladeFotoHoch },
        {
          meldung: (m) => setMeldungen((alt) => [...alt, m]),
          fotoHochgeladen: (uri) => {
            try {
              new File(uri).delete();
            } catch {
              // schon weg
            }
          },
          timerNurLokal: async (id, betriebId) => {
            const t = await leseZwischenspeicher<LokalerTimer>(timerSchluessel(betriebId));
            if (t?.daten.id === id) await schreibeZwischenspeicher(timerSchluessel(betriebId), { ...t.daten, nurLokal: true });
          },
        },
      );
      setOffline(ergebnis === "offline");
      const nachher = await sqliteWarteschlange.alle();
      setAusstehend(nachher);
      if (ergebnis !== "offline" && (vorher > 0 || nachher.length !== vorher)) setVersion((v) => v + 1);
    } finally {
      sperre.current = false;
      setLaeuft(false);
    }
  }, [aktiv]);

  // Beim Start, bei Rückkehr in den Vordergrund und alle 30 Sekunden, solange etwas offen ist
  useEffect(() => {
    void neuLesen().then(abgleichen);
    const sub = AppState.addEventListener("change", (s) => s === "active" && void abgleichen());
    const intervall = setInterval(() => {
      void sqliteWarteschlange.alle().then((a) => {
        if (a.some((e) => !e.fehler)) void abgleichen();
      });
    }, 30_000);
    return () => {
      sub.remove();
      clearInterval(intervall);
    };
  }, [neuLesen, abgleichen]);

  const wert = useMemo<AbgleichWert>(
    () => ({
      ausstehend,
      offline,
      laeuft,
      meldungen,
      version,
      async fuegeHinzu(betriebId, v) {
        await sqliteWarteschlange.fuegeHinzu(betriebId, v);
        await neuLesen();
        void abgleichen();
      },
      abgleichen,
      async verwerfen(nr) {
        const e = (await sqliteWarteschlange.alle()).find((x) => x.nr === nr);
        if (e?.vorgang.art === "foto_neu") {
          try {
            new File(e.vorgang.daten.uri).delete();
          } catch {
            // schon weg
          }
        }
        await sqliteWarteschlange.entferne(nr);
        await neuLesen();
      },
      meldungGelesen(index) {
        setMeldungen((alt) => alt.filter((_, i) => i !== index));
      },
      setzeOffline: setOffline,
    }),
    [ausstehend, offline, laeuft, meldungen, version, neuLesen, abgleichen],
  );
  return <Kontext.Provider value={wert}>{children}</Kontext.Provider>;
}

export function useAbgleich(): AbgleichWert {
  const w = useContext(Kontext);
  if (!w) throw new Error("useAbgleich außerhalb von AbgleichProvider");
  return w;
}
