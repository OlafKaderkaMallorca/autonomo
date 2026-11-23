# Autónomo-App – Projektplan

Stand: 23.11.2026 · Status: **Entwurf, wartet auf Freigabe durch Olaf**

## 1. Ziel

Eine eigene App für Olaf (Autónomo, steuerlich gemeldet auf Mallorca) für den kompletten Ablauf vom Angebot bis zur Rechnung, mit Kundenportal und später einem Zugang für die Steuerberaterin.

**Ausgangslage**
- Olaf arbeitet allein und hat 5–6 Kunden pro Monat, meist Stammkunden. Er hat Privat- und Firmenkunden.
- Abgerechnet wird gemischt:
  - **Pauschalen**, z. B. Garten 2× pro Woche à 3 h = 700 €/Monat
  - **nach Stunden** für einzelne Aufgaben und Zwischenfälle
- Bisher rechnet Olaf mit Zoho Books bzw. Odoo ab. Er weist derzeit keinen IRPF-Einbehalt aus.
- Gewünscht sind iPhone und Android, nach Möglichkeit offline nutzbar.
- Alles soll auf Deutsch, Spanisch und Englisch laufen.
- Betrieb auf einem eigenen Server bei Hetzner mit Docker.

**Prioritäten (laut Olaf)**
1. Stunden, Projekte, Aufgaben, Angebote, Rechnungen
2. Kundenportal (Angebote unterschreiben, Aufgaben melden, Rechnungen sehen)
3. Belege scannen
4. Zugang für die Steuerberaterin, ganz zum Schluss

## 2. Grundablauf

```
Angebot ──(Kunde unterschreibt im Portal)──► Auftrag ──► Aufgaben / Stunden / Fotos ──► Monatsrechnung
```

- **Angebot:** Olaf erstellt es in der App, der Kunde bekommt einen Link bzw. sieht es im Portal. Er nimmt es per Unterschrift an (Finger oder Maus). Gespeichert werden Name, Zeitpunkt, IP-Adresse und ein Hash des Angebots-PDFs, damit nachweisbar bleibt, welche Version angenommen wurde.
- **Auftrag:** entsteht automatisch aus dem angenommenen Angebot. Ein Auftrag hat eine oder mehrere Positionen:
  - *Pauschale* (fester Betrag pro Monat, optional mit vereinbartem Stundenkontingent als Info)
  - *nach Aufwand* (Stundensatz × erfasste Stunden, plus Material)
- **Aufgaben:** gehören zu einem Auftrag. Sie können von Olaf oder vom Kunden im Portal angelegt werden, z. B. „Bewässerung defekt“. Zu jeder Aufgabe gibt es Fotos, Notizen und einen Status (offen, in Arbeit, erledigt).
- **Stunden:** per Start/Stopp-Timer oder nachträglich eingetragen, immer zu einem Auftrag und optional zu einer Aufgabe. Bei Pauschalen dienen sie als Nachweis und zeigen Olaf, ob sich die Pauschale lohnt.
- **Monatsrechnung:** Am Monatsende schlägt die App pro Kunde einen Rechnungsentwurf vor. Er enthält die Pauschalen sowie die abrechenbaren Stunden und das Material des Monats. Olaf prüft den Entwurf und gibt ihn frei. Erst bei der Freigabe bekommt die Rechnung ihre endgültige Nummer und wird an VeriFactu gemeldet.

## 3. Technik

### Empfehlung

