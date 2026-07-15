[OPEN] Debug Session: lista-compras-estoque-zero

## Sintoma
- Lista de Compras mostra "Estoque Final" = 0,000 para todos os itens, mesmo existindo inventário com quantidades preenchidas (ex.: 27/04/2026).

## Hipóteses (falsificáveis)
1) A API `/api/lista-de-compras` está carregando `inventory_items` vazios/zerados para o inventário final selecionado (erro de consulta/IDs/company_id).
2) O inventário final selecionado na Lista não corresponde ao inventário “contabilizado” esperado (endInventoryId/data divergentes).
3) O fallback para inventário legacy (`inventario`) não encontra a data (formato/parse de `data` diferente, timezone, ou não existe linha exatamente no mesmo dia).
4) As quantidades existem, mas estão em campos/formatos não cobertos pelo parser (ex.: strings com unidade, campos alternativos dentro de `raw`).
5) O frontend está exibindo 0 por causa de algum overwrite pós-resposta (ex.: transformação/parse no client), apesar da API já retornar valores > 0.

## Plano de evidências
- Instrumentar `/api/lista-de-compras` para retornar um bloco `diag` quando `?diag=1` (sem PII), contendo:
  - source (compat/legacy), start/end inventory ids e datas derivadas
  - contagens: inventories carregados, inventory_items carregados, tamanhos dos maps
  - status do fallback legacy (rows encontradas, datas parseadas, amostras)
  - amostra de 2-3 itens (ex.: “Brownie Tradicional 6x6”, “Papel Acoplado”) com `estoqueAtual` calculado e origem (compat vs legacy)

## Repro
- Abrir a URL da API com o mesmo querystring do browser e adicionar `&diag=1`.

