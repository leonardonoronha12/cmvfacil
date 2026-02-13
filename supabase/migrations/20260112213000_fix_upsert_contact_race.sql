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
begin
  if v_email is not null then
    perform pg_advisory_xact_lock(hashtextextended(v_email, 0));
  end if;
  if v_phone is not null then
    perform pg_advisory_xact_lock(hashtextextended(v_phone, 0));
  end if;

  select c.id
    into v_id
  from public.contacts c
  where (v_email is not null and lower(c.email) = v_email)
     or (v_phone is not null and c.phone_e164 = v_phone)
  order by c.updated_at desc
  limit 1;

  if v_id is null then
    begin
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
    exception
      when unique_violation then
        select c.id
          into v_id
        from public.contacts c
        where (v_email is not null and lower(c.email) = v_email)
           or (v_phone is not null and c.phone_e164 = v_phone)
        order by c.updated_at desc
        limit 1;
    end;
  end if;

  if v_id is not null then
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

