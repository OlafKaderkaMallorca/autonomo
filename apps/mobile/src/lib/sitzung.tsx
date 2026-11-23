import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { getLocales } from "expo-localization";
import { istSprache, t as tBasis, type Rolle, type Sprache, type UebersetzungsSchluessel } from "@autonomo/shared";
import { api, ApiFehler, speichereToken } from "./api";

export interface Ich {
  id: string;
  email: string;
  name: string;
  sprache: Sprache;
  plattformAdmin: boolean;
  betriebe: { id: string; name: string; rolle: Rolle; kundeId: string | null }[];
}

interface SitzungsWert {
  ich: Ich | null | undefined; // undefined = lädt noch
  sprache: Sprache;
  t: (s: UebersetzungsSchluessel, w?: Record<string, string | number>) => string;
  anmelden(email: string, passwort: string): Promise<void>;
  abmelden(): Promise<void>;
  setzeSprache(s: Sprache): Promise<void>;
}

const Kontext = createContext<SitzungsWert | null>(null);

function geraeteSprache(): Sprache {
  const code = getLocales()[0]?.languageCode ?? "es";
  return istSprache(code) ? code : "es";
}

export function SitzungsProvider({ children }: { children: ReactNode }) {
  const [ich, setIch] = useState<Ich | null | undefined>(undefined);
  const [sprache, setSprache] = useState<Sprache>(geraeteSprache());

  const neuLaden = useCallback(async () => {
    try {
      const daten = await api<Ich>("/me");
      setIch(daten);
      setSprache(daten.sprache);
    } catch (e) {
      if (e instanceof ApiFehler && e.status === 401) {
        await speichereToken(null);
        setIch(null);
      } else {
        setIch(null);
      }
    }
  }, []);

  useEffect(() => {
    void neuLaden();
  }, [neuLaden]);

  const wert = useMemo<SitzungsWert>(
    () => ({
      ich,
      sprache,
      t: (s, w) => tBasis(sprache, s, w),
      async anmelden(email, passwort) {
        const { token } = await api<{ token: string }>("/auth/login", { method: "POST", body: { email, passwort } });
        await speichereToken(token);
        await neuLaden();
      },
      async abmelden() {
        await api("/auth/logout", { method: "POST" }).catch(() => undefined);
        await speichereToken(null);
        setIch(null);
      },
      async setzeSprache(s) {
        setSprache(s);
        if (ich) await api("/me", { method: "PATCH", body: { sprache: s } }).catch(() => undefined);
      },
    }),
    [ich, sprache, neuLaden],
  );

  return <Kontext.Provider value={wert}>{children}</Kontext.Provider>;
}

export function useSitzung(): SitzungsWert {
  const wert = useContext(Kontext);
  if (!wert) throw new Error("useSitzung außerhalb von SitzungsProvider");
  return wert;
}
