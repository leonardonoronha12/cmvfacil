create extension if not exists "pgcrypto";

do $$
begin
  if not exists (select 1 from pg_proc where proname = 'set_updated_at') then
    create or replace function public.set_updated_at()
    returns trigger as $fn$
    begin
      new.updated_at := now();
      return new;
    end;
    $fn$ language plpgsql;
  end if;
end $$;

create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists companies_set_updated_at on public.companies;
create trigger companies_set_updated_at
before update on public.companies
for each row execute function public.set_updated_at();

create table if not exists public.company_members (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'Colaborador',
  permission_level integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, user_id)
);

drop trigger if exists company_members_set_updated_at on public.company_members;
create trigger company_members_set_updated_at
before update on public.company_members
for each row execute function public.set_updated_at();

create table if not exists public.sectors (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  user_scope_id text,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sectors_scope_check check (
    (company_id is not null and user_scope_id is null)
    or (company_id is null and user_scope_id is not null)
  )
);

drop trigger if exists sectors_set_updated_at on public.sectors;
create trigger sectors_set_updated_at
before update on public.sectors
for each row execute function public.set_updated_at();

create unique index if not exists sectors_company_name_unq
  on public.sectors (company_id, lower(name))
  where company_id is not null;

create unique index if not exists sectors_user_name_unq
  on public.sectors (user_scope_id, lower(name))
  where user_scope_id is not null;

alter table public.sectors enable row level security;

drop policy if exists sectors_select on public.sectors;
create policy sectors_select on public.sectors for select to authenticated
using (
  (company_id is not null and company_id in (
    select company_id from public.company_members where user_id = auth.uid()
  ))
  or (user_scope_id is not null and user_scope_id = ('user:' || auth.uid()::text))
);

drop policy if exists sectors_insert on public.sectors;
create policy sectors_insert on public.sectors for insert to authenticated
with check (
  (company_id is not null and company_id in (
    select company_id from public.company_members where user_id = auth.uid() and role = 'Administrador'
  ))
  or (user_scope_id is not null and user_scope_id = ('user:' || auth.uid()::text))
);

drop policy if exists sectors_update on public.sectors;
create policy sectors_update on public.sectors for update to authenticated
using (
  (company_id is not null and company_id in (
    select company_id from public.company_members where user_id = auth.uid() and role = 'Administrador'
  ))
  or (user_scope_id is not null and user_scope_id = ('user:' || auth.uid()::text))
)
with check (
  (company_id is not null and company_id in (
    select company_id from public.company_members where user_id = auth.uid() and role = 'Administrador'
  ))
  or (user_scope_id is not null and user_scope_id = ('user:' || auth.uid()::text))
);

drop policy if exists sectors_delete on public.sectors;
create policy sectors_delete on public.sectors for delete to authenticated
using (
  (company_id is not null and company_id in (
    select company_id from public.company_members where user_id = auth.uid() and role = 'Administrador'
  ))
  or (user_scope_id is not null and user_scope_id = ('user:' || auth.uid()::text))
);

