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
| `aktualisieren.cmd` | Neuen Stand von GitHub holen und danach alles einrichten (Pakete, Datenbank) |
| `einrichten.cmd` | Einmalig: Pakete installieren, Datenbank starten, Demo-Daten anlegen |
| `start.cmd` | Datenbank, API und Web-Portal starten, Browser öffnet sich auf http://localhost:3012 |
| `stop.cmd` | API, Web-Portal und Datenbank stoppen (Daten bleiben erhalten) |
| `handy.cmd` | Handy-App über Expo Go starten (start.cmd muss laufen) |
| `tests.cmd` | Typprüfung und Tests |

Voraussetzungen: Node.js 24 und Docker Desktop. Die Skripte starten Docker Desktop bei Bedarf selbst.

### Von Hand

Ports: **Web-Portal 3012**, **API 4002**, **Datenbank 5434**. So kommt nichts mit anderen Projekten in die Quere.

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

Dann http://localhost:3012 öffnen und mit **olaf@demo.local** / **demo-passwort** anmelden.

Nach einem neuen Pull Request einfach `aktualisieren.cmd` doppelklicken: holt den neuen Stand und führt danach `einrichten.cmd` aus. Vorhandene Daten bleiben erhalten.

E-Mails (Anmeldelinks, Angebote, Rechnungen) werden lokal nicht wirklich verschickt. Sie landen im Test-Postfach **Mailpit**: http://localhost:8026 (startet zusammen mit der Datenbank). Ohne Docker bleibt `SMTP_URL` in `apps/api/.env` leer, dann erscheinen die Mails im Terminal, in dem `pnpm dev` läuft.

PDFs für Angebote und Rechnungen erzeugt die API mit dem vorhandenen Browser: unter Windows automatisch mit Microsoft Edge. Wird keiner gefunden, in `apps/api/.env` bei `PDF_BROWSER` den Pfad zu Chrome oder Edge eintragen. Fotos, PDFs und Logos liegen lokal im Ordner `apps/api/daten/`.

### Handy-App

1. Auf dem Handy die App **Expo Go** installieren (App Store bzw. Play Store).
2. Die IP-Adresse deines PCs im WLAN herausfinden (Windows: `ipconfig`, z. B. `192.168.1.20`).
3. Im Projektordner starten (PowerShell):
   ```powershell
   $env:EXPO_PUBLIC_API_URL="http://192.168.1.20:4002"; pnpm dev:mobile
   ```
4. Den QR-Code mit dem Handy scannen. Handy und PC müssen im selben WLAN sein. Falls die Windows-Firewall fragt, den Zugriff auf Port 4002 im privaten Netzwerk erlauben.

Die App hat drei Reiter: **Heute** (Timer, Zeit nachtragen, letzte Einträge), **Aufgaben** (abhaken, Notizen, Fotos aufnehmen) und **Mehr** (Sprache, Face ID / Fingerabdruck, Übertragungsstatus, Abmelden). Alles davon geht auch ohne Netz: Änderungen werden auf dem Handy gespeichert und automatisch übertragen, sobald wieder Verbindung besteht. Oben steht dann, wie viele Änderungen noch fehlen. Zum Ausprobieren einfach WLAN und mobile Daten ausschalten.

In Expo Go fragt iOS statt Face ID nach dem Gerätecode; echtes Face ID gibt es erst in der fertig gebauten App.

### Prüfen

```sh
pnpm typecheck
pnpm test          # API-Tests brauchen die laufende Datenbank
```

Die API-Tests legen sich auf der Datenbank (Port 5434) eine eigene, temporäre Datenbank an und löschen sie danach wieder. Läuft deine Datenbank auf einem anderen Port, setzt du vorher `TEST_OWNER_URL=postgres://autonomo_owner:owner@localhost:5434/postgres` und `TEST_APP_URL_BASIS=postgres://autonomo_app:app@localhost:5434`.
