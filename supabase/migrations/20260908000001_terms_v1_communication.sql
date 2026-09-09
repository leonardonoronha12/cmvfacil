create table if not exists public.legal_communication_deliveries (
  id uuid primary key default gen_random_uuid(),
  campaign_key text not null,
  user_id uuid not null references auth.users(id),
  recipient_email text not null,
  content_sha256 text not null,
  status text not null default 'pending' check (status in ('pending','sent','delivered','delivery_delayed','bounced','failed')),
  resend_email_id text,
  error_message text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  delivered_at timestamptz,
  bounced_at timestamptz,
  last_event_at timestamptz,
  unique(campaign_key, recipient_email),
  unique(resend_email_id)
);
create index if not exists legal_communication_campaign_status_idx
  on public.legal_communication_deliveries(campaign_key, status);
alter table public.legal_communication_deliveries enable row level security;
