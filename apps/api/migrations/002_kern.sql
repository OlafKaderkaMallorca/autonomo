-- Phase 1: Betriebs-Einstellungen, Kunden-Erweiterung, Angebote, Aufträge, Aufgaben,
-- Zeiterfassung, Material, Rechnungen. Beträge in Cent (bigint), IVA-Sätze in Prozent.

create or replace function app_ist_inhaber() returns boolean language sql stable as
$$ select app_rolle() = 'inhaber' $$;

-- ---------------------------------------------------------------------------
-- Betrieb: Stammdaten für Rechnungen
-- ---------------------------------------------------------------------------
alter table betrieb
  add column adresse text,
  add column iban text,
  add column email text,
  add column telefon text,
  add column standard_iva numeric(5,2) not null default 21 check (standard_iva >= 0 and standard_iva <= 100),
  add column irpf_satz numeric(5,2) not null default 15 check (irpf_satz >= 0 and irpf_satz <= 100),
  add column stundensatz_cent bigint check (stundensatz_cent >= 0),
  add column zahlungsziel_tage int not null default 14 check (zahlungsziel_tage between 0 and 365),
  add column fusstext text,
  add column farbe text check (farbe ~ '^#[0-9A-Fa-f]{6}$');

create table rechnungsserie (
  id uuid primary key default gen_random_uuid(),
  betrieb_id uuid not null references betrieb(id) on delete cascade,
  art text not null check (art in ('rechnung','korrektur','angebot')),
  praefix text not null check (length(praefix) between 1 and 20),
  naechste_nummer int not null default 1 check (naechste_nummer >= 1),
  stellen int not null default 4 check (stellen between 1 and 8),
  aktiv boolean not null default true,
  erstellt_am timestamptz not null default now(),
  unique (betrieb_id, praefix),
  unique (betrieb_id, id)
);
-- Pro Art höchstens eine aktive Serie
create unique index rechnungsserie_aktiv_idx on rechnungsserie(betrieb_id, art) where aktiv;

-- ---------------------------------------------------------------------------
-- Kunden: Telefon, Archiv, Kontaktpersonen
-- ---------------------------------------------------------------------------
alter table kunde
  add column telefon text,
  add column archiviert boolean not null default false,
  add constraint kunde_irpf_nur_firma check (not irpf or typ = 'firma');

create table kontakt (
  id uuid primary key default gen_random_uuid(),
  betrieb_id uuid not null references betrieb(id) on delete cascade,
  kunde_id uuid not null,
  name text not null,
  email text,
  telefon text,
  funktion text,
  erstellt_am timestamptz not null default now(),
  foreign key (betrieb_id, kunde_id) references kunde(betrieb_id, id) on delete cascade
);
create index kontakt_kunde_idx on kontakt(kunde_id);

-- ---------------------------------------------------------------------------
-- Angebote
-- ---------------------------------------------------------------------------
create table angebot (
  id uuid primary key default gen_random_uuid(),
  betrieb_id uuid not null references betrieb(id) on delete cascade,
  kunde_id uuid not null,
  nummer text not null,
  titel text not null,
  einleitung text,
  gueltig_bis date not null,
  status text not null default 'entwurf' check (status in ('entwurf','gesendet','angenommen','abgelehnt')),
  link_token_hash bytea unique,
  gesendet_am timestamptz,
  geoeffnet_am timestamptz,
  entschieden_am timestamptz,
  ablehnungsgrund text,
  unterschrift_name text,
  unterschrift_bild text,
  unterschrift_ip text,
  pdf_hash text,
  erstellt_am timestamptz not null default now(),
  geaendert_am timestamptz not null default now(),
  unique (betrieb_id, nummer),
  unique (betrieb_id, id),
  foreign key (betrieb_id, kunde_id) references kunde(betrieb_id, id)
);
create index angebot_kunde_idx on angebot(kunde_id);

