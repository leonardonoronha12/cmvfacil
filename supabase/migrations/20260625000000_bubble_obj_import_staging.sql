create table if not exists public.bubble_obj_user_map (
  bubble_user_id text primary key,
  email text null,
  nome text null,
  supabase_user_id uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists bubble_obj_user_map_set_updated_at on public.bubble_obj_user_map;
create trigger bubble_obj_user_map_set_updated_at
before update on public.bubble_obj_user_map
for each row execute function public.set_updated_at();

create table if not exists public.bubble_obj_import_control (
  id uuid primary key default gen_random_uuid(),
  bubble_object_type text not null,
  bubble_unique_id text not null,
  bubble_user_id text null,
  supabase_user_id uuid null,
  status text not null default 'staged',
  error_message text not null default '',
  imported_at timestamptz null,
  raw_payload_json jsonb null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (bubble_object_type, bubble_unique_id)
);

drop trigger if exists bubble_obj_import_control_set_updated_at on public.bubble_obj_import_control;
create trigger bubble_obj_import_control_set_updated_at
before update on public.bubble_obj_import_control
for each row execute function public.set_updated_at();

create index if not exists bubble_obj_import_control_user_idx on public.bubble_obj_import_control (supabase_user_id, bubble_object_type);
create index if not exists bubble_obj_import_control_bubble_user_idx on public.bubble_obj_import_control (bubble_user_id, bubble_object_type);

create table if not exists public.bubble_obj_import_staging (
  id uuid primary key default gen_random_uuid(),
  bubble_object_type text not null,
  bubble_unique_id text not null,
  bubble_user_id text null,
  supabase_user_id uuid null,
  run_id uuid null,
  cursor int not null default 0,
  fetched_at timestamptz not null default now(),
  status text not null default 'staged',
  error_message text not null default '',
  raw_payload_json jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (bubble_object_type, bubble_unique_id)
);

drop trigger if exists bubble_obj_import_staging_set_updated_at on public.bubble_obj_import_staging;
create trigger bubble_obj_import_staging_set_updated_at
before update on public.bubble_obj_import_staging
for each row execute function public.set_updated_at();

create index if not exists bubble_obj_import_staging_run_idx on public.bubble_obj_import_staging (run_id, bubble_object_type);
create index if not exists bubble_obj_import_staging_user_idx on public.bubble_obj_import_staging (supabase_user_id, bubble_object_type);

create table if not exists public.bubble_obj_import_checkpoint (
  id uuid primary key default gen_random_uuid(),
  user_email text not null default '',
  bubble_user_id text not null,
  supabase_user_id uuid null,
  object_type text not null,
  last_cursor int not null default 0,
  total_imported int not null default 0,
  status text not null default 'pending',
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (bubble_user_id, object_type, supabase_user_id)
);

drop trigger if exists bubble_obj_import_checkpoint_set_updated_at on public.bubble_obj_import_checkpoint;
create trigger bubble_obj_import_checkpoint_set_updated_at
before update on public.bubble_obj_import_checkpoint
for each row execute function public.set_updated_at();

create index if not exists bubble_obj_import_checkpoint_status_idx on public.bubble_obj_import_checkpoint (supabase_user_id, status, object_type);

create table if not exists public.bubble_obj_import_run (
  id uuid primary key default gen_random_uuid(),
  triggered_by_supabase_user_id uuid null,
  status text not null default 'running',
  base_url text not null default '',
  batch_limit int not null default 100,
  started_at timestamptz not null default now(),
  finished_at timestamptz null,
  summary jsonb null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists bubble_obj_import_run_set_updated_at on public.bubble_obj_import_run;
create trigger bubble_obj_import_run_set_updated_at
before update on public.bubble_obj_import_run
for each row execute function public.set_updated_at();

create table if not exists public.bubble_obj_import_run_item (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.bubble_obj_import_run(id) on delete cascade,
  bubble_user_id text not null,
  supabase_user_id uuid null,
  object_type text not null,
  status text not null default 'running',
  last_cursor int not null default 0,
  total_expected int not null default 0,
  total_received int not null default 0,
  total_saved_staging int not null default 0,
  total_processed int not null default 0,
  total_duplicate_ignored int not null default 0,
  total_error int not null default 0,
  total_pending_review int not null default 0,
  last_error text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (run_id, bubble_user_id, object_type, supabase_user_id)
);

drop trigger if exists bubble_obj_import_run_item_set_updated_at on public.bubble_obj_import_run_item;
create trigger bubble_obj_import_run_item_set_updated_at
before update on public.bubble_obj_import_run_item
for each row execute function public.set_updated_at();

alter table public.bubble_obj_user_map enable row level security;
alter table public.bubble_obj_import_control enable row level security;
alter table public.bubble_obj_import_staging enable row level security;
alter table public.bubble_obj_import_checkpoint enable row level security;
alter table public.bubble_obj_import_run enable row level security;
alter table public.bubble_obj_import_run_item enable row level security;

