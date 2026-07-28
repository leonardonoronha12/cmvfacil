[OPEN]

# Debug Session: suppliers-refresh-loss

## Objetivo
- Reproduzir (com conta de teste nova) o bug de “vínculos de fornecedores somem/zeram após F5/refresh” no mesmo fluxo.
- Coletar evidência (logs) sem tocar na conta `luisfelipeisrael7@gmail.com`.
- Identificar causa raiz, aplicar correção mínima e validar: cadastro, login, persistência após refresh.

## Hipóteses (falsificáveis)
1. **H1 — POST parcial (client)**: o client envia um payload incompleto (ex.: só o fornecedor editado), e o backend interpreta como “estado total”, limpando ou sobrescrevendo vínculos de outros fornecedores.
2. **H2 — Clear indevido (backend)**: a rotina de “clear” em compat roda com `supplierIdsToClear` errados (por chaves normalizadas/tombstones), removendo linhas em `supplier_items` que não deveria.
3. **H3 — GET inconsistente (backend/RLS)**: após salvar, o GET em compat retorna `linksDb=0` por seleção errada (companyId/userId) ou RLS, então a UI “parece” ter perdido tudo após refresh.
4. **H4 — Chaves instáveis (client/store)**: conversões `DB:<uuid>`, upper/lowercase, ou normalização removendo arrays vazios causam “sumir” itens na serialização/normalização após reload.
5. **H5 — Escrita concorrente**: outra aba/auto-save dispara um POST com estado antigo ou vazio logo após um POST correto, revertendo os vínculos.

## Plano de reprodução (produção)
- Criar conta de teste nova (email/senha) e logar.
- Criar 2–3 insumos.
- Criar 2 fornecedores e vincular itens.
- Fazer refresh (F5).
- Verificar se vínculos persistem.

## Evidências coletadas
- (preencher com IDs/trechos de logs do Debug Server e/ou `/api/debug/events-me`)

## Fix (após evidência)
- (somente após confirmar hipóteses com logs)

## Verificação pós-fix
- Cadastro → login → criar insumos → criar fornecedores → vincular → refresh.

