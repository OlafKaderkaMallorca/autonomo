"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { istSprache, parseBetrag, parseZahl, type Sprache } from "@autonomo/shared";
import { api, apiRoh, ApiFehler } from "@/lib/api";
import { aktuelleSprache, uebersetzer } from "@/lib/sprache";

export interface Zustand {
  fehler?: string;
  ok?: string;
  link?: string;
}

/** Führt einen API-Aufruf aus und macht aus API-Fehlern eine Meldung im Formular. */
async function versuche(fn: () => Promise<Zustand | void>): Promise<Zustand> {
  try {
    return (await fn()) ?? {};
  } catch (e) {
    if (e instanceof ApiFehler) return { fehler: e.message };
    throw e;
  }
}

const text = (f: FormData, name: string): string | null => {
  const w = f.get(name);
  return typeof w === "string" && w.trim() ? w.trim() : null;
};
const pflicht = (f: FormData, name: string): string => text(f, name) ?? "";
const an = (f: FormData, name: string) => f.get(name) === "on" || f.get(name) === "true";
const pfad = (b: string, rest = "") => `/b/${b}${rest}`;
const t = async () => uebersetzer(await aktuelleSprache());

interface EditorZeile {
  id?: string;
  art: string;
  beschreibung: string;
  menge: string;
  einheit: string;
  preis: string;
  ivaSatz: string;
  stundenkontingent: string;
}

/** Positionen aus dem Editor (Euro-Texte) in API-Positionen (Cent). */
function positionen(f: FormData, mitArt = true) {
  const roh = JSON.parse(String(f.get("positionen") ?? "[]")) as EditorZeile[];
  return roh
    .filter((p) => p.beschreibung.trim() || p.preis.trim())
    .map((p) => {
      const preisCent = parseBetrag(p.preis);
      const menge = parseZahl(p.menge || "0");
      const ivaSatz = parseZahl(p.ivaSatz || "0");
      if (preisCent === null || menge === null || ivaSatz === null) throw new ApiFehler(400, `Bitte Zahlen prüfen: „${p.beschreibung}“`);
      return {
        ...(p.id ? { id: p.id } : {}),
        ...(mitArt ? { art: p.art } : {}),
        beschreibung: p.beschreibung.trim(),
        menge,
        einheit: p.einheit.trim() || null,
        preisCent,
        ivaSatz,
        ...(mitArt ? { stundenkontingent: p.art === "pauschale" ? parseZahl(p.stundenkontingent || "") : null } : {}),
      };
    });
}

/** Datum + Uhrzeit in Spanien als ISO-Zeitpunkt mit richtigem Versatz (Sommer-/Winterzeit). */
function madridZuIso(datum: string, zeit: string): string {
  const ungefaehr = new Date(`${datum}T${zeit}:00Z`);
  const name = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Madrid", timeZoneName: "longOffset" })
    .formatToParts(ungefaehr)
    .find((p) => p.type === "timeZoneName")!.value;
  const versatz = name.replace("GMT", "") || "+00:00";
  return `${datum}T${zeit}:00${versatz}`;
}

// --- Kunden -----------------------------------------------------------------

function kundenDaten(f: FormData) {
  const typ = f.get("typ") === "firma" ? "firma" : "privat";
  const sprache = String(f.get("sprache"));
  return {
    typ,
    name: pflicht(f, "name"),
    steuernummer: text(f, "steuernummer"),
    email: text(f, "email"),
    telefon: text(f, "telefon"),
    adresse: text(f, "adresse"),
    notizen: text(f, "notizen"),
    sprache: istSprache(sprache) ? sprache : "es",
    irpf: typ === "firma" && an(f, "irpf"),
  };
}

export async function kundeAnlegen(b: string, _: Zustand, f: FormData): Promise<Zustand> {
  let id = "";
  const z = await versuche(async () => {
    id = (await api<{ id: string }>(`/betriebe/${b}/kunden`, { method: "POST", body: kundenDaten(f) })).id;
  });
  if (id) redirect(pfad(b, `/kunden/${id}`));
  return z;
}

export async function kundeSpeichern(b: string, k: string, _: Zustand, f: FormData): Promise<Zustand> {
  return versuche(async () => {
    await api(`/betriebe/${b}/kunden/${k}`, { method: "PATCH", body: kundenDaten(f) });
    revalidatePath(pfad(b, "/kunden"), "layout");
    return { ok: (await t())("allg.gespeichert") };
  });
}