| Baustein | Wahl | Warum |
|---|---|---|
| App für Olaf (iOS + Android) | **React Native mit Expo** (TypeScript) | Eine Codebasis für beide Plattformen, Kamera, Unterschrift und Offline-Datenbank (SQLite) sind gut unterstützt. Builds und Updates laufen über Expo EAS, ohne eigenen Mac. |
| Kunden- und Steuerberater-Portal | **Web-App (Next.js)**, als PWA installierbar | Kunden und Steuerberaterin müssen nichts installieren, ein Link reicht. Teilt Code (Typen, Logik, Übersetzungen) mit der App. |
| Backend / API | **Node.js + TypeScript (NestJS oder Fastify)** | Volle Kontrolle über Rechnungsnummern, VeriFactu-Kette und Rechte. Dieselbe Sprache wie Frontend. |
| Datenbank | **PostgreSQL** | Robust, Transaktionen für lückenlose Rechnungsnummern. |
| Dateien (Fotos, Belege, PDFs) | **MinIO** (S3-kompatibel) im selben Docker-Setup | Bleibt auf dem eigenen Server, später leicht zu Hetzner Object Storage umziehbar. |
| PDF-Erzeugung | HTML-Vorlagen → PDF (Playwright/Chromium) | Rechnungs- und Angebotslayout in drei Sprachen einfach anpassbar. |
| Reverse Proxy / HTTPS | **Caddy** | Automatische Let's-Encrypt-Zertifikate. |
| E-Mail-Versand | SMTP-Dienst (z. B. Brevo oder Postmark) | Damit Mails nicht im Spam landen. |
| Übersetzungen | i18next (DE / ES / EN) | Eine Übersetzungsdatei für App und Portal. |

Auf dem Hetzner-Server läuft alles per `docker compose`: `api`, `web`, `postgres`, `minio`, `caddy` und ein Backup-Job.

### Offline

- **Offline in der App:** Stunden erfassen (Timer läuft weiter), Aufgaben ansehen, anlegen und abhaken, Fotos aufnehmen, Notizen schreiben. Alles wird lokal in SQLite gespeichert und automatisch synchronisiert, sobald wieder Netz da ist. Fotos werden im Hintergrund hochgeladen.
- **Nur online:** Rechnungen und Angebote endgültig freigeben. Fortlaufende Nummern und die VeriFactu-Meldung müssen zentral auf dem Server entstehen. Entwürfe gehen auch offline.

### Rollen und Login

| Rolle | Darf |
|---|---|
| **Olaf (Admin)** | alles |
| **Kunde** | nur eigene Daten: Angebote ansehen und unterschreiben, Aufträge, Aufgaben (ansehen, neu melden, kommentieren), Fotos, Stunden, Rechnungen als PDF |
| **Steuerberaterin** | nur lesen: Rechnungen, Gutschriften, Belege, Exporte; Belege kommentieren und markieren |

- **Login:** Kunden und Steuerberaterin melden sich per **Magic Link** an, also mit einem Anmeldelink per E-Mail. Optional gibt es auch ein Passwort.
- **Olaf:** Passwort plus Face ID / Fingerabdruck in der App.
- Olaf lädt Kunden per Einladungslink ins Portal ein.

## 4. Datenmodell (vereinfacht)

```
Unternehmen     Olafs Stammdaten: Name, NIF, Adresse, IBAN, Logo, Standard-IVA, Rechnungsserien
Kunde           Typ (privat/firma), Name, NIF/NIE/CIF, Adresse, Sprache, E-Mail, IRPF ja/nein, Notizen
Kontakt         Personen beim Kunden (für Portal-Login)
Benutzer        Login, Rolle (admin/kunde/steuerberater), Verknüpfung zu Kunde
Angebot         Nummer, Kunde, Positionen, Gültig bis, Status (Entwurf/gesendet/angenommen/abgelehnt),
                PDF, Unterschrift (Bild, Name, Zeit, IP, PDF-Hash)
Auftrag         Kunde, aus Angebot, Titel, Status, Zeitraum
Auftragsposition  Art (pauschal/stunden/material), Betrag oder Stundensatz, Intervall (monatlich), IVA-Satz
Aufgabe         Auftrag, Titel, Beschreibung, Status, erstellt von (Olaf/Kunde), Fälligkeit, Sichtbar für Kunde
Foto            Aufgabe, Datei, Aufnahmezeit, GPS (optional), Bildunterschrift, Sichtbar für Kunde
Zeiteintrag     Auftrag, Aufgabe (optional), Start, Ende/Dauer, Notiz, abrechenbar, abgerechnet in Rechnung
Rechnung        Serie + Nummer, Typ (vollständig/vereinfacht/Korrektur), Kunde (Snapshot der Daten),
                Datum, Leistungszeitraum, Positionen, Basis, IVA, IRPF, Summe, Status (Entwurf/
                ausgestellt/bezahlt), PDF, VeriFactu-Datensatz (Hash, Vorgänger-Hash, QR, Status AEAT)
Rechnungsposition  Beschreibung, Menge, Preis, IVA-Satz, Verweis auf Zeiteinträge/Pauschale
Beleg           Datei, Lieferant, NIF Lieferant, Datum, Basis, IVA, Summe, Kategorie, Zahlungsart,
                Status (neu/geprüft), Kommentare Steuerberaterin
Aktivitätslog   wer hat wann was geändert (Nachvollziehbarkeit)
```