create table angebot_position (
  id uuid primary key default gen_random_uuid(),
  betrieb_id uuid not null references betrieb(id) on delete cascade,
  angebot_id uuid not null,
  pos int not null,
  art text not null check (art in ('pauschale','stunden','material')),
  beschreibung text not null,
  menge numeric(12,2) not null default 1 check (menge >= 0),
  einheit text,
  preis_cent bigint not null check (preis_cent >= 0),
  iva_satz numeric(5,2) not null check (iva_satz >= 0 and iva_satz <= 100),
  stundenkontingent numeric(8,2),
  foreign key (betrieb_id, angebot_id) references angebot(betrieb_id, id) on delete cascade
);
create index angebot_position_angebot_idx on angebot_position(angebot_id, pos);

-- ---------------------------------------------------------------------------
-- Aufträge
-- ---------------------------------------------------------------------------
create table auftrag (
  id uuid primary key default gen_random_uuid(),
  betrieb_id uuid not null references betrieb(id) on delete cascade,
  kunde_id uuid not null,
  angebot_id uuid,
  titel text not null,
  status text not null default 'aktiv' check (status in ('aktiv','pausiert','beendet')),
  beginn date not null default current_date,
  ende date,
  erstellt_am timestamptz not null default now(),
  geaendert_am timestamptz not null default now(),
  unique (betrieb_id, id),
  foreign key (betrieb_id, kunde_id) references kunde(betrieb_id, id),
  foreign key (betrieb_id, angebot_id) references angebot(betrieb_id, id),
  check (ende is null or ende >= beginn)
);
create index auftrag_kunde_idx on auftrag(kunde_id);
create unique index auftrag_angebot_idx on auftrag(angebot_id) where angebot_id is not null;

create table auftrag_position (
  id uuid primary key default gen_random_uuid(),
  betrieb_id uuid not null references betrieb(id) on delete cascade,
  auftrag_id uuid not null,
  pos int not null,
  art text not null check (art in ('pauschale','stunden','material')),
  beschreibung text not null,
  menge numeric(12,2) not null default 1 check (menge >= 0),
  einheit text,
  preis_cent bigint not null check (preis_cent >= 0),
  iva_satz numeric(5,2) not null check (iva_satz >= 0 and iva_satz <= 100),
  stundenkontingent numeric(8,2),
  aktiv boolean not null default true,
  unique (betrieb_id, id),
  foreign key (betrieb_id, auftrag_id) references auftrag(betrieb_id, id) on delete cascade
);
create index auftrag_position_auftrag_idx on auftrag_position(auftrag_id, pos);

-- ---------------------------------------------------------------------------
-- Aufgaben und Notizen
-- ---------------------------------------------------------------------------
create table aufgabe (
  id uuid primary key default gen_random_uuid(),
  betrieb_id uuid not null references betrieb(id) on delete cascade,
  auftrag_id uuid not null,
  titel text not null,
  beschreibung text,
  status text not null default 'offen' check (status in ('offen','in_arbeit','erledigt')),
  faellig_am date,
  sichtbar_fuer_kunde boolean not null default true,
  erstellt_von uuid references benutzer(id) on delete set null,
  erstellt_von_rolle text not null check (erstellt_von_rolle in ('inhaber','kunde')),
  erledigt_am timestamptz,
  erstellt_am timestamptz not null default now(),
  geaendert_am timestamptz not null default now(),
  unique (betrieb_id, id),
  foreign key (betrieb_id, auftrag_id) references auftrag(betrieb_id, id) on delete cascade
);
create index aufgabe_auftrag_idx on aufgabe(auftrag_id);
create index aufgabe_offen_idx on aufgabe(betrieb_id) where status <> 'erledigt';

create table aufgabe_notiz (
  id uuid primary key default gen_random_uuid(),
  betrieb_id uuid not null references betrieb(id) on delete cascade,
  aufgabe_id uuid not null,
  benutzer_id uuid references benutzer(id) on delete set null,
  text text not null,
  sichtbar_fuer_kunde boolean not null default false,
  erstellt_am timestamptz not null default now(),
  foreign key (betrieb_id, aufgabe_id) references aufgabe(betrieb_id, id) on delete cascade
);
create index aufgabe_notiz_aufgabe_idx on aufgabe_notiz(aufgabe_id, erstellt_am);

