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

