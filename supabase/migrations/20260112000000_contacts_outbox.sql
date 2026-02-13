create extension if not exists pgcrypto;

create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'bubble',
  external_id text null,
  email text null,
  phone_e164 text null,
  first_name text null,
  last_name text null,
  consent_email boolean not null default false,
  consent_whatsapp boolean not null default false,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists contacts_phone_uidx
  on public.contacts (phone_e164)
  where phone_e164 is not null;

create unique index if not exists contacts_email_lower_uidx
  on public.contacts ((lower(email)))
  where email is not null;

create table if not exists public.bravo_outbox (
  id bigserial primary key,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  event_type text not null,
  payload jsonb not null,
  status text not null default 'pending',
  attempts int not null default 0,
  last_error text null,
  next_attempt_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists bravo_outbox_pending_idx
  on public.bravo_outbox (status, next_attempt_at, id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists contacts_set_updated_at on public.contacts;
create trigger contacts_set_updated_at
before update on public.contacts
for each row execute function public.set_updated_at();

drop trigger if exists bravo_outbox_set_updated_at on public.bravo_outbox;
create trigger bravo_outbox_set_updated_at
before update on public.bravo_outbox
for each row execute function public.set_updated_at();

create or replace function public.normalize_email(p_email text)
returns text
language sql
immutable
as $$
  select nullif(lower(trim(p_email)), '');
$$;

create or replace function public.upsert_contact(
  p_source text,
  p_external_id text,
  p_email text,
  p_phone_e164 text,
  p_first_name text,
  p_last_name text,
  p_consent_email boolean,
  p_consent_whatsapp boolean,
  p_raw jsonb
)
returns uuid
language plpgsql
security definer
as $$
declare
  v_email text := public.normalize_email(p_email);
  v_phone text := nullif(trim(p_phone_e164), '');
  v_id uuid;
  v_lock_key bigint;
begin
  v_lock_key := hashtextextended(coalesce(v_email, '') || '|' || coalesce(v_phone, ''), 0);
  perform pg_advisory_xact_lock(v_lock_key);

  select c.id
    into v_id
  from public.contacts c
  where (v_email is not null and lower(c.email) = v_email)
     or (v_phone is not null and c.phone_e164 = v_phone)
  order by c.updated_at desc
  limit 1;

  if v_id is null then
    insert into public.contacts (
      source,
      external_id,
      email,
      phone_e164,
      first_name,
      last_name,
      consent_email,
      consent_whatsapp,
      raw
    ) values (
      coalesce(nullif(trim(p_source), ''), 'bubble'),
      nullif(trim(p_external_id), ''),
      v_email,
      v_phone,
      nullif(trim(p_first_name), ''),
      nullif(trim(p_last_name), ''),
      coalesce(p_consent_email, false),
      coalesce(p_consent_whatsapp, false),
      coalesce(p_raw, '{}'::jsonb)
    )
    returning id into v_id;
  else
    update public.contacts c
    set
      source = coalesce(nullif(trim(p_source), ''), c.source),
      external_id = coalesce(nullif(trim(p_external_id), ''), c.external_id),
      email = coalesce(v_email, c.email),
      phone_e164 = coalesce(v_phone, c.phone_e164),
      first_name = coalesce(nullif(trim(p_first_name), ''), c.first_name),
      last_name = coalesce(nullif(trim(p_last_name), ''), c.last_name),
      consent_email = c.consent_email or coalesce(p_consent_email, false),
      consent_whatsapp = c.consent_whatsapp or coalesce(p_consent_whatsapp, false),
      raw = c.raw || coalesce(p_raw, '{}'::jsonb)
    where c.id = v_id;
  end if;

  return v_id;
end;
$$;

create or replace function public.enqueue_bravo_event(
  p_contact_id uuid,
  p_event_type text,
  p_payload jsonb
)
returns bigint
language plpgsql
security definer
as $$
declare
  v_id bigint;
begin
  insert into public.bravo_outbox (contact_id, event_type, payload)
  values (p_contact_id, p_event_type, coalesce(p_payload, '{}'::jsonb))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.claim_bravo_outbox(p_limit int default 25)
returns setof public.bravo_outbox
language plpgsql
security definer
as $$
begin
  return query
  with picked as (
    select o.id
    from public.bravo_outbox o
    where o.status = 'pending'
      and o.next_attempt_at <= now()
    order by o.id asc
    for update skip locked
    limit greatest(p_limit, 1)
  )
  update public.bravo_outbox o
  set status = 'processing'
  where o.id in (select id from picked)
  returning o.*;
end;
$$;

alter table public.contacts enable row level security;
alter table public.bravo_outbox enable row level security;
