import { useEffect, useState } from "react";
import { ScrollView, Text } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Crypto from "expo-crypto";
import { useAbgleich } from "../../../../lib/abgleich";
import { useDaten } from "../../../../lib/daten";
import { useSitzung } from "../../../../lib/sitzung";
import type { Auftrag } from "../../../../lib/typen";
import { Auswahl, Feld, Knopf, useFarben } from "../../../../lib/ui";

/** Neue Aufgabe anlegen – wird offline gespeichert und später übertragen. */
export default function NeueAufgabe() {
  const { betriebId: b } = useLocalSearchParams<{ betriebId: string }>();
  const { t } = useSitzung();
  const f = useFarben();
  const { fuegeHinzu } = useAbgleich();
  const auftraege = useDaten<Auftrag[]>(`/betriebe/${b}/auftraege?status=aktiv`);
  const liste = auftraege.daten ?? [];
  const [auftragId, setAuftragId] = useState<string | null>(null);
  const [titel, setTitel] = useState("");
  const [beschreibung, setBeschreibung] = useState("");

  useEffect(() => {
    if (!auftragId && liste.length > 0) setAuftragId(liste[0]!.id);
  }, [auftragId, liste]);

  async function anlegen() {
    if (!auftragId || titel.trim().length === 0) return;
    const id = Crypto.randomUUID();
    await fuegeHinzu(b, { art: "aufgabe_neu", daten: { id, auftragId, titel: titel.trim(), beschreibung: beschreibung.trim() || null } });
    router.replace({ pathname: "/b/[betriebId]/aufgabe/[aufgabeId]", params: { betriebId: b, aufgabeId: id } });
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: f.bg }} edges={["top"]}>
      <ScrollView contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
        <Knopf leise titel={`← ${t("allg.zurueck")}`} onPress={() => router.back()} />
        <Text style={{ fontSize: 22, fontWeight: "700", color: f.fg, marginTop: 12 }}>{t("app.neueAufgabe")}</Text>
        {liste.length === 0 ? (
          <Text style={{ color: f.muted, marginTop: 12 }}>{t("app.keineAuftraege")}</Text>
        ) : (
          <Auswahl werte={liste.map((a) => ({ wert: a.id, text: `${a.kundeName} · ${a.titel}` }))} wert={auftragId} onWahl={setAuftragId} />
        )}
        <Feld beschriftung={t("feld.titel")} value={titel} onChangeText={setTitel} autoFocus />
        <Feld beschriftung={t("feld.notiz")} value={beschreibung} onChangeText={setBeschreibung} multiline style={{ minHeight: 80, textAlignVertical: "top" }} />
        <Knopf titel={t("allg.anlegen")} onPress={() => void anlegen()} disabled={!auftragId || titel.trim().length === 0} />
      </ScrollView>
    </SafeAreaView>
  );
}
