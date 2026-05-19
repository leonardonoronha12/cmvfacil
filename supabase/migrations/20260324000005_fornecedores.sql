create table if not exists public.fornecedores_state (
  id text primary key,
  info jsonb not null default '{}'::jsonb,
  produtos jsonb not null default '{}'::jsonb,
  equivalencias jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists fornecedores_state_set_updated_at on public.fornecedores_state;
create trigger fornecedores_state_set_updated_at
before update on public.fornecedores_state
for each row execute function public.set_updated_at();

alter table public.fornecedores_state enable row level security;

