import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AppState, StyleSheet, Text, View } from "react-native";
import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";
import { useSitzung } from "./sitzung";
import { Knopf, useFarben } from "./ui";

/** Nach so langer Zeit im Hintergrund wird wieder nach Face ID / Fingerabdruck gefragt. */
const SPERRE_NACH_MS = 5 * 60_000;
const SCHLUESSEL = "biometrie";

interface SperrWert {
  aktiv: boolean;
  /** Gerät hat Face ID / Fingerabdruck eingerichtet */
  verfuegbar: boolean;
  setzeAktiv(an: boolean): Promise<boolean>;
}

const Kontext = createContext<SperrWert | null>(null);

/** Sperrt die App beim Öffnen und nach 5 Minuten im Hintergrund, wenn Face ID / Fingerabdruck eingeschaltet ist. */
export function SperrProvider({ children }: { children: ReactNode }) {
  const { ich, t } = useSitzung();
  const f = useFarben();
  const [aktiv, setAktiv] = useState(false);
  const [verfuegbar, setVerfuegbar] = useState(false);
  const [gesperrt, setGesperrt] = useState(true);
  const [geladen, setGeladen] = useState(false);
  const imHintergrundSeit = useRef<number | null>(null);

  useEffect(() => {
    void (async () => {
      const an = (await SecureStore.getItemAsync(SCHLUESSEL)) === "1";
      const hw = (await LocalAuthentication.hasHardwareAsync()) && (await LocalAuthentication.isEnrolledAsync());
      setVerfuegbar(hw);
      setAktiv(an && hw);
      setGesperrt(an && hw);
      setGeladen(true);
    })();
  }, []);

  const entsperren = useCallback(async () => {
    const r = await LocalAuthentication.authenticateAsync({ promptMessage: t("app.entsperrenGrund"), disableDeviceFallback: false });
    if (r.success) setGesperrt(false);
  }, [t]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "background") imHintergrundSeit.current = Date.now();
      if (s === "active" && imHintergrundSeit.current && aktiv && Date.now() - imHintergrundSeit.current > SPERRE_NACH_MS) setGesperrt(true);
      if (s === "active") imHintergrundSeit.current = null;
    });
    return () => sub.remove();
  }, [aktiv]);

  // Beim Sperren gleich die Abfrage zeigen
  const zeigeSperre = geladen && aktiv && gesperrt && !!ich;
  useEffect(() => {
    if (zeigeSperre) void entsperren();
  }, [zeigeSperre, entsperren]);

  const wert = useMemo<SperrWert>(
    () => ({
      aktiv,
      verfuegbar,
      async setzeAktiv(an) {
        if (an) {
          // Vor dem Einschalten einmal bestätigen lassen
          const r = await LocalAuthentication.authenticateAsync({ promptMessage: t("app.entsperrenGrund") });
          if (!r.success) return false;
        }
        await SecureStore.setItemAsync(SCHLUESSEL, an ? "1" : "0");
        setAktiv(an);
        setGesperrt(false);
        return true;
      },
    }),
    [aktiv, verfuegbar, t],
  );

  return (
    <Kontext.Provider value={wert}>
      {children}
      {/* Abdeckung statt Ausblenden, damit die Bildschirme ihren Zustand behalten */}
      {(!geladen || zeigeSperre) && (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: f.bg, justifyContent: "center", padding: 32 }]}>
          <Text style={{ color: f.fg, fontSize: 22, fontWeight: "700", textAlign: "center" }}>ApuntaPro</Text>
          {zeigeSperre && <Knopf titel={t("app.entsperren")} onPress={entsperren} />}
        </View>
      )}
    </Kontext.Provider>
  );
}

export function useSperre(): SperrWert {
  const w = useContext(Kontext);
  if (!w) throw new Error("useSperre außerhalb von SperrProvider");
  return w;
}
