create table if not exists public.entradas (
  id text primary key,
  user_id uuid not null default auth.uid(),
  numero text not null,
  data_lancamento text not null,
  fornecedor text not null,
  valor_nota text not null,
  itens text not null,
  responsavel text not null,
  data_criacao text not null,
  itens_nota jsonb null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists entradas_set_updated_at on public.entradas;
create trigger entradas_set_updated_at
before update on public.entradas
for each row execute function public.set_updated_at();

alter table public.entradas enable row level security;

drop policy if exists entradas_select_own on public.entradas;
create policy entradas_select_own
on public.entradas
for select
using (auth.uid() = user_id);

drop policy if exists entradas_insert_own on public.entradas;
create policy entradas_insert_own
on public.entradas
for insert
with check (auth.uid() = user_id);

drop policy if exists entradas_update_own on public.entradas;
create policy entradas_update_own
on public.entradas
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists entradas_delete_own on public.entradas;
create policy entradas_delete_own
on public.entradas
for delete
using (auth.uid() = user_id);

