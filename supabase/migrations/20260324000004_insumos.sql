create table if not exists public.insumos (
  id text primary key,
  item text not null,
  medida text not null default 'Und',
  custo_medio text not null default '',
  categoria text not null default '',
  especificacao text not null default '',
  ocultar boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists insumos_set_updated_at on public.insumos;
create trigger insumos_set_updated_at
before update on public.insumos
for each row execute function public.set_updated_at();

alter table public.insumos enable row level security;
