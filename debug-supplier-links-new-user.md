[OPEN] Debug Session: supplier-links-new-user

## Objetivo
Reproduzir com uma conta de teste nova (sem tocar em `luisfelipeisrael7@gmail.com`) o problema de persistência de vínculos de Fornecedores (modo compat), identificar causa raiz por evidência e aplicar correção mínima.

## Hipóteses (falsificáveis)
A) O client envia `produtosMap[key]` parcial (apenas o item recém-vinculado), e o backend substitui `raw.fornecedores.produtos` por essa lista reduzida.

B) O client envia `produtosMap[key]=[]` para algum fornecedor (explicitamente) e o backend executa “clear” (delete) em `supplier_items` desse fornecedor.

C) O store `writeFornecedorProdutosMap` está sendo chamado com um objeto parcial (1 fornecedor), substituindo o mapa inteiro; o autosave então envia payload parcial e “apaga” o restante.

D) `supplier_items` é gravado, mas o GET compat retorna 0 vínculos por problema de query/join/RLS, e a UI mostra 0 itens.

E) Existe um segundo writer concorrente (multi-aba / outra tela como Entradas) que reescreve `produtosMap` e dispara autosave, sobrescrevendo logo após o save correto.

## Evidência necessária
- Logs do POST compat: tamanho de `produtosMap`, quantos fornecedores vieram com `produtosLen=0` ou `1`, e amostras das keys afetadas.
- Logs do planejamento: `supplierIdsForSync`, `desiredRows`, `supplierIdsToClear`.
- Logs do GET compat: `suppliersDb`, `linksDb`, `produtosKeys`.

## Reprodução (produção)
1) Criar nova conta (teste) e logar em https://cmvfacil.app
2) Criar 1–2 insumos.
3) Criar 1 fornecedor.
4) Vincular 2–3 insumos nesse fornecedor, salvar.
5) Atualizar (F5) e verificar se os itens persistem.

