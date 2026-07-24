# Debug Session: billing-missing-subscription
- **Status**: [OPEN]
- **Issue**: Cliente assinou (Stripe), mas o app mostra "sem assinatura"; insumos não aparecem; erro ao salvar fornecedores_state.
- **Environment**: Production (cmvfacil.app) + Supabase + Stripe

## Repro (relato)
1) Cliente conclui checkout do Stripe.
2) Ao voltar para o app, tela Planos mostra "Sem assinatura".
3) Telas de dados (ex.: Insumos) não carregam.
4) Toast: "Não foi possível salvar fornecedores no Supabase... fornecedores_state ... (/setup-supabase)".

## Evidence Log Pointers
- A coletar: status/metadata do Checkout Session + Subscription no Stripe.
- A coletar: snapshot da linha da empresa em `companies` (subscription_status, stripe_subscription_id, trial_*).
- A coletar: resposta de `/api/billing/access` e `/api/me` para o usuário afetado.

## Evidence (coletada)
- Supabase remoto estava com **histórico de migrations divergente** do repositório (versões remotas 20260629/20260701/20260706 não existiam localmente). Isso bloqueava `supabase db push`.
- Foi feito alinhamento adicionando placeholders locais e executado `supabase db push` com sucesso, aplicando:
  - 20260707000000_external_key.sql
  - 20260719000000_billing_company_fields.sql
  - 20260719000001_billing_checkout_abandoned_template.sql
  - 20260719000002_stripe_webhook_events.sql
  - 20260721174500_billing_checkout_plan.sql
  - 20260723000000_trial_7_days.sql

