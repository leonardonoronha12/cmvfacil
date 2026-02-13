create unique index if not exists bravo_outbox_dedupe_full_uidx
  on public.bravo_outbox (contact_id, event_type, dedupe_key);

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
    15,
    1440
  );

  return new;
end;
$$;

drop trigger if exists bravo_outbox_enqueue_free_plan_sequence on public.bravo_outbox;
create trigger bravo_outbox_enqueue_free_plan_sequence
after insert on public.bravo_outbox
for each row execute function public.trg_bravo_outbox_enqueue_free_plan_sequence();

do $$
declare
  r record;
begin
  for r in
    select distinct on (o.contact_id)
      o.contact_id,
      o.payload
    from public.bravo_outbox o
    join public.contacts c on c.id = o.contact_id
    where o.event_type in ('contact.upsert', 'contact_upsert')
      and o.created_at >= now() - interval '21 days'
      and c.stripe_free_active = false
      and not exists (
        select 1
        from public.bravo_outbox p
        where p.contact_id = o.contact_id
          and p.event_type = 'plan.free_pending'
          and p.dedupe_key = 'plan.free_pending'
      )
    order by o.contact_id, o.created_at desc
  loop
    perform public.enqueue_free_plan_pending_sequence_v2(r.contact_id, r.payload, 15, 1440);
  end loop;
end;
$$;
