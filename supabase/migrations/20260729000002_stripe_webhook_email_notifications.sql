alter table if exists public.stripe_webhook_events
  add column if not exists email_notification_type text null;

alter table if exists public.stripe_webhook_events
  add column if not exists email_notification_status text null;

alter table if exists public.stripe_webhook_events
  add column if not exists email_notification_error text null;

alter table if exists public.stripe_webhook_events
  add column if not exists resend_email_id text null;

