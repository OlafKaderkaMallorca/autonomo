import { Tabs } from "expo-router";
import { Text, type ColorValue } from "react-native";
import { useSitzung } from "../../../lib/sitzung";
import { useFarben } from "../../../lib/ui";

const symbol = (zeichen: string) =>
  function Symbol({ color }: { color: ColorValue }) {
    return <Text style={{ color, fontSize: 20 }}>{zeichen}</Text>;
  };

export default function BetriebLayout() {
  const { t } = useSitzung();
  const f = useFarben();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: f.akzent,
        tabBarInactiveTintColor: f.muted,
        tabBarStyle: { backgroundColor: f.karte, borderTopColor: f.rand },
      }}
    >
      <Tabs.Screen name="index" options={{ title: t("app.heute"), tabBarIcon: symbol("⏱") }} />
      <Tabs.Screen name="aufgaben" options={{ title: t("app.aufgaben"), tabBarIcon: symbol("✓") }} />
      <Tabs.Screen name="mehr" options={{ title: t("app.mehr"), tabBarIcon: symbol("☰") }} />
      <Tabs.Screen name="aufgabe/[aufgabeId]" options={{ href: null }} />
      <Tabs.Screen name="aufgabe/neu" options={{ href: null }} />
    </Tabs>
  );
}
