alter table public.bubble_obj_import_control drop constraint if exists bubble_obj_import_control_bubble_object_type_bubble_unique_id_key;
create unique index if not exists bubble_obj_import_control_unique_per_user
on public.bubble_obj_import_control (supabase_user_id, bubble_object_type, bubble_unique_id);

alter table public.bubble_obj_import_staging drop constraint if exists bubble_obj_import_staging_bubble_object_type_bubble_unique_id_key;
create unique index if not exists bubble_obj_import_staging_unique_per_user
on public.bubble_obj_import_staging (supabase_user_id, bubble_object_type, bubble_unique_id);

create table if not exists public.bubble_obj_user_migration (
  supabase_user_id uuid primary key,
  email text not null default '',
  bubble_user_id text not null default '',
  status text not null default 'not_started',
  last_run_id uuid null,
  last_attempt_at timestamptz null,
  completed_at timestamptz null,
  last_error text not null default '',
  total_received int not null default 0,
  total_saved_staging int not null default 0,
  total_duplicate_ignored int not null default 0,
  total_pending_review int not null default 0,
  total_error int not null default 0,
  total_processed int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bubble_obj_user_migration_status_check
    check (status in ('not_started','running','completed','failed','pending_review'))
);

drop trigger if exists bubble_obj_user_migration_set_updated_at on public.bubble_obj_user_migration;
create trigger bubble_obj_user_migration_set_updated_at
before update on public.bubble_obj_user_migration
for each row execute function public.set_updated_at();

create table if not exists public.bubble_obj_user_migration_attempt (
  id uuid primary key default gen_random_uuid(),
  supabase_user_id uuid not null,
  email text not null default '',
  bubble_user_id text not null default '',
  run_id uuid null,
  status text not null default 'running',
  error_message text not null default '',
  started_at timestamptz not null default now(),
  finished_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bubble_obj_user_migration_attempt_status_check
    check (status in ('running','completed','failed','pending_review'))
);

drop trigger if exists bubble_obj_user_migration_attempt_set_updated_at on public.bubble_obj_user_migration_attempt;
create trigger bubble_obj_user_migration_attempt_set_updated_at
before update on public.bubble_obj_user_migration_attempt
for each row execute function public.set_updated_at();

create index if not exists bubble_obj_user_migration_attempt_user_idx on public.bubble_obj_user_migration_attempt (supabase_user_id, started_at desc);

create table if not exists public.bubble_obj_empresa (
  id uuid primary key default gen_random_uuid(),
  supabase_user_id uuid not null,
  bubble_unique_id text not null,
  bubble_user_id text not null default '',
  nome text not null default '',
  normalized jsonb null,
  raw_payload_json jsonb null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (supabase_user_id, bubble_unique_id)
);

drop trigger if exists bubble_obj_empresa_set_updated_at on public.bubble_obj_empresa;
create trigger bubble_obj_empresa_set_updated_at
before update on public.bubble_obj_empresa
for each row execute function public.set_updated_at();

create table if not exists public.bubble_obj_cliente (
  id uuid primary key default gen_random_uuid(),
  supabase_user_id uuid not null,
  bubble_unique_id text not null,
  empresa_id text not null default '',
  nome text not null default '',
  normalized jsonb null,
  raw_payload_json jsonb null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (supabase_user_id, bubble_unique_id)
);

drop trigger if exists bubble_obj_cliente_set_updated_at on public.bubble_obj_cliente;
create trigger bubble_obj_cliente_set_updated_at
before update on public.bubble_obj_cliente
for each row execute function public.set_updated_at();

create table if not exists public.bubble_obj_veiculo (
  id uuid primary key default gen_random_uuid(),
  supabase_user_id uuid not null,
  bubble_unique_id text not null,
  cliente_id text not null default '',
  placa text not null default '',
  normalized jsonb null,
  raw_payload_json jsonb null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (supabase_user_id, bubble_unique_id)
);

drop trigger if exists bubble_obj_veiculo_set_updated_at on public.bubble_obj_veiculo;
create trigger bubble_obj_veiculo_set_updated_at
before update on public.bubble_obj_veiculo
for each row execute function public.set_updated_at();

