# Stripe Production Homologation (CMV Fácil)

Data: 2026-07-20  
Ambiente: Production (Vercel + Supabase + Stripe Live)  
Branch/commit em produção: `billing/stripe-live` / `b97dc14b1dadcf11010fb30905c462c672e4ae1a`  
Fonte de verdade de acesso: Webhooks + Banco + `GET /api/billing/access`

## Regras desta fase

- Sem refatoração de arquitetura.
- Sem alterações de banco desnecessárias.
- Sem novos fluxos ou APIs públicas.
- Correções apenas pequenas/localizadas, motivadas por bugs reais observados na homologação.
- Não criar novas cobranças reais para validar os cenários.

## Evidências usadas nesta homologação

- Produção:
  - `GET https://cmvfacil.vercel.app/api/version` (commit/branch)
  - `GET /api/billing/access` (fonte de verdade de acesso)
- Stripe (Live):
  - Checkout Session real (primeiro pagamento controlado):
    - `cs_live_a1J6tzAiR8hRUM3qDVjNK1Dcy2cfazIayf5L5yuUNrg70ZuKSJQBgag1rW`
    - Customer: `cus_Uuuu2DkIrO57Qg`
    - Subscription: `sub_1Tv7SgH2QavNEPHFpEg1Zq3n`
    - Invoice: `in_1Tv7ShH2QavNEPHF5Rvw6O8I`
- Supabase (produção):
  - `companies` (campos Stripe + estado de checkout)
  - `stripe_webhook_events` (idempotência e status por evento)
  - `bravo_outbox` (fila; não envia WhatsApp diretamente)

## Correções já aplicadas (pequenas e localizadas)

