[OPEN]

# Debug Session: entradas-page-crash

## Sintoma
- Em produção, a tela **Entradas** não carrega e quebra com:
  - `ReferenceError: Cannot access 'ab' before initialization`
  - O erro aparece no bundle compilado durante um `Array.filter`.

## Hipóteses (falsificáveis)
- H1: Existe uma função/const (ex.: `displayFornecedor`) declarada com `const` **depois** do primeiro uso dentro de um `useMemo` que roda durante o render, causando TDZ e explodindo no `rows.filter`.
- H2: Alguma dependência/callback usada no `filter` referencia uma variável `const` declarada depois (outro helper além de `displayFornecedor`), também causando TDZ.
- H3: O erro não é TDZ: é uma exceção lançada dentro do `filter` por dados inesperados (ex.: `undefined`) e o minifier “disfarça” a causa.
- H4: Existe um erro anterior no boot do módulo e o stack aponta “filter” apenas como efeito colateral.

## Evidência esperada
- Com instrumentação global (`window.error` / `unhandledrejection`), deve aparecer evento `window_error` com `message` e `stack` apontando para o trecho relacionado.

## Plano
1) Instrumentar captura de erros globais do browser para `/api/debug/event` (sem mexer em regra de negócio).
2) Aplicar correção mínima (hoist) no helper suspeito e validar que a tela volta a carregar.

