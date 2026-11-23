import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { getLocales } from "expo-localization";
import { istSprache, t as tBasis, type Rolle, type Sprache, type UebersetzungsSchluessel } from "@autonomo/shared";
import { api, ApiFehler, ladeToken, OfflineFehler, setzeAbmeldeHandler, speichereToken } from "./api";
import { leereZwischenspeicher, leseZwischenspeicher, schreibeZwischenspeicher } from "./speicher";

export interface Ich {
  id: string;
  email: string;
  name: string;
  sprache: Sprache;
  plattformAdmin: boolean;
  zweiFaktor: boolean;
  betriebe: { id: string; name: string; rolle: Rolle; kundeId: string | null }[];
}

interface SitzungsWert {
  ich: Ich | null | undefined; // undefined = lädt noch
  sprache: Sprache;
  t: (s: UebersetzungsSchluessel, w?: Record<string, string | number>) => string;
  /** Wirft ApiFehler mit code „zweiter_faktor“, wenn ein Code aus der Authenticator-App nötig ist. */
  anmelden(email: string, passwort: string, code?: string): Promise<void>;
  abmelden(): Promise<void>;
  ueberallAbmelden(): Promise<void>;
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
    if (!(await ladeToken())) {
      setIch(null);
      return;
    }
    try {
      const daten = await api<Ich>("/me");
      setIch(daten);
      setSprache(daten.sprache);
      await schreibeZwischenspeicher("ich", daten);
    } catch (e) {
      if (e instanceof OfflineFehler || (e instanceof ApiFehler && e.status >= 500)) {
        // Ohne Netz mit dem letzten bekannten Stand weiterarbeiten
        const z = await leseZwischenspeicher<Ich>("ich");
        setIch(z?.daten ?? null);
        if (z) setSprache(z.daten.sprache);
        return;
      }
      if (e instanceof ApiFehler && e.status === 401) await speichereToken(null);
      setIch(null);
    }
  }, []);

  useEffect(() => {
    void neuLaden();
    // Sitzung abgelaufen (z. B. nach längerer Inaktivität): zurück zur Anmeldung
    setzeAbmeldeHandler(() => {
      void speichereToken(null);
      setIch(null);
    });
    return () => setzeAbmeldeHandler(null);
  }, [neuLaden]);

  const wert = useMemo<SitzungsWert>(
    () => ({
      ich,
      sprache,
      t: (s, w) => tBasis(sprache, s, w),
      async anmelden(email, passwort, code) {
        const { token } = await api<{ token: string }>("/auth/login", { method: "POST", body: { email, passwort, ...(code ? { code } : {}) } });
        await speichereToken(token);
        await neuLaden();
      },
      async abmelden() {
        await api("/auth/logout", { method: "POST" }).catch(() => undefined);
        await speichereToken(null);
        await leereZwischenspeicher();
        setIch(null);
      },
      async ueberallAbmelden() {
        await api("/auth/logout-alle", { method: "POST" });
        await speichereToken(null);
        await leereZwischenspeicher();
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
