import type { Metadata, Viewport } from "next";
import "./globals.css";
import { aktuelleSprache } from "@/lib/sprache";

export const metadata: Metadata = {
  title: "Autónomo",
  description: "Portal für Kunden und Steuerberatung",
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#1f6f50" };

export default async function Layout({ children }: { children: React.ReactNode }) {
  const sprache = await aktuelleSprache();
  return (
    <html lang={sprache}>
      <body>{children}</body>
    </html>
  );
}
