create or replace function public.enqueue_free_plan_pending_sequence_v2(
  p_contact_id uuid,
  p_payload jsonb,
  p_start_delay_minutes int,
  p_step_minutes int
)
returns bigint
language plpgsql
security definer
as $$
declare
  v_first_id bigint;
  v_id bigint;
  v_start_delay int := greatest(coalesce(p_start_delay_minutes, 15), 0);
  v_step int := greatest(coalesce(p_step_minutes, 1440), 1);
  v_start timestamptz;
begin
  v_start := now() + make_interval(mins => v_start_delay);

  insert into public.bravo_outbox (contact_id, event_type, payload, next_attempt_at, dedupe_key)
  values (p_contact_id, 'plan.free_pending', coalesce(p_payload, '{}'::jsonb), v_start, 'plan.free_pending')
  on conflict (contact_id, event_type, dedupe_key)
  do update set payload = excluded.payload, status = 'pending', next_attempt_at = excluded.next_attempt_at
  returning id into v_first_id;

  insert into public.bravo_outbox (contact_id, event_type, payload, next_attempt_at, dedupe_key)
  values (p_contact_id, 'plan.free_pending_2', coalesce(p_payload, '{}'::jsonb), v_start + make_interval(mins => v_step * 1), 'plan.free_pending_2')
  on conflict (contact_id, event_type, dedupe_key)
  do update set payload = excluded.payload, status = 'pending', next_attempt_at = excluded.next_attempt_at
  returning id into v_id;

  insert into public.bravo_outbox (contact_id, event_type, payload, next_attempt_at, dedupe_key)
  values (p_contact_id, 'plan.free_pending_3', coalesce(p_payload, '{}'::jsonb), v_start + make_interval(mins => v_step * 2), 'plan.free_pending_3')
  on conflict (contact_id, event_type, dedupe_key)
  do update set payload = excluded.payload, status = 'pending', next_attempt_at = excluded.next_attempt_at
  returning id into v_id;

  insert into public.bravo_outbox (contact_id, event_type, payload, next_attempt_at, dedupe_key)
  values (p_contact_id, 'plan.free_pending_4', coalesce(p_payload, '{}'::jsonb), v_start + make_interval(mins => v_step * 3), 'plan.free_pending_4')
  on conflict (contact_id, event_type, dedupe_key)
  do update set payload = excluded.payload, status = 'pending', next_attempt_at = excluded.next_attempt_at
  returning id into v_id;

  insert into public.bravo_outbox (contact_id, event_type, payload, next_attempt_at, dedupe_key)
  values (p_contact_id, 'plan.free_pending_5', coalesce(p_payload, '{}'::jsonb), v_start + make_interval(mins => v_step * 4), 'plan.free_pending_5')
  on conflict (contact_id, event_type, dedupe_key)
  do update set payload = excluded.payload, status = 'pending', next_attempt_at = excluded.next_attempt_at
  returning id into v_id;

  return v_first_id;
end;
$$;