export async function kundeArchivieren(b: string, k: string, archiviert: boolean, _: Zustand): Promise<Zustand> {
  return versuche(async () => {
    await api(`/betriebe/${b}/kunden/${k}`, { method: "PATCH", body: { archiviert } });
    revalidatePath(pfad(b, "/kunden"), "layout");
  });
}

export async function kontaktAnlegen(b: string, k: string, _: Zustand, f: FormData): Promise<Zustand> {
  return versuche(async () => {
    await api(`/betriebe/${b}/kunden/${k}/kontakte`, {
      method: "POST",
      body: { name: pflicht(f, "name"), email: text(f, "email"), telefon: text(f, "telefon"), funktion: text(f, "funktion") },
    });
    revalidatePath(pfad(b, `/kunden/${k}`));
  });
}

export async function kontaktLoeschen(b: string, k: string, kontakt: string, _: Zustand): Promise<Zustand> {
  return versuche(async () => {
    await api(`/betriebe/${b}/kunden/${k}/kontakte/${kontakt}`, { method: "DELETE" });
    revalidatePath(pfad(b, `/kunden/${k}`));
  });
}

export async function kundeEinladen(b: string, k: string, sprache: Sprache, _: Zustand, f: FormData): Promise<Zustand> {
  return versuche(async () => {
    await api(`/betriebe/${b}/einladungen`, {
      method: "POST",
      body: { email: pflicht(f, "email"), name: pflicht(f, "name"), rolle: "kunde", kundeId: k, sprache },
    });
    return { ok: (await t())("kunden.eingeladen") };
  });
}

// --- Angebote ---------------------------------------------------------------

function angebotDaten(f: FormData) {
  return {
    kundeId: pflicht(f, "kundeId"),
    titel: pflicht(f, "titel"),
    einleitung: text(f, "einleitung"),
    gueltigBis: pflicht(f, "gueltigBis"),
    positionen: positionen(f),
  };
}

export async function angebotAnlegen(b: string, _: Zustand, f: FormData): Promise<Zustand> {
  let id = "";
  const z = await versuche(async () => {
    id = (await api<{ id: string }>(`/betriebe/${b}/angebote`, { method: "POST", body: angebotDaten(f) })).id;
  });
  if (id) redirect(pfad(b, `/angebote/${id}`));
  return z;
}

export async function angebotSpeichern(b: string, id: string, _: Zustand, f: FormData): Promise<Zustand> {
  let fertig = false;
  const z = await versuche(async () => {
    await api(`/betriebe/${b}/angebote/${id}`, { method: "PUT", body: angebotDaten(f) });
    fertig = true;
  });
  if (fertig) redirect(pfad(b, `/angebote/${id}`));
  return z;
}

export async function angebotLoeschen(b: string, id: string, _: Zustand): Promise<Zustand> {
  let fertig = false;
  const z = await versuche(async () => {
    await api(`/betriebe/${b}/angebote/${id}`, { method: "DELETE" });
    fertig = true;
  });
  if (fertig) redirect(pfad(b, "/angebote"));
  return z;
}

export async function angebotSenden(b: string, id: string, _: Zustand, f: FormData): Promise<Zustand> {
  return versuche(async () => {
    const ohneMail = f.get("ohneMail") === "ja";
    const r = await api<{ link: string; gesendetAn: string | null }>(`/betriebe/${b}/angebote/${id}/senden`, {
      method: "POST",
      body: { ohneMail, ...(text(f, "an") ? { an: text(f, "an") } : {}) },
    });
    revalidatePath(pfad(b, `/angebote/${id}`));
    return { link: r.link, ok: r.gesendetAn ? `✓ ${r.gesendetAn}` : (await t())("angebote.linkHinweis") };
  });
}

export async function angebotAngenommen(b: string, id: string, _: Zustand, f: FormData): Promise<Zustand> {
  let auftragId = "";
  const z = await versuche(async () => {
    auftragId = (await api<{ auftragId: string }>(`/betriebe/${b}/angebote/${id}/angenommen`, { method: "POST", body: { name: pflicht(f, "name") } })).auftragId;
  });
  if (auftragId) redirect(pfad(b, `/auftraege/${auftragId}`));
  return z;
}

export async function angebotAbgelehnt(b: string, id: string, _: Zustand, f: FormData): Promise<Zustand> {
  return versuche(async () => {
    await api(`/betriebe/${b}/angebote/${id}/abgelehnt`, { method: "POST", body: text(f, "grund") ? { grund: text(f, "grund") } : {} });
    revalidatePath(pfad(b, `/angebote/${id}`));
  });
}