-- ---------------------------------------------------------------------------
-- Rechnungen (vor Zeiteinträgen/Material, weil diese darauf verweisen)
-- ---------------------------------------------------------------------------
create table rechnung (
  id uuid primary key default gen_random_uuid(),
  betrieb_id uuid not null references betrieb(id) on delete cascade,
  kunde_id uuid not null,
  serie_id uuid,
  nummer text,
  typ text check (typ in ('vollstaendig','vereinfacht','korrektur')),
  status text not null default 'entwurf' check (status in ('entwurf','ausgestellt','bezahlt')),
  datum date,
  leistung_von date,
  leistung_bis date,
  leistungszeitraum text,
  sprache text not null default 'es' check (sprache in ('de','es','en')),
  korrigiert_rechnung_id uuid,
  korrektur_grund text,
  kunde_snapshot jsonb,
  betrieb_snapshot jsonb,
  basis_cent bigint not null default 0,
  iva_cent bigint not null default 0,
  irpf_satz numeric(5,2) not null default 0,
  irpf_cent bigint not null default 0,
  summe_cent bigint not null default 0,
  faellig_am date,
  bezahlt_am date,
  ausgestellt_am timestamptz,
  bemerkung text,
  erstellt_am timestamptz not null default now(),
  geaendert_am timestamptz not null default now(),
  unique (betrieb_id, id),
  unique (betrieb_id, nummer),
  foreign key (betrieb_id, kunde_id) references kunde(betrieb_id, id),
  foreign key (betrieb_id, serie_id) references rechnungsserie(betrieb_id, id),
  foreign key (betrieb_id, korrigiert_rechnung_id) references rechnung(betrieb_id, id),
  check ((status = 'entwurf') = (nummer is null)),
  check (status = 'entwurf' or (typ is not null and datum is not null and kunde_snapshot is not null)),
  check ((status = 'bezahlt') = (bezahlt_am is not null)),
  check ((typ = 'korrektur') = (korrigiert_rechnung_id is not null) or status = 'entwurf')
);
create index rechnung_kunde_idx on rechnung(kunde_id);
create index rechnung_status_idx on rechnung(betrieb_id, status);

create table rechnung_position (
  id uuid primary key default gen_random_uuid(),
  betrieb_id uuid not null references betrieb(id) on delete cascade,
  rechnung_id uuid not null,
  pos int not null,
  quelle text not null default 'manuell' check (quelle in ('pauschale','stunden','material','manuell','korrektur')),
  auftrag_position_id uuid,
  beschreibung text not null,
  menge numeric(12,2) not null,
  einheit text,
  preis_cent bigint not null,
  iva_satz numeric(5,2) not null check (iva_satz >= 0 and iva_satz <= 100),
  basis_cent bigint not null,
  foreign key (betrieb_id, rechnung_id) references rechnung(betrieb_id, id) on delete cascade,
  foreign key (betrieb_id, auftrag_position_id) references auftrag_position(betrieb_id, id) on delete set null (auftrag_position_id)
);
create index rechnung_position_rechnung_idx on rechnung_position(rechnung_id, pos);
create index rechnung_position_auftrag_pos_idx on rechnung_position(auftrag_position_id);

