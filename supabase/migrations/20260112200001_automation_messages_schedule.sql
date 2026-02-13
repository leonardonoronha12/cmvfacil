alter table public.automation_messages
  add column if not exists send_delay_minutes int not null default 0,
  add column if not exists repeat_count int not null default 1,
  add column if not exists repeat_interval_minutes int not null default 0;

alter table public.automation_messages
  add constraint automation_messages_send_delay_minutes_chk
  check (send_delay_minutes >= 0);

alter table public.automation_messages
  add constraint automation_messages_repeat_count_chk
  check (repeat_count >= 1);

alter table public.automation_messages
  add constraint automation_messages_repeat_interval_minutes_chk
  check (repeat_interval_minutes >= 0);

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
  v_first_id bigint;
  v_delay int;
  v_repeat_count int;
  v_repeat_interval int;
  v_i int;
begin
  select
    coalesce(m.send_delay_minutes, 0),
    coalesce(m.repeat_count, 1),
    coalesce(m.repeat_interval_minutes, 0)
  into
    v_delay,
    v_repeat_count,
    v_repeat_interval
  from public.automation_messages m
  where m.event_type = p_event_type;

  v_delay := coalesce(v_delay, 0);
  v_repeat_count := greatest(coalesce(v_repeat_count, 1), 1);
  v_repeat_interval := greatest(coalesce(v_repeat_interval, 0), 0);

  if v_repeat_count > 1 and v_repeat_interval = 0 then
    v_repeat_interval := 1;
  end if;

  v_i := 1;
  while v_i <= v_repeat_count loop
    insert into public.bravo_outbox (contact_id, event_type, payload, next_attempt_at)
    values (
      p_contact_id,
      p_event_type,
      coalesce(p_payload, '{}'::jsonb) || jsonb_build_object(
        'send_index',
        v_i,
        'send_total',
        v_repeat_count
      ),
      now()
        + make_interval(mins => v_delay)
        + make_interval(mins => (v_i - 1) * v_repeat_interval)
    )
    returning id into v_first_id;

    v_i := v_i + 1;
  end loop;

  return v_first_id;
end;
$$;