Rechnungen speichern die Kundendaten zum Zeitpunkt der Ausstellung. Ändert sich später die Adresse eines Kunden, bleibt die alte Rechnung trotzdem unverändert.

## 5. Spanische Pflichten (wichtig für die Rechnungen)

### Rechnungsinhalt (Reglamento de facturación, RD 1619/2012)
- Fortlaufende Nummer je Serie, **lückenlos**. Gelöscht wird nie, korrigiert wird nur per *factura rectificativa* (eigene Serie, z. B. `R-2027-001`).
- Ausstellungsdatum und, falls abweichend, das Leistungsdatum bzw. der Leistungszeitraum (z. B. „November 2026“).
- Name/Firma, NIF und Adresse von Olaf und vom Kunden.
- Leistungsbeschreibung, Bemessungsgrundlage, IVA-Satz (in der Regel 21 %), IVA-Betrag und Gesamtbetrag.
- **IRPF-Einbehalt** als Schalter pro Kunde, standardmäßig aus. Er greift nur bei Firmenkunden und nur, wenn Olafs Tätigkeit als professionelle Tätigkeit gilt. *Das sollte die Steuerberaterin einmal bestätigen.*
- **Vereinfachte Rechnung** (*factura simplificada*) ohne Kunden-NIF ist nur bis 400 € (inkl. IVA) erlaubt. Für Privatkunden mit Pauschalen wie 700 €/Monat braucht es eine **vollständige Rechnung mit NIF/NIE** des Kunden. Die App prüft das automatisch.

### VeriFactu (Ley Antifraude, RD 1007/2023, Orden HAC/1177/2024)
- **Pflicht für Autónomos ab 1. Juli 2027.** Für Unternehmen, die Körperschaftsteuer zahlen, gilt sie ab 1. Januar 2027. Die Termine wurden durch das RDL 15/2025 um ein Jahr verschoben.
- Jede ausgestellte Rechnung erzeugt einen Datensatz (*registro de facturación*). Er ist per Hash mit dem vorherigen verkettet und wird sofort an die AEAT gemeldet.
- Auf jeder Rechnung stehen ein **QR-Code** und der Hinweis „VERI*FACTU“.
- Software, die Rechnungen ausstellt, braucht eine *declaración responsable* des Herstellers, auch bei Eigenentwicklung.

**Empfehlung:** Die eigentliche VeriFactu-Kommunikation läuft über einen **zertifizierten VeriFactu-API-Dienst**. Wir bauen sie nicht selbst. Unsere App schickt die Rechnungsdaten dorthin, der Dienst kümmert sich um Hash-Kette, XML-Format, Zertifikat, AEAT-Meldung und QR-Code. Das senkt das rechtliche Risiko deutlich und kostet nur wenige Euro im Monat. Die App wird trotzdem von Anfang an so gebaut, dass lückenlose Nummern und unveränderbare Rechnungen garantiert sind. Bis Juli 2027 kann man VeriFactu freiwillig testen.

