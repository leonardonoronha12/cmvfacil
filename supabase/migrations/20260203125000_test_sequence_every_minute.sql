create or replace function public.trg_bravo_outbox_enqueue_free_plan_sequence()
returns trigger
language plpgsql
security definer
as $$
begin
  if tg_op <> 'INSERT' then
    return new;
  end if;

  if new.event_type not in ('contact.upsert', 'contact_upsert') then
    return new;
  end if;

  if exists (
    select 1
    from public.bravo_outbox o
    where o.contact_id = new.contact_id
      and o.event_type = 'plan.free_pending'
      and o.dedupe_key = 'plan.free_pending'
  ) then
    return new;
  end if;

  perform public.enqueue_free_plan_pending_sequence_v2(
    new.contact_id,
    new.payload,
    1,
    1
  );

  return new;
end;
$$;

