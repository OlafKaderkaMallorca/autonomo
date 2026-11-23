import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from "node:crypto";

const scrypt = (pw: string, salt: Buffer, len: number, opts: ScryptOptions) =>
  new Promise<Buffer>((resolve, reject) =>
    scryptCb(pw, salt, len, opts, (err, key) => (err ? reject(err) : resolve(key))),
  );

const N = 2 ** 15;
const R = 8;
const P = 1;
const LAENGE = 64;
const MAXMEM = 128 * N * R * 2;

/** Format: scrypt$N$r$p$saltBase64$hashBase64 */
export async function hashePasswort(passwort: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(passwort, salt, LAENGE, { N, r: R, p: P, maxmem: MAXMEM });
  return ["scrypt", N, R, P, salt.toString("base64"), hash.toString("base64")].join("$");
}

export async function pruefePasswort(passwort: string, gespeichert: string): Promise<boolean> {
  const [algo, n, r, p, saltB64, hashB64] = gespeichert.split("$");
  if (algo !== "scrypt" || !n || !r || !p || !saltB64 || !hashB64) return false;
  const erwartet = Buffer.from(hashB64, "base64");
  const hash = await scrypt(passwort, Buffer.from(saltB64, "base64"), erwartet.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: 128 * Number(n) * Number(r) * 2,
  });
  return hash.length === erwartet.length && timingSafeEqual(hash, erwartet);
}

/** Hash zum Vergleichen, wenn es den Benutzer nicht gibt (gleiche Laufzeit, kein Hinweis auf existierende Konten). */
export const DUMMY_HASH_PROMISE = hashePasswort(randomBytes(16).toString("hex"));
