create table if not exists public.app_sessions (
  id uuid primary key default gen_random_uuid(),
  session_key text not null unique,
  user_id uuid,
  company_id uuid,
  started_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  ended_at timestamptz,
  page_views integer not null default 0,
  actions_count integer not null default 0,
  errors_count integer not null default 0,
  device_type text,
  browser text,
  os text,
  country text,
  region text,
  city text,
  ip_hash text,
  entry_route text,
  current_route text,
  referrer_host text,
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.app_events (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  session_key text not null,
  user_id uuid,
  company_id uuid,
  category text not null check (category in ('session','navigation','action','error','performance','system')),
  event_name text not null,
  route text,
  target text,
  success boolean,
  duration_ms integer,
  error_code text,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists app_sessions_last_seen_idx on public.app_sessions(last_seen_at desc);
create index if not exists app_sessions_user_idx on public.app_sessions(user_id, last_seen_at desc);
create index if not exists app_sessions_company_idx on public.app_sessions(company_id, last_seen_at desc);
create index if not exists app_events_created_idx on public.app_events(created_at desc);
create index if not exists app_events_user_idx on public.app_events(user_id, created_at desc);
create index if not exists app_events_company_idx on public.app_events(company_id, created_at desc);
create index if not exists app_events_category_idx on public.app_events(category, created_at desc);
create index if not exists app_events_session_idx on public.app_events(session_key, created_at desc);

alter table public.app_sessions enable row level security;
alter table public.app_events enable row level security;

create or replace function public.cleanup_app_observability(retention_days integer default 90)
returns table(events_deleted bigint, sessions_deleted bigint)
language plpgsql security definer set search_path = public
as $$
declare e bigint; s bigint;
begin
  delete from public.app_events where created_at < now() - make_interval(days => greatest(retention_days, 7));
  get diagnostics e = row_count;
  delete from public.app_sessions where last_seen_at < now() - make_interval(days => greatest(retention_days, 7));
  get diagnostics s = row_count;
  return query select e, s;
end;
$$;

revoke all on function public.cleanup_app_observability(integer) from public, anon, authenticated;
