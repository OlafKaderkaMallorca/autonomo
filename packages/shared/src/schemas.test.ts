import { describe, expect, it } from "vitest";
import { istGueltigeSpanischeSteuernummer } from "./schemas.js";
import { t } from "./i18n/index.js";

describe("istGueltigeSpanischeSteuernummer", () => {
  it.each(["12345678Z", "X1234567L", "B12345674", "Q2826000H"])("akzeptiert %s", (n) => {
    expect(istGueltigeSpanischeSteuernummer(n)).toBe(true);
  });
  it.each(["12345678A", "X1234567A", "B12345670", "ABC", ""])("lehnt %s ab", (n) => {
    expect(istGueltigeSpanischeSteuernummer(n)).toBe(false);
  });
});

describe("t", () => {
  it("setzt Platzhalter ein", () => {
    expect(t("de", "mail.magicLink.text", { minuten: 15, link: "https://x" })).toContain("15 Minuten");
    expect(t("es", "login.titel")).toBe("Iniciar sesión");
  });
});
