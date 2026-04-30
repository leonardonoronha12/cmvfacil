alter table public.entradas
  alter column user_id drop default,
  alter column user_id drop not null;

alter table public.entradas disable row level security;

drop policy if exists entradas_select_own on public.entradas;
drop policy if exists entradas_insert_own on public.entradas;
drop policy if exists entradas_update_own on public.entradas;
drop policy if exists entradas_delete_own on public.entradas;

