create or replace function public.seed_internal_consumption_reasons_for_company()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.internal_consumption_reasons (company_id, name)
  values
    (new.id, 'Refeição da equipe'),
    (new.id, 'Teste de produto'),
    (new.id, 'Cortesia'),
    (new.id, 'Uso operacional'),
    (new.id, 'Outro')
  on conflict (company_id, name) do nothing;
  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'seed_internal_consumption_reasons_after_company_insert'
      and tgrelid = 'public.companies'::regclass
  ) then
    create trigger seed_internal_consumption_reasons_after_company_insert
    after insert on public.companies
    for each row execute function public.seed_internal_consumption_reasons_for_company();
  end if;
end;
$$;

insert into public.internal_consumption_reasons (company_id, name)
select c.id, reason.name
from public.companies c
cross join (values
  ('Refeição da equipe'),
  ('Teste de produto'),
  ('Cortesia'),
  ('Uso operacional'),
  ('Outro')
) as reason(name)
on conflict (company_id, name) do nothing;
