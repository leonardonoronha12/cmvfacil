create table if not exists public.debug_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  session_id text not null,
  run_id text not null,
  hypothesis_id text not null,
  trace_id uuid null,
  location text null,
  msg text not null,
  data jsonb not null default '{}'::jsonb,
  company_id uuid null,
  user_id uuid null
);

alter table public.debug_events enable row level security;

create index if not exists debug_events_session_created_at_idx
  on public.debug_events (session_id, created_at desc);

create index if not exists debug_events_company_created_at_idx
  on public.debug_events (company_id, created_at desc);

