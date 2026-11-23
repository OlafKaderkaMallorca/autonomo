-- Phase 1, Teil 3: Zwei-Faktor-Anmeldung, Ablauf bei Inaktivität, Offline-Abgleich

-- Sitzungen laufen zusätzlich nach längerer Inaktivität ab
alter table sitzung add column zuletzt_aktiv_am timestamptz not null default now();

-- TOTP (Authenticator-App). geheimnis ist Base32; aktiv erst nach Bestätigung mit einem Code.
alter table benutzer add column totp_geheimnis text;
alter table benutzer add column totp_aktiv_seit timestamptz;
-- Notfallcodes, falls das Handy weg ist (nur Hashes, einmal verwendbar)
alter table benutzer add column totp_notfallcodes bytea[] not null default '{}';
-- Zuletzt verwendetes TOTP-Zeitfenster, damit ein Code nicht zweimal gilt
alter table benutzer add column totp_letztes_fenster bigint;
