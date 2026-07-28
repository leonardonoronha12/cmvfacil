# Debug Session: supplier-items-zero
- **Status**: [OPEN]
- **Issue**: Após atualizar/deploy, todos os fornecedores passam a mostrar 0 items apesar de vínculos terem sido salvos (ex.: Baía Norte). Backend antes falhava com duplicate key em supplier_items.
- **Debug Server**: http://127.0.0.1:7777/event
- **Log File**: .dbg/trae-debug-log-supplier-items-zero.ndjson

## Reproduction Steps
1. Abrir Fornecedores
2. Vincular itens em um fornecedor (ex.: Baía Norte) e salvar
3. Atualizar (F5) / aguardar sincronização
4. Observar que fornecedores retornam para 0 items

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Evidence |
|----|------------|------------|----------|
| A | supplier_items ficou vazio/foi apagado por um fluxo `delete` seguido de `insert` que falhou por duplicidade (unique constraint), causando 0 items | High | Pending |
| B | supplier_items tem dados, mas o GET /api/fornecedores não está lendo (RLS/filters company_id/supplier_id) e retorna 0 items | Med | Pending |
| C | Existem duplicatas no payload de inserção (mesmo supplier_id+item_id) causando falha e abortando o insert, deixando a tabela vazia | High | Pending |
| D | O deploy ainda não pegou a correção (API rodando commit antigo), então o comportamento persiste | Med | Pending |
| E | O problema é só de UI/store (carrega certo do backend, mas zera no client) | Low | Pending |

