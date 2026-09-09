create extension if not exists pgcrypto;

create table if not exists public.internal_consumption_reasons (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (company_id, name)
);

create table if not exists public.internal_consumptions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  item_id uuid references public.items(id) on delete set null,
  item_name text not null,
  quantity numeric(18,3) not null check (quantity > 0),
  unit text not null,
  unit_cost numeric(18,6) not null default 0 check (unit_cost >= 0),
  total_cost numeric(18,2) not null default 0 check (total_cost >= 0),
  reason_id uuid references public.internal_consumption_reasons(id) on delete set null,
  reason_text text not null,
  occurred_on date not null,
  notes text,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists internal_consumptions_company_date_idx on public.internal_consumptions(company_id, occurred_on desc);
create index if not exists internal_consumptions_company_item_idx on public.internal_consumptions(company_id, item_id);

alter table public.items add column if not exists operational_image_url text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('item-photos', 'item-photos', true, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

alter table public.internal_consumption_reasons enable row level security;
alter table public.internal_consumptions enable row level security;

drop policy if exists internal_consumption_reasons_member_access on public.internal_consumption_reasons;
create policy internal_consumption_reasons_member_access on public.internal_consumption_reasons
for all using (exists (select 1 from public.company_members cm where cm.company_id = internal_consumption_reasons.company_id and cm.user_id = auth.uid()))
with check (exists (select 1 from public.company_members cm where cm.company_id = internal_consumption_reasons.company_id and cm.user_id = auth.uid()));

drop policy if exists internal_consumptions_member_access on public.internal_consumptions;
create policy internal_consumptions_member_access on public.internal_consumptions
for all using (exists (select 1 from public.company_members cm where cm.company_id = internal_consumptions.company_id and cm.user_id = auth.uid()))
with check (exists (select 1 from public.company_members cm where cm.company_id = internal_consumptions.company_id and cm.user_id = auth.uid()));

insert into public.internal_consumption_reasons (company_id, name)
select c.id, reason.name
from public.companies c
cross join (values ('Refeição da equipe'), ('Teste de produto'), ('Cortesia'), ('Uso operacional'), ('Outro')) as reason(name)
on conflict (company_id, name) do nothing;
