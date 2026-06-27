alter table public.bubble_obj_user_migration
add column if not exists per_type_stats jsonb null;

alter table public.bubble_obj_user_migration
add column if not exists validation_status text not null default 'not_started';

alter table public.bubble_obj_user_migration
add column if not exists validation_report jsonb null;

alter table public.bubble_obj_user_migration
add column if not exists validated_at timestamptz null;

alter table public.bubble_obj_user_migration
drop constraint if exists bubble_obj_user_migration_validation_status_check;

alter table public.bubble_obj_user_migration
add constraint bubble_obj_user_migration_validation_status_check
check (validation_status in ('not_started','running','validated','divergent','skipped','failed'));

alter table public.bubble_obj_user_migration_attempt
add column if not exists duration_ms int not null default 0;

alter table public.bubble_obj_user_migration_attempt
add column if not exists per_type_stats jsonb null;

alter table public.bubble_obj_user_migration_attempt
add column if not exists validation_status text not null default 'not_started';

alter table public.bubble_obj_user_migration_attempt
add column if not exists validation_report jsonb null;

alter table public.bubble_obj_user_migration_attempt
add column if not exists validated_at timestamptz null;

alter table public.bubble_obj_user_migration_attempt
drop constraint if exists bubble_obj_user_migration_attempt_validation_status_check;

alter table public.bubble_obj_user_migration_attempt
add constraint bubble_obj_user_migration_attempt_validation_status_check
check (validation_status in ('not_started','running','validated','divergent','skipped','failed'));

create index if not exists bubble_obj_user_migration_validation_idx
on public.bubble_obj_user_migration (validation_status, validated_at desc);