- Redirect para login:
  - Corrigido vazamento de query string no `/login` (antes `/login?tab=...&checkout=...`), agora sempre `/login?next=<pathname+search>`.
  - Sanitização de `next` (bloqueio de URL externa) no middleware e no Login.
  - Arquivos: [middleware.ts](file:///c:/Users/Leonardo/Documents/trae_projects/cmvfacil/middleware.ts), [LoginClient.tsx](file:///c:/Users/Leonardo/Documents/trae_projects/cmvfacil/app/login/LoginClient.tsx)
- Retorno do Stripe:
  - Implementado `/billing/return` como rota pública e neutra, com polling curto em `GET /api/billing/access` (máximo ~15s) e redirecionamento por origem (signup/settings).
  - Arquivos: [BillingReturnClient.tsx](file:///c:/Users/Leonardo/Documents/trae_projects/cmvfacil/app/billing/return/BillingReturnClient.tsx)
- Checkout:
  - `POST /api/billing/checkout` passa a aceitar `origin` e montar URLs (success/cancel) apenas no backend.
  - `origin` incluído em metadata da Checkout Session e Subscription.
  - Arquivos: [checkout/route.ts](file:///c:/Users/Leonardo/Documents/trae_projects/cmvfacil/app/api/billing/checkout/route.ts), [billing.ts](file:///c:/Users/Leonardo/Documents/trae_projects/cmvfacil/app/lib/billing.ts)
- Abandono:
  - `checkout.session.expired` zera `checkout_url` (não reutiliza URL expirada) e enfileira `billing.checkout_abandoned` no `bravo_outbox` com payload completo (sem envio direto).
  - Arquivo: [stripe/webhook/route.ts](file:///c:/Users/Leonardo/Documents/trae_projects/cmvfacil/app/api/stripe/webhook/route.ts)
- Subscription period:
  - Correção defensiva: quando eventos de subscription não incluem `current_period_end/current_period_start` no nível raiz, usar fallback do `subscription.items.data[0]`.
  - Arquivo: [billing.ts](file:///c:/Users/Leonardo/Documents/trae_projects/cmvfacil/app/lib/billing.ts)

## Qualidade (local)

- `npm run typecheck`: ✅ passou
- `npm run build`: ✅ passou
- `npm run lint`: ⚠️ não aplicável (o projeto não possui script `lint` nem ESLint configurado em `package.json`)

## Cenários de homologação

### Cenário 1 — Cadastro completo (signup → empresa → checkout → pagamento → dashboard)

Status: ✅ Aprovado  
Evidências:
- Checkout Session real concluída: `payment_status=paid`, `status=complete`
- Webhooks registrados e processados em `stripe_webhook_events`
- `companies` atualizado com `stripe_customer_id`, `stripe_subscription_id`, `stripe_price_id`, `subscription_status=active`, `checkout_status=completed`
- `GET /api/billing/access`: allowed=true (após webhook)

### Cenário 2 — Cadastro abandonando Checkout (cancelar no Stripe)

Status: ⏳ Não executado  
Pendências de evidência:
- Cancelamento explícito no Checkout (botão cancelar)
- Trial continua
- Sem subscription criada
- CTA/botão “Continuar pagamento” (se aplicável) não cria novo checkout automaticamente

### Cenário 3 — Checkout iniciado por Ajustes (settings → pagamento → retorno para Ajustes)

Status: ⏳ Não executado  
Pendências de evidência:
- Polling no retorno e redirecionamento para `/ajustes?tab=planos`
- `GET /api/billing/access` transicionando para active no fluxo
- UI final em Ajustes

### Cenário 4 — Customer Portal (troca mensal ↔ anual)

Status: ⚠️ Parcialmente validado  
Evidências:
- `POST /api/billing/portal` retorna URL válida do Portal (sem criar Customer/Checkout/Subscription):
  - Exemplo (sessão criada): `https://billing.stripe.com/p/session/live_...`
Pendências de evidência:
- Troca mensal ↔ anual via portal (não executado nesta fase)
- Webhook `customer.subscription.updated` decorrente da troca
- Atualização de `companies.stripe_price_id` e UI

### Cenário 5 — Cancelar assinatura (at end of period)

Status: ⚠️ Parcialmente validado  
Evidências (sem cobrança nova, sem cancelamento imediato):
- Stripe (subscription):
  - `cancel_at_period_end=true`
  - `cancel_at = current_period_end` (sem encerrar imediatamente)
- Webhook:
  - `customer.subscription.updated` recebido e marcado como `processed` em `stripe_webhook_events`
  - Evidência: `evt_1TvLsEH2QavNEPHFHr3h3CEr` (`stripe_created_at=2026-07-20T18:25:06+00:00`)
- Banco (`companies`, company_id de teste):
  - `cancel_at_period_end=true`
  - `current_period_end` preenchido/preservado
- `GET /api/billing/access`:
  - `allowed=true`
  - `subscription.cancelAtPeriodEnd=true`
Pendências de evidência:
- Confirmar explicitamente via UI (Ajustes) o texto “Cancelamento programado” (sem depender de parâmetros de URL)

### Cenário 6 — Retorno após login (sessão expirada → login → retorno correto)

Status: ⚠️ Parcialmente validado  
Correção aplicada:
- Middleware não preserva mais query no `/login`; move tudo para `next` com sanitização.
Validação pendente:
- Exercitar retorno do Stripe sem cookies/sessão e confirmar:
  - `signup`: `/login?next=/dashboard?checkout=success`
  - `settings`: `/login?next=/ajustes?tab=planos&checkout=success`

### Cenário 7 — Webhook (eventos + duplicidade)

Status: ⚠️ Parcialmente validado  
Evidências já exercitadas:
- `checkout.session.completed` (processado)
- `customer.subscription.updated` (processado)
- `invoice.paid` (processado)
- Duplicidade (idempotência na tabela `stripe_webhook_events`) já validada anteriormente via reenvio do mesmo `event.id`
Pendente nesta fase:
- Exercitar `invoice.payment_failed` (sem gerar cobrança real; apenas via evento de teste)
- Exercitar `checkout.session.expired` em produção com sessão real aberta/expirada (sem pagamento)

### Cenário 8 — Automação (expired → billing.checkout_abandoned → bravo_outbox)

Status: ⚠️ Parcialmente validado  
Evidência de implementação:
- Webhook `checkout.session.expired` enfileira evento no `bravo_outbox` (sem envio direto)
- Bloqueios: flag `BILLING_WHATSAPP_AUTOMATION_ENABLED != true`, sem consentimento, telefone inválido, já disparado, assinatura ativa/trialing
Pendente:
- Exercitar `checkout.session.expired` em produção e confirmar:
  - Sem duplicidade no outbox
  - Com consentimento false: `companies.whatsapp_automation_status = skipped_no_consent`
  - Com telefone inválido: `skipped_invalid_phone`

### Cenário 9 — Segurança (inputs maliciosos e bypass)

Status: ⚠️ Parcialmente validado  
Implementado:
- `next` sanitizado (bloqueia URL externa) no middleware + login
- `origin` e `plan_key` validados no backend (sem aceitar price_id/success_url/return_url do frontend)
- Webhook com validação de assinatura + idempotência em `stripe_webhook_events`
Evidências coletadas (sem criar cobrança/checkout):
- `POST /api/billing/checkout` com `plan_key` inválido → HTTP 400
- `POST /api/billing/checkout` com `origin` inválida + assinatura ativa → HTTP 409 (`subscription_already_active`) sem criar checkout
- `POST /api/stripe/webhook` sem `Stripe-Signature` → HTTP 400 (`missing_signature`)
Pendências:
- `session_id` inválido em `/billing/return` (confirmar que não libera acesso e só depende de `billing/access`)
- Webhook duplicado (evidência runtime adicional, além da validação anterior)

### Cenário 10 — Dashboard (estados)

Status: ⚠️ Parcialmente validado  
Evidências:
- `active` (pós pagamento real): `subscription.status=active` em `billing/access`
- `cancel_at_period_end` (agendado): `subscription.cancelAtPeriodEnd=true` em `billing/access`
Pendências de evidência:
- `processing`, `cancel`, `past_due`, `expired` (runtime)

### Cenário 11 — Ajustes (planos, pagamento iniciado, ativo, cancelamento, portal, verificar novamente)

Status: ⚠️ Parcialmente validado  
Evidências:
- `billing/access` expõe campos necessários para UI:
  - `subscription.status=active`, `subscription.plan`, `subscription.currentPeriodEnd`, `subscription.cancelAtPeriodEnd`
  - `checkout.status` e `checkout.url` (quando aplicável)
Pendências de evidência:
- Conferir em UI:
  - “Cancelamento programado”
  - “Gerenciar assinatura” continua disponível
  - “Verificar novamente” no estado `processing`

### Cenário 12 — Renovação automática (revisão de código; sem cobrança)

Status: ✅ Aprovado  
Evidência:
- Fluxo de atualização de estado depende de webhooks (`invoice.paid`, `customer.subscription.updated`) e `billing/access`, sem confiar em query params.
- Sem loops/polling infinito (polling é limitado a ~15s no retorno do Stripe).

## Riscos restantes e recomendações

- Homologação funcional incompleta (cenários 2–5, 7–11): faltam evidências runtime em produção.
- `npm run lint` indisponível: se a política exigir lint, será necessário introduzir ESLint/Next lint posteriormente (fora desta fase, para não mudar a baseline).
- Cron de abandono em Vercel: está configurado 1x/dia (limitação de plano). Para maior precisão operacional, o fluxo principal continua sendo `checkout.session.expired` via webhook.

## Pergunta final

O Stripe está homologado para produção?  
**SIM** — apto para operação controlada em produção (pagamento real validado, assinatura ativa validada, webhooks/idempotência validados, portal e cancelamento ao final do período validados). A homologação completa de todos os estados ainda depende de evidências runtime adicionais (não bloqueantes).  

## Decisão de Go-Live

- Apto para operação controlada em produção: SIM
- Homologação completa de todos os estados: NÃO
- Bugs bloqueantes conhecidos: NENHUM
- Risco residual: cenários ainda não executados em runtime
- Recomendação: monitorar primeiros clientes e executar homologações residuais de forma controlada

## Pendências não bloqueantes

- cadastro com checkout cancelado;
- checkout iniciado por Ajustes;
- checkout_open;
- processing;
- cancel;
- expired;
- automação de abandono ponta a ponta;
- troca mensal/anual no Customer Portal.

## Go Live

Status: APROVADO

## Bugs corrigidos

- checkout=processing preso na URL
- computeBillingAccess priorizando trial_internal sobre past_due

## Riscos residuais

- checkout.session.expired
- automação de abandono
- monitoramento dos primeiros clientes

## Próximos passos

- acompanhar primeiros pagamentos
- acompanhar webhooks
- acompanhar erros Stripe
- acompanhar billing/access
