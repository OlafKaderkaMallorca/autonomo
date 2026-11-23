import { useEffect, useMemo, useState } from "react";
import { Alert, Image, RefreshControl, ScrollView, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Crypto from "expo-crypto";
import * as ImagePicker from "expo-image-picker";
import { Directory, File, Paths } from "expo-file-system";
import { aufgabenMitAusstehenden, type FotoArt } from "../../../../lib/abgleich-kern";
import { useAbgleich } from "../../../../lib/abgleich";
import { bildQuelle } from "../../../../lib/api";
import { useDaten } from "../../../../lib/daten";
import { useSitzung } from "../../../../lib/sitzung";
import type { Aufgabe, Auftrag, Foto } from "../../../../lib/typen";
import { AbgleichLeiste, Auswahl, Feld, Knopf, Titel, useFarben } from "../../../../lib/ui";

const FOTO_ARTEN: FotoArt[] = ["vorher", "nachher", "arbeit", "schaden"];

/** Foto in den App-Ordner kopieren, damit es bis zum Hochladen sicher liegt (Cache kann geleert werden). */
function sichereFoto(quelle: string, id: string): string {
  const ordner = new Directory(Paths.document, "fotos");
  if (!ordner.exists) ordner.create({ intermediates: true, idempotent: true });
  const ziel = new File(ordner, `${id}.jpg`);
  new File(quelle).copy(ziel);
  return ziel.uri;
}

function ServerFoto({ pfad }: { pfad: string }) {
  const [quelle, setQuelle] = useState<{ uri: string; headers: Record<string, string> } | null>(null);
  useEffect(() => {
    void bildQuelle(pfad).then(setQuelle);
  }, [pfad]);
  return quelle ? <Image source={quelle} style={{ width: "100%", aspectRatio: 4 / 3, borderRadius: 8 }} /> : null;
}

/** Aufgabe mit Notizen und Fotos – alles auch offline. */
export default function AufgabeSeite() {
  const { betriebId: b, aufgabeId } = useLocalSearchParams<{ betriebId: string; aufgabeId: string }>();
  const { t } = useSitzung();
  const f = useFarben();
  const { ausstehend: alle, fuegeHinzu } = useAbgleich();
  const ausstehend = useMemo(() => alle.filter((e) => e.betriebId === b), [alle, b]);
  const aufgabe = useDaten<Aufgabe>(`/betriebe/${b}/aufgaben/${aufgabeId}`);
  const fotos = useDaten<Foto[]>(`/betriebe/${b}/aufgaben/${aufgabeId}/fotos`);
  const auftraege = useDaten<Auftrag[]>(`/betriebe/${b}/auftraege?status=aktiv`);
  const [notiz, setNotiz] = useState("");
  const [fotoArt, setFotoArt] = useState<FotoArt>("arbeit");

  // Server-Stand plus noch nicht übertragene Änderungen (auch für offline angelegte Aufgaben)
  const basis = aufgabe.daten ? [aufgabe.daten] : [];
  const g = aufgabenMitAusstehenden(
    basis,
    ausstehend,
    (auftraege.daten ?? []).map((a) => ({ id: a.id, titel: a.titel, kundeName: a.kundeName })),
  ).find((x) => x.id === aufgabeId) as Aufgabe | undefined;

  const notizen = [
    ...(aufgabe.daten?.notizen ?? []),
    ...ausstehend.flatMap((e) =>
      e.vorgang.art === "notiz_neu" && e.vorgang.daten.aufgabeId === aufgabeId
        ? [{ id: e.vorgang.daten.id, text: e.vorgang.daten.text, erstelltAm: e.erstelltAm, autor: null, ausstehend: true }]
        : [],
    ),
  ];
  const lokaleFotos = ausstehend.flatMap((e) => (e.vorgang.art === "foto_neu" && e.vorgang.daten.aufgabeId === aufgabeId ? [e.vorgang.daten] : []));

  async function umschalten() {
    if (!g) return;
    const status = g.status === "erledigt" ? "offen" : "erledigt";
    await fuegeHinzu(b, { art: "aufgabe_aendern", daten: { aufgabeId, titel: g.titel, aenderung: { status }, stand: g.geaendertAm } });
  }

  async function notizSpeichern() {
    if (!notiz.trim()) return;
    await fuegeHinzu(b, { art: "notiz_neu", daten: { id: Crypto.randomUUID(), aufgabeId, text: notiz.trim() } });
    setNotiz("");
  }

  async function foto(quelle: "kamera" | "galerie") {
    const erlaubt =
      quelle === "kamera" ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!erlaubt.granted) {
      Alert.alert(t("app.kameraVerweigert"));
      return;
    }
    const optionen: ImagePicker.ImagePickerOptions = { mediaTypes: ["images"], quality: 0.7, exif: false };
    const r = quelle === "kamera" ? await ImagePicker.launchCameraAsync(optionen) : await ImagePicker.launchImageLibraryAsync(optionen);
    if (r.canceled || !r.assets[0]) return;
    const id = Crypto.randomUUID();
    const uri = sichereFoto(r.assets[0].uri, id);
    await fuegeHinzu(b, { art: "foto_neu", daten: { id, aufgabeId, uri, fotoArt } });
  }

  const erledigt = g?.status === "erledigt";

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: f.bg }} edges={["top"]}>
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={false} onRefresh={() => void Promise.all([aufgabe.neuLaden(), fotos.neuLaden()]).catch(() => undefined)} />}
      >
        <Knopf leise titel={`← ${t("app.aufgaben")}`} onPress={() => router.navigate({ pathname: "/b/[betriebId]/aufgaben", params: { betriebId: b } })} />
        <AbgleichLeiste betriebId={b} />
        {!g ? (
          <Text style={{ color: f.muted, marginTop: 16 }}>…</Text>
        ) : (
          <>
            <Text style={{ fontSize: 22, fontWeight: "700", color: f.fg, marginTop: 12 }}>{g.titel}</Text>
            <Text style={{ color: f.muted }}>
              {[g.kundeName, g.auftragTitel].filter(Boolean).join(" · ")} · {t(`status.${g.status}`)}
              {g.erstelltVonRolle === "kunde" ? ` · ${t("aufgaben.vomKunden")}` : ""}
            </Text>
            {g.beschreibung ? <Text style={{ color: f.fg, marginTop: 10 }}>{g.beschreibung}</Text> : null}
            <Knopf leise={erledigt} titel={erledigt ? t("app.wiederOeffnen") : `✓ ${t("app.erledigt")}`} onPress={() => void umschalten()} />

            <Titel>{t("aufgaben.fotos")}</Titel>
            <Auswahl werte={FOTO_ARTEN.map((a) => ({ wert: a, text: t(`foto.${a}`) }))} wert={fotoArt} onWahl={setFotoArt} />
            <View style={{ flexDirection: "row", gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Knopf titel={t("app.fotoAufnehmen")} onPress={() => void foto("kamera")} />
              </View>
              <View style={{ flex: 1 }}>
                <Knopf leise titel={t("app.fotoGalerie")} onPress={() => void foto("galerie")} />
              </View>
            </View>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 12 }}>
              {lokaleFotos.map((x) => (
                <View key={x.id} style={{ width: "48%" }}>
                  <Image source={{ uri: x.uri }} style={{ width: "100%", aspectRatio: 4 / 3, borderRadius: 8, opacity: 0.7 }} />
                  <Text style={{ color: f.muted, fontSize: 12 }}>{t(`foto.${x.fotoArt}`)} · {t("app.fotoWartet")}</Text>
                </View>
              ))}
              {(fotos.daten ?? []).map((x) => (
                <View key={x.id} style={{ width: "48%" }}>
                  <ServerFoto pfad={`/betriebe/${b}/fotos/${x.id}/bild?groesse=klein`} />
                  <Text style={{ color: f.muted, fontSize: 12 }}>{t(`foto.${x.art}`)}</Text>
                </View>
              ))}
            </View>

            <Titel>{t("aufgaben.notizen")}</Titel>
            {notizen.map((n) => (
              <View key={n.id} style={{ backgroundColor: f.karte, borderColor: f.rand, borderWidth: 1, borderRadius: 10, padding: 12, marginTop: 8 }}>
                <Text style={{ color: f.fg }}>{n.text}</Text>
                <Text style={{ color: f.muted, fontSize: 12, marginTop: 4 }}>
                  {[n.autor, new Date(n.erstelltAm).toLocaleString()].filter(Boolean).join(" · ")}
                  {n.ausstehend ? ` · ${t("app.ausstehendKurz")}` : ""}
                </Text>
              </View>
            ))}
            <Feld placeholder={t("app.notizSchreiben")} value={notiz} onChangeText={setNotiz} multiline style={{ minHeight: 70, textAlignVertical: "top" }} />
            <Knopf titel={t("app.speichern")} onPress={() => void notizSpeichern()} disabled={!notiz.trim()} />
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
