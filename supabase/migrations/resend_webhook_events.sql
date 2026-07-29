create table if not exists public.resend_webhook_events (
  svix_id text primary key,
  svix_timestamp bigint not null,
  event_type text not null,
  email_id text null,
  received_at timestamptz not null default now()
);

alter table public.resend_webhook_events enable row level security;
