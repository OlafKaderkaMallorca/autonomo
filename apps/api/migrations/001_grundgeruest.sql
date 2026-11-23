-- Phase 0: Betriebe (Mandanten), Benutzer, Mitgliedschaften, Sitzungen, Kunden.
-- Datentrennung per Row-Level-Security. Die App verbindet sich als Rolle "autonomo_app"
-- (kein Superuser, kein BYPASSRLS). Tabellen gehören dem Migrations-Benutzer.
-- Der Kontext wird pro Transaktion gesetzt: app.benutzer_id, app.betrieb_id, app.rolle, app.kunde_id.

create or replace function app_benutzer_id() returns uuid language sql stable as
$$ select nullif(current_setting('app.benutzer_id', true), '')::uuid $$;
create or replace function app_betrieb_id() returns uuid language sql stable as
$$ select nullif(current_setting('app.betrieb_id', true), '')::uuid $$;
create or replace function app_rolle() returns text language sql stable as
$$ select nullif(current_setting('app.rolle', true), '') $$;
create or replace function app_kunde_id() returns uuid language sql stable as
$$ select nullif(current_setting('app.kunde_id', true), '')::uuid $$;

-- ---------------------------------------------------------------------------
-- Globale Tabellen für Anmeldung (ohne Mandantenbezug, nur serverseitig genutzt)
-- ---------------------------------------------------------------------------
create table benutzer (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (email = lower(email)),
  name text not null,
  passwort_hash text,
  sprache text not null default 'de' check (sprache in ('de','es','en')),
  plattform_admin boolean not null default false,
  erstellt_am timestamptz not null default now()
);

create table sitzung (
  id uuid primary key default gen_random_uuid(),
  benutzer_id uuid not null references benutzer(id) on delete cascade,
  token_hash bytea not null unique,
  erstellt_am timestamptz not null default now(),
  laeuft_ab_am timestamptz not null,
  geraet text
);
create index sitzung_benutzer_idx on sitzung(benutzer_id);

create table login_token (
  id uuid primary key default gen_random_uuid(),
  benutzer_id uuid not null references benutzer(id) on delete cascade,
  token_hash bytea not null unique,
  erstellt_am timestamptz not null default now(),
  laeuft_ab_am timestamptz not null,
  eingeloest_am timestamptz
);

-- Sicherheitsdefinierte Prüfung, damit Policies nicht rekursiv RLS auslösen.
create or replace function app_ist_plattform_admin() returns boolean
language sql stable security definer set search_path = public as
$$ select coalesce((select plattform_admin from benutzer where id = app_benutzer_id()), false) $$;

-- ---------------------------------------------------------------------------
-- Mandanten
-- ---------------------------------------------------------------------------
create table betrieb (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  nif text not null unique,
  sprache text not null default 'es' check (sprache in ('de','es','en')),
  gesperrt boolean not null default false,
  erstellt_am timestamptz not null default now()
);

create table kunde (
  id uuid primary key default gen_random_uuid(),
  betrieb_id uuid not null references betrieb(id) on delete cascade,
  typ text not null check (typ in ('privat','firma')),
  name text not null,
  steuernummer text,
  email text,
  sprache text not null default 'es' check (sprache in ('de','es','en')),
  irpf boolean not null default false,
  adresse text,
  notizen text,
  erstellt_am timestamptz not null default now(),
  geaendert_am timestamptz not null default now(),
  unique (betrieb_id, id)
);
create index kunde_betrieb_idx on kunde(betrieb_id);

create table mitgliedschaft (
  id uuid primary key default gen_random_uuid(),
  betrieb_id uuid not null references betrieb(id) on delete cascade,
  benutzer_id uuid not null references benutzer(id) on delete cascade,
  rolle text not null check (rolle in ('inhaber','kunde','steuerberater')),
  kunde_id uuid,
  erstellt_am timestamptz not null default now(),
  unique (betrieb_id, benutzer_id),
  -- Kunden-Login gehört immer zu einem Kunden desselben Betriebs
  foreign key (betrieb_id, kunde_id) references kunde(betrieb_id, id) on delete cascade,
  check ((rolle = 'kunde') = (kunde_id is not null))
);
create index mitgliedschaft_benutzer_idx on mitgliedschaft(benutzer_id);

create table aktivitaet (
  id bigint generated always as identity primary key,
  betrieb_id uuid not null references betrieb(id) on delete cascade,
  benutzer_id uuid references benutzer(id) on delete set null,
  aktion text not null,
  objekt text not null,
  objekt_id uuid,
  daten jsonb,
  zeit timestamptz not null default now()
);
create index aktivitaet_betrieb_idx on aktivitaet(betrieb_id, zeit desc);

-- ---------------------------------------------------------------------------
-- Row-Level-Security
-- ---------------------------------------------------------------------------
alter table betrieb enable row level security;
alter table mitgliedschaft enable row level security;
alter table kunde enable row level security;
alter table aktivitaet enable row level security;

-- Mitgliedschaften: eigene sehen; Inhaber sieht alle seines Betriebs; Admin alles.
create policy mitgliedschaft_lesen on mitgliedschaft for select using (
  benutzer_id = app_benutzer_id()
  or (betrieb_id = app_betrieb_id() and app_rolle() = 'inhaber')
  or app_ist_plattform_admin()
);
create policy mitgliedschaft_schreiben on mitgliedschaft for all using (
  (betrieb_id = app_betrieb_id() and app_rolle() = 'inhaber') or app_ist_plattform_admin()
) with check (
  (betrieb_id = app_betrieb_id() and app_rolle() = 'inhaber') or app_ist_plattform_admin()
);

-- Betriebe: Mitglieder sehen ihre Betriebe; nur Plattform-Admin legt an/sperrt; Inhaber ändert den eigenen.
create policy betrieb_lesen on betrieb for select using (
  id in (select betrieb_id from mitgliedschaft where benutzer_id = app_benutzer_id())
  or app_ist_plattform_admin()
);
create policy betrieb_anlegen on betrieb for insert with check (app_ist_plattform_admin());
create policy betrieb_aendern on betrieb for update using (
  (id = app_betrieb_id() and app_rolle() = 'inhaber') or app_ist_plattform_admin()
);
create policy betrieb_loeschen on betrieb for delete using (app_ist_plattform_admin());

-- Kunden: nur im aktuellen Betrieb. Kunden-Login sieht nur sich selbst. Schreiben nur Inhaber.
create policy kunde_lesen on kunde for select using (
  betrieb_id = app_betrieb_id()
  and (app_rolle() in ('inhaber','steuerberater') or (app_rolle() = 'kunde' and id = app_kunde_id()))
);
create policy kunde_schreiben on kunde for all using (
  betrieb_id = app_betrieb_id() and app_rolle() = 'inhaber'
) with check (
  betrieb_id = app_betrieb_id() and app_rolle() = 'inhaber'
);

-- Aktivitätslog: alle Mitglieder dürfen schreiben (für ihren Betrieb), lesen nur Inhaber.
create policy aktivitaet_lesen on aktivitaet for select using (
  betrieb_id = app_betrieb_id() and app_rolle() = 'inhaber'
);
create policy aktivitaet_schreiben on aktivitaet for insert with check (
  betrieb_id = app_betrieb_id() and benutzer_id = app_benutzer_id()
);

-- ---------------------------------------------------------------------------
-- Rechte für die App-Rolle
-- ---------------------------------------------------------------------------
grant usage on schema public to autonomo_app;
grant select, insert, update, delete on benutzer, sitzung, login_token, betrieb, mitgliedschaft, kunde to autonomo_app;
grant select, insert on aktivitaet to autonomo_app;