export async function angebotKopieren(b: string, id: string, _: Zustand, f: FormData): Promise<Zustand> {
  let neu = "";
  const z = await versuche(async () => {
    neu = (await api<{ id: string }>(`/betriebe/${b}/angebote/${id}/kopie`, {
      method: "POST",
      body: text(f, "kundeId") ? { kundeId: text(f, "kundeId") } : {},
    })).id;
  });
  if (neu) redirect(pfad(b, `/angebote/${neu}/bearbeiten`));
  return z;
}

// --- Aufträge, Aufgaben, Material, Fotos --------------------------------------

export async function auftragAnlegen(b: string, _: Zustand, f: FormData): Promise<Zustand> {
  let id = "";
  const z = await versuche(async () => {
    id = (await api<{ id: string }>(`/betriebe/${b}/auftraege`, {
      method: "POST",
      body: { kundeId: pflicht(f, "kundeId"), titel: pflicht(f, "titel"), beginn: text(f, "beginn") ?? undefined, positionen: positionen(f) },
    })).id;
  });
  if (id) redirect(pfad(b, `/auftraege/${id}`));
  return z;
}

export async function auftragSpeichern(b: string, id: string, _: Zustand, f: FormData): Promise<Zustand> {
  return versuche(async () => {
    await api(`/betriebe/${b}/auftraege/${id}`, {
      method: "PATCH",
      body: { titel: pflicht(f, "titel"), status: pflicht(f, "status"), positionen: positionen(f).map((p) => ({ ...p, aktiv: true })) },
    });
    revalidatePath(pfad(b, `/auftraege/${id}`));
    return { ok: (await t())("allg.gespeichert") };
  });
}

export async function aufgabeAnlegen(b: string, auftragId: string, _: Zustand, f: FormData): Promise<Zustand> {
  return versuche(async () => {
    await api(`/betriebe/${b}/aufgaben`, {
      method: "POST",
      body: { auftragId, titel: pflicht(f, "titel"), beschreibung: text(f, "beschreibung"), faelligAm: text(f, "faelligAm"), sichtbarFuerKunde: an(f, "sichtbar") },
    });
    revalidatePath(pfad(b, `/auftraege/${auftragId}`));
  });
}

export async function aufgabeStatus(b: string, aufgabeId: string, status: string, _: Zustand): Promise<Zustand> {
  return versuche(async () => {
    await api(`/betriebe/${b}/aufgaben/${aufgabeId}`, { method: "PATCH", body: { status } });
    revalidatePath(pfad(b), "layout");
  });
}

export async function notizAnlegen(b: string, aufgabeId: string, _: Zustand, f: FormData): Promise<Zustand> {
  return versuche(async () => {
    await api(`/betriebe/${b}/aufgaben/${aufgabeId}/notizen`, { method: "POST", body: { text: pflicht(f, "text"), sichtbarFuerKunde: an(f, "sichtbar") } });
    revalidatePath(pfad(b, `/aufgaben/${aufgabeId}`));
  });
}

export async function materialAnlegen(b: string, auftragId: string, _: Zustand, f: FormData): Promise<Zustand> {
  return versuche(async () => {
    const preisCent = parseBetrag(pflicht(f, "preis"));
    if (preisCent === null) return { fehler: "€?" };
    await api(`/betriebe/${b}/material`, {
      method: "POST",
      body: { auftragId, datum: text(f, "datum") ?? undefined, beschreibung: pflicht(f, "beschreibung"), menge: parseZahl(pflicht(f, "menge")) ?? 1, einheit: text(f, "einheit"), preisCent },
    });
    revalidatePath(pfad(b, `/auftraege/${auftragId}`));
  });
}

export async function fotoHochladen(b: string, aufgabeId: string, _: Zustand, f: FormData): Promise<Zustand> {
  return versuche(async () => {
    const datei = f.get("foto");
    if (!(datei instanceof File) || datei.size === 0) return { fehler: "?" };
    const q = new URLSearchParams({ art: String(f.get("art") ?? "arbeit"), sichtbar: an(f, "sichtbar") ? "ja" : "nein" });
    if (text(f, "beschreibung")) q.set("beschreibung", text(f, "beschreibung")!);
    const res = await apiRoh(`/betriebe/${b}/aufgaben/${aufgabeId}/fotos?${q}`, {
      method: "POST",
      body: new Uint8Array(await datei.arrayBuffer()),
      typ: datei.type || "image/jpeg",
    });
    if (!res.ok) return { fehler: ((await res.json().catch(() => ({}))) as { fehler?: string }).fehler ?? res.statusText };
    revalidatePath(pfad(b, `/aufgaben/${aufgabeId}`));
  });
}

