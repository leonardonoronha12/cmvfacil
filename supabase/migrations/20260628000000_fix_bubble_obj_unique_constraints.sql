do $$
declare
  r record;
begin
  for r in
    select
      n.nspname as schema_name,
      t.relname as table_name,
      c.conname as constraint_name
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname in ('bubble_obj_import_control','bubble_obj_import_staging')
      and c.contype = 'u'
      and not exists (
        select 1
        from unnest(c.conkey) as k(attnum)
        join pg_attribute a on a.attrelid = t.oid and a.attnum = k.attnum
        where a.attname = 'supabase_user_id'
      )
      and exists (
        select 1
        from unnest(c.conkey) as k(attnum)
        join pg_attribute a on a.attrelid = t.oid and a.attnum = k.attnum
        where a.attname = 'bubble_object_type'
      )
      and exists (
        select 1
        from unnest(c.conkey) as k(attnum)
        join pg_attribute a on a.attrelid = t.oid and a.attnum = k.attnum
        where a.attname = 'bubble_unique_id'
      )
  loop
    execute format('alter table %I.%I drop constraint if exists %I', r.schema_name, r.table_name, r.constraint_name);
  end loop;
end $$;

do $$
declare
  r record;
begin
  for r in
    select
      ni.nspname as index_schema,
      i.relname as index_name
    from pg_index ix
    join pg_class i on i.oid = ix.indexrelid
    join pg_class t on t.oid = ix.indrelid
    join pg_namespace nt on nt.oid = t.relnamespace
    join pg_namespace ni on ni.oid = i.relnamespace
    where nt.nspname = 'public'
      and t.relname in ('bubble_obj_import_control','bubble_obj_import_staging')
      and ix.indisunique = true
      and not exists (
        select 1
        from unnest(ix.indkey) as k(attnum)
        join pg_attribute a on a.attrelid = t.oid and a.attnum = k.attnum
        where a.attname = 'supabase_user_id'
      )
      and exists (
        select 1
        from unnest(ix.indkey) as k(attnum)
        join pg_attribute a on a.attrelid = t.oid and a.attnum = k.attnum
        where a.attname = 'bubble_object_type'
      )
      and exists (
        select 1
        from unnest(ix.indkey) as k(attnum)
        join pg_attribute a on a.attrelid = t.oid and a.attnum = k.attnum
        where a.attname = 'bubble_unique_id'
      )
  loop
    execute format('drop index if exists %I.%I', r.index_schema, r.index_name);
  end loop;
end $$;

create unique index if not exists bubble_obj_import_control_unique_per_user
on public.bubble_obj_import_control (supabase_user_id, bubble_object_type, bubble_unique_id);

create unique index if not exists bubble_obj_import_staging_unique_per_user
on public.bubble_obj_import_staging (supabase_user_id, bubble_object_type, bubble_unique_id);

create index if not exists bubble_obj_import_staging_bubble_user_idx
on public.bubble_obj_import_staging (supabase_user_id, bubble_user_id, bubble_object_type);