create table if not exists public.bubble_obj_ordem_servico (
  id uuid primary key default gen_random_uuid(),
  supabase_user_id uuid not null,
  bubble_unique_id text not null,
  cliente_id text not null default '',
  veiculo_id text not null default '',
  normalized jsonb null,
  raw_payload_json jsonb null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (supabase_user_id, bubble_unique_id)
);

drop trigger if exists bubble_obj_ordem_servico_set_updated_at on public.bubble_obj_ordem_servico;
create trigger bubble_obj_ordem_servico_set_updated_at
before update on public.bubble_obj_ordem_servico
for each row execute function public.set_updated_at();

create table if not exists public.bubble_obj_financeiro (
  id uuid primary key default gen_random_uuid(),
  supabase_user_id uuid not null,
  bubble_unique_id text not null,
  ordem_servico_id text not null default '',
  normalized jsonb null,
  raw_payload_json jsonb null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (supabase_user_id, bubble_unique_id)
);

drop trigger if exists bubble_obj_financeiro_set_updated_at on public.bubble_obj_financeiro;
create trigger bubble_obj_financeiro_set_updated_at
before update on public.bubble_obj_financeiro
for each row execute function public.set_updated_at();

create table if not exists public.bubble_obj_anexo (
  id uuid primary key default gen_random_uuid(),
  supabase_user_id uuid not null,
  bubble_unique_id text not null,
  parent_id text not null default '',
  url text not null default '',
  normalized jsonb null,
  raw_payload_json jsonb null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (supabase_user_id, bubble_unique_id)
);

drop trigger if exists bubble_obj_anexo_set_updated_at on public.bubble_obj_anexo;
create trigger bubble_obj_anexo_set_updated_at
before update on public.bubble_obj_anexo
for each row execute function public.set_updated_at();

alter table public.bubble_obj_user_migration enable row level security;
alter table public.bubble_obj_user_migration_attempt enable row level security;
alter table public.bubble_obj_empresa enable row level security;
alter table public.bubble_obj_cliente enable row level security;
alter table public.bubble_obj_veiculo enable row level security;
alter table public.bubble_obj_ordem_servico enable row level security;
alter table public.bubble_obj_financeiro enable row level security;
alter table public.bubble_obj_anexo enable row level security;

drop policy if exists bubble_obj_user_migration_select_own on public.bubble_obj_user_migration;
create policy bubble_obj_user_migration_select_own
on public.bubble_obj_user_migration
for select
to authenticated
using (supabase_user_id = auth.uid());

drop policy if exists bubble_obj_user_migration_attempt_select_own on public.bubble_obj_user_migration_attempt;
create policy bubble_obj_user_migration_attempt_select_own
on public.bubble_obj_user_migration_attempt
for select
to authenticated
using (supabase_user_id = auth.uid());

drop policy if exists bubble_obj_empresa_select_own on public.bubble_obj_empresa;
create policy bubble_obj_empresa_select_own
on public.bubble_obj_empresa
for select
to authenticated
using (supabase_user_id = auth.uid());

drop policy if exists bubble_obj_cliente_select_own on public.bubble_obj_cliente;
create policy bubble_obj_cliente_select_own
on public.bubble_obj_cliente
for select
to authenticated
using (supabase_user_id = auth.uid());

drop policy if exists bubble_obj_veiculo_select_own on public.bubble_obj_veiculo;
create policy bubble_obj_veiculo_select_own
on public.bubble_obj_veiculo
for select
to authenticated
using (supabase_user_id = auth.uid());

drop policy if exists bubble_obj_ordem_servico_select_own on public.bubble_obj_ordem_servico;
create policy bubble_obj_ordem_servico_select_own
on public.bubble_obj_ordem_servico
for select
to authenticated
using (supabase_user_id = auth.uid());

drop policy if exists bubble_obj_financeiro_select_own on public.bubble_obj_financeiro;
create policy bubble_obj_financeiro_select_own
on public.bubble_obj_financeiro
for select
to authenticated
using (supabase_user_id = auth.uid());

drop policy if exists bubble_obj_anexo_select_own on public.bubble_obj_anexo;
create policy bubble_obj_anexo_select_own
on public.bubble_obj_anexo
for select
to authenticated
using (supabase_user_id = auth.uid());