export async function fotoAendern(b: string, aufgabeId: string, fotoId: string, sichtbarFuerKunde: boolean, _: Zustand): Promise<Zustand> {
  return versuche(async () => {
    await api(`/betriebe/${b}/fotos/${fotoId}`, { method: "PATCH", body: { sichtbarFuerKunde } });
    revalidatePath(pfad(b, `/aufgaben/${aufgabeId}`));
  });
}

export async function fotoLoeschen(b: string, aufgabeId: string, fotoId: string, _: Zustand): Promise<Zustand> {
  return versuche(async () => {
    await api(`/betriebe/${b}/fotos/${fotoId}`, { method: "DELETE" });
    revalidatePath(pfad(b, `/aufgaben/${aufgabeId}`));
  });
}

// --- Zeiten -----------------------------------------------------------------

export async function timerStarten(b: string, _: Zustand, f: FormData): Promise<Zustand> {
  return versuche(async () => {
    await api(`/betriebe/${b}/timer/start`, { method: "POST", body: { auftragId: pflicht(f, "auftragId"), notiz: text(f, "notiz") } });
    revalidatePath(pfad(b), "layout");
  });
}

export async function timerStoppen(b: string, _: Zustand): Promise<Zustand> {
  return versuche(async () => {
    await api(`/betriebe/${b}/timer/stopp`, { method: "POST", body: {} });
    revalidatePath(pfad(b), "layout");
  });
}

export async function zeitNachtragen(b: string, _: Zustand, f: FormData): Promise<Zustand> {
  return versuche(async () => {
    const datum = pflicht(f, "datum");
    const von = pflicht(f, "von");
    const bis = text(f, "bis");
    const dauer = parseZahl(text(f, "dauer") ?? "");
    const start = madridZuIso(datum, von);
    await api(`/betriebe/${b}/zeiten`, {
      method: "POST",
      body: {
        auftragId: pflicht(f, "auftragId"),
        start,
        ...(bis ? { ende: madridZuIso(datum, bis) } : { dauerMinuten: Math.round(dauer ?? 0) }),
        notiz: text(f, "notiz"),
        ...(f.get("abrechenbar") ? { abrechenbar: f.get("abrechenbar") === "ja" } : {}),
      },
    });
    revalidatePath(pfad(b), "layout");
  });
}

export async function zeitLoeschen(b: string, id: string, _: Zustand): Promise<Zustand> {
  return versuche(async () => {
    await api(`/betriebe/${b}/zeiten/${id}`, { method: "DELETE" });
    revalidatePath(pfad(b), "layout");
  });
}

// --- Rechnungen -------------------------------------------------------------

export async function monatsentwuerfe(b: string, _: Zustand, f: FormData): Promise<Zustand> {
  return versuche(async () => {
    const r = await api<{ erstellt: unknown[]; uebersprungen: { kundeName: string; grund: string }[] }>(`/betriebe/${b}/rechnungen/monatsentwuerfe`, {
      method: "POST",
      body: { monat: pflicht(f, "monat") },
    });
    revalidatePath(pfad(b), "layout");
    const tr = await t();
    const teile = [r.erstellt.length ? tr("rechnungen.entwuerfeErstellt", { anzahl: r.erstellt.length }) : tr("rechnungen.nichts")];
    const relevante = r.uebersprungen.filter((u) => u.grund !== "nichts_abzurechnen");
    if (relevante.length) teile.push(tr("rechnungen.uebersprungen", { liste: relevante.map((u) => `${u.kundeName} (${u.grund})`).join(", ") }));
    return { ok: teile.join(" ") };
  });
}

export async function rechnungAnlegen(b: string, _: Zustand, f: FormData): Promise<Zustand> {
  let id = "";
  const z = await versuche(async () => {
    id = (await api<{ id: string }>(`/betriebe/${b}/rechnungen`, { method: "POST", body: { kundeId: pflicht(f, "kundeId"), positionen: [] } })).id;
  });
  if (id) redirect(pfad(b, `/rechnungen/${id}`));
  return z;
}

