import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** TOTP nach RFC 6238 (SHA-1, 6 Stellen, 30 Sekunden) – kompatibel mit Google Authenticator, Authy, 1Password usw. */

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32(buf: Buffer): string {
  let bits = 0;
  let wert = 0;
  let aus = "";
  for (const byte of buf) {
    wert = (wert << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      aus += BASE32[(wert >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) aus += BASE32[(wert << (5 - bits)) & 31];
  return aus;
}

export function base32Lesen(text: string): Buffer {
  const sauber = text.replace(/[\s=]/g, "").toUpperCase();
  let bits = 0;
  let wert = 0;
  const aus: number[] = [];
  for (const z of sauber) {
    const i = BASE32.indexOf(z);
    if (i < 0) throw new Error("Ungültiges Base32");
    wert = (wert << 5) | i;
    bits += 5;
    if (bits >= 8) {
      aus.push((wert >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(aus);
}

export function neuesTotpGeheimnis(): string {
  return base32(randomBytes(20));
}

export function totpCode(geheimnis: string, fenster: number): string {
  const zaehler = Buffer.alloc(8);
  zaehler.writeBigUInt64BE(BigInt(fenster));
  const h = createHmac("sha1", base32Lesen(geheimnis)).update(zaehler).digest();
  const o = h[h.length - 1]! & 15;
  const zahl = (h.readUInt32BE(o) & 0x7fffffff) % 1_000_000;
  return zahl.toString().padStart(6, "0");
}

export function aktuellesFenster(jetzt = Date.now()): number {
  return Math.floor(jetzt / 30_000);
}

/**
 * Prüft einen Code mit ±1 Zeitfenster Toleranz (Uhrabweichung am Handy).
 * Gibt das passende Fenster zurück, damit der Aufrufer Wiederverwendung verhindern kann.
 */
export function pruefeTotp(geheimnis: string, code: string, jetzt = Date.now()): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const f = aktuellesFenster(jetzt);
  for (const kandidat of [f, f - 1, f + 1]) {
    const soll = Buffer.from(totpCode(geheimnis, kandidat));
    if (timingSafeEqual(soll, Buffer.from(code))) return kandidat;
  }
  return null;
}

export function otpauthUrl(geheimnis: string, konto: string, aussteller = "ApuntaPro"): string {
  const label = `${encodeURIComponent(aussteller)}:${encodeURIComponent(konto)}`;
  return `otpauth://totp/${label}?secret=${geheimnis}&issuer=${encodeURIComponent(aussteller)}&algorithm=SHA1&digits=6&period=30`;
}

/** Notfallcodes im Format abcd-efgh (ohne leicht verwechselbare Zeichen). */
export function neueNotfallcodes(anzahl = 8): string[] {
  const zeichen = "abcdefghjkmnpqrstuvwxyz23456789";
  return Array.from({ length: anzahl }, () => {
    const b = randomBytes(8);
    const s = Array.from(b, (x) => zeichen[x % zeichen.length]).join("");
    return `${s.slice(0, 4)}-${s.slice(4)}`;
  });
}

export function hashNotfallcode(code: string): Buffer {
  return createHash("sha256").update(code.trim().toLowerCase().replace(/[^a-z0-9]/g, "")).digest();
}
