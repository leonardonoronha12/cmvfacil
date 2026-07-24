# Debug Session: insumos-delete-returns
- **Status**: [OPEN]
- **Issue**: Insumo deletado (“Acém”) volta após recarregar em produção.
- **Debug Server**: http://127.0.0.1:7777/event
- **Log File**: .dbg/trae-debug-log-insumos-delete-returns.ndjson

## Reproduction Steps
1. Em produção, abrir Insumos.
2. Excluir o item “Acém”.
3. Aguardar o autosave.
4. Recarregar a página.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Evidence |
|----|------------|------------|--------|----------|
| A | O deploy em produção ainda não está com o commit do fix (rollout/cache/alias). | High | Low | Pending |
| B | O delete não dispara POST antes do reload (debounce/autosave não roda / reload rápido). | High | Low | Pending |
| C | O POST está indo para legacy enquanto o GET lê compat (fonte divergente entre leitura e escrita). | Med | Low | Pending |
| D | O POST compat roda, mas não deleta (toDelete vazio por mismatch de IDs / filtro). | Med | Med | Pending |
| E | Algum fluxo chama /api/bubble-import ou Bubble e re-insere o item. | Low | Low | Pending |

## Log Evidence
- Pending (usaremos headers de resposta em produção como evidência mínima).

## Verification Conclusion
- Pending
