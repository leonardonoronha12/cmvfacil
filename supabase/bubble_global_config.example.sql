create table if not exists public.bubble_global_config (
  id text primary key,
  base_url text null,
  api_token text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.bubble_global_config enable row level security;

insert into public.bubble_global_config (id, base_url, api_token)
values ('global', 'https://api.app.cmvfacil.com', 'COLE_SEU_TOKEN_AQUI')
on conflict (id) do update set base_url = excluded.base_url, api_token = excluded.api_token, updated_at = now();