-- ---------------------------------------------------------------------------
-- Zeiteinträge und Material
-- ---------------------------------------------------------------------------
create table zeiteintrag (
  id uuid primary key default gen_random_uuid(),
  betrieb_id uuid not null references betrieb(id) on delete cascade,
  auftrag_id uuid not null,
  aufgabe_id uuid,
  benutzer_id uuid references benutzer(id) on delete set null,
  start timestamptz not null,
  ende timestamptz,
  notiz text,
  abrechenbar boolean not null default true,
  rechnung_id uuid,
  erstellt_am timestamptz not null default now(),
  geaendert_am timestamptz not null default now(),
  foreign key (betrieb_id, auftrag_id) references auftrag(betrieb_id, id),
  foreign key (betrieb_id, aufgabe_id) references aufgabe(betrieb_id, id) on delete set null (aufgabe_id),
  foreign key (betrieb_id, rechnung_id) references rechnung(betrieb_id, id) on delete set null (rechnung_id),
  check (ende is null or ende > start),
  check (ende is not null or rechnung_id is null)
);
create index zeiteintrag_auftrag_idx on zeiteintrag(auftrag_id, start);
create index zeiteintrag_rechnung_idx on zeiteintrag(rechnung_id);
-- Pro Benutzer läuft höchstens ein Timer
create unique index zeiteintrag_timer_idx on zeiteintrag(benutzer_id) where ende is null;

create table material (
  id uuid primary key default gen_random_uuid(),
  betrieb_id uuid not null references betrieb(id) on delete cascade,
  auftrag_id uuid not null,
  datum date not null default current_date,
  beschreibung text not null,
  menge numeric(12,2) not null default 1 check (menge > 0),
  einheit text,
  preis_cent bigint not null check (preis_cent >= 0),
  iva_satz numeric(5,2) not null check (iva_satz >= 0 and iva_satz <= 100),
  rechnung_id uuid,
  erstellt_am timestamptz not null default now(),
  foreign key (betrieb_id, auftrag_id) references auftrag(betrieb_id, id),
  foreign key (betrieb_id, rechnung_id) references rechnung(betrieb_id, id) on delete set null (rechnung_id)
);
create index material_auftrag_idx on material(auftrag_id, datum);

-- ---------------------------------------------------------------------------
-- Unveränderbarkeit ausgestellter Rechnungen (in der Datenbank erzwungen)
-- ---------------------------------------------------------------------------
create or replace function rechnung_schutz() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'entwurf' then
      raise exception 'Ausgestellte Rechnungen können nicht gelöscht werden' using errcode = 'P0001';
    end if;
    return old;
  end if;
  if old.status = 'entwurf' then
    return new;
  end if;
  -- Ausgestellt/bezahlt: nur der Zahlungsstatus darf sich ändern
  if (to_jsonb(new) - array['status','bezahlt_am','geaendert_am'])
     is distinct from (to_jsonb(old) - array['status','bezahlt_am','geaendert_am']) then
    raise exception 'Ausgestellte Rechnungen können nicht geändert werden' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger rechnung_schutz before update or delete on rechnung
  for each row execute function rechnung_schutz();

create or replace function rechnung_position_schutz() returns trigger language plpgsql as $$
declare
  st text;
begin
  select status into st from rechnung where id = coalesce(new.rechnung_id, old.rechnung_id);
  -- Wird die Rechnung selbst gerade gelöscht (Entwurf, Kaskade), ist st null
  if st is not null and st <> 'entwurf' then
    raise exception 'Positionen ausgestellter Rechnungen können nicht geändert werden' using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end $$;
create trigger rechnung_position_schutz before insert or update or delete on rechnung_position
  for each row execute function rechnung_position_schutz();

-- Abgerechnete Zeiteinträge und Material sind gesperrt
create or replace function abgerechnet_schutz() returns trigger language plpgsql as $$
declare
  st text;
begin
  if old.rechnung_id is null then
    return coalesce(new, old);
  end if;
  select status into st from rechnung where id = old.rechnung_id;
  if st is not null and st <> 'entwurf' then
    raise exception 'Bereits abgerechnete Einträge können nicht geändert werden' using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end $$;
create trigger zeiteintrag_schutz before update or delete on zeiteintrag
  for each row execute function abgerechnet_schutz();
create trigger material_schutz before update or delete on material
  for each row execute function abgerechnet_schutz();

