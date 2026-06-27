create table if not exists public.bubble_global_config (
  id text primary key,
  base_url text null,
  api_token text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists bubble_global_config_set_updated_at on public.bubble_global_config;
create trigger bubble_global_config_set_updated_at
before update on public.bubble_global_config
for each row execute function public.set_updated_at();

alter table public.bubble_global_config enable row level security;