create table if not exists public.item_sectors (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  user_scope_id text,
  item_id text not null,
  sector_id uuid not null references public.sectors(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint item_sectors_scope_check check (
    (company_id is not null and user_scope_id is null)
    or (company_id is null and user_scope_id is not null)
  )
);

create unique index if not exists item_sectors_company_unq
  on public.item_sectors (company_id, item_id, sector_id)
  where company_id is not null;

create unique index if not exists item_sectors_user_unq
  on public.item_sectors (user_scope_id, item_id, sector_id)
  where user_scope_id is not null;

alter table public.item_sectors enable row level security;

drop policy if exists item_sectors_select on public.item_sectors;
create policy item_sectors_select on public.item_sectors for select to authenticated
using (
  (company_id is not null and company_id in (
    select company_id from public.company_members where user_id = auth.uid()
  ))
  or (user_scope_id is not null and user_scope_id = ('user:' || auth.uid()::text))
);

drop policy if exists item_sectors_insert on public.item_sectors;
create policy item_sectors_insert on public.item_sectors for insert to authenticated
with check (
  (company_id is not null and company_id in (
    select company_id from public.company_members where user_id = auth.uid()
  ))
  or (user_scope_id is not null and user_scope_id = ('user:' || auth.uid()::text))
);

drop policy if exists item_sectors_update on public.item_sectors;
create policy item_sectors_update on public.item_sectors for update to authenticated
using (
  (company_id is not null and company_id in (
    select company_id from public.company_members where user_id = auth.uid()
  ))
  or (user_scope_id is not null and user_scope_id = ('user:' || auth.uid()::text))
)
with check (
  (company_id is not null and company_id in (
    select company_id from public.company_members where user_id = auth.uid()
  ))
  or (user_scope_id is not null and user_scope_id = ('user:' || auth.uid()::text))
);

drop policy if exists item_sectors_delete on public.item_sectors;
create policy item_sectors_delete on public.item_sectors for delete to authenticated
using (
  (company_id is not null and company_id in (
    select company_id from public.company_members where user_id = auth.uid()
  ))
  or (user_scope_id is not null and user_scope_id = ('user:' || auth.uid()::text))
);

create table if not exists public.inventory_item_sector_counts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  user_scope_id text,
  inventory_id text not null,
  item_id text not null,
  sector_id uuid not null references public.sectors(id) on delete cascade,
  quantity numeric not null default 0,
  counted_by_user_id uuid references auth.users(id) on delete set null,
  counted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sector_counts_scope_check check (
    (company_id is not null and user_scope_id is null)
    or (company_id is null and user_scope_id is not null)
  )
);

drop trigger if exists sector_counts_set_updated_at on public.inventory_item_sector_counts;
create trigger sector_counts_set_updated_at
before update on public.inventory_item_sector_counts
for each row execute function public.set_updated_at();

create unique index if not exists sector_counts_company_unq
  on public.inventory_item_sector_counts (company_id, inventory_id, item_id, sector_id)
  where company_id is not null;

create unique index if not exists sector_counts_user_unq
  on public.inventory_item_sector_counts (user_scope_id, inventory_id, item_id, sector_id)
  where user_scope_id is not null;

alter table public.inventory_item_sector_counts enable row level security;

drop policy if exists sector_counts_select on public.inventory_item_sector_counts;
create policy sector_counts_select on public.inventory_item_sector_counts for select to authenticated
using (
  (company_id is not null and company_id in (
    select company_id from public.company_members where user_id = auth.uid()
  ))
  or (user_scope_id is not null and user_scope_id = ('user:' || auth.uid()::text))
);

drop policy if exists sector_counts_insert on public.inventory_item_sector_counts;
create policy sector_counts_insert on public.inventory_item_sector_counts for insert to authenticated
with check (
  (company_id is not null and company_id in (
    select company_id from public.company_members where user_id = auth.uid()
  ))
  or (user_scope_id is not null and user_scope_id = ('user:' || auth.uid()::text))
);

drop policy if exists sector_counts_update on public.inventory_item_sector_counts;
create policy sector_counts_update on public.inventory_item_sector_counts for update to authenticated
using (
  (company_id is not null and company_id in (
    select company_id from public.company_members where user_id = auth.uid()
  ))
  or (user_scope_id is not null and user_scope_id = ('user:' || auth.uid()::text))
)
with check (
  (company_id is not null and company_id in (
    select company_id from public.company_members where user_id = auth.uid()
  ))
  or (user_scope_id is not null and user_scope_id = ('user:' || auth.uid()::text))
);

drop policy if exists sector_counts_delete on public.inventory_item_sector_counts;
create policy sector_counts_delete on public.inventory_item_sector_counts for delete to authenticated
using (
  (company_id is not null and company_id in (
    select company_id from public.company_members where user_id = auth.uid()
  ))
  or (user_scope_id is not null and user_scope_id = ('user:' || auth.uid()::text))
);

insert into public.sectors (user_scope_id, name)
select 'user:' || u.id::text, 'Geral'
from auth.users u
where not exists (
  select 1 from public.sectors s
  where s.user_scope_id = ('user:' || u.id::text) and lower(s.name) = 'geral'
)
on conflict do nothing;

insert into public.sectors (company_id, name)
select c.id, 'Geral'
from public.companies c
where not exists (
  select 1 from public.sectors s
  where s.company_id = c.id and lower(s.name) = 'geral'
)
on conflict do nothing;