### Belege und Aufbewahrung
- Eingangsrechnungen und Belege müssen lesbar und vollständig sein: Lieferant, NIF, Datum, Basis, IVA. Ein normaler Kassenbon (*ticket*) reicht für den IVA-Abzug nicht, dafür braucht es eine *factura* bzw. *factura simplificada* mit NIF.
- **Aufbewahrung:** mindestens 4 Jahre steuerlich (Ley General Tributaria) und 6 Jahre handelsrechtlich (Código de Comercio). Die App löscht Rechnungen und Belege nie automatisch.
- **Steuererklärungen:** Die Exporte für die Steuerberaterin sind auf Modelo 303 (IVA, quartalsweise), Modelo 130 (IRPF-Vorauszahlung), Modelo 390 (IVA-Jahreserklärung) und Modelo 347 (Geschäftspartner über 3.005,06 €) ausgerichtet.

## 6. Datenschutz (DSGVO / LOPDGDD)

- Server bei Hetzner in Deutschland oder Finnland, also in der EU. Mit Hetzner wird ein **Auftragsverarbeitungsvertrag** abgeschlossen, das geht online. Ebenso mit dem E-Mail-Dienst und dem VeriFactu-Dienst.
- **Datenschutzerklärung und Impressum** (*aviso legal*) im Portal, auf Spanisch, Deutsch und Englisch.
- **Fotos:** Wenn darauf Personen oder Kennzeichen zu sehen sein können, gibt es den Hinweis „vor dem Upload prüfen“. Pro Foto lässt sich einstellen, ob der Kunde es sieht.
- GPS in Fotos ist optional und standardmäßig aus.
- **Verschlüsselung:** HTTPS überall, verschlüsselte Backups, starke Passwörter und Zwei-Faktor-Anmeldung für Olaf.
- **Backups:** täglich (Datenbank und Dateien) auf eine Hetzner Storage Box, verschlüsselt, mit mehreren Tagen bzw. Wochen Historie. Die Wiederherstellung wird einmal getestet.
- **Löschung:** Kundendaten können auf Wunsch anonymisiert werden. Rechnungen bleiben wegen der Aufbewahrungspflicht erhalten.

## 7. Kosten im Betrieb (ca.)

| Posten | Kosten |
|---|---|
| Hetzner Cloud Server (z. B. CX22/CPX21, 2–3 vCPU, 4 GB RAM) | ca. 5–9 €/Monat |
| Hetzner Storage Box für Backups (1 TB) | ca. 4 €/Monat |
| Domain (z. B. `.es` oder `.com`) | ca. 1 €/Monat |
| E-Mail-Versand (geringe Menge) | 0 € (Gratis-Kontingent) |
| VeriFactu-API-Dienst | ca. 5–20 €/Monat (Anbieter vergleichen) |
| Apple Developer Account | 99 $/Jahr |
| Google Play Developer Account | 25 $ einmalig |
| Expo EAS (App-Builds) | 0 € im Gratis-Tarif, reicht für den Anfang |
| **Summe** | **ca. 20–40 €/Monat** plus ca. 100 €/Jahr |

Da nur Olaf die App benutzt, muss sie nicht öffentlich im App Store stehen. Auf dem iPhone reicht eine private Verteilung über TestFlight bzw. Ad-hoc, auf Android eine APK oder ein interner Test-Track. Kunden und Steuerberaterin nutzen das Web-Portal.

## 8. Phasen

### Phase 0 – Grundgerüst (ca. 1 Woche)
- Monorepo: `apps/mobile` (Expo), `apps/web` (Next.js), `apps/api`, `packages/shared` (Typen, Übersetzungen)
- Docker-Compose-Setup, Hetzner-Server, Domain, HTTPS, Backups
- Login und Rollen, Übersetzungen DE/ES/EN

