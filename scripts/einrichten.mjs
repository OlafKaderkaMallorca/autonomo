// Einmalige lokale Einrichtung: .env anlegen, gemeinsames Paket bauen, Datenbank migrieren, Demo-Daten anlegen.
// Voraussetzung: Datenbank läuft (pnpm db:start oder eigene Postgres-Installation, siehe README).
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const env = "apps/api/.env";
if (!existsSync(env)) {
  copyFileSync("apps/api/.env.example", env);
  console.log(`${env} angelegt`);
} else {
  // Ältere .env ohne Mail-Postfach: Mailpit eintragen (ab Phase 1, Teil 2)
  const inhalt = readFileSync(env, "utf8");
  if (/^SMTP_URL=\s*$/m.test(inhalt)) {
    writeFileSync(env, inhalt.replace(/^SMTP_URL=\s*$/m, "SMTP_URL=smtp://localhost:1026"));
    console.log(`${env}: Test-Postfach (Mailpit) eingetragen`);
  }
}
const run = (cmd) => execSync(cmd, { stdio: "inherit" });
run("pnpm --filter @autonomo/shared build");
run("pnpm --filter @autonomo/api migrate:dev");
run("pnpm --filter @autonomo/api demo");
