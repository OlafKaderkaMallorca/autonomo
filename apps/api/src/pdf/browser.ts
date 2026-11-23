import { existsSync } from "node:fs";
import { chromium, type Browser } from "playwright-core";

/**
 * HTML → PDF mit einem vorhandenen Chromium-Browser.
 * Windows: Microsoft Edge ist immer installiert und wird automatisch genutzt.
 * Server/Linux: Chromium aus dem System oder PDF_BROWSER.
 */
export interface PdfDrucker {
  drucke(html: string): Promise<Buffer>;
  schliessen(): Promise<void>;
}

const KANDIDATEN = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/opt/pw-browsers/chromium",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome",
];

export function findeBrowser(vorgabe?: string): string {
  if (vorgabe) return vorgabe;
  const pfad = KANDIDATEN.find((p) => existsSync(p));
  if (!pfad) {
    throw new Error("Kein Browser für die PDF-Erzeugung gefunden. Bitte PDF_BROWSER in apps/api/.env setzen (Pfad zu Chrome, Edge oder Chromium).");
  }
  return pfad;
}

export function erstellePdfDrucker(browserPfad?: string): PdfDrucker {
  let browser: Promise<Browser> | null = null;
  const holeBrowser = () => {
    browser ??= chromium.launch({ executablePath: findeBrowser(browserPfad), headless: true, args: ["--no-sandbox"] }).catch((e) => {
      browser = null;
      throw e;
    });
    return browser;
  };
  return {
    async drucke(html) {
      const b = await holeBrowser();
      // Kein Netzwerkzugriff: alle Inhalte (Logo, Unterschrift) sind eingebettet
      const kontext = await b.newContext({ javaScriptEnabled: false, offline: true });
      try {
        const seite = await kontext.newPage();
        await seite.route("**/*", (r) => (r.request().url().startsWith("data:") ? r.continue() : r.abort()));
        await seite.setContent(html, { waitUntil: "load" });
        return await seite.pdf({ format: "A4", printBackground: true, preferCSSPageSize: true });
      } finally {
        await kontext.close();
      }
    },
    async schliessen() {
      if (browser) await (await browser).close().catch(() => {});
      browser = null;
    },
  };
}
