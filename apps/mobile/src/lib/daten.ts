import { useCallback, useEffect, useRef, useState } from "react";
import { OfflineFehler } from "./abgleich-kern";
import { useAbgleich } from "./abgleich";
import { api } from "./api";
import { leseZwischenspeicher, schreibeZwischenspeicher } from "./speicher";

/**
 * Lädt Daten von der API und legt sie im Zwischenspeicher ab. Ohne Netz wird der letzte Stand angezeigt.
 * `frisch` ist true, sobald die Daten in dieser Ansicht vom Server kamen.
 */
export function useDaten<T>(pfad: string | null) {
  const { version, setzeOffline } = useAbgleich();
  const [daten, setDaten] = useState<T | undefined>(undefined);
  const [stand, setStand] = useState<string | null>(null);
  const [frisch, setFrisch] = useState(false);
  const [laedt, setLaedt] = useState(false);
  const aktuell = useRef(pfad);
  aktuell.current = pfad;

  const neuLaden = useCallback(async () => {
    if (!pfad) return;
    setLaedt(true);
    try {
      const d = await api<T>(pfad);
      if (aktuell.current !== pfad) return;
      setDaten(d);
      setStand(new Date().toISOString());
      setFrisch(true);
      setzeOffline(false);
      await schreibeZwischenspeicher(pfad, d);
    } catch (e) {
      if (e instanceof OfflineFehler) setzeOffline(true);
      else throw e;
    } finally {
      setLaedt(false);
    }
  }, [pfad, setzeOffline]);

  useEffect(() => {
    if (!pfad) return;
    let abgebrochen = false;
    void leseZwischenspeicher<T>(pfad).then((z) => {
      if (!abgebrochen && z && aktuell.current === pfad) {
        setDaten((alt) => alt ?? z.daten);
        setStand((alt) => alt ?? z.stand);
      }
    });
    neuLaden().catch(() => undefined);
    return () => {
      abgebrochen = true;
    };
  }, [pfad, neuLaden, version]);

  return { daten, stand, frisch, laedt, neuLaden };
}