-- ---------------------------------------------------------------------------
-- Row-Level-Security
-- Inhaber: alles im eigenen Betrieb. Steuerberatung: Rechnungen (ohne Entwürfe) lesen.
-- Kunde: eigene Angebote (ohne Entwürfe), Aufträge, sichtbare Aufgaben, Stunden, Rechnungen.
-- ---------------------------------------------------------------------------
alter table rechnungsserie enable row level security;
alter table kontakt enable row level security;
alter table angebot enable row level security;
alter table angebot_position enable row level security;
alter table auftrag enable row level security;
alter table auftrag_position enable row level security;
alter table aufgabe enable row level security;
alter table aufgabe_notiz enable row level security;
alter table rechnung enable row level security;
alter table rechnung_position enable row level security;
alter table zeiteintrag enable row level security;
alter table material enable row level security;

-- Inhaber: voller Zugriff im aktuellen Betrieb
do $$
declare t text;
begin
  foreach t in array array['rechnungsserie','kontakt','angebot','angebot_position','auftrag','auftrag_position',
                           'aufgabe','aufgabe_notiz','rechnung','rechnung_position','zeiteintrag','material'] loop
    execute format(
      'create policy %I on %I for all using (betrieb_id = app_betrieb_id() and app_ist_inhaber())
       with check (betrieb_id = app_betrieb_id() and app_ist_inhaber())', t || '_inhaber', t);
  end loop;
end $$;

-- Kunde: lesen, was ihn betrifft
create policy angebot_kunde on angebot for select using (
  betrieb_id = app_betrieb_id() and app_rolle() = 'kunde' and kunde_id = app_kunde_id() and status <> 'entwurf');
create policy angebot_position_kunde on angebot_position for select using (
  betrieb_id = app_betrieb_id() and app_rolle() = 'kunde'
  and angebot_id in (select id from angebot));
create policy auftrag_kunde on auftrag for select using (
  betrieb_id = app_betrieb_id() and app_rolle() = 'kunde' and kunde_id = app_kunde_id());
create policy auftrag_position_kunde on auftrag_position for select using (
  betrieb_id = app_betrieb_id() and app_rolle() = 'kunde' and auftrag_id in (select id from auftrag));
create policy aufgabe_kunde on aufgabe for select using (
  betrieb_id = app_betrieb_id() and app_rolle() = 'kunde' and sichtbar_fuer_kunde
  and auftrag_id in (select id from auftrag));
create policy aufgabe_notiz_kunde on aufgabe_notiz for select using (
  betrieb_id = app_betrieb_id() and app_rolle() = 'kunde' and sichtbar_fuer_kunde
  and aufgabe_id in (select id from aufgabe));
create policy zeiteintrag_kunde on zeiteintrag for select using (
  betrieb_id = app_betrieb_id() and app_rolle() = 'kunde' and ende is not null
  and auftrag_id in (select id from auftrag));
create policy rechnung_kunde on rechnung for select using (
  betrieb_id = app_betrieb_id() and app_rolle() = 'kunde' and kunde_id = app_kunde_id() and status <> 'entwurf');
create policy rechnung_position_kunde on rechnung_position for select using (
  betrieb_id = app_betrieb_id() and app_rolle() = 'kunde' and rechnung_id in (select id from rechnung));

-- Steuerberatung: ausgestellte Rechnungen lesen
create policy rechnung_steuerberater on rechnung for select using (
  betrieb_id = app_betrieb_id() and app_rolle() = 'steuerberater' and status <> 'entwurf');
create policy rechnung_position_steuerberater on rechnung_position for select using (
  betrieb_id = app_betrieb_id() and app_rolle() = 'steuerberater' and rechnung_id in (select id from rechnung));

-- Aktivitätslog: nicht änderbar (nur insert/select gewährt), siehe 001.

grant select, insert, update, delete on rechnungsserie, kontakt, angebot, angebot_position, auftrag, auftrag_position,
  aufgabe, aufgabe_notiz, rechnung, rechnung_position, zeiteintrag, material to autonomo_app;
