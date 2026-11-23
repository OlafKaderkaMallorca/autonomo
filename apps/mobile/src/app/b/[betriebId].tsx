import { useCallback, useEffect, useState } from "react";
import { FlatList, RefreshControl, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import type { Rolle } from "@autonomo/shared";
import { api } from "../../lib/api";
import { useSitzung } from "../../lib/sitzung";
import { Knopf, SprachWahl, useFarben } from "../../lib/ui";

interface Kunde {
  id: string;
  name: string;
  steuernummer: string | null;
}

export default function BetriebSeite() {
  const { betriebId } = useLocalSearchParams<{ betriebId: string }>();
  const { ich, t, abmelden } = useSitzung();
  const f = useFarben();
  const [betrieb, setBetrieb] = useState<{ name: string; meineRolle: Rolle } | null>(null);
  const [kunden, setKunden] = useState<Kunde[]>([]);
  const [laedt, setLaedt] = useState(false);

  const laden = useCallback(async () => {
    setLaedt(true);
    try {
      const [b, k] = await Promise.all([
        api<{ name: string; meineRolle: Rolle }>(`/betriebe/${betriebId}`),
        api<Kunde[]>(`/betriebe/${betriebId}/kunden`),
      ]);
      setBetrieb(b);
      setKunden(k);
    } finally {
      setLaedt(false);
    }
  }, [betriebId]);

  useEffect(() => {
    void laden();
  }, [laden]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: f.bg }}>
      <FlatList
        contentContainerStyle={{ padding: 16 }}
        data={kunden}
        keyExtractor={(k) => k.id}
        refreshControl={<RefreshControl refreshing={laedt} onRefresh={laden} />}
        ListHeaderComponent={
          <View>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Text style={{ fontSize: 22, fontWeight: "700", color: f.fg, flexShrink: 1 }}>{betrieb?.name ?? ""}</Text>
              <SprachWahl />
            </View>
            {betrieb && <Text style={{ color: f.muted, marginTop: 4 }}>{ich?.name} · {t(`rolle.${betrieb.meineRolle}`)}</Text>}
            <Text style={{ fontSize: 17, fontWeight: "600", color: f.fg, marginTop: 24, marginBottom: 8 }}>{t("kunden.titel")}</Text>
          </View>
        }
        ListEmptyComponent={!laedt ? <Text style={{ color: f.muted }}>{t("kunden.leer")}</Text> : undefined}
        renderItem={({ item }) => (
          <View style={{ backgroundColor: f.karte, borderColor: f.rand, borderWidth: 1, borderRadius: 12, padding: 14, marginBottom: 8 }}>
            <Text style={{ color: f.fg, fontSize: 16 }}>{item.name}</Text>
            {item.steuernummer && <Text style={{ color: f.muted }}>{item.steuernummer}</Text>}
          </View>
        )}
        ListFooterComponent={
          <View>
            {ich && ich.betriebe.length > 1 && <Knopf leise titel={t("betrieb.waehlen")} onPress={() => router.replace("/")} />}
            <Knopf leise titel={t("abmelden")} onPress={abmelden} />
          </View>
        }
      />
    </SafeAreaView>
  );
}
