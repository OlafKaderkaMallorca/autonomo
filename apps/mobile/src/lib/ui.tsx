import { Pressable, StyleSheet, Text, useColorScheme, View, type PressableProps } from "react-native";
import { SPRACHEN } from "@autonomo/shared";
import { useSitzung } from "./sitzung";

export function useFarben() {
  const dunkel = useColorScheme() === "dark";
  return dunkel
    ? { bg: "#141816", fg: "#e8ece9", muted: "#a3aea7", karte: "#1c211e", rand: "#2d3530", akzent: "#4fb489", akzentFg: "#0d130f", fehler: "#f97066" }
    : { bg: "#f6f7f5", fg: "#1d2420", muted: "#5b665f", karte: "#ffffff", rand: "#dde3de", akzent: "#1f6f50", akzentFg: "#ffffff", fehler: "#b42318" };
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
