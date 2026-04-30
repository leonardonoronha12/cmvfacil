create table if not exists public.inventario (
  id text primary key,
  data text not null,
  categorias jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists inventario_set_updated_at on public.inventario;
create trigger inventario_set_updated_at
before update on public.inventario
for each row execute function public.set_updated_at();

alter table public.inventario enable row level security;

