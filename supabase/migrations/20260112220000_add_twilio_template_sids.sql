alter table public.automation_messages
  add column if not exists twilio_content_sids text null;

