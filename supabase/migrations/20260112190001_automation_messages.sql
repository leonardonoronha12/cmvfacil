create table if not exists public.automation_messages (
  id uuid primary key default gen_random_uuid(),
  event_type text not null unique,
  email_subject text null,
  email_body text null,
  whatsapp_body text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists automation_messages_set_updated_at on public.automation_messages;
create trigger automation_messages_set_updated_at
before update on public.automation_messages
for each row execute function public.set_updated_at();

alter table public.automation_messages enable row level security;
