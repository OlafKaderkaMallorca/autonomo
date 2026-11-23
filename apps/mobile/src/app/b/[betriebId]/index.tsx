import { useEffect, useMemo, useRef, useState } from "react";
import { RefreshControl, ScrollView, Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Crypto from "expo-crypto";
import { stoppVorgang, timerZusammenfuehren, zeitenMitAusstehenden, type LokalerTimer } from "../../../lib/abgleich-kern";
import { timerSchluessel, useAbgleich } from "../../../lib/abgleich";
import { useDaten } from "../../../lib/daten";
import { useSitzung } from "../../../lib/sitzung";
import { leseZwischenspeicher, schreibeZwischenspeicher } from "../../../lib/speicher";
import type { Auftrag, ServerTimer, Zeiteintrag } from "../../../lib/typen";
import { AbgleichLeiste, Auswahl, Feld, formatDauer, Karte, Knopf, Titel, useFarben } from "../../../lib/ui";

const tag = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const uhrzeit = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/** „Heute“: Timer starten/stoppen, Zeit nachtragen, letzte Einträge – funktioniert auch ohne Netz. */
export default function Heute() {
  const { betriebId: b } = useLocalSearchParams<{ betriebId: string }>();
  const { t, ich } = useSitzung();
  const f = useFarben();
  const { ausstehend: alle, fuegeHinzu } = useAbgleich();
  const ausstehend = useMemo(() => alle.filter((e) => e.betriebId === b), [alle, b]);

  const vor7Tagen = useMemo(() => tag(new Date(Date.now() - 7 * 86400_000)), []);
  const auftraege = useDaten<Auftrag[]>(`/betriebe/${b}/auftraege?status=aktiv`);
  const serverTimer = useDaten<{ timer: ServerTimer | null }>(`/betriebe/${b}/timer`);
  const zeiten = useDaten<Zeiteintrag[]>(`/betriebe/${b}/zeiten?von=${vor7Tagen}`);

  const [timer, setTimer] = useState<LokalerTimer | null | undefined>(undefined);
  const [auftragId, setAuftragId] = useState<string | null>(null);
  const [jetzt, setJetzt] = useState(Date.now());
  const letzteAenderung = useRef(0);

  const auftragListe = auftraege.daten ?? [];
  const auftraegeKurz = auftragListe.map((a) => ({ id: a.id, titel: a.titel, kundeName: a.kundeName }));
  useEffect(() => {
    if (!auftragId && auftragListe.length > 0) setAuftragId(auftragListe[0]!.id);
  }, [auftragId, auftragListe]);

  // Lokalen Timer laden
  useEffect(() => {
    void leseZwischenspeicher<LokalerTimer | null>(timerSchluessel(b)).then((z) => setTimer(z?.daten ?? null));
  }, [b]);

  // Merken, wann sich Timer-Vorgänge in der Warteschlange geändert haben
  const timerVorgaenge = ausstehend.filter((e) => e.vorgang.art.startsWith("timer_") || e.vorgang.art === "zeit_neu").map((e) => e.nr).join(",");
  useEffect(() => {
    letzteAenderung.current = Date.now();
  }, [timerVorgaenge]);

  // Mit dem Server zusammenführen – nur mit Daten, die nach der letzten lokalen Änderung geladen wurden
  useEffect(() => {
    if (timer === undefined || !serverTimer.frisch || !serverTimer.stand || !serverTimer.daten) return;
    if (Date.parse(serverTimer.stand) < letzteAenderung.current) return;
    const neu = timerZusammenfuehren(timer, serverTimer.daten.timer, ausstehend);
    if (neu?.id !== timer?.id || neu?.nurLokal !== timer?.nurLokal) {
      setTimer(neu);
      void schreibeZwischenspeicher(timerSchluessel(b), neu);
    }
  }, [serverTimer.stand, serverTimer.frisch, serverTimer.daten, timer, ausstehend, b]);

  // Anzeige der laufenden Zeit
  useEffect(() => {
    if (!timer) return;
    const i = setInterval(() => setJetzt(Date.now()), 1000);
    return () => clearInterval(i);
  }, [timer]);

  async function starten() {
    const a = auftragListe.find((x) => x.id === auftragId);
    if (!a) return;
    const neu: LokalerTimer = { id: Crypto.randomUUID(), auftragId: a.id, auftragTitel: a.titel, kundeName: a.kundeName, start: new Date().toISOString() };
    letzteAenderung.current = Date.now();
    setTimer(neu);
    await schreibeZwischenspeicher(timerSchluessel(b), neu);
    await fuegeHinzu(b, { art: "timer_start", daten: { id: neu.id, auftragId: neu.auftragId, start: neu.start } });
  }

  async function stoppen() {
    if (!timer) return;
    const v = stoppVorgang(timer, new Date().toISOString());
    letzteAenderung.current = Date.now();
    setTimer(null);
    await schreibeZwischenspeicher(timerSchluessel(b), null);
    await fuegeHinzu(b, v);
  }

  // Zeit nachtragen
  const heute = new Date();
  const [datum, setDatum] = useState(`${String(heute.getDate()).padStart(2, "0")}.${String(heute.getMonth() + 1).padStart(2, "0")}.${heute.getFullYear()}`);
  const [von, setVon] = useState("");
  const [bis, setBis] = useState("");
  const [nachtragFehler, setNachtragFehler] = useState(false);
  const [nachtragOffen, setNachtragOffen] = useState(false);

  async function nachtragen() {
    const d = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(datum.trim());
    const v = /^(\d{1,2})[:.](\d{2})$/.exec(von.trim());
    const e = /^(\d{1,2})[:.](\d{2})$/.exec(bis.trim());
    if (!d || !v || !e || !auftragId) return setNachtragFehler(true);
    const start = new Date(+d[3]!, +d[2]! - 1, +d[1]!, +v[1]!, +v[2]!);
    const ende = new Date(+d[3]!, +d[2]! - 1, +d[1]!, +e[1]!, +e[2]!);
    if (isNaN(start.getTime()) || ende <= start) return setNachtragFehler(true);
    setNachtragFehler(false);
    await fuegeHinzu(b, { art: "zeit_neu", daten: { id: Crypto.randomUUID(), auftragId, start: start.toISOString(), ende: ende.toISOString() } });
    setVon("");
    setBis("");
    setNachtragOffen(false);
  }

  const liste = zeitenMitAusstehenden((zeiten.daten ?? []).filter((z) => !z.laeuft), ausstehend, auftraegeKurz);
  const heuteMinuten =
    liste.filter((z) => tag(new Date(z.start)) === tag(new Date())).reduce((s, z) => s + z.dauerMinuten, 0) +
    (timer && tag(new Date(timer.start)) === tag(new Date()) ? Math.floor((jetzt - Date.parse(timer.start)) / 60000) : 0);
  const laufend = timer ? Math.max(0, Math.floor((jetzt - Date.parse(timer.start)) / 1000)) : 0;
  const betrieb = ich?.betriebe.find((x) => x.id === b);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: f.bg }} edges={["top"]}>
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={false} onRefresh={() => void Promise.all([auftraege.neuLaden(), serverTimer.neuLaden(), zeiten.neuLaden()]).catch(() => undefined)} />}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={{ fontSize: 22, fontWeight: "700", color: f.fg }}>{betrieb?.name ?? ""}</Text>
        <AbgleichLeiste betriebId={b} />

        <Karte>
          <Text style={{ color: f.muted }}>{t("timer.titel")}</Text>
          {timer ? (
            <>
              <Text style={{ fontSize: 44, fontWeight: "700", color: f.fg, fontVariant: ["tabular-nums"], marginTop: 6 }}>
                {`${Math.floor(laufend / 3600)}:${String(Math.floor((laufend % 3600) / 60)).padStart(2, "0")}:${String(laufend % 60).padStart(2, "0")}`}
              </Text>
              <Text style={{ color: f.fg, fontSize: 16 }}>{timer.kundeName} · {timer.auftragTitel}</Text>
              <Text style={{ color: f.muted }}>{t("timer.laeuft", { zeit: uhrzeit(timer.start) })}</Text>
              <Knopf titel={t("timer.stopp")} onPress={() => void stoppen()} />
            </>
          ) : auftragListe.length === 0 ? (
            <Text style={{ color: f.muted, marginTop: 8 }}>{t("app.keineAuftraege")}</Text>
          ) : (
            <>
              <Auswahl werte={auftragListe.map((a) => ({ wert: a.id, text: `${a.kundeName} · ${a.titel}` }))} wert={auftragId} onWahl={setAuftragId} />
              <Knopf titel={t("timer.start")} onPress={() => void starten()} disabled={!auftragId || timer === undefined} />
            </>
          )}
        </Karte>

        <Text style={{ color: f.muted, marginTop: 12 }}>{t("app.heuteErfasst", { dauer: formatDauer(heuteMinuten) })}</Text>

        {nachtragOffen ? (
          <Karte>
            <Text style={{ color: f.fg, fontWeight: "600" }}>{t("app.zeitNachtragen")}</Text>
            {auftragListe.length > 0 && (
              <Auswahl werte={auftragListe.map((a) => ({ wert: a.id, text: `${a.kundeName} · ${a.titel}` }))} wert={auftragId} onWahl={setAuftragId} />
            )}
            <Feld beschriftung={t("app.datum")} value={datum} onChangeText={setDatum} keyboardType="numbers-and-punctuation" />
            <View style={{ flexDirection: "row", gap: 10 }}>
              <Feld beschriftung={t("app.von")} value={von} onChangeText={setVon} placeholder="08:00" keyboardType="numbers-and-punctuation" />
              <Feld beschriftung={t("app.bis")} value={bis} onChangeText={setBis} placeholder="12:30" keyboardType="numbers-and-punctuation" />
            </View>
            {nachtragFehler && <Text style={{ color: f.fehler, marginTop: 8 }}>{t("app.eingabeFalsch")}</Text>}
            <Knopf titel={t("app.speichern")} onPress={() => void nachtragen()} disabled={!auftragId} />
          </Karte>
        ) : (
          auftragListe.length > 0 && <Knopf leise titel={t("app.zeitNachtragen")} onPress={() => setNachtragOffen(true)} />
        )}

        <Titel>{t("app.letzteZeiten")}</Titel>
        {liste.slice(0, 20).map((z) => (
          <Karte key={z.id} style={{ marginTop: 8, flexDirection: "row", justifyContent: "space-between" }}>
            <View style={{ flexShrink: 1 }}>
              <Text style={{ color: f.fg }}>{z.kundeName} · {z.auftragTitel}</Text>
              <Text style={{ color: f.muted }}>
                {new Date(z.start).toLocaleDateString()} {uhrzeit(z.start)}–{z.ende ? uhrzeit(z.ende) : ""}
                {z.ausstehend ? ` · ${t("app.ausstehendKurz")}` : ""}
              </Text>
            </View>
            <Text style={{ color: f.fg, fontVariant: ["tabular-nums"] }}>{formatDauer(z.dauerMinuten)}</Text>
          </Karte>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}
