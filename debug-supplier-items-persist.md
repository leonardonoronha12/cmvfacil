[OPEN] Debug Session: supplier-items-persist

## Contexto
Sintoma: após salvar vínculos de itens em Fornecedores (modo compat), ao recarregar a página os fornecedores aparecem com 0 itens e/ou apenas o último item salvo permanece. Evidência prévia: `suppliers=47` e `supplier_items=5` para a empresa afetada.

Objetivo: provar por evidência onde ocorre a perda (payload parcial no client, wipe/clear indevido no POST, falha/rollback do upsert, ou leitura incorreta no GET) e aplicar correção mínima baseada em logs.

## Hipóteses (falsificáveis)
A) O client está enviando `produtosMap` parcial (por fornecedor), contendo só o item recém-editado; o backend persiste `raw.fornecedores.produtos` parcial e a sincronização de `supplier_items` reflete essa lista reduzida.

B) O client envia explicitamente `produtosMap[key]=[]` (intenção não explícita) para muitos fornecedores; o backend interpreta como “clear” e apaga `supplier_items` desses fornecedores.

C) O POST calcula `supplierProductsById`/`desiredRows` corretamente, mas o `upsert` em `supplier_items` falha (RLS/constraint/erro silencioso) e o endpoint ainda retorna `ok: true` (ou o erro é mascarado por algum fluxo).

D) O POST grava `supplier_items`, mas o GET compat não retorna os vínculos por falha na query/join/RLS (ex.: links existem, porém `select("supplier_id,item:items(name),supplier:suppliers(...)")` retorna vazio), levando a UI a exibir 0 itens.

E) Existe outro writer (legacy/fallback/autosave concorrente, multi-aba) sobrescrevendo `raw` e/ou reescrevendo `supplier_items` logo após um save.

## Instrumentação (planejada)
- POST /api/fornecedores (compat):
  - contagem de keys recebidas em `info/produtos/equivalencias`
  - distribuição de tamanhos de `produtos` por fornecedor (min/max e quantos com 0/1)
  - contagem de `supplierIdsForSync`, `desiredRows`, `supplierIdsToClear`, `missing.length`
  - resultado do upsert (erro vs sucesso)
- GET /api/fornecedores (compat):
  - `suppliersDb.length`, `linksDb.length`
  - quantos fornecedores retornaram produtos via `supplier_items` vs fallback `raw`

## Passo a passo de reprodução (local)
1) Abrir a tela de Fornecedores (modo compat).
2) Escolher 1 fornecedor e vincular 2–3 insumos (salvar).
3) Aguardar a sincronização terminar (toast ok).
4) Recarregar a página (F5).
5) Verificar se os itens permaneceram.

## Evidências
- Pre-fix logs: (a coletar)
- Post-fix logs: (a coletar)

