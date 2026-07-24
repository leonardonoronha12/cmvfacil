[OPEN] Debug session: fornecedores-delete-persist

## Sintoma (reportado)
- Ao excluir um fornecedor: total cai (ex.: 57 -> 56)
- Após recarregar (F5): volta (ex.: 56 -> 57)
- Registros técnicos `DB:...` reaparecem e ganham itens vinculados
- Impacto: duplicação/corrupção de fornecedores e entradas ao continuar a migração

## Ambiente
- Produção: https://www.cmvfacil.app
- Branch: billing/stripe-live

## Hipóteses (falsificáveis)
- A) Produção não está com o código corrigido (deploy/promoção não aplicada), então o comportamento continua antigo.
- B) A rota `/api/fornecedores` está usando modo compat, mas o Supabase está retornando erro (RLS/permissões) em `delete`/`update`, e a UI não está refletindo corretamente a falha.
- C) A deleção está gravando tombstone, mas o tombstone não está sendo persistido/recuperado (perdido entre POST e GET), então no reload o supplier volta.
- D) Algum processo de sincronização/import reintroduz fornecedores após deleção.

## Evidências coletadas
- E1) `/api/version` em produção aponta commit `671be9b` (billing/stripe-live), indicando que as correções recentes de fornecedores podem não estar em produção.

## Próximo passo
- Confirmar se o deploy de produção inclui as mudanças de fornecedores (commit SHA/versão).
- Se já estiver incluído e o bug persistir, instrumentar `/api/fornecedores` (GET/POST) com logs via Debug Server para capturar: modo (legacy/compat), tombstones, deleteIds e erros do Supabase.

