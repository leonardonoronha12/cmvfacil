do $$
begin
  alter table public.companies add column if not exists stripe_customer_id text;
  alter table public.companies add column if not exists stripe_subscription_id text;
  alter table public.companies add column if not exists stripe_price_id text;
  alter table public.companies add column if not exists subscription_status text;
  alter table public.companies add column if not exists subscription_plan text;
  alter table public.companies add column if not exists trial_started_at timestamptz;
  alter table public.companies add column if not exists trial_ends_at timestamptz;
  alter table public.companies add column if not exists current_period_start timestamptz;
  alter table public.companies add column if not exists current_period_end timestamptz;
  alter table public.companies add column if not exists cancel_at_period_end boolean default false;
  alter table public.companies add column if not exists subscription_updated_at timestamptz;
  alter table public.companies add column if not exists stripe_checkout_session_id text;
  alter table public.companies add column if not exists checkout_status text;
  alter table public.companies add column if not exists checkout_started_at timestamptz;
  alter table public.companies add column if not exists checkout_abandoned_at timestamptz;
  alter table public.companies add column if not exists checkout_url text;
  alter table public.companies add column if not exists whatsapp_automation_triggered_at timestamptz;
  alter table public.companies add column if not exists whatsapp_automation_status text;
  alter table public.companies add column if not exists billing_last_event_id text;
  alter table public.companies add column if not exists billing_last_event_created_at timestamptz;
end $$;

create index if not exists companies_stripe_customer_id_idx on public.companies (stripe_customer_id);
create index if not exists companies_stripe_subscription_id_idx on public.companies (stripe_subscription_id);
create index if not exists companies_stripe_checkout_session_id_idx on public.companies (stripe_checkout_session_id);

create or replace function public.companies_set_trial_defaults()
returns trigger
language plpgsql
as $$
begin
  if new.trial_started_at is null and new.trial_ends_at is null and coalesce(new.subscription_status, '') = '' then
    new.trial_started_at = now();
    new.trial_ends_at = now() + interval '30 days';
    new.subscription_status = 'trial_internal';
    new.cancel_at_period_end = false;
    new.subscription_updated_at = now();
  end if;
  return new;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'companies_set_trial_defaults') then
    create trigger companies_set_trial_defaults
    before insert on public.companies
    for each row execute function public.companies_set_trial_defaults();
  end if;
end $$;
