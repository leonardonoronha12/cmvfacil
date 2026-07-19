create table if not exists public.stripe_webhook_events (
  id uuid primary key default gen_random_uuid(),
  stripe_event_id text not null,
  event_type text not null,
  stripe_created_at timestamptz null,
  processed_at timestamptz not null default now(),
  company_id uuid null,
  status text not null,
  error_message text null,
  payload_summary jsonb null
);

create unique index if not exists stripe_webhook_events_stripe_event_id_uidx
  on public.stripe_webhook_events (stripe_event_id);

create index if not exists stripe_webhook_events_company_id_idx
  on public.stripe_webhook_events (company_id);
