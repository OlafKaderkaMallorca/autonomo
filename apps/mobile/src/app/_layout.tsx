import type { ReactNode } from "react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { AbgleichProvider } from "../lib/abgleich";
import { SitzungsProvider, useSitzung } from "../lib/sitzung";
import { SperrProvider } from "../lib/sperre";

function MitAbgleich({ children }: { children: ReactNode }) {
  const { ich } = useSitzung();
  return <AbgleichProvider aktiv={!!ich}>{children}</AbgleichProvider>;
}

export default function Layout() {
  return (
    <SitzungsProvider>
      <MitAbgleich>
        <SperrProvider>
          <StatusBar style="auto" />
          <Stack screenOptions={{ headerShown: false }} />
        </SperrProvider>
      </MitAbgleich>
    </SitzungsProvider>
  );
}
