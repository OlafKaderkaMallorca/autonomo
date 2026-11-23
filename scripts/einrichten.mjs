// Einmalige lokale Einrichtung: .env anlegen, gemeinsames Paket bauen, Datenbank migrieren, Demo-Daten anlegen.
// Voraussetzung: Datenbank läuft (pnpm db:start oder eigene Postgres-Installation, siehe README).
import { copyFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";

const env = "apps/api/.env";
if (!existsSync(env)) {
  copyFileSync("apps/api/.env.example", env);
  console.log(`${env} angelegt`);
}
const run = (cmd) => execSync(cmd, { stdio: "inherit" });
run("pnpm --filter @autonomo/shared build");
run("pnpm --filter @autonomo/api migrate:dev");
run("pnpm --filter @autonomo/api demo");
