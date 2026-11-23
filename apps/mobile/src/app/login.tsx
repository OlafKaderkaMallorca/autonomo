import { useState } from "react";
import { KeyboardAvoidingView, Platform, Text, TextInput, View } from "react-native";
import { Redirect } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { api, ApiFehler } from "../lib/api";
import { useSitzung } from "../lib/sitzung";
import { Knopf, SprachWahl, useFarben } from "../lib/ui";

export default function Login() {
  const { ich, t, anmelden } = useSitzung();
  const f = useFarben();
  const [email, setEmail] = useState("");
  const [passwort, setPasswort] = useState("");
  const [code, setCode] = useState("");
  const [codeNoetig, setCodeNoetig] = useState(false);
  const [laeuft, setLaeuft] = useState(false);
  const [meldung, setMeldung] = useState<{ text: string; fehler?: boolean } | null>(null);

  if (ich) return <Redirect href="/" />;

  const feld = { borderWidth: 1, borderColor: f.rand, borderRadius: 8, padding: 12, fontSize: 16, color: f.fg, backgroundColor: f.karte, marginTop: 6 };

  async function mitPasswort() {
    setLaeuft(true);
    setMeldung(null);
    try {
      await anmelden(email.trim(), passwort, codeNoetig ? code.trim() : undefined);
    } catch (e) {
      if (e instanceof ApiFehler && e.code === "zweiter_faktor") setCodeNoetig(true);
      else if (e instanceof ApiFehler && e.code === "code_falsch") setMeldung({ text: t("login.codeFalsch"), fehler: true });
      else setMeldung({ text: t("login.fehler"), fehler: true });
    } finally {
      setLaeuft(false);
    }
  }

  async function perLink() {
    setLaeuft(true);
    try {
      await api("/auth/magic-link", { method: "POST", body: { email: email.trim() } });
    } catch {
      // Antwort ist absichtlich immer gleich
    }
    setMeldung({ text: t("login.magicLinkGesendet") });
    setLaeuft(false);
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: f.bg }}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ padding: 16 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <Text style={{ fontSize: 24, fontWeight: "700", color: f.fg }}>{t("login.titel")}</Text>
          <SprachWahl />
        </View>
        <Text style={{ color: f.muted }}>{t("login.email")}</Text>
        <TextInput style={feld} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" textContentType="username" />
        <Text style={{ color: f.muted, marginTop: 12 }}>{t("login.passwort")}</Text>
        <TextInput style={feld} value={passwort} onChangeText={setPasswort} secureTextEntry autoComplete="password" textContentType="password" />
        {codeNoetig && (
          <>
            <Text style={{ color: f.muted, marginTop: 12 }}>{t("login.code")}</Text>
            <TextInput style={feld} value={code} onChangeText={setCode} autoFocus autoCapitalize="none" keyboardType="number-pad" textContentType="oneTimeCode" autoComplete="one-time-code" maxLength={20} />
            <Text style={{ color: f.muted, marginTop: 4 }}>{t("login.codeHinweis")}</Text>
          </>
        )}
        <Knopf titel={t("login.absenden")} onPress={mitPasswort} disabled={laeuft || !email || !passwort || (codeNoetig && code.trim().length < 6)} />
        <Knopf leise titel={t("login.magicLink")} onPress={perLink} disabled={laeuft || !email} />
        {meldung && <Text style={{ marginTop: 16, color: meldung.fehler ? f.fehler : f.muted }}>{meldung.text}</Text>}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
