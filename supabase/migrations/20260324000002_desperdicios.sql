create table if not exists public.desperdicios (
  id text primary key,
  data text not null,
  item text not null,
  quantidade text not null default '',
  custo text not null default '',
  motivo text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists desperdicios_set_updated_at on public.desperdicios;
create trigger desperdicios_set_updated_at
before update on public.desperdicios
for each row execute function public.set_updated_at();

alter table public.desperdicios enable row level security;

