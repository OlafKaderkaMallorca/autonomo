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
  let inhalt = readFileSync(env, "utf8");
  const vorher = inhalt;
  if (/^SMTP_URL=\s*$/m.test(inhalt)) {
    inhalt = inhalt.replace(/^SMTP_URL=\s*$/m, "SMTP_URL=smtp://localhost:1026");
    console.log(`${env}: Test-Postfach (Mailpit) eingetragen`);
  }
  // Web-Portal ist von 3002 auf 3012 umgezogen (3002 nutzt ein anderes Projekt)
  if (/^WEB_URL=http:\/\/localhost:3002\s*$/m.test(inhalt)) {
    inhalt = inhalt.replace(/^WEB_URL=http:\/\/localhost:3002\s*$/m, "WEB_URL=http://localhost:3012");
    console.log(`${env}: Web-Portal auf Port 3012 umgestellt`);
  }
  if (inhalt !== vorher) writeFileSync(env, inhalt);
}
const run = (cmd) => execSync(cmd, { stdio: "inherit" });
run("pnpm --filter @autonomo/shared build");
run("pnpm --filter @autonomo/api migrate:dev");
run("pnpm --filter @autonomo/api demo");
