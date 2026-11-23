import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { Redirect, router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useSitzung } from "../lib/sitzung";
import { Knopf, SprachWahl, useFarben } from "../lib/ui";

export default function Start() {
  const { ich, t, abmelden } = useSitzung();
  const f = useFarben();
  if (ich === undefined) {
    return (
      <View style={{ flex: 1, justifyContent: "center", backgroundColor: f.bg }}>
        <ActivityIndicator color={f.akzent} />
      </View>
    );
  }
  if (ich === null) return <Redirect href="/login" />;
  if (ich.betriebe.length === 1) return <Redirect href={{ pathname: "/b/[betriebId]", params: { betriebId: ich.betriebe[0]!.id } }} />;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: f.bg }}>
      <ScrollView contentContainerStyle={{ padding: 16 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <Text style={{ fontSize: 24, fontWeight: "700", color: f.fg }}>{t("betrieb.waehlen")}</Text>
          <SprachWahl />
        </View>
        {ich.betriebe.length === 0 && <Text style={{ color: f.muted, marginTop: 16 }}>{t("betrieb.keine")}</Text>}
        {ich.betriebe.map((b) => (
          <Pressable
            key={b.id}
            onPress={() => router.push({ pathname: "/b/[betriebId]", params: { betriebId: b.id } })}
            style={{ backgroundColor: f.karte, borderColor: f.rand, borderWidth: 1, borderRadius: 12, padding: 16, marginTop: 12 }}
          >
            <Text style={{ color: f.fg, fontSize: 17 }}>{b.name}</Text>
            <Text style={{ color: f.muted }}>{t(`rolle.${b.rolle}`)}</Text>
          </Pressable>
        ))}
        <Knopf leise titel={t("abmelden")} onPress={abmelden} />
      </ScrollView>
    </SafeAreaView>
  );
}
