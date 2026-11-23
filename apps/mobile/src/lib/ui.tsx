import { Pressable, StyleSheet, Text, TextInput, useColorScheme, View, type PressableProps, type TextInputProps } from "react-native";
import { SPRACHEN } from "@autonomo/shared";
import { useAbgleich } from "./abgleich";
import { useSitzung } from "./sitzung";

export function useFarben() {
  const dunkel = useColorScheme() === "dark";
  return dunkel
    ? { bg: "#111827", fg: "#f3f4f6", muted: "#9ca3af", karte: "#1f2937", rand: "#374151", akzent: "#34d399", akzentFg: "#111827", fehler: "#f97066" }
    : { bg: "#f5f7f6", fg: "#1f2937", muted: "#5b6472", karte: "#ffffff", rand: "#e1e5ea", akzent: "#059669", akzentFg: "#ffffff", fehler: "#b42318" };
}

export function Knopf({ titel, leise, ...rest }: PressableProps & { titel: string; leise?: boolean }) {
  const f = useFarben();
  return (
    <Pressable
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.knopf,
        leise ? { borderWidth: 1, borderColor: f.rand } : { backgroundColor: f.akzent },
        { opacity: pressed || rest.disabled ? 0.6 : 1 },
      ]}
      {...rest}
    >
      <Text style={{ color: leise ? f.akzent : f.akzentFg, fontSize: 16, fontWeight: "600" }}>{titel}</Text>
    </Pressable>
  );
}

export function SprachWahl() {
  const { sprache, setzeSprache } = useSitzung();
  const f = useFarben();
  return (
    <View style={{ flexDirection: "row", gap: 6 }}>
      {SPRACHEN.map((s) => (
        <Pressable key={s} onPress={() => setzeSprache(s)} style={[styles.sprache, { borderColor: f.rand }]} accessibilityState={{ selected: s === sprache }}>
          <Text style={{ color: f.akzent, fontWeight: s === sprache ? "700" : "400" }}>{s.toUpperCase()}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  knopf: { marginTop: 16, paddingVertical: 12, paddingHorizontal: 16, borderRadius: 8, alignItems: "center" },
  sprache: { borderWidth: 1, borderRadius: 8, paddingVertical: 6, paddingHorizontal: 10 },
});

export function Karte({ children, style }: { children: React.ReactNode; style?: object }) {
  const f = useFarben();
  return <View style={[{ backgroundColor: f.karte, borderColor: f.rand, borderWidth: 1, borderRadius: 12, padding: 14, marginTop: 12 }, style]}>{children}</View>;
}

export function Titel({ children }: { children: React.ReactNode }) {
  const f = useFarben();
  return <Text style={{ fontSize: 17, fontWeight: "600", color: f.fg, marginTop: 20 }}>{children}</Text>;
}

export function Feld(props: TextInputProps & { beschriftung?: string }) {
  const f = useFarben();
  const { beschriftung, style, ...rest } = props;
  return (
    <View style={{ marginTop: 10, flex: 1 }}>
      {beschriftung ? <Text style={{ color: f.muted, marginBottom: 4 }}>{beschriftung}</Text> : null}
      <TextInput
        placeholderTextColor={f.muted}
        style={[{ borderWidth: 1, borderColor: f.rand, borderRadius: 8, padding: 12, fontSize: 16, color: f.fg, backgroundColor: f.bg }, style]}
        {...rest}
      />
    </View>
  );
}

/** Auswahl als Chips (z. B. Auftrag, Foto-Art). */
export function Auswahl<T extends string>({ werte, wert, onWahl }: { werte: { wert: T; text: string }[]; wert: T | null; onWahl: (w: T) => void }) {
  const f = useFarben();
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
      {werte.map((w) => {
        const an = w.wert === wert;
        return (
          <Pressable
            key={w.wert}
            onPress={() => onWahl(w.wert)}
            accessibilityState={{ selected: an }}
            style={{ borderWidth: 1, borderColor: an ? f.akzent : f.rand, backgroundColor: an ? f.akzent : "transparent", borderRadius: 20, paddingVertical: 8, paddingHorizontal: 12 }}
          >
            <Text style={{ color: an ? f.akzentFg : f.fg }}>{w.text}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Hinweisleiste oben: offline, nicht übertragene Änderungen, Konflikte. */
export function AbgleichLeiste({ betriebId }: { betriebId: string }) {
  const { t } = useSitzung();
  const f = useFarben();
  const { offline, ausstehend, meldungen, meldungGelesen, abgleichen, laeuft } = useAbgleich();
  const offen = ausstehend.filter((e) => e.betriebId === betriebId && !e.fehler).length;
  const fehlerhaft = ausstehend.filter((e) => e.betriebId === betriebId && e.fehler).length;
  if (!offline && offen === 0 && fehlerhaft === 0 && meldungen.length === 0) return null;
  const leiste = { borderRadius: 10, padding: 10, marginTop: 8 };
  return (
    <View>
      {offline && (
        <View style={[leiste, { backgroundColor: f.karte, borderColor: f.rand, borderWidth: 1 }]}>
          <Text style={{ color: f.muted }}>{t("app.offline")}</Text>
        </View>
      )}
      {(offen > 0 || fehlerhaft > 0) && (
        <Pressable onPress={() => void abgleichen()} disabled={laeuft} style={[leiste, { borderColor: f.akzent, borderWidth: 1, flexDirection: "row", justifyContent: "space-between" }]}>
          <Text style={{ color: f.fg, flexShrink: 1 }}>{t("app.ausstehend", { anzahl: offen + fehlerhaft })}</Text>
          <Text style={{ color: f.akzent, fontWeight: "600" }}>{laeuft ? "…" : t("app.uebertragen")}</Text>
        </Pressable>
      )}
      {meldungen.map((m, i) => (
        <Pressable key={i} onPress={() => meldungGelesen(i)} style={[leiste, { borderColor: f.fehler, borderWidth: 1 }]}>
          <Text style={{ color: f.fg }}>
            {m.art === "konflikt_aufgabe"
              ? t("app.konfliktAufgabe", { titel: m.titel })
              : m.art === "konflikt_timer"
                ? t("app.konfliktTimer")
                : t("app.fehlerUebertragung", { text: m.text })}
            {"  ✕"}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

export function formatDauer(minuten: number): string {
  const h = Math.floor(minuten / 60);
  const m = Math.round(minuten % 60);
  return `${h}:${String(m).padStart(2, "0")} h`;
}
