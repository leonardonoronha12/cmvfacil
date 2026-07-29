create table if not exists public.resend_webhook_events (
  svix_id text primary key,
  svix_timestamp bigint not null,
  event_type text not null,
  email_id text null,
  status text null,
  payload_summary jsonb null,
  error_message text null,
  received_at timestamptz not null default now(),
  processed_at timestamptz null
);

alter table public.resend_webhook_events enable row level security;

create index if not exists resend_webhook_events_email_id_idx on public.resend_webhook_events(email_id);
create index if not exists resend_webhook_events_event_type_idx on public.resend_webhook_events(event_type);
