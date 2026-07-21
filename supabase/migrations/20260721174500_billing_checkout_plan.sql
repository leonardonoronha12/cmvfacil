do $$
begin
  alter table public.companies add column if not exists checkout_plan text;
end $$;

update public.companies
set checkout_plan = coalesce(checkout_plan, subscription_plan),
    subscription_plan = null,
    stripe_price_id = null,
    subscription_updated_at = now()
where checkout_status = 'open'
  and stripe_subscription_id is null
  and subscription_plan in ('pro_monthly', 'pro_yearly');

