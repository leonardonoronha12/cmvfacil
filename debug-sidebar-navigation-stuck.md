# Debug Session: sidebar-navigation-stuck
- **Status**: [OPEN]
- **Issue**: Após abrir CMV Real (/dashboard), clicar em outro item do menu lateral não navega (não redireciona).
- **Environment**: Production (cmvfacil.app) / Next.js 14 App Router

## Hypotheses
1) Um overlay (loading/migração/blocked) fica por cima do sidebar e bloqueia o clique (pointer-events).
2) O clique chega no Link, mas a navegação é cancelada por algum handler (defaultPrevented) ou por um erro em runtime.
3) A navegação acontece, mas é imediatamente revertida por um redirect (middleware/auth/billing) ou por um replace no client.
4) Thread principal está bloqueada após o dashboard (loop pesado) e o clique não é processado a tempo.
5) Existe conflito de domínio/cookies (host-only) e o app está em estado “semi autenticado”, causando falhas de navegação.

## Evidence to Collect
- Clique no item do sidebar (capturar: href, pathname atual, defaultPrevented).
- Eventos de navegação (start/complete) e pathname após 250ms/1000ms.
- Presença de overlays visíveis no DOM e `document.elementFromPoint` na área do menu.

