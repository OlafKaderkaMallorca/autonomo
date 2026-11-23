import { useState } from "react";
import { Alert, ScrollView, Switch, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAbgleich } from "../../../lib/abgleich";
import { useSitzung } from "../../../lib/sitzung";
import { useSperre } from "../../../lib/sperre";
import { Karte, Knopf, SprachWahl, Titel, useFarben } from "../../../lib/ui";

/** Konto, Sprache, Face ID, Übertragungsstatus, Abmelden. */
export default function Mehr() {
  const { betriebId: b } = useLocalSearchParams<{ betriebId: string }>();
  const { ich, t, abmelden, ueberallAbmelden } = useSitzung();
  const f = useFarben();
  const sperre = useSperre();
  const { ausstehend, abgleichen, verwerfen, laeuft } = useAbgleich();
  const [biometrieFehlt, setBiometrieFehlt] = useState(false);
  const meine = ausstehend.filter((e) => e.betriebId === b);
  const betrieb = ich?.betriebe.find((x) => x.id === b);

  function alleAbmelden() {
    Alert.alert(t("sicherheit.alleAbmelden"), t("sicherheit.alleAbmeldenFrage"), [
      { text: t("allg.abbrechen"), style: "cancel" },
      { text: t("sicherheit.alleAbmelden"), style: "destructive", onPress: () => void ueberallAbmelden().catch(() => undefined) },
    ]);
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: f.bg }} edges={["top"]}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <Text style={{ fontSize: 22, fontWeight: "700", color: f.fg }}>{t("app.konto")}</Text>
          <SprachWahl />
        </View>
        <Text style={{ color: f.fg, marginTop: 8 }}>{ich?.name}</Text>
        <Text style={{ color: f.muted }}>{ich?.email}</Text>
        {betrieb && <Text style={{ color: f.muted }}>{betrieb.name} · {t(`rolle.${betrieb.rolle}`)}</Text>}

        <Titel>{t("sicherheit.titel")}</Titel>
        <Karte>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <Text style={{ color: f.fg, flexShrink: 1 }}>{t("app.biometrie")}</Text>
            <Switch
              value={sperre.aktiv}
              onValueChange={async (an) => {
                if (an && !sperre.verfuegbar) return setBiometrieFehlt(true);
                await sperre.setzeAktiv(an);
              }}
            />
          </View>
          <Text style={{ color: f.muted, marginTop: 6 }}>{biometrieFehlt ? t("app.biometrieFehlt") : t("app.biometrieHinweis")}</Text>
          <Text style={{ color: f.muted, marginTop: 10 }}>
            {t("sicherheit.zweiFaktor")}: {ich?.zweiFaktor ? t("allg.ja") : t("allg.nein")}
          </Text>
        </Karte>

        <Titel>{t("app.ausstehend", { anzahl: meine.length })}</Titel>
        {meine.length > 0 && <Knopf titel={laeuft ? "…" : t("app.uebertragen")} onPress={() => void abgleichen()} disabled={laeuft} />}
        {meine
          .filter((e) => e.fehler)
          .map((e) => (
            <Karte key={e.nr}>
              <Text style={{ color: f.fehler }}>{t("app.fehlerUebertragung", { text: e.fehler ?? "" })}</Text>
              <Text style={{ color: f.muted }}>{e.vorgang.art} · {new Date(e.erstelltAm).toLocaleString()}</Text>
              <Knopf leise titel={t("app.verwerfen")} onPress={() => void verwerfen(e.nr)} />
            </Karte>
          ))}

        <Text style={{ color: f.muted, marginTop: 20 }}>{t("app.web")}</Text>
        {ich && ich.betriebe.length > 1 && <Knopf leise titel={t("betrieb.waehlen")} onPress={() => router.replace("/")} />}
        <Knopf leise titel={t("abmelden")} onPress={() => void abmelden()} />
        <Knopf leise titel={t("sicherheit.alleAbmelden")} onPress={alleAbmelden} />
      </ScrollView>
    </SafeAreaView>
  );
}
