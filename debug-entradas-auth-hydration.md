[OPEN]

# Debug Session: entradas-auth-hydration

## Sintoma
- A página `/entradas` fica permanentemente em “Carregando autenticação…”, apesar do menu reconhecer “Luis Felipe”.
- Erros de hidratação React (#425, #423, #329) continuam.

## Hipóteses (falsificáveis)
- H1: `companyId` está vazio no `meStore` (localStorage antigo sem `companyId` e `/api/me` não preenche), então `authReady` nunca fica `true`.
- H2: `loadMeFromApi()` está falhando/limpando estado após o primeiro render (ex.: `/api/auth/me` retorna userId, mas `/api/me` falha), deixando `email/companyId` inconsistentes.
- H3: A tela `/entradas` renderiza caminhos diferentes entre SSR/CSR por depender de dados de `localStorage`/hora (`Date.now()`/listas), causando hidratação (#425/#423/#329).
- H4: Algum erro em runtime interrompe os efeitos (`useEffect`) de carregar `entradas/fornecedores`, mantendo o estado em “Carregando autenticação…”.

## Evidências necessárias
- Snapshot do `meStore` no cliente durante o carregamento (email, userId, companyId, nomeCompleto).
- Logs de transição de `authReady/canRender` e motivo do bloqueio.
- Captura dos warnings/erros de hidratação (console.warn/console.error) com as mensagens completas.

