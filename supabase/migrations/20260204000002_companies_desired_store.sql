alter table public.companies
  add column if not exists desired_store text null;

drop function if exists public.upsert_company(text, text, text, text, text, text, text, jsonb);

create or replace function public.upsert_company(
  p_fantasy_name text,
  p_legal_name text,
  p_cnpj text,
  p_email text,
  p_phone_e164 text,
  p_industry text,
  p_logo_url text,
  p_desired_store text,
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
      desired_store,
      raw
    ) values (
      nullif(trim(p_fantasy_name), ''),
      nullif(trim(p_legal_name), ''),
      v_cnpj,
      v_email,
      v_phone,
      nullif(trim(p_industry), ''),
      nullif(trim(p_logo_url), ''),
      nullif(trim(p_desired_store), ''),
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
      desired_store = coalesce(nullif(trim(p_desired_store), ''), c.desired_store),
      raw = c.raw || coalesce(p_raw, '{}'::jsonb)
    where c.id = v_id;
  end if;

  return v_id;
end;
$$;