### Phase 1 – Kern für Olaf (MVP, ca. 4–6 Wochen)
- Kunden (privat/firma, Sprache, IRPF-Schalter)
- Angebote mit Positionen, PDF in Kundensprache, Versand per Link
- Aufträge mit Pauschale und/oder Stundensatz
- Aufgaben mit Fotos und Notizen
- Zeiterfassung (Timer und manuell), offline-fähig
- Monatsrechnungen: Entwurf automatisch, Freigabe, PDF, Versand per E-Mail, Status „bezahlt“
- Korrekturrechnungen, lückenlose Nummernkreise, Rechnungen nach der Freigabe unveränderbar
- Einfache Übersicht: offene Rechnungen, Stunden pro Kunde und Monat, „lohnt sich die Pauschale?“

### Phase 2 – Kundenportal (ca. 2–3 Wochen)
- Einladung und Magic-Link-Login
- Angebote ansehen und mit Unterschrift annehmen, daraus wird automatisch ein Auftrag
- Aufgaben melden (mit eigenen Fotos), Status und Fotos sehen, kommentieren
- Stundennachweise und Rechnungen ansehen und herunterladen
- Benachrichtigung an Olaf bei neuer Aufgabe oder angenommenem Angebot (Push und E-Mail)

### Phase 3 – VeriFactu (vor Juli 2027, ca. 1–2 Wochen)
- Anbindung des VeriFactu-API-Dienstes, QR-Code auf der Rechnung, Statusanzeige
- Testbetrieb im freiwilligen Zeitraum

### Phase 4 – Belege (ca. 2 Wochen)
- Beleg mit der Kamera scannen (Kanten erkennen, Perspektive korrigieren) oder PDF/Bild hochladen
- Texterkennung (OCR) schlägt Lieferant, Datum, NIF, Basis, IVA und Summe vor. Olaf bestätigt die Werte.
- Kategorien wie Material, Werkzeug, Fahrzeug/Diesel und Telefon

### Phase 5 – Steuerberaterin (ca. 1–2 Wochen)
- Eigener Zugang, der nur lesen darf, mit Filter nach Monat und Quartal
- Export als ZIP (PDFs) plus Excel/CSV, passend für Modelo 303/130/390/347. Format möglichst passend zu ihrem Programm (A3, Sage, …).
- Belege kommentieren bzw. markieren („unleserlich“, „fehlt NIF“)
- Optional: ZIP auf Knopfdruck per E-Mail

### Später / optional
- Import von Kunden und Rechnungshistorie aus Zoho Books bzw. Odoo (CSV-Export). Neue Rechnungen laufen in einer eigenen neuen Serie weiter.
- Zahlungserinnerungen, Abgleich mit Kontoauszug, Bizum/SEPA-Infos auf der Rechnung
- Kilometer bzw. Fahrten erfassen
- Mitarbeiter (falls Olaf irgendwann nicht mehr allein arbeitet)

Die Zeitangaben sind grobe Schätzungen für die Entwicklung mit Claude, ohne Testphasen mit echten Kunden.

## 9. Offene Punkte für Olaf

1. **Steuerberaterin fragen:** Braucht Olaf IRPF auf Firmenrechnungen? Und mit welchem Programm arbeitet sie (für das Exportformat)?
2. **Domain:** Gibt es schon eine, oder soll eine neue her (z. B. für `portal.<deine-domain>`)?
3. **Rechnungsserie:** Neue Serie starten, z. B. `2027-0001`, oder an Zoho/Odoo anschließen?
4. **Technik-Empfehlung freigeben:** React Native/Expo plus Next.js plus Node/Postgres auf Hetzner. Die Alternative wäre Flutter, die Empfehlung bleibt aber TypeScript, weil App, Portal und Server dann dieselbe Sprache sprechen.
5. **VeriFactu über einen externen API-Dienst** statt Eigenbau: einverstanden?

Nach der Freigabe startet Phase 0.
