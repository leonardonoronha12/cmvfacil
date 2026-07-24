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
set trial_ends_at = trial_started_at + interval '7 days'
where subscription_status = 'trial_internal'
  and trial_started_at is not null
  and coalesce(stripe_subscription_id, '') = ''
  and (
    trial_ends_at is null
    or trial_ends_at > trial_started_at + interval '7 days'
  );

update public.automation_messages
set whatsapp_body = 'Olá, {{nome}}! Vimos que você ainda não concluiu sua assinatura do CMV Fácil. Seu acesso gratuito continua disponível por 7 dias. Para ativar o Plano PRO, conclua por aqui: {{checkout_url}}'
where event_type = 'billing.checkout_abandoned';

