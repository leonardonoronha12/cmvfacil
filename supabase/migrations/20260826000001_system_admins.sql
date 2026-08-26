create table if not exists public.system_admins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  email text not null,
  name text null,
  active boolean not null default true,
  created_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists system_admins_email_lower_uidx
  on public.system_admins (lower(email));

alter table public.system_admins enable row level security;

revoke all on table public.system_admins from anon, authenticated;

