alter table public.contacts
  add column if not exists stripe_free_active boolean not null default false,
  add column if not exists stripe_free_activated_at timestamptz null;

alter table public.bravo_outbox
  add column if not exists dedupe_key text null,
  add column if not exists sent_count int not null default 0,
  add column if not exists last_sent_at timestamptz null;

create unique index if not exists bravo_outbox_dedupe_uidx
  on public.bravo_outbox (contact_id, event_type, dedupe_key)
  where dedupe_key is not null;

create or replace function public.set_contact_stripe_free_active(
  p_contact_id uuid,
  p_active boolean
)
returns uuid
language plpgsql
security definer
as $$
begin
  update public.contacts c
  set
    stripe_free_active = coalesce(p_active, false),
    stripe_free_activated_at = case when coalesce(p_active, false) then now() else null end
  where c.id = p_contact_id;

  if coalesce(p_active, false) then
    update public.bravo_outbox o
    set
      status = 'sent',
      next_attempt_at = now(),
      last_error = null
    where o.contact_id = p_contact_id
      and o.event_type = 'plan.free_pending'
      and o.dedupe_key = 'plan.free_pending'
      and o.status in ('pending', 'processing');
  end if;

  return p_contact_id;
end;
$$;

create or replace function public.set_contact_stripe_free_active_by_email(
  p_email text,
  p_active boolean
)
returns uuid
language plpgsql
security definer
as $$
declare
  v_email text := public.normalize_email(p_email);
  v_id uuid;
begin
  select c.id into v_id
  from public.contacts c
  where v_email is not null and lower(c.email) = v_email
  order by c.updated_at desc
  limit 1;

  if v_id is null then
    return null;
  end if;

  perform public.set_contact_stripe_free_active(v_id, p_active);
  return v_id;
end;
$$;

create or replace function public.enqueue_free_plan_pending_reminder(
  p_contact_id uuid,
  p_payload jsonb
)
returns bigint
language plpgsql
security definer
as $$
declare
  v_id bigint;
begin
  insert into public.bravo_outbox (
    contact_id,
    event_type,
    payload,
    status,
    next_attempt_at,
    dedupe_key
  ) values (
    p_contact_id,
    'plan.free_pending',
    coalesce(p_payload, '{}'::jsonb),
    'pending',
    now() + make_interval(mins => 15),
    'plan.free_pending'
  )
  on conflict (contact_id, event_type, dedupe_key)
  do update set
    payload = excluded.payload,
    status = 'pending',
    next_attempt_at = excluded.next_attempt_at
  returning id into v_id;

  return v_id;
end;
$$;

