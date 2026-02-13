create extension if not exists pg_cron;
create extension if not exists pg_net;

create table if not exists public.app_secrets (
  name text primary key,
  secret text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists app_secrets_set_updated_at on public.app_secrets;
create trigger app_secrets_set_updated_at
before update on public.app_secrets
for each row execute function public.set_updated_at();

alter table public.app_secrets enable row level security;

create or replace function public.get_app_secret(p_name text)
returns text
language sql
security definer
as $$
  select secret
  from public.app_secrets
  where name = p_name
  limit 1;
$$;

do $$
declare
  v_secret text;
begin
  if not exists (select 1 from public.app_secrets where name = 'sync_worker_secret') then
    v_secret := encode(gen_random_bytes(32), 'base64');
    v_secret := regexp_replace(replace(replace(v_secret, '+', '-'), '/', '_'), '=', '', 'g');
    insert into public.app_secrets (name, secret) values ('sync_worker_secret', v_secret);
  end if;
end;
$$;

do $$
declare
  v_exists boolean;
begin
  select exists(select 1 from cron.job where jobname = 'sync-bravo-every-minute') into v_exists;

  if not v_exists then
    perform cron.schedule(
      'sync-bravo-every-minute',
      '* * * * *',
      $cmd$
      select
        net.http_post(
          url := 'https://erbxmgvrdxqfvrejbsrt.supabase.co/functions/v1/sync-bravo',
          headers := jsonb_build_object(
            'content-type', 'application/json',
            'x-worker-secret', public.get_app_secret('sync_worker_secret')
          ),
          body := '{}'::jsonb
        );
      $cmd$
    );
  end if;
end;
$$;
