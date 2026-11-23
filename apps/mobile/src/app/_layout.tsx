import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SitzungsProvider } from "../lib/sitzung";

export default function Layout() {
  return (
    <SitzungsProvider>
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerShown: false }} />
    </SitzungsProvider>
  );
}
