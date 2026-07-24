create or replace function public.companies_set_trial_defaults()
returns trigger
language plpgsql
as $$
begin
  if new.trial_started_at is null and new.trial_ends_at is null and coalesce(new.subscription_status, '') = '' then
    new.trial_started_at = now();
    new.trial_ends_at = now() + interval '7 days';
    new.subscription_status = 'trial_internal';
    new.cancel_at_period_end = false;
    new.subscription_updated_at = now();
  end if;
  return new;
end;
$$;

update public.companies
set
  trial_ends_at = trial_started_at + interval '7 days',
  subscription_status = case when coalesce(subscription_status, '') = '' then 'trial_internal' else subscription_status end,
  subscription_updated_at = now()
where trial_started_at is not null
  and coalesce(stripe_subscription_id, '') = ''
  and (coalesce(subscription_status, '') = '' or subscription_status = 'trial_internal')
  and (
    trial_ends_at is null
    or trial_ends_at > trial_started_at + interval '7 days'
  );
