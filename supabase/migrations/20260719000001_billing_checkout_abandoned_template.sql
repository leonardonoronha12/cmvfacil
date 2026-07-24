insert into public.automation_messages (event_type, whatsapp_body)
values (
  'billing.checkout_abandoned',
  'Olá, {{nome}}! Vimos que você ainda não concluiu sua assinatura do CMV Fácil. Seu acesso gratuito continua disponível por 30 dias. Para ativar o Plano PRO, conclua por aqui: {{checkout_url}}'
)
on conflict (event_type) do nothing;
