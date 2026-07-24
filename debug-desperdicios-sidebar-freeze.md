# Debug Session: desperdicios-sidebar-freeze
- **Status**: [OPEN]
- **Issue**: Ao entrar na aba /desperdicios, o app “trava” e não permite mais navegar pelo menu lateral.
- **Debug Server**: http://127.0.0.1:7777/event
- **Log File**: .dbg/trae-debug-log-desperdicios-sidebar-freeze.ndjson

## Reproduction Steps
1. Abrir o app logado.
2. Clicar em “Desperdícios” no menu lateral.
3. Tentar clicar em outra aba do menu lateral.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Evidence |
|----|------------|------------|--------|----------|
| A | Um overlay/camada fixa (invisível ou modal) fica sobre a tela e bloqueia cliques no menu lateral. | High | Low | Unlikely (cliques chegam no onClick do sidebar) |
| B | O thread principal fica preso em renderizações/computações (loops/useEffect) e os cliques não são processados. | Med | Med | Unlikely (setTimeout dispara; não há “freeze” total) |
| C | A navegação do Next (Link) não efetiva em alguns cliques ao sair de /desperdicios; forçar navegação no onClick resolve. | High | Low | Supported (post-fix navega) |
| D | Um erro em runtime ocorre ao entrar em /desperdicios e deixa a UI em estado inconsistente. | Low | Low | Unlikely (sem window-error/unhandledrejection) |

## Log Evidence
- post-fix (runId=post): navegação do sidebar passa a efetivar via handler explícito.
  - Click Dashboard → Desperdícios: `nav-complete` em ~22ms (linhas 2–6 do log atual).
  - Click Desperdícios → Inventário: `pathname-change` efetiva (linha 10 do log atual), mesmo quando `nav-timeout` dispara antes (linha 9).

## Verification Conclusion
- Fix aplicado: Sidebar agora faz `preventDefault()` + `router.push()` no `onClick` de todos os links (com fallback para `window.location.assign`).
- Status: aguardando confirmação do usuário em produção.
