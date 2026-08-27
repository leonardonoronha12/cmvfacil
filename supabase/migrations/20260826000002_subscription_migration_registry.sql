create table if not exists public.subscription_migration_registry (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  source text not null default 'manual_transfer',
  migrated_at timestamptz not null default now(),
  notes text null,
  created_at timestamptz not null default now()
);

create unique index if not exists subscription_migration_registry_email_lower_uidx
  on public.subscription_migration_registry (lower(email));

alter table public.subscription_migration_registry enable row level security;
revoke all on table public.subscription_migration_registry from anon, authenticated;

insert into public.subscription_migration_registry (email, source, notes)
values
  ('alexandreocouto@gmail.com', 'manual_transfer', 'Assinatura transferida para o sistema novo'),
  ('bharzin.contato@gmail.com', 'manual_transfer', 'Assinatura transferida para o sistema novo'),
  ('riorootsmacae@gmail.com', 'manual_transfer', 'Assinatura transferida para o sistema novo'),
  ('imperatrizquintal@gmail.com', 'manual_transfer', 'Assinatura transferida para o sistema novo'),
  ('bardrinkimperatriz@gmail.com', 'manual_transfer', 'Assinatura transferida para o sistema novo'),
  ('coffeebreakquintal@gmail.com', 'manual_transfer', 'Assinatura transferida para o sistema novo'),
  ('filhaopizza@gmail.com', 'manual_transfer', 'Assinatura transferida para o sistema novo'),
  ('manoabeachclub@gmail.com', 'manual_transfer', 'Assinatura transferida para o sistema novo'),
  ('goldburgersv@gmail.com', 'manual_transfer', 'Assinatura transferida para o sistema novo'),
  ('rubensmitsuo@hotmail.com', 'manual_transfer', 'Assinatura transferida para o sistema novo'),
  ('rioroots.macae@gmail.com', 'manual_transfer', 'Assinatura transferida para o sistema novo'),
  ('bendittosforneria@gmail.com', 'manual_transfer', 'Assinatura transferida para o sistema novo')
on conflict ((lower(email))) do update
set source = excluded.source,
    notes = excluded.notes;
