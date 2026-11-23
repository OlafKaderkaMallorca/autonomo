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

import { berechneSummen, pruefeRechnungsregeln, formatRechnungsnummer, monatsGrenzen } from "./rechnung.js";
import { formatBetrag, formatDatum, formatMonat, rundeCent } from "./geld.js";

describe("berechneSummen", () => {
  it("rechnet IVA je Satz und IRPF auf die Basis", () => {
    const s = berechneSummen(
      [
        { menge: 1, preisCent: 70000, ivaSatz: 21 },
        { menge: 2.5, preisCent: 3500, ivaSatz: 21 },
        { menge: 3, preisCent: 333, ivaSatz: 10 },
      ],
      15,
    );
    expect(s.positionen).toEqual([70000, 8750, 999]);
    expect(s.basisCent).toBe(79749);
    expect(s.ivaGruppen).toEqual([
      { ivaSatz: 21, basisCent: 78750, ivaCent: 16538 },
      { ivaSatz: 10, basisCent: 999, ivaCent: 100 },
    ]);
    expect(s.irpfCent).toBe(11962);
    expect(s.summeCent).toBe(79749 + 16638 - 11962);
  });

  it("rundet negative Beträge symmetrisch", () => {
    expect(rundeCent(-0.5)).toBe(-1);
    expect(rundeCent(0.5)).toBe(1);
    expect(rundeCent(1.005 * 100)).toBe(101); // Gleitkomma-Rest 100.49999999999999
  });
});

describe("pruefeRechnungsregeln", () => {
  const privat = { typ: "privat" as const, steuernummer: null, adresse: null, irpf: false };
  it("vereinfacht bis 400 €", () => {
    expect(pruefeRechnungsregeln(privat, 40000, 1)).toMatchObject({ ok: true, typ: "vereinfacht" });
  });
  it("über 400 € nur mit NIF und Adresse", () => {
    expect(pruefeRechnungsregeln(privat, 40001, 1)).toMatchObject({ ok: false, fehler: "nif_und_adresse_noetig" });
    expect(pruefeRechnungsregeln({ ...privat, steuernummer: "12345678Z", adresse: "Calle 1" }, 84700, 1)).toMatchObject({ ok: true, typ: "vollstaendig" });
  });
  it("IRPF nur bei Firmenkunden mit Schalter", () => {
    const firma = { typ: "firma" as const, steuernummer: "B12345674", adresse: "Calle 2", irpf: true };
    expect(pruefeRechnungsregeln(firma, 100, 1).irpf).toBe(true);
    expect(pruefeRechnungsregeln({ ...firma, typ: "privat" }, 100, 1).irpf).toBe(false);
  });
  it("leere Rechnung wird abgelehnt", () => {
    expect(pruefeRechnungsregeln(privat, 0, 0).fehler).toBe("keine_positionen");
  });
});

describe("Formatierung", () => {
  it("formatiert Beträge, Daten und Monate je Sprache", () => {
    const ohneNbsp = (s: string) => s.replace(/\u00a0/g, " ");
    expect(ohneNbsp(formatBetrag(70000, "de"))).toBe("700,00 €");
    expect(formatBetrag(123456, "en")).toBe("€1,234.56");
    expect(formatDatum("2026-11-23", "es")).toBe("23/11/2026");
    expect(formatMonat("2026-11", "es")).toBe("noviembre de 2026");
    expect(formatRechnungsnummer("2027-", 7, 4)).toBe("2027-0007");
    expect(monatsGrenzen("2026-02")).toEqual({ von: "2026-02-01", bis: "2026-02-28" });
  });
});

import { parseBetrag } from "./geld.js";
describe("parseBetrag", () => {
  it("versteht deutsche, spanische und englische Schreibweisen", () => {
    expect(parseBetrag("700")).toBe(70000);
    expect(parseBetrag("35,50")).toBe(3550);
    expect(parseBetrag("35.5")).toBe(3550);
    expect(parseBetrag("1.234,56 €")).toBe(123456);
    expect(parseBetrag("1,234.56")).toBe(123456);
    expect(parseBetrag("-12,5")).toBe(-1250);
    expect(parseBetrag("abc")).toBeNull();
    expect(parseBetrag("")).toBeNull();
  });
});
