create table if not exists public.insumos_state (
  id text primary key,
  payload jsonb not null default '{"rows":[],"categories":[]}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists insumos_state_set_updated_at on public.insumos_state;
create trigger insumos_state_set_updated_at
before update on public.insumos_state
for each row execute function public.set_updated_at();

alter table public.insumos_state enable row level security;

drop policy if exists insumos_state_select_own on public.insumos_state;
create policy insumos_state_select_own
on public.insumos_state
for select
to authenticated
using (id = ('user:' || auth.uid()::text));

drop policy if exists insumos_state_insert_own on public.insumos_state;
create policy insumos_state_insert_own
on public.insumos_state
for insert
to authenticated
with check (id = ('user:' || auth.uid()::text));

drop policy if exists insumos_state_update_own on public.insumos_state;
create policy insumos_state_update_own
on public.insumos_state
for update
to authenticated
using (id = ('user:' || auth.uid()::text))
with check (id = ('user:' || auth.uid()::text));

drop policy if exists insumos_select_own on public.insumos;
create policy insumos_select_own
on public.insumos
for select
to authenticated
using (id like ('user:' || auth.uid()::text || ':%'));

drop policy if exists insumos_insert_own on public.insumos;
create policy insumos_insert_own
on public.insumos
for insert
to authenticated
with check (id like ('user:' || auth.uid()::text || ':%'));

drop policy if exists insumos_update_own on public.insumos;
create policy insumos_update_own
on public.insumos
for update
to authenticated
using (id like ('user:' || auth.uid()::text || ':%'))
with check (id like ('user:' || auth.uid()::text || ':%'));

drop policy if exists insumos_delete_own on public.insumos;
create policy insumos_delete_own
on public.insumos
for delete
to authenticated
using (id like ('user:' || auth.uid()::text || ':%'));
