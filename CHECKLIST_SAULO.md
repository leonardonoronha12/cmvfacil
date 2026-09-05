# Checklist de homologação — reunião com Saulo

Legenda: `[x]` concluído e publicado; `[-]` parcialmente implementado; `[ ]` pendente.

## Fluxo principal: Entrada → Inventário → CMV → Lista de Compras

- [x] Corrigir entradas que não apareciam no cálculo do CMV
- [x] Considerar a entrada somente dentro do período correto
- [x] Vincular a entrada pelo ID real do insumo, mesmo com nome diferente na nota
- [x] Converter a unidade da entrada para a unidade-base do insumo
- [x] Usar as entradas corretamente na Lista de Compras
- [x] Corrigir máscara brasileira do faturamento, inclusive `351,11`
- [x] Utilizar exatamente os centavos informados no cálculo
- [x] Salvar e recuperar faturamento por período
- [x] Não herdar faturamento ao trocar de período
- [x] Mostrar sucesso somente depois de calcular e persistir
- [x] Tratar erro de persistência e bloquear submissão duplicada
- [-] Validar estoque inicial e final em contas novas e migradas
- [-] Investigar valores históricos absurdamente altos de custo/CMV
- [ ] Comparar amostras do sistema antigo com o novo
- [ ] Homologar cenários completos com empresa criada do zero e empresa migrada
- [x] Formatar o faturamento como moeda brasileira durante a digitação
- [x] Exibir carregamento ao buscar o faturamento salvo do período

## Fornecedores nas Entradas

- [x] Liberar o dropdown na edição da nota
- [x] Carregar as opções da empresa atual
- [x] Mostrar e permitir trocar o fornecedor atual
- [x] Ordenar fornecedores alfabeticamente
- [x] Persistir fornecedor e data sem modificar itens ou valores
- [x] Confirmar sucesso somente após salvar
- [-] Homologar reabertura da nota em contas novas e migradas

## Inventário

- [x] Deduplicar o mesmo ID entre todas as categorias da contagem
- [x] Tratar quantidade zero como contabilizada
- [x] Impedir itens vazios de entrarem em novas contagens
- [x] Adicionar insumos novos somente a contagens ainda abertas
- [x] Preservar inventários históricos concluídos
- [x] Melhorar busca por nome, categoria e unidade
- [x] Aceitar somente quantidade numérica, com até três decimais
- [x] Abrir o histórico ao clicar no nome do item
- [x] Revisar visual e responsividade de Pendentes, Contabilizados e Sem categoria
- [ ] Homologar desktop, tablet e celular
- [x] Preservar uma nova contagem localmente antes de navegar para outra tela
- [x] Manter o menu de três pontos ancorado ao botão acionado
- [x] Recuperar inventários normalizados quando a cópia antiga estiver vazia

## Itens e equivalências do fornecedor

- [-] Simplificar cadastro de item do fornecedor
- [x] Explicar a conversão na frase “1 embalagem da nota equivale a X unidades do insumo”
- [x] Priorizar seleção de insumos cadastrados
- [x] Validar associações de peso incompatíveis com volume
- [x] Validar conversão embalagem → unidade
- [x] Impedir fator zero, negativo, não numérico ou excessivamente alto
- [x] Garantir que a unidade equivalente seja herdada do insumo cadastrado
- [-] Homologar a unidade resultante no Inventário, CMV e histórico com dados reais

## Fichas técnicas e pré-preparo migrados

- [x] Recuperar ingredientes do banco normalizado quando a cópia antiga estiver incompleta
- [x] Aplicar a recuperação tanto em Fichas Técnicas quanto em Pré-Preparo
- [x] Restringir `Und` e porções a números inteiros e manter decimais nas unidades fracionáveis
- [ ] Homologar edição de receitas recuperadas da migração

## Contas migradas em auditoria

- [-] Ivson: autenticação confirmada; perfil sem dados importados e reimportação administrativa pendente
- [-] Alcemir: autenticação confirmada; vínculo com empresa/perfil ausente e isolamento de dados precisa ser reparado
- [-] Bistrô Lausi: recuperação automática pela fonte normalizada publicada; homologação específica da conta pendente
- [ ] Reexecutar a migração das contas afetadas com acesso administrativo
- [ ] Comparar inventários, entradas, categorias e receitas antes/depois da reimportação

## Usuários e permissões

- [x] Validar adicionar, editar e remover usuário
- [x] Garantir ações visíveis apenas para autorizados
- [x] Garantir isolamento por empresa
- [x] Atualizar a interface sem reload desnecessário
- [ ] Homologar desktop e mobile

## Experiência e responsividade geral

- [-] Feedback de carregamento, salvamento, cálculo e erros nas telas corrigidas
- [x] Bloquear o avanço do guia até a ação obrigatória ser concluída
- [x] Impedir acesso direto a etapas futuras pela barra de progresso
- [x] Manter somente o controle destacado disponível durante etapas práticas
- [x] Validar valor preenchido em inputs, selects e textareas antes de avançar
- [ ] Revisar todas as telas em desktop, notebook, tablet e celular
- [ ] Eliminar cortes, sobreposições e scroll horizontal
- [ ] Padronizar estados vazios, skeletons, foco, hover e seleção
- [x] Aplicar `prefers-reduced-motion`
- [ ] Reduzir digitação e linguagem técnica

## Leitura de nota e fotos

- [ ] Upload de foto e PDF da nota
- [ ] Extração assistida de fornecedor, itens, quantidades, unidades e valores
- [ ] Revisão humana e confiança mínima antes de salvar
- [ ] Manter entrada manual
- [ ] Foto do insumo para identificação operacional

## Consumo interno e perdas

- [ ] Criar módulo de consumo interno e motivos personalizados
- [ ] Reduzir estoque sem contabilizar como venda
- [ ] Registrar histórico e motivo
- [ ] Integrar desperdícios e consumo interno à reposição e Lista de Compras
- [ ] Não mascarar o CMV

## Multiempresa e lojas

- [ ] Revisar alternância entre lojas
- [ ] Garantir isolamento total
- [ ] Criar visão consolidada para proprietário
- [ ] Criar indicadores consolidados
