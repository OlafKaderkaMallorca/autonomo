# ApuntaPro

App für selbstständige Handwerker in Spanien (Autónomos): Kunden, Aufträge, Aufgaben mit Fotos, Stunden, Angebote mit Unterschrift, Rechnungen (VeriFactu) und ein Portal für Kunden und Steuerberatung. Der Plan steht in [docs/PLAN.md](docs/PLAN.md).

## Aufbau

| Ordner | Inhalt |
|---|---|
| `apps/api` | Server (Node.js, Fastify, PostgreSQL). Jeder Betrieb ist ein eigener Mandant, die Datenbank trennt die Daten per Row-Level-Security. |
| `apps/web` | Web-Portal (Next.js) für Kunden, Steuerberatung und Inhaber |
| `apps/mobile` | Handy-App (Expo / React Native) für iPhone und Android |
| `packages/shared` | Gemeinsamer Code: Rollen, Eingabeprüfung, NIF/NIE/CIF-Prüfung, Übersetzungen DE/ES/EN |
| `dev` | Lokale Datenbank für die Entwicklung |

## Lokal starten

### Unter Windows per Doppelklick

| Datei | Wofür |
|---|---|
| `einrichten.cmd` | Einmalig: Pakete installieren, Datenbank starten, Demo-Daten anlegen |
| `start.cmd` | Datenbank, API und Web-Portal starten, Browser öffnet sich auf http://localhost:3002 |
| `stop.cmd` | Datenbank stoppen (Daten bleiben erhalten) |
| `handy.cmd` | Handy-App über Expo Go starten (start.cmd muss laufen) |
| `tests.cmd` | Typprüfung und Tests |

Voraussetzungen: Node.js 24 und Docker Desktop. Die Skripte starten Docker Desktop bei Bedarf selbst.

### Von Hand

Ports: **Web-Portal 3002**, **API 4002**, **Datenbank 5434**. So kommt nichts mit anderen Projekten in die Quere.

### Einmalig

1. **Node.js 24** installieren (https://nodejs.org) und danach in einem Terminal `corepack enable` ausführen. Damit ist `pnpm` verfügbar.
2. **Datenbank**, eine der beiden Varianten:
   - **Mit Docker Desktop** (einfachste Variante): `pnpm db:start`
   - **Ohne Docker**: PostgreSQL 16 installieren und als Superuser ausführen:
     ```sql
     create role autonomo_owner login password 'owner' superuser;
     create role autonomo_app login password 'app' nosuperuser nobypassrls;
     create database autonomo owner autonomo_owner;
     ```
     Danach in `apps/api/.env` den Port `5434` durch den Port deiner Installation ersetzen (meist `5432`).
3. Im Projektordner:
   ```sh
   pnpm install
   pnpm run einrichten
   ```
   Das legt `apps/api/.env` an, richtet die Datenbank ein und erstellt Demo-Daten.

### Jeden Tag

```sh
pnpm db:start      # nur bei der Docker-Variante
pnpm dev           # startet API und Web-Portal
```

Dann http://localhost:3002 öffnen und mit **olaf@demo.local** / **demo-passwort** anmelden.

Nach einem Update mit neuen Demo-Daten (z. B. Phase 1: Aufträge, Stunden des Vormonats) einfach `einrichten.cmd` bzw. `pnpm run einrichten` noch einmal ausführen. Vorhandene Daten bleiben erhalten.

Anmeldelinks per E-Mail werden lokal nicht verschickt. Sie erscheinen im Terminal, in dem `pnpm dev` läuft.

### Handy-App

1. Auf dem Handy die App **Expo Go** installieren (App Store bzw. Play Store).
2. Die IP-Adresse deines PCs im WLAN herausfinden (Windows: `ipconfig`, z. B. `192.168.1.20`).
3. Im Projektordner starten (PowerShell):
   ```powershell
   $env:EXPO_PUBLIC_API_URL="http://192.168.1.20:4002"; pnpm dev:mobile
   ```
4. Den QR-Code mit dem Handy scannen. Handy und PC müssen im selben WLAN sein. Falls die Windows-Firewall fragt, den Zugriff auf Port 4002 im privaten Netzwerk erlauben.

### Prüfen

```sh
pnpm typecheck
pnpm test          # API-Tests brauchen die laufende Datenbank
```

Die API-Tests legen sich auf der Datenbank (Port 5434) eine eigene, temporäre Datenbank an und löschen sie danach wieder. Läuft deine Datenbank auf einem anderen Port, setzt du vorher `TEST_OWNER_URL=postgres://autonomo_owner:owner@localhost:5434/postgres` und `TEST_APP_URL_BASIS=postgres://autonomo_app:app@localhost:5434`.