export async function rechnungSpeichern(b: string, id: string, _: Zustand, f: FormData): Promise<Zustand> {
  return versuche(async () => {
    await api(`/betriebe/${b}/rechnungen/${id}`, {
      method: "PATCH",
      body: { leistungszeitraum: text(f, "leistungszeitraum"), bemerkung: text(f, "bemerkung"), positionen: positionen(f, false) },
    });
    revalidatePath(pfad(b, `/rechnungen/${id}`));
    return { ok: (await t())("allg.gespeichert") };
  });
}

export async function rechnungLoeschen(b: string, id: string, _: Zustand): Promise<Zustand> {
  let fertig = false;
  const z = await versuche(async () => {
    await api(`/betriebe/${b}/rechnungen/${id}`, { method: "DELETE" });
    fertig = true;
  });
  if (fertig) redirect(pfad(b, "/rechnungen"));
  return z;
}

export async function rechnungFreigeben(b: string, id: string, _: Zustand): Promise<Zustand> {
  return versuche(async () => {
    await api(`/betriebe/${b}/rechnungen/${id}/freigeben`, { method: "POST" });
    revalidatePath(pfad(b), "layout");
  });
}

export async function rechnungSenden(b: string, id: string, _: Zustand, f: FormData): Promise<Zustand> {
  return versuche(async () => {
    const r = await api<{ gesendetAn: string }>(`/betriebe/${b}/rechnungen/${id}/senden`, { method: "POST", body: text(f, "an") ? { an: text(f, "an") } : {} });
    revalidatePath(pfad(b, `/rechnungen/${id}`));
    return { ok: `✓ ${r.gesendetAn}` };
  });
}

export async function rechnungBezahlt(b: string, id: string, _: Zustand, f: FormData): Promise<Zustand> {
  return versuche(async () => {
    await api(`/betriebe/${b}/rechnungen/${id}/bezahlt`, { method: "POST", body: { bezahltAm: text(f, "bezahltAm") } });
    revalidatePath(pfad(b), "layout");
  });
}

export async function rechnungKorrektur(b: string, id: string, _: Zustand, f: FormData): Promise<Zustand> {
  let neu = "";
  const z = await versuche(async () => {
    neu = (await api<{ id: string }>(`/betriebe/${b}/rechnungen/${id}/korrektur`, { method: "POST", body: { grund: pflicht(f, "grund") } })).id;
  });
  if (neu) redirect(pfad(b, `/rechnungen/${neu}`));
  return z;
}

// --- Einstellungen ----------------------------------------------------------

export async function einstellungenSpeichern(b: string, _: Zustand, f: FormData): Promise<Zustand> {
  return versuche(async () => {
    const satz = text(f, "stundensatz");
    await api(`/betriebe/${b}/einstellungen`, {
      method: "PATCH",
      body: {
        name: pflicht(f, "name"),
        adresse: text(f, "adresse"),
        iban: text(f, "iban"),
        email: text(f, "email"),
        telefon: text(f, "telefon"),
        standardIva: parseZahl(pflicht(f, "standardIva")) ?? 21,
        irpfSatz: parseZahl(pflicht(f, "irpfSatz")) ?? 15,
        stundensatzCent: satz ? parseBetrag(satz) : null,
        zahlungszielTage: Math.round(parseZahl(pflicht(f, "zahlungszielTage")) ?? 14),
        fusstext: text(f, "fusstext"),
        farbe: text(f, "farbe"),
      },
    });
    revalidatePath(pfad(b), "layout");
    return { ok: (await t())("allg.gespeichert") };
  });
}

export async function logoHochladen(b: string, _: Zustand, f: FormData): Promise<Zustand> {
  return versuche(async () => {
    const datei = f.get("logo");
    if (!(datei instanceof File) || datei.size === 0) return { fehler: "?" };
    const res = await apiRoh(`/betriebe/${b}/logo`, { method: "PUT", body: new Uint8Array(await datei.arrayBuffer()), typ: datei.type || "image/png" });
    if (!res.ok) return { fehler: ((await res.json().catch(() => ({}))) as { fehler?: string }).fehler ?? res.statusText };
    revalidatePath(pfad(b, "/einstellungen"));
    return { ok: (await t())("allg.gespeichert") };
  });
}

export async function serieAnlegen(b: string, _: Zustand, f: FormData): Promise<Zustand> {
  return versuche(async () => {
    await api(`/betriebe/${b}/serien`, {
      method: "POST",
      body: { art: pflicht(f, "art"), praefix: pflicht(f, "praefix"), naechsteNummer: Math.round(parseZahl(pflicht(f, "naechsteNummer")) ?? 1) },
    });
    revalidatePath(pfad(b, "/einstellungen"));
  });
}
