# Debug Session: sidebar-double-click
- **Status**: [FIXED]
- **Issue**: Clique no item do menu lateral às vezes não navega imediatamente; parece exigir 2 cliques.
- **Environment**: Next.js 14 (App Router) / Vercel production + local dev

## Repro Steps (target)
1) Estar em qualquer rota com sidebar visível (ex.: /desperdicios).
2) Clicar em outro item do menu (ex.: /inventario).
3) Observar: em alguns casos não navega no primeiro clique.

## Expected vs Actual
- **Expected**: 1 clique sempre navega imediatamente (client-side).
- **Actual**: 1º clique às vezes não navega; 2º clique navega.

## Hypotheses & Verification
| ID | Hypothesis (falsifiable) | Signal to verify | Status |
|----|--------------------------|------------------|--------|
| A | Um overlay/elemento com `pointer-events` captura o clique (Loading/Modal/Toast) | `elementFromPoint` no ponto do clique não é o `<a>` do sidebar; ou evento chega com target fora do link | Not confirmed |
| B | O clique chega no `<a>`, mas o Next Link é cancelado por `defaultPrevented`/listener global | Logs mostram `defaultPrevented=true` ou `eventPhase`/propagation interrompida | Not confirmed |
| C | Navegação inicia, mas o thread está ocupado e a mudança de `pathname` atrasa (parece “não pegou”) | `nav-attempt` registrado e `pathname-change` só acontece depois de >500ms | Plausible |
| D | O clique dispara fechamento do drawer e perde o clique/navegação em mobile | Logs mostram `isMobile=true`, `closeDrawer` rodou e nenhum `pathname-change` ocorre | Not confirmed |
| E | Algum erro/hydration mismatch reseta estado ou impede a transição | Logs mostram `error/unhandledrejection` em torno do clique + ausência de `pathname-change` | Plausible |

## Evidence Log
- Source: `.dbg/trae-debug-log-sidebar-double-click.ndjson`

## Root Cause (prático)
- O AppSidebar fazia `router.prefetch()` de várias rotas em burst, competindo com a navegação e gerando “stall”/atraso que parecia exigir 2 cliques.

## Fix
- Removido o prefetch agressivo; a navegação volta a depender do prefetch nativo do Next Link (hover/viewport), que é mais estável.
