create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  fantasy_name text not null,
  legal_name text not null,
  cnpj text null,
  email text null,
  phone_e164 text null,
  industry text null,
  logo_url text null,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists companies_cnpj_uidx
  on public.companies (cnpj)
  where cnpj is not null;

create unique index if not exists companies_email_lower_uidx
  on public.companies ((lower(email)))
  where email is not null;

drop trigger if exists companies_set_updated_at on public.companies;
create trigger companies_set_updated_at
before update on public.companies
for each row execute function public.set_updated_at();

create or replace function public.normalize_cnpj(p_cnpj text)
returns text
language sql
immutable
as $$
  select nullif(regexp_replace(trim(p_cnpj), '\D', '', 'g'), '');
$$;

create or replace function public.upsert_company(
  p_fantasy_name text,
  p_legal_name text,
  p_cnpj text,
  p_email text,
  p_phone_e164 text,
  p_industry text,
  p_logo_url text,
  p_raw jsonb
)
returns uuid
language plpgsql
security definer
as $$
declare
  v_cnpj text := public.normalize_cnpj(p_cnpj);
  v_email text := public.normalize_email(p_email);
  v_phone text := nullif(trim(p_phone_e164), '');
  v_id uuid;
  v_lock_key bigint;
begin
  v_lock_key := hashtextextended(coalesce(v_cnpj, '') || '|' || coalesce(v_email, ''), 0);
  perform pg_advisory_xact_lock(v_lock_key);

  select c.id
    into v_id
  from public.companies c
  where (v_cnpj is not null and c.cnpj = v_cnpj)
     or (v_email is not null and lower(c.email) = v_email)
  order by c.updated_at desc
  limit 1;

  if v_id is null then
    insert into public.companies (
      fantasy_name,
      legal_name,
      cnpj,
      email,
      phone_e164,
      industry,
      logo_url,
      raw
    ) values (
      nullif(trim(p_fantasy_name), ''),
      nullif(trim(p_legal_name), ''),
      v_cnpj,
      v_email,
      v_phone,
      nullif(trim(p_industry), ''),
      nullif(trim(p_logo_url), ''),
      coalesce(p_raw, '{}'::jsonb)
    )
    returning id into v_id;
  else
    update public.companies c
    set
      fantasy_name = coalesce(nullif(trim(p_fantasy_name), ''), c.fantasy_name),
      legal_name = coalesce(nullif(trim(p_legal_name), ''), c.legal_name),
      cnpj = coalesce(v_cnpj, c.cnpj),
      email = coalesce(v_email, c.email),
      phone_e164 = coalesce(v_phone, c.phone_e164),
      industry = coalesce(nullif(trim(p_industry), ''), c.industry),
      logo_url = coalesce(nullif(trim(p_logo_url), ''), c.logo_url),
      raw = c.raw || coalesce(p_raw, '{}'::jsonb)
    where c.id = v_id;
  end if;

  return v_id;
end;
$$;

alter table public.companies enable row level security;

