create or replace function public.enqueue_free_plan_pending_sequence(
  p_contact_id uuid,
  p_payload jsonb
)
returns bigint
language plpgsql
security definer
as $$
declare
  v_first_id bigint;
  v_id bigint;
  v_start timestamptz;
begin
  v_start := now() + interval '15 minutes';

  insert into public.bravo_outbox (contact_id, event_type, payload, next_attempt_at, dedupe_key)
  values (p_contact_id, 'plan.free_pending', coalesce(p_payload, '{}'::jsonb), v_start, 'plan.free_pending')
  on conflict (contact_id, event_type, dedupe_key)
  do update set
    payload = excluded.payload,
    status = 'pending',
    next_attempt_at = excluded.next_attempt_at
  returning id into v_first_id;

  insert into public.bravo_outbox (contact_id, event_type, payload, next_attempt_at, dedupe_key)
  values (p_contact_id, 'plan.free_pending_2', coalesce(p_payload, '{}'::jsonb), v_start + interval '24 hours', 'plan.free_pending_2')
  on conflict (contact_id, event_type, dedupe_key)
  do update set payload = excluded.payload, status = 'pending', next_attempt_at = excluded.next_attempt_at
  returning id into v_id;

  insert into public.bravo_outbox (contact_id, event_type, payload, next_attempt_at, dedupe_key)
  values (p_contact_id, 'plan.free_pending_3', coalesce(p_payload, '{}'::jsonb), v_start + interval '48 hours', 'plan.free_pending_3')
  on conflict (contact_id, event_type, dedupe_key)
  do update set payload = excluded.payload, status = 'pending', next_attempt_at = excluded.next_attempt_at
  returning id into v_id;

  insert into public.bravo_outbox (contact_id, event_type, payload, next_attempt_at, dedupe_key)
  values (p_contact_id, 'plan.free_pending_4', coalesce(p_payload, '{}'::jsonb), v_start + interval '72 hours', 'plan.free_pending_4')
  on conflict (contact_id, event_type, dedupe_key)
  do update set payload = excluded.payload, status = 'pending', next_attempt_at = excluded.next_attempt_at
  returning id into v_id;

  insert into public.bravo_outbox (contact_id, event_type, payload, next_attempt_at, dedupe_key)
  values (p_contact_id, 'plan.free_pending_5', coalesce(p_payload, '{}'::jsonb), v_start + interval '96 hours', 'plan.free_pending_5')
  on conflict (contact_id, event_type, dedupe_key)
  do update set payload = excluded.payload, status = 'pending', next_attempt_at = excluded.next_attempt_at
  returning id into v_id;

  return v_first_id;
end;
$$;

