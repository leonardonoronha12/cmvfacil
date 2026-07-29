create table if not exists public.auth_rate_limits (
  key text not null,
  bucket timestamptz not null,
  count integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (key, bucket)
);

alter table public.auth_rate_limits enable row level security;

create or replace function public.auth_check_rate_limit(p_key text, p_window_seconds integer, p_max integer)
returns jsonb
language plpgsql
security definer
as $$
declare
  bucket_ts timestamptz;
  c integer;
begin
  if p_key is null or btrim(p_key) = '' then
    return jsonb_build_object('allowed', true);
  end if;

  if p_window_seconds is null or p_window_seconds <= 0 then
    return jsonb_build_object('allowed', true);
  end if;

  bucket_ts := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);

  insert into public.auth_rate_limits(key, bucket, count)
  values (p_key, bucket_ts, 1)
  on conflict (key, bucket) do update set count = public.auth_rate_limits.count + 1;

  select count into c from public.auth_rate_limits where key = p_key and bucket = bucket_ts;

  return jsonb_build_object('allowed', c <= p_max);
end;
$$;

revoke all on function public.auth_check_rate_limit(text, integer, integer) from public;
grant execute on function public.auth_check_rate_limit(text, integer, integer) to service_role;
