[OPEN] Debug Session: entradas-supplier-items

## Contexto
- Sintoma: ao criar uma nota em /entradas, o seletor não encontra os itens vinculados ao fornecedor.
- Esperado: ao selecionar um fornecedor, o seletor deve listar os insumos/itens vinculados (via supplier_items / fornecedores compat).
- Ambiente: produção (cmvfacil.app / www.cmvfacil.app).

## Hipóteses (falsificáveis)
1) H1: o frontend de /entradas está usando uma fonte “legacy” ou cache local (e não /api/fornecedores compat), portanto não enxerga os vínculos atuais.
2) H2: o backend retorna vínculos, mas /entradas filtra por IDs (item_id) enquanto o payload compat de fornecedores usa nomes, resultando em lista vazia.
3) H3: mismatch de chave do fornecedor (db:uuid vs label/bubble_id) entre /entradas e o payload de fornecedores, fazendo o lookup falhar.
4) H4: a API que /entradas consulta está retornando 401/empty por cookies/headers diferentes dos usados em /fornecedores.
5) H5: existem vínculos, mas o seletor aplica um filtro adicional (categoria/unidade/busca) com bug e esconde tudo.

## Evidências a coletar
- Qual endpoint é chamado ao abrir o seletor (Network).
- Payload retornado (contagens e chaves) e parâmetros de query usados.
- Logs instrumentados no servidor para correlacionar supplier_id, supplierKey e quantidade de itens entregues ao client.

## Plano
1) Mapear o fluxo de dados do seletor em /entradas (frontend) e identificar o endpoint de dados.
2) Instrumentar o endpoint (e/ou ação de client) para registrar: supplierKey recebido, supplier_id resolvido, quantidade de vínculos carregados, e motivo de filtro.
3) Reproduzir em produção e comparar pre-fix vs post-fix.

