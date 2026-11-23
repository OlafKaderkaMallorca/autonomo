import { useMemo } from "react";
import { FlatList, Pressable, RefreshControl, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { aufgabenMitAusstehenden } from "../../../lib/abgleich-kern";
import { useAbgleich } from "../../../lib/abgleich";
import { useDaten } from "../../../lib/daten";
import { useSitzung } from "../../../lib/sitzung";
import type { Aufgabe, Auftrag } from "../../../lib/typen";
import { AbgleichLeiste, Knopf, useFarben } from "../../../lib/ui";

/** Offene Aufgaben über alle Kunden – abhaken geht auch offline. */
export default function Aufgaben() {
  const { betriebId: b } = useLocalSearchParams<{ betriebId: string }>();
  const { t } = useSitzung();
  const f = useFarben();
  const { ausstehend: alle, fuegeHinzu } = useAbgleich();
  const ausstehend = useMemo(() => alle.filter((e) => e.betriebId === b), [alle, b]);
  const aufgaben = useDaten<Aufgabe[]>(`/betriebe/${b}/aufgaben`);
  const auftraege = useDaten<Auftrag[]>(`/betriebe/${b}/auftraege?status=aktiv`);
  const liste = aufgabenMitAusstehenden(aufgaben.daten ?? [], ausstehend, (auftraege.daten ?? []).map((a) => ({ id: a.id, titel: a.titel, kundeName: a.kundeName })));

  async function umschalten(g: (typeof liste)[number]) {
    const status = g.status === "erledigt" ? "offen" : "erledigt";
    await fuegeHinzu(b, { art: "aufgabe_aendern", daten: { aufgabeId: g.id, titel: g.titel, aenderung: { status }, stand: g.geaendertAm } });
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: f.bg }} edges={["top"]}>
      <FlatList
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        data={liste}
        keyExtractor={(g) => g.id}
        refreshControl={<RefreshControl refreshing={false} onRefresh={() => void aufgaben.neuLaden().catch(() => undefined)} />}
        ListHeaderComponent={
          <View>
            <Text style={{ fontSize: 22, fontWeight: "700", color: f.fg }}>{t("app.aufgaben")}</Text>
            <AbgleichLeiste betriebId={b} />
            <Knopf leise titel={`+ ${t("app.neueAufgabe")}`} onPress={() => router.push({ pathname: "/b/[betriebId]/aufgabe/neu", params: { betriebId: b } })} />
          </View>
        }
        ListEmptyComponent={aufgaben.daten ? <Text style={{ color: f.muted, marginTop: 16 }}>{t("allg.keine")}</Text> : undefined}
        renderItem={({ item: g }) => {
          const erledigt = g.status === "erledigt";
          return (
            <View style={{ flexDirection: "row", alignItems: "center", backgroundColor: f.karte, borderColor: f.rand, borderWidth: 1, borderRadius: 12, marginTop: 10 }}>
              <Pressable
                onPress={() => void umschalten(g)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: erledigt }}
                accessibilityLabel={erledigt ? t("app.wiederOeffnen") : t("app.erledigt")}
                style={{ padding: 14 }}
              >
                <View style={{ width: 26, height: 26, borderRadius: 6, borderWidth: 2, borderColor: f.akzent, backgroundColor: erledigt ? f.akzent : "transparent", alignItems: "center", justifyContent: "center" }}>
                  {erledigt && <Text style={{ color: f.akzentFg, fontWeight: "700" }}>✓</Text>}
                </View>
              </Pressable>
              <Pressable
                style={{ flex: 1, paddingVertical: 12, paddingRight: 14 }}
                onPress={() => router.push({ pathname: "/b/[betriebId]/aufgabe/[aufgabeId]", params: { betriebId: b, aufgabeId: g.id } })}
              >
                <Text style={{ color: f.fg, fontSize: 16, textDecorationLine: erledigt ? "line-through" : "none" }}>{g.titel}</Text>
                <Text style={{ color: f.muted }}>
                  {[g.kundeName, g.auftragTitel].filter(Boolean).join(" · ")}
                  {g.ausstehend ? ` · ${t("app.ausstehendKurz")}` : ""}
                </Text>
              </Pressable>
            </View>
          );
        }}
      />
    </SafeAreaView>
  );
}
