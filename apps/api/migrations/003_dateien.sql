-- Phase 1, Teil 2: Dateien (Fotos, PDFs, Logo), Versand von Angeboten und Rechnungen

-- ---------------------------------------------------------------------------
-- Dateien: Metadaten in der Datenbank, Inhalt im Dateispeicher (lokal bzw. später S3)
-- ---------------------------------------------------------------------------
create table datei (
  id uuid primary key default gen_random_uuid(),
  betrieb_id uuid not null references betrieb(id) on delete cascade,
  art text not null check (art in ('foto','foto_klein','pdf','logo')),
  schluessel text not null unique,
  mime text not null,
  groesse integer not null,
  sha256 text not null,
  erstellt_von uuid references benutzer(id) on delete set null,
  erstellt_am timestamptz not null default now(),
  unique (betrieb_id, id)
);

create table foto (
  id uuid primary key default gen_random_uuid(),
  betrieb_id uuid not null references betrieb(id) on delete cascade,
  aufgabe_id uuid not null,
  datei_id uuid not null,
  vorschau_datei_id uuid not null,
  art text not null default 'arbeit' check (art in ('arbeit','schaden','vorher','nachher')),
  beschreibung text,
  sichtbar_fuer_kunde boolean not null default true,
  breite integer,
  hoehe integer,
  erstellt_von uuid references benutzer(id) on delete set null,
  erstellt_von_rolle text not null default 'inhaber' check (erstellt_von_rolle in ('inhaber','kunde')),
  erstellt_am timestamptz not null default now(),
  foreign key (betrieb_id, aufgabe_id) references aufgabe(betrieb_id, id) on delete cascade,
  foreign key (betrieb_id, datei_id) references datei(betrieb_id, id),
  foreign key (betrieb_id, vorschau_datei_id) references datei(betrieb_id, id)
);
create index foto_aufgabe_idx on foto(aufgabe_id);

alter table betrieb add column logo_datei_id uuid references datei(id) on delete set null;
alter table angebot add column pdf_datei_id uuid references datei(id);
alter table angebot add column unterschrift_am timestamptz;
alter table rechnung add column pdf_datei_id uuid references datei(id);
alter table rechnung add column gesendet_am timestamptz;
alter table rechnung add column gesendet_an text;

-- Ausgestellte Rechnungen: außer dem Zahlungsstatus dürfen nur das einmal erzeugte PDF
-- und der Versandvermerk nachgetragen werden.
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
  if old.pdf_datei_id is not null and new.pdf_datei_id is distinct from old.pdf_datei_id then
    raise exception 'Das PDF einer ausgestellten Rechnung kann nicht ersetzt werden' using errcode = 'P0001';
  end if;
  if (to_jsonb(new) - array['status','bezahlt_am','geaendert_am','pdf_datei_id','gesendet_am','gesendet_an'])
     is distinct from (to_jsonb(old) - array['status','bezahlt_am','geaendert_am','pdf_datei_id','gesendet_am','gesendet_an']) then
    raise exception 'Ausgestellte Rechnungen können nicht geändert werden' using errcode = 'P0001';
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Angebots-Link: löst ein Token (Hash) zum Betrieb und dessen Inhaber auf.
-- Die API arbeitet danach im Kontext dieses Betriebs und greift nur auf dieses Angebot zu.
-- ---------------------------------------------------------------------------
create or replace function app_angebot_link(p_hash bytea)
returns table (angebot_id uuid, betrieb_id uuid, inhaber_id uuid)
language sql stable security definer set search_path = public as $$
  select a.id, a.betrieb_id, m.benutzer_id
  from angebot a
  join betrieb b on b.id = a.betrieb_id and not b.gesperrt
  join mitgliedschaft m on m.betrieb_id = a.betrieb_id and m.rolle = 'inhaber'
  where a.link_token_hash = p_hash and a.status <> 'entwurf'
  order by m.erstellt_am
  limit 1
$$;
revoke all on function app_angebot_link(bytea) from public;
grant execute on function app_angebot_link(bytea) to autonomo_app;

-- ---------------------------------------------------------------------------
-- Row-Level-Security
-- ---------------------------------------------------------------------------
alter table datei enable row level security;
alter table foto enable row level security;

create policy datei_inhaber on datei for all
  using (betrieb_id = app_betrieb_id() and app_rolle() = 'inhaber')
  with check (betrieb_id = app_betrieb_id() and app_rolle() = 'inhaber');
create policy foto_inhaber on foto for all
  using (betrieb_id = app_betrieb_id() and app_rolle() = 'inhaber')
  with check (betrieb_id = app_betrieb_id() and app_rolle() = 'inhaber');

-- Kunde: Fotos sichtbarer Aufgaben; Dateien nur, wenn sie zu etwas gehören, das er sehen darf
create policy foto_kunde on foto for select using (
  betrieb_id = app_betrieb_id() and app_rolle() = 'kunde' and sichtbar_fuer_kunde
  and aufgabe_id in (select id from aufgabe));
create policy datei_lesen on datei for select using (
  betrieb_id = app_betrieb_id() and app_rolle() in ('kunde','steuerberater') and (
    exists (select 1 from foto f where f.datei_id = datei.id or f.vorschau_datei_id = datei.id)
    or exists (select 1 from rechnung r where r.pdf_datei_id = datei.id)
    or exists (select 1 from angebot a where a.pdf_datei_id = datei.id)
    or exists (select 1 from betrieb b where b.logo_datei_id = datei.id)));

grant select, insert, update, delete on datei, foto to autonomo_app;
