"use client";

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import styles from "./MigrationExperience.module.css";

const TOUR_VERSION = "2026-09-academia-v18";
const ACTIVE_TOUR_KEY = `cmvfacil:onboarding:active:${TOUR_VERSION}`;
const DONE_TOUR_KEY = `cmvfacil:onboarding:done:${TOUR_VERSION}`;
const MODULE_PROGRESS_KEY = `cmvfacil:onboarding:modules:${TOUR_VERSION}`;
const SUPPORT_PHONE = "5513936180830";

function findTourTarget(target: { selector?: string; text?: string; tag?: string }) {
  const candidates = target.selector
    ? Array.from(document.querySelectorAll(target.selector))
    : Array.from(document.querySelectorAll(target.tag || "button,a")).filter(item => item.textContent?.trim().includes(target.text || ""));
  return candidates.find(item => {
    if (!(item instanceof HTMLElement) || item.closest('[data-cmv-tour-ui="true"]')) return false;
    const rect = item.getBoundingClientRect();
    const style = window.getComputedStyle(item);
    return rect.width > 2 && rect.height > 2 && style.display !== "none" && style.visibility !== "hidden";
  }) ?? null;
}

type TourStep = {
  path: string;
  icon: string;
  kicker: string;
  title: string;
  text: string;
  improvement: string;
  bullets: string[];
  target?: { selector?: string; text?: string; tag?: string };
  passive?: boolean;
  completion?: { selector: string; event: "click" | "change" | "blur" | "input"; debounceMs?: number; requireValue?: boolean };
};

const steps: TourStep[] = [
  { path: "/dashboard", icon: "✨", kicker: "Uma experiência renovada", title: "Bem-vindo ao novo CMV Fácil", text: "Seus dados continuam aqui, agora em uma experiência mais rápida, organizada e simples de usar.", improvement: "Eu vou caminhar com você pelas telas. A partir do próximo passo, clique apenas no que estiver iluminado.", bullets: ["Dados preservados", "Tour interativo", "Ajuda sempre disponível"] },
  { path: "/dashboard", target: { selector: 'a[href="/inventario"]' }, icon: "🧭", kicker: "Sua vez", title: "Abra o Inventário", text: "A tela ficou escura para destacar exatamente onde você deve clicar.", improvement: "Clique em Inventário no menu lateral. Eu vou junto e continuo a explicação na próxima tela.", bullets: ["Clique no item iluminado"] },
  { path: "/inventario", target: { text: "Nova Contagem", tag: "button" }, icon: "📦", kicker: "Inventário por setores", title: "Crie uma nova contagem", text: "Agora você pode separar Bar, Cozinha, Estoque Seco e outras áreas.", improvement: "Clique em Nova Contagem para conhecer a janela. Nada será salvo sem sua confirmação.", bullets: ["Setores organizados", "Pendentes visíveis"] },
  { path: "/inventario", target: { selector: '[data-tour="inventory-date"]' }, passive: true, completion: { selector: '[data-tour="inventory-date-day"]', event: "click" }, icon: "🗓️", kicker: "Passo 1 — escolha a data", title: "Informe o dia da contagem", text: "Clique no campo destacado e selecione no calendário a data em que o estoque está sendo contado.", improvement: "Assim que você escolher o dia, eu avanço automaticamente. Use uma data diferente se já existir uma contagem para hoje.", bullets: ["Clique no campo", "Escolha a data", "Avanço automático"] },
  { path: "/inventario", target: { text: "Começar", tag: "button" }, icon: "▶️", kicker: "Passo 2 — crie a contagem", title: "Agora clique em Começar", text: "Este botão cria o inventário na data escolhida e abre a lista de itens que precisam ser contados.", improvement: "Antes de clicar, confirme a data. Depois clique uma vez em Começar e aguarde a lista carregar; o guia seguirá automaticamente.", bullets: ["Data conferida", "Clique apenas uma vez", "Aguarde carregar"] },
  { path: "/inventario", target: { selector: 'input[placeholder="Pesquise por itens..."]' }, passive: true, icon: "🔎", kicker: "Passo 3 — encontre os itens", title: "Use busca, categoria e setor", text: "A busca localiza um item pelo nome. Os filtros ajudam a contar uma área por vez, como Bar, Cozinha ou Estoque Seco.", improvement: "Escolha um setor, pesquise quando necessário e trabalhe somente com os itens exibidos. Depois clique em Continuar.", bullets: ["Selecione o setor", "Pesquise o item", "Conte uma área por vez"] },
  { path: "/inventario", target: { selector: 'input[data-inv-pending="1"]' }, passive: true, completion: { selector: 'input[data-inv-pending="1"]', event: "blur" }, icon: "⌨️", kicker: "Passo 4 — registre a quantidade", title: "Digite o estoque contado", text: "No item pendente, informe a quantidade física encontrada usando a unidade mostrada ao lado: Kg, g, L, ml ou Und.", improvement: "Digite o valor e pressione Enter, ou toque fora do campo. Assim que o valor for confirmado, eu avanço. Para 700 gramas em Kg, digite 0,700.", bullets: ["Respeite a unidade", "Use vírgula nos decimais", "Pressione Enter"] },
  { path: "/inventario", passive: true, icon: "✅", kicker: "Passo 5 — confira", title: "Pendentes e contabilizados", text: "Pendentes ainda precisam de quantidade. Contabilizados já foram registrados e podem ser revisados.", improvement: "Antes de encerrar a rotina, verifique se não restaram itens pendentes no setor. Se errar, edite o valor contabilizado e confirme novamente.", bullets: ["Confira os pendentes", "Revise os contabilizados", "Corrija quando necessário"] },
  { path: "/inventario", target: { selector: 'a[href="/entradas"]' }, icon: "⚖️", kicker: "Próxima novidade", title: "Vamos para Entradas", text: "O lançamento de notas ganhou recursos que reduzem contas manuais e itens não encontrados.", improvement: "Clique em Entradas no menu lateral para eu mostrar onde tudo começa.", bullets: ["Clique em Entradas"] },
  { path: "/entradas", target: { text: "Nova Nota", tag: "button" }, icon: "🧾", kicker: "Lançamento mais fácil", title: "Abra uma nova nota", text: "O novo fluxo prepara fornecedor e data antes da inclusão dos produtos.", improvement: "Clique em Nova Nota. Você poderá conhecer a tela sem salvar nenhuma informação.", bullets: ["Fluxo guiado", "Sem salvar agora"] },
  { path: "/entradas", target: { selector: '[role="dialog"] select' }, passive: true, completion: { selector: '[role="dialog"] select', event: "change" }, icon: "🚚", kicker: "Passo 1 — fornecedor", title: "Selecione de quem você comprou", text: "Clique no campo destacado e escolha o fornecedor que aparece na nota.", improvement: "Se ele não estiver cadastrado, use ADD Fornecedor. Assim que você escolher uma opção, eu avanço.", bullets: ["Abra a lista", "Escolha o fornecedor", "Avanço automático"] },
  { path: "/entradas", target: { selector: '[data-tour="entry-date"]' }, passive: true, completion: { selector: '[data-tour="entry-date-day"]', event: "click" }, icon: "🗓️", kicker: "Passo 2 — recebimento", title: "Confira a data da nota", text: "Informe o dia em que os produtos foram recebidos. Essa data organiza o histórico e o custo do período correto.", improvement: "Clique no campo e escolha a data. Eu avanço assim que o dia for selecionado.", bullets: ["Abra o calendário", "Escolha a data", "Avanço automático"] },
  { path: "/entradas", target: { text: "Criar nota", tag: "button" }, icon: "▶️", kicker: "Passo 3 — abrir a nota", title: "Clique em Criar nota", text: "Com fornecedor e data preenchidos, este botão cria o cabeçalho e abre a inclusão dos produtos.", improvement: "Clique apenas uma vez e aguarde a tela de itens carregar.", bullets: ["Fornecedor preenchido", "Data preenchida", "Clique uma vez"] },
  { path: "/entradas", target: { selector: '[data-tour="entry-item-menu"]' }, icon: "🔎", kicker: "Passo 4 — produtos", title: "Abra a lista de itens", text: "Este campo reúne os produtos já vinculados ao fornecedor e os insumos disponíveis.", improvement: "Clique na seta para conhecer primeiro como cadastrar o nome que aparece na nota e sua conversão para o estoque.", bullets: ["Abra o catálogo", "Produtos do fornecedor"] },
  { path: "/entradas", target: { selector: '[data-tour="entry-item-new-link"]' }, icon: "🔗", kicker: "Passo 5 — vinculação", title: "Adicione um item do fornecedor", text: "Use esta opção quando a descrição impressa na nota for diferente do nome do seu insumo.", improvement: "Clique para relacionar o nome da nota ao item real do estoque.", bullets: ["Nome da nota", "Insumo real", "Conversão"] },
  { path: "/entradas", target: { selector: '[data-tour="link-name"]' }, passive: true, completion: { selector: '[data-tour="link-name"]', event: "input", debounceMs: 700, requireValue: true }, icon: "✍️", kicker: "Passo 6 — nome", title: "Digite o nome que vem na nota", text: "Copie a descrição usada pelo fornecedor.", improvement: "Quando parar de digitar, o guia avançará automaticamente.", bullets: ["Descrição da nota", "Detecção automática"] },
  { path: "/entradas", target: { selector: '[data-tour="link-unit"]' }, passive: true, completion: { selector: '[data-tour="link-unit"]', event: "change" }, icon: "📦", kicker: "Passo 7 — embalagem", title: "Escolha a unidade da nota", text: "Informe se o fornecedor vende em unidade, pacote, caixa, fardo, quilo ou litro.", improvement: "Essa é a embalagem de compra, não necessariamente a unidade do estoque.", bullets: ["Unidade da compra", "Seleção imediata"] },
  { path: "/entradas", target: { selector: '[data-tour="link-item"]' }, passive: true, completion: { selector: '[data-tour="link-item"]', event: "change" }, icon: "🥫", kicker: "Passo 8 — insumo", title: "Escolha o insumo equivalente", text: "Selecione o item real do estoque correspondente ao nome da nota.", improvement: "É essa ligação que mantém histórico, estoque e custo médio corretos.", bullets: ["Item cadastrado", "Estoque conectado"] },
  { path: "/entradas", target: { selector: '[data-tour="link-factor"]' }, passive: true, completion: { selector: '[data-tour="link-factor"]', event: "input", debounceMs: 700, requireValue: true }, icon: "⚖️", kicker: "Passo 9 — conversão", title: "Informe quanto entra no estoque", text: "Diga quanto uma embalagem da nota representa na unidade do insumo.", improvement: "Exemplo: uma caixa com 12 unidades equivale a 12 Und.", bullets: ["Fator de conversão", "Sem contas futuras"] },
  { path: "/entradas", target: { selector: '[data-tour="link-save"]' }, icon: "✅", kicker: "Passo 10 — salvar", title: "Salve a vinculação", text: "Revise nome, embalagem, insumo e equivalência.", improvement: "Clique em Salvar para disponibilizar o item nesta e nas próximas notas do fornecedor.", bullets: ["Vínculo permanente", "Reutilização"] },
  { path: "/entradas", target: { selector: '[data-tour="entry-item-menu"]' }, icon: "🔎", kicker: "Passo 11 — selecionar", title: "Abra novamente o catálogo", text: "Agora o item vinculado está disponível.", improvement: "Clique na seta e escolha o produto que acabamos de configurar.", bullets: ["Vínculo disponível"] },
  { path: "/entradas", target: { selector: '[data-tour="entry-item-option"]' }, icon: "☑️", kicker: "Passo 12 — item", title: "Selecione o item da nota", text: "Clique no produto correto.", improvement: "A unidade configurada será preenchida automaticamente.", bullets: ["Produto correto", "Unidade automática"] },
  { path: "/entradas", target: { selector: '[data-tour="entry-qty"]' }, passive: true, completion: { selector: '[data-tour="entry-qty"]', event: "input", debounceMs: 700, requireValue: true }, icon: "🔢", kicker: "Passo 13 — quantidade", title: "Informe a quantidade comprada", text: "Digite quantas embalagens ou unidades vieram na nota.", improvement: "O conversor aplicará a equivalência salva ao estoque.", bullets: ["Quantidade da nota", "Conversão automática"] },
  { path: "/entradas", target: { selector: '[data-tour="entry-subtotal"]' }, passive: true, completion: { selector: '[data-tour="entry-subtotal"]', event: "input", debounceMs: 700, requireValue: true }, icon: "💰", kicker: "Passo 14 — valor", title: "Informe o subtotal", text: "Digite o valor total pago por esse item.", improvement: "O custo unitário será calculado automaticamente.", bullets: ["Valor total", "Custo automático"] },
  { path: "/entradas", target: { selector: '[data-tour="entry-add-item"]' }, icon: "➕", kicker: "Passo 15 — adicionar", title: "Adicione o item à nota", text: "Confira a linha e clique no botão de adicionar.", improvement: "O item passa a fazer parte da nota e do histórico de entradas.", bullets: ["Linha conferida", "Entrada registrada"] },
  { path: "/entradas", target: { selector: '[role="dialog"] button[aria-label="Fechar"]' }, icon: "✅", kicker: "Passo 6 — finalizar", title: "Confira e feche a nota", text: "Revise fornecedor, data, itens, quantidades, custos e total antes de sair.", improvement: "Clique no X iluminado quando terminar. A nota e os itens já adicionados ficam disponíveis no histórico de entradas.", bullets: ["Revise os itens", "Confira o total", "Feche a janela"] },
  { path: "/dashboard", icon: "📊", kicker: "Gestão e resultado", title: "Entenda o CMV Real", text: "O painel reúne estoque inicial, entradas, estoque final, saídas, custo médio e CMV para transformar a operação em uma leitura gerencial.", improvement: "Use os filtros de período, confira os dados de origem e calcule o indicador. Você pode voltar a este módulo sempre que quiser revisar o cálculo.", bullets: ["Indicadores do período", "Custos conectados", "Decisão mais segura"] },
  { path: "/dashboard", target: { text: "Calcular CMV", tag: "button" }, icon: "🧮", kicker: "Faça a leitura", title: "Calcule o período", text: "Depois de escolher o período e informar o faturamento, este botão atualiza o CMV Real.", improvement: "Confira os filtros antes de clicar. Durante o tutorial, você pode usar o botão para praticar com os dados já preenchidos.", bullets: ["Período conferido", "Faturamento informado", "Resultado atualizado"] },
  { path: "/insumos", icon: "🥫", kicker: "Base do sistema", title: "Organize seus insumos", text: "Insumos alimentam entradas, inventários, fichas técnicas, compras e desperdícios.", improvement: "Cadastre nome, unidade e setor com atenção. O conversor ajuda a relacionar caixas, unidades, quilos e litros sem contas manuais.", bullets: ["Cadastro central", "Conversão de unidades", "Histórico conectado"] },
  { path: "/insumos", target: { selector: '[data-tour="categories-open"]' }, icon: "🗂️", kicker: "Passo 1 — estrutura", title: "Cadastre a primeira categoria", text: "Antes do insumo, precisamos criar a categoria que organizará esse item.", improvement: "Clique em Ver Categorias. Ela será usada no cadastro do insumo logo em seguida.", bullets: ["Ordem correta", "Categoria antes do item"] },
  { path: "/insumos", target: { selector: '[data-tour="category-name"]' }, passive: true, completion: { selector: '[data-tour="category-name"]', event: "blur" }, icon: "✍️", kicker: "Passo 2 — categoria", title: "Dê um nome à categoria", text: "Digite uma categoria real da operação, como Bebidas, Proteínas ou Hortifruti.", improvement: "Depois de digitar, pressione Tab ou toque fora do campo para continuar.", bullets: ["Nome real", "Sem abreviações", "Avanço automático"] },
  { path: "/insumos", target: { selector: '[data-tour="category-save"]' }, icon: "✅", kicker: "Passo 3 — salvar", title: "Salve a categoria", text: "Clique em ADD para gravar a categoria.", improvement: "O guia só seguirá depois que esse cadastro básico for concluído.", bullets: ["Cadastro real", "Base para o insumo"] },
  { path: "/insumos", target: { selector: '[data-tour="categories-close"]' }, icon: "➡️", kicker: "Categoria pronta", title: "Volte ao cadastro de insumos", text: "A categoria já está disponível.", improvement: "Feche a janela para criar o primeiro insumo.", bullets: ["Categoria disponível"] },
  { path: "/insumos", target: { text: "Novo Item", tag: "button" }, icon: "➕", kicker: "Pratique sem salvar", title: "Abra um novo insumo", text: "Este é o início do cadastro que abastece todo o sistema.", improvement: "Clique em Novo Item para conhecer os campos. Nada será gravado sem você confirmar o salvamento.", bullets: ["Nome claro", "Unidade correta", "Setor organizado"] },
  { path: "/insumos", target: { selector: '[data-tour="insumos-name"]' }, passive: true, completion: { selector: '[data-tour="insumos-name"]', event: "input", debounceMs: 700, requireValue: true }, icon: "📝", kicker: "Passo 4 — insumo", title: "Digite o nome do insumo", text: "Informe um produto real usado na operação.", improvement: "Use um nome claro, como Arroz, Leite Integral ou Coca-Cola Lata. Quando você parar de digitar, eu reconheço o nome e avanço automaticamente.", bullets: ["Nome padronizado", "Produto real", "Detecta a pausa"] },
  { path: "/insumos", target: { selector: '[data-tour="insumos-category"]' }, passive: true, completion: { selector: '[data-tour="insumos-category"]', event: "change" }, icon: "🗂️", kicker: "Passo 5 — organização", title: "Escolha a categoria criada", text: "Selecione a categoria que acabamos de cadastrar.", improvement: "Isso garante que filtros, inventário e relatórios encontrem o item corretamente.", bullets: ["Categoria cadastrada", "Organização"] },
  { path: "/insumos", target: { selector: '[data-tour="insumos-unit"]' }, passive: true, completion: { selector: '[data-tour="insumos-unit"]', event: "change" }, icon: "⚖️", kicker: "Unidades e conversão", title: "Defina como o item é medido", text: "A unidade principal determina como o estoque será contado e calculado.", improvement: "Clique em Unidade de Medida e escolha Und, Kg, g ou L. O guia avançará somente depois da mudança desse campo — Categoria não será confundida com unidade.", bullets: ["Abra Unidade de Medida", "Escolha a unidade correta", "Avanço automático"] },
  { path: "/insumos", target: { selector: '[data-tour="insumos-cost"]' }, passive: true, completion: { selector: '[data-tour="insumos-cost"]', event: "blur" }, icon: "💰", kicker: "Passo 7 — custo", title: "Informe o custo inicial", text: "Digite o custo real da unidade escolhida.", improvement: "Esse valor será a base até a primeira entrada atualizar o custo médio.", bullets: ["Custo real", "Unidade conferida"] },
  { path: "/insumos", target: { selector: '[data-tour="insumos-save"]' }, icon: "✅", kicker: "Passo 8 — concluir", title: "Salve o insumo", text: "Revise os campos e clique em Salvar.", improvement: "Somente após salvar o guia seguirá para o fornecedor que vende esse item.", bullets: ["Cadastro completo", "Cascata liberada"] },
  { path: "/fornecedores", icon: "🚚", kicker: "Compras organizadas", title: "Gerencie fornecedores", text: "Aqui você mantém os fornecedores e os produtos vinculados a cada um.", improvement: "Use os vínculos para acelerar notas, preservar o histórico de entradas e comparar de quem cada item foi comprado.", bullets: ["Contatos reunidos", "Produtos vinculados", "Histórico preservado"] },
  { path: "/fornecedores", target: { text: "Novo Fornecedor", tag: "button" }, icon: "➕", kicker: "Conheça o cadastro", title: "Abra um fornecedor", text: "O cadastro organiza a empresa e os contatos usados nas compras.", improvement: "Clique no botão iluminado. Você poderá conhecer a janela sem salvar.", bullets: ["Dados do fornecedor", "Contato", "Vínculos"] },
  { path: "/fornecedores", target: { selector: '[data-tour="supplier-name"]' }, passive: true, completion: { selector: '[data-tour="supplier-name"]', event: "blur" }, icon: "📝", kicker: "Cadastro obrigatório", title: "Digite o nome do fornecedor", text: "Informe um fornecedor real que vende o insumo cadastrado.", improvement: "Vendedor, WhatsApp e endereço são recomendados, mas o nome é o dado obrigatório para continuar.", bullets: ["Fornecedor real", "Contato recomendado"] },
  { path: "/fornecedores", target: { selector: '[data-tour="supplier-save"]' }, icon: "✅", kicker: "Concluir fornecedor", title: "Salve o fornecedor", text: "Clique em Salvar para liberar a etapa de Entradas.", improvement: "A nota usará este fornecedor e o insumo que você já cadastrou.", bullets: ["Cadastro salvo", "Entradas liberadas"] },
  { path: "/fichas-tecnicas", icon: "🍽️", kicker: "Custo dos produtos", title: "Monte fichas técnicas", text: "A ficha transforma ingredientes e quantidades no custo real do produto vendido.", improvement: "Inclua os ingredientes, informe o rendimento e confira custo unitário, CMV atual e preço sugerido.", bullets: ["Ingredientes", "Rendimento", "Preço sugerido"] },
  { path: "/fichas-tecnicas", target: { text: "Nova Ficha Técnica", tag: "button" }, icon: "➕", kicker: "Monte uma receita", title: "Abra uma nova ficha", text: "Aqui começa a composição de um produto vendido.", improvement: "Clique para conhecer ingredientes, rendimento e preço. Nada será salvo sem confirmação.", bullets: ["Ingredientes", "Quantidade", "Rendimento"] },
  { path: "/fichas-tecnicas", target: { selector: '[data-tour="sheet-name"]' }, passive: true, completion: { selector: '[data-tour="sheet-name"]', event: "input", debounceMs: 700, requireValue: true }, icon: "✍️", kicker: "Passo 1 — produto vendido", title: "Digite o nome da receita", text: "Informe o nome exatamente como a equipe reconhece o item no cardápio.", improvement: "Quando você parar de digitar, o guia seguirá automaticamente.", bullets: ["Nome do cardápio", "Avanço automático"] },
  { path: "/fichas-tecnicas", target: { selector: '[data-tour="sheet-price"]' }, passive: true, completion: { selector: '[data-tour="sheet-price"]', event: "input", debounceMs: 700, requireValue: true }, icon: "💵", kicker: "Passo 2 — venda", title: "Informe o preço de venda", text: "Digite quanto o cliente paga por uma unidade ou porção deste produto.", improvement: "O sistema comparará este preço com o custo para calcular o CMV atual.", bullets: ["Preço real", "CMV calculado"] },
  { path: "/fichas-tecnicas", target: { selector: '[data-tour="sheet-target"]' }, passive: true, completion: { selector: '[data-tour="sheet-target"]', event: "input", debounceMs: 700, requireValue: true }, icon: "🎯", kicker: "Passo 3 — meta", title: "Defina o CMV desejado", text: "Digite a porcentagem máxima de custo que você pretende ter neste produto.", improvement: "A meta permite comparar o resultado atual e calcular um preço sugerido.", bullets: ["Percentual desejado", "Preço sugerido"] },
  { path: "/fichas-tecnicas", target: { selector: '[data-tour="sheet-popularity"]' }, passive: true, completion: { selector: '[data-tour="sheet-popularity"]', event: "change" }, icon: "⭐", kicker: "Passo 4 — procura", title: "Classifique a popularidade", text: "Escolha Alta para itens muito vendidos ou Baixa para itens com pouca saída.", improvement: "Essa informação ajuda a analisar margem e popularidade juntas.", bullets: ["Alta ou baixa", "Análise do cardápio"] },
  { path: "/fichas-tecnicas", target: { selector: '[data-tour="sheet-next"]' }, icon: "➡️", kicker: "Passo 5 — composição", title: "Avance para os ingredientes", text: "Revise nome, preço, meta e popularidade e clique em Próximo.", improvement: "Agora vamos montar o custo real do produto.", bullets: ["Dados conferidos", "Clique em Próximo"] },
  { path: "/fichas-tecnicas", target: { selector: '[data-tour="sheet-ingredient"]' }, passive: true, completion: { selector: '[data-tour="sheet-ingredient"]', event: "change" }, icon: "🥫", kicker: "Passo 6 — ingrediente", title: "Selecione o primeiro ingrediente", text: "Escolha um insumo ou pré-preparo usado nesta ficha.", improvement: "A unidade e o custo cadastrados serão carregados automaticamente.", bullets: ["Insumo ou pré-preparo", "Custo conectado"] },
  { path: "/fichas-tecnicas", target: { selector: '[data-tour="sheet-ingredient-qty"]' }, passive: true, completion: { selector: '[data-tour="sheet-ingredient-qty"]', event: "input", debounceMs: 700, requireValue: true }, icon: "🔢", kicker: "Passo 7 — quantidade", title: "Informe quanto vai em uma receita", text: "Digite a quantidade utilizada respeitando a unidade exibida ao lado.", improvement: "É essa quantidade que transforma o custo do insumo no custo da receita.", bullets: ["Quantidade real", "Unidade correta"] },
  { path: "/fichas-tecnicas", target: { selector: '[data-tour="sheet-ingredient-add"]' }, icon: "➕", kicker: "Passo 8 — adicionar", title: "Inclua o ingrediente", text: "Confira item, quantidade e custo e clique no botão de adicionar.", improvement: "Repita para todos os componentes do produto vendido.", bullets: ["Item conferido", "Composição completa"] },
  { path: "/fichas-tecnicas", target: { selector: '[data-tour="sheet-yield"]' }, passive: true, completion: { selector: '[data-tour="sheet-yield"]', event: "input", debounceMs: 700, requireValue: true }, icon: "🍽️", kicker: "Passo 9 — rendimento", title: "Informe quantas porções rende", text: "Digite quantas porções vendáveis essa receita completa produz.", improvement: "O custo total será dividido pelo rendimento para chegar ao custo por porção.", bullets: ["Porções produzidas", "Custo unitário"] },
  { path: "/fichas-tecnicas", target: { selector: '[data-tour="sheet-next"]' }, icon: "➡️", kicker: "Passo 10 — resumo", title: "Avance para a conferência", text: "Com ingredientes e rendimento preenchidos, clique em Próximo.", improvement: "O sistema mostrará custo, CMV atual e comparação com a meta.", bullets: ["Receita completa", "Conferência"] },
  { path: "/fichas-tecnicas", target: { selector: '[data-tour="sheet-summary"]' }, passive: true, icon: "📊", kicker: "Passo 11 — resultado", title: "Confira os indicadores da ficha", text: "Revise preço de venda, custo por porção, CMV meta e CMV atual.", improvement: "Se algo não fizer sentido, volte e corrija os ingredientes ou o rendimento.", bullets: ["Custo por porção", "CMV atual", "Meta"] },
  { path: "/fichas-tecnicas", target: { selector: '[data-tour="sheet-next"]' }, icon: "✅", kicker: "Passo 12 — salvar", title: "Conclua a ficha técnica", text: "Se todos os números estiverem corretos, clique em Salvar.", improvement: "A ficha ficará disponível para análise do cardápio e controle de custos.", bullets: ["Cadastro completo", "Indicadores disponíveis"] },
  { path: "/pre-preparo", icon: "👨‍🍳", kicker: "Produção intermediária", title: "Cadastre pré-preparos", text: "Molhos, massas e outras bases podem ser produzidos antes e usados em várias fichas.", improvement: "Registre ingredientes e rendimento para que o custo seja reaproveitado corretamente nas receitas finais.", bullets: ["Bases reutilizáveis", "Custo automático", "Receitas conectadas"] },
  { path: "/pre-preparo", target: { text: "Nova Receita", tag: "button" }, icon: "➕", kicker: "Crie uma base", title: "Abra um pré-preparo", text: "Pré-preparos transformam vários ingredientes em uma base reutilizável.", improvement: "Clique para conhecer o cadastro de receita e rendimento.", bullets: ["Ingredientes", "Rendimento", "Validade"] },
  { path: "/pre-preparo", target: { selector: '[data-tour="prep-name"]' }, passive: true, completion: { selector: '[data-tour="prep-name"]', event: "input", debounceMs: 700, requireValue: true }, icon: "✍️", kicker: "Passo 1 — identificação", title: "Dê um nome ao pré-preparo", text: "Digite o nome da base que será produzida, como Molho Gorgonzola, Caldo de Carne ou Massa de Pizza.", improvement: "Use um nome fácil de reconhecer no inventário e nas fichas. Quando você parar de digitar, eu avanço automaticamente.", bullets: ["Nome claro", "Avanço automático"] },
  { path: "/pre-preparo", target: { selector: '[data-tour="prep-spec"]' }, passive: true, completion: { selector: '[data-tour="prep-spec"]', event: "input", debounceMs: 700, requireValue: true }, icon: "📝", kicker: "Passo 2 — utilização", title: "Explique como essa base será usada", text: "Descreva de forma curta onde esse pré-preparo entra, por exemplo: usado em massas e hambúrgueres.", improvement: "Essa informação ajuda qualquer funcionário a escolher a base correta.", bullets: ["Uso da receita", "Descrição objetiva"] },
  { path: "/pre-preparo", target: { selector: '[data-tour="prep-category"]' }, passive: true, completion: { selector: '[data-tour="prep-category"]', event: "change" }, icon: "🗂️", kicker: "Passo 3 — organização", title: "Selecione a categoria", text: "Escolha a categoria que organiza esta receita. Se nenhuma existir, use Add categoria antes de continuar.", improvement: "A categoria facilita buscas, filtros e conferências posteriores.", bullets: ["Categoria existente", "Organização"] },
  { path: "/pre-preparo", target: { selector: '[data-tour="prep-unit"]' }, passive: true, completion: { selector: '[data-tour="prep-unit"]', event: "change" }, icon: "⚖️", kicker: "Passo 4 — unidade", title: "Defina como o pré-preparo será medido", text: "Escolha Und, Kg, g ou L conforme a forma usada para produzir, contar e consumir essa receita.", improvement: "A unidade será usada no rendimento, no custo e nas fichas técnicas.", bullets: ["Unidade correta", "Cálculo conectado"] },
  { path: "/pre-preparo", target: { selector: '[data-tour="prep-validity"]' }, passive: true, completion: { selector: '[data-tour="prep-validity"]', event: "input", debounceMs: 700, requireValue: true }, icon: "📅", kicker: "Passo 5 — validade", title: "Informe a validade em dias", text: "Digite por quantos dias esta preparação pode ser usada com segurança depois de produzida.", improvement: "O prazo será reaproveitado nas etiquetas deste item.", bullets: ["Prazo em dias", "Etiquetas consistentes"] },
  { path: "/pre-preparo", target: { selector: '[data-tour="prep-sector"]' }, icon: "🏪", kicker: "Passo 6 — setores", title: "Escolha onde essa receita fica", text: "Marque o setor que produz ou armazena o pré-preparo.", improvement: "Isso faz o item aparecer no inventário das áreas corretas.", bullets: ["Produção", "Armazenamento", "Inventário"] },
  { path: "/pre-preparo", target: { selector: '[data-tour="prep-next"]' }, icon: "➡️", kicker: "Passo 7 — ingredientes", title: "Avance para a composição", text: "Revise nome, categoria, unidade, validade e setor. Depois clique em Próximo.", improvement: "A próxima tela mostra exatamente de quais insumos essa base é feita.", bullets: ["Dados conferidos", "Clique em Próximo"] },
  { path: "/pre-preparo", target: { selector: '[data-tour="prep-ingredient-menu"]' }, icon: "🔎", kicker: "Passo 8 — catálogo", title: "Abra a lista de ingredientes", text: "Clique na seta para ver os insumos e pré-preparos já cadastrados.", improvement: "A receita usa o custo atual desses itens para calcular seu custo total.", bullets: ["Abra o catálogo", "Itens cadastrados"] },
  { path: "/pre-preparo", target: { selector: '[data-tour="prep-ingredient-option"]' }, icon: "☑️", kicker: "Passo 9 — ingrediente", title: "Selecione um ingrediente", text: "Escolha o primeiro item que faz parte desta receita.", improvement: "A unidade e o custo do cadastro serão carregados automaticamente.", bullets: ["Item correto", "Custo automático"] },
  { path: "/pre-preparo", target: { selector: '[data-tour="prep-ingredient-qty"]' }, passive: true, completion: { selector: '[data-tour="prep-ingredient-qty"]', event: "input", debounceMs: 700, requireValue: true }, icon: "🔢", kicker: "Passo 10 — quantidade", title: "Informe quanto será utilizado", text: "Digite a quantidade desse ingrediente consumida para produzir uma receita completa.", improvement: "Respeite a unidade exibida ao lado do campo para o custo não ficar incorreto.", bullets: ["Quantidade real", "Unidade conferida"] },
  { path: "/pre-preparo", target: { selector: '[data-tour="prep-ingredient-add"]' }, icon: "➕", kicker: "Passo 11 — adicionar", title: "Inclua o ingrediente na receita", text: "Confira item, quantidade e custo e clique no botão de adicionar.", improvement: "Repita essa rotina para todos os ingredientes que compõem a base.", bullets: ["Conferência", "Composição da receita"] },
  { path: "/pre-preparo", target: { selector: '[data-tour="prep-yield"]' }, passive: true, completion: { selector: '[data-tour="prep-yield"]', event: "input", debounceMs: 700, requireValue: true }, icon: "🥣", kicker: "Passo 12 — rendimento", title: "Informe quanto a receita rende", text: "Digite a quantidade total obtida depois do preparo, já na unidade escolhida.", improvement: "O sistema divide o custo total pelo rendimento para encontrar o custo por Kg, litro ou unidade.", bullets: ["Rendimento final", "Custo unitário"] },
  { path: "/pre-preparo", target: { selector: '[data-tour="prep-next"]' }, icon: "➡️", kicker: "Passo 13 — resumo", title: "Avance para revisar", text: "Com ingrediente e rendimento preenchidos, clique em Próximo.", improvement: "Você verá o custo total, o rendimento e o custo unitário antes de gravar.", bullets: ["Composição pronta", "Revisão final"] },
  { path: "/pre-preparo", target: { selector: '[data-tour="prep-summary"]' }, passive: true, icon: "🧮", kicker: "Passo 14 — conferência", title: "Confira os cálculos da receita", text: "Revise o nome, a descrição, o custo total, o rendimento e o custo unitário exibidos no resumo.", improvement: "Se algo estiver errado, use Voltar e corrija antes de salvar.", bullets: ["Custo total", "Rendimento", "Custo por unidade"] },
  { path: "/pre-preparo", target: { selector: '[data-tour="prep-next"]' }, icon: "✅", kicker: "Passo 15 — concluir", title: "Salve o pré-preparo", text: "Quando todos os dados estiverem corretos, clique em Salvar.", improvement: "A base ficará disponível no inventário e como ingrediente das fichas técnicas.", bullets: ["Cadastro completo", "Receitas conectadas"] },
  { path: "/lista-de-compras", icon: "🛒", kicker: "Reposição inteligente", title: "Prepare a lista de compras", text: "A lista ajuda a transformar necessidade de estoque em uma rotina objetiva de compra.", improvement: "Revise itens e quantidades sugeridas, faça ajustes e use a lista como guia da reposição.", bullets: ["Necessidade visível", "Quantidades sugeridas", "Compra organizada"] },
  { path: "/lista-de-compras", target: { selector: 'select' }, passive: true, completion: { selector: 'select', event: "change" }, icon: "📅", kicker: "Defina a necessidade", title: "Comece pelo período", text: "A lista compara inventários para entender o estoque disponível e sugerir reposição.", improvement: "Clique no campo e escolha uma opção. Assim que o período mudar, eu avanço automaticamente.", bullets: ["Inventário inicial", "Inventário final", "Avanço automático"] },
  { path: "/lista-de-compras", target: { selector: 'input[placeholder="Pesquise por itens..."]' }, passive: true, icon: "🔎", kicker: "Encontre e filtre", title: "Refine a lista", text: "A busca, categoria e fornecedor ajudam a enxergar apenas o que será comprado naquele momento.", improvement: "Depois de conferir quantidades, você pode exportar a lista em PDF ou XLSX para usar fora do sistema.", bullets: ["Busca", "Categoria ou fornecedor", "PDF e XLSX"] },
  { path: "/desperdicios", icon: "♻️", kicker: "Controle de perdas", title: "Registre desperdícios", text: "Perdas precisam sair do estoque e aparecer separadas das vendas.", improvement: "Escolha o item, informe quantidade e motivo. Assim o estoque e o CMV refletem o que realmente aconteceu.", bullets: ["Motivo registrado", "Estoque correto", "Impacto visível"] },
  { path: "/desperdicios", target: { text: "Desperdício", tag: "button" }, icon: "➕", kicker: "Registre a ocorrência", title: "Abra um lançamento", text: "O lançamento identifica o item perdido, a quantidade e o motivo.", improvement: "Clique para conhecer os campos. Nenhuma perda será registrada sem salvar.", bullets: ["Item", "Quantidade", "Motivo"] },
  { path: "/desperdicios", target: { selector: '[role="dialog"]' }, passive: true, icon: "📝", kicker: "Cadastro do desperdício", title: "Informe todos os detalhes", text: "Selecione item, data, quantidade, unidade e motivo para registrar a perda corretamente.", improvement: "O custo é calculado a partir do item e a saída passa a compor os relatórios sem ser confundida com venda.", bullets: ["Data e item", "Quantidade e unidade", "Motivo e custo"] },
  { path: "/desperdicios", target: { selector: '[role="dialog"] button[aria-label="Fechar"]' }, icon: "✅", kicker: "Sem alterar estoque", title: "Feche o lançamento", text: "Use essa rotina sempre que uma perda ocorrer para manter os números confiáveis.", improvement: "Feche pelo X para concluir sem salvar.", bullets: ["Nenhuma perda registrada"] },
  { path: "/ajustes", icon: "⚙️", kicker: "Sua operação", title: "Configure empresa e equipe", text: "Ajustes reúne dados da conta, usuários, empresa, unidades e preferências.", improvement: "Revise acessos e configurações sempre que a equipe ou a operação mudar.", bullets: ["Usuários", "Permissões", "Configurações"] },
  { path: "/ajustes", target: { text: "Cadastrar novo usuário", tag: "button" }, icon: "👥", kicker: "Equipe e acesso", title: "Conheça o cadastro de usuários", text: "Administradores podem convidar pessoas e escolher o nível de acesso.", improvement: "Clique para abrir o formulário. Só envie um convite quando os dados estiverem corretos.", bullets: ["Nome", "E-mail", "Permissão"] },
  { path: "/ajustes", target: { selector: 'input[type="email"]' }, passive: true, completion: { selector: 'input[type="email"]', event: "blur" }, icon: "🔐", kicker: "Permissões seguras", title: "Preencha o convite", text: "Informe nome, e-mail e escolha se a pessoa será administradora ou colaboradora.", improvement: "Ao terminar o e-mail e sair do campo, eu avanço. Depois use a mesma área para editar permissões ou remover acessos.", bullets: ["Digite o e-mail", "Escolha a permissão", "Avanço automático"] },
  { path: "/ajustes", icon: "🎓", kicker: "Treinamento concluído", title: "Você já sabe onde revisar", text: "A Academia CMV Fácil continua disponível no botão Tutorial do sistema.", improvement: "Volte sempre que quiser praticar um cadastro, relembrar uma rotina ou ensinar alguém da equipe.", bullets: ["Curso completo", "Módulos separados", "Progresso salvo"] },
  { path: "/ajustes", target: { selector: 'button[data-tour="support"]' }, icon: "💬", kicker: "Última etapa", title: "Fale comigo quando precisar", text: "Agora que você conheceu o sistema, saiba que o botão Ajuda acompanha você em todas as telas.", improvement: "Clique no botão iluminado. Você pode tirar dúvidas, descrever um problema, anexar imagem ou vídeo e encaminhar o chamado ao suporte com o contexto da tela.", bullets: ["Dúvidas no sistema", "Imagem ou vídeo", "Atendimento com contexto"] },
];

const learningModules = [
  { id: "inventario", title: "Inventário", description: "Contagens, setores e conferência", icon: "📦", step: steps.findIndex(item => item.title === "Abra o Inventário") },
  { id: "entradas", title: "Entradas e notas", description: "Fornecedores, itens e conversão", icon: "🧾", step: steps.findIndex(item => item.title === "Vamos para Entradas") },
  { id: "cmv", title: "CMV Real", description: "Indicadores e leitura do resultado", icon: "📊", step: steps.findIndex(item => item.title === "Entenda o CMV Real") },
  { id: "insumos", title: "Insumos", description: "Cadastros e unidades", icon: "🥫", step: steps.findIndex(item => item.title === "Organize seus insumos") },
  { id: "fornecedores", title: "Fornecedores", description: "Vínculos e histórico", icon: "🚚", step: steps.findIndex(item => item.title === "Gerencie fornecedores") },
  { id: "fichas", title: "Fichas técnicas", description: "Ingredientes, custo e rendimento", icon: "🍽️", step: steps.findIndex(item => item.title === "Monte fichas técnicas") },
  { id: "preparo", title: "Pré-preparos", description: "Bases e produção intermediária", icon: "👨‍🍳", step: steps.findIndex(item => item.title === "Cadastre pré-preparos") },
  { id: "compras", title: "Lista de compras", description: "Reposição orientada", icon: "🛒", step: steps.findIndex(item => item.title === "Prepare a lista de compras") },
  { id: "desperdicios", title: "Desperdícios", description: "Perdas e impacto no estoque", icon: "♻️", step: steps.findIndex(item => item.title === "Registre desperdícios") },
  { id: "ajustes", title: "Empresa e usuários", description: "Acessos e configurações", icon: "⚙️", step: steps.findIndex(item => item.title === "Configure empresa e equipe") },
] as const;

const stepIndex = (title: string) => steps.findIndex(item => item.title === title);
const stepRange = (firstTitle: string, nextTitle: string) => {
  const first = stepIndex(firstTitle);
  const next = stepIndex(nextTitle);
  return Array.from({ length: Math.max(0, next - first) }, (_, index) => first + index);
};

// O curso completo acompanha a ordem real da operação: cadastros primeiro,
// movimentos depois e análise gerencial por último.
const fullCourseSteps = [
  ...stepRange("Organize seus insumos", "Gerencie fornecedores"),
  ...stepRange("Gerencie fornecedores", "Monte fichas técnicas"),
  ...stepRange("Abra uma nova nota", "Entenda o CMV Real"),
  ...stepRange("Cadastre pré-preparos", "Prepare a lista de compras"),
  ...stepRange("Monte fichas técnicas", "Cadastre pré-preparos"),
  ...stepRange("Crie uma nova contagem", "Vamos para Entradas"),
  ...stepRange("Registre desperdícios", "Configure empresa e equipe"),
  ...stepRange("Prepare a lista de compras", "Registre desperdícios"),
  ...stepRange("Configure empresa e equipe", "Você já sabe onde revisar"),
  stepIndex("Você já sabe onde revisar"),
  ...stepRange("Entenda o CMV Real", "Organize seus insumos"),
  stepIndex("Fale comigo quando precisar"),
].filter((value, index, values) => value >= 0 && values.indexOf(value) === index);

type Me = { userId?: string; email?: string; nomeCompleto?: string; companyName?: string; source?: { hasBubbleMatch?: boolean; userBubbleId?: string | null } };
type ChatLine = { from: "bot" | "user"; text: string };

export default function MigrationExperience() {
  const pathname = usePathname();
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [tourOpen, setTourOpen] = useState(false);
  const [learningOpen, setLearningOpen] = useState(false);
  const [activeModule, setActiveModule] = useState<string | null>(null);
  const [completedModules, setCompletedModules] = useState<string[]>([]);
  const [step, setStep] = useState(0);
  const [chatOpen, setChatOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [ticket, setTicket] = useState<{ protocol: string; whatsappUrl: string; forwarded: boolean } | null>(null);
  const [typedText, setTypedText] = useState("");
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const [revealRect, setRevealRect] = useState<DOMRect | null>(null);
  const [targetUnavailable, setTargetUnavailable] = useState(false);
  const [lines, setLines] = useState<ChatLine[]>([{ from: "bot", text: "Olá! Sou o assistente do CMV Fácil. Conte sua dúvida ou o que não está funcionando." }]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    router.prefetch("/dashboard");
    router.prefetch("/inventario");
    router.prefetch("/entradas");
    learningModules.forEach(module => router.prefetch(steps[module.step].path));
    try { setCompletedModules(JSON.parse(localStorage.getItem(MODULE_PROGRESS_KEY) || "[]")); } catch { setCompletedModules([]); }
    if (localStorage.getItem(DONE_TOUR_KEY) !== "done") {
      const savedStep = Number(sessionStorage.getItem(ACTIVE_TOUR_KEY) ?? "0");
      const initialStep = Number.isInteger(savedStep) && savedStep >= 0 && savedStep < steps.length ? savedStep : 0;
      sessionStorage.setItem(ACTIVE_TOUR_KEY, String(initialStep));
      setStep(initialStep);
      setTourOpen(true);
      if (pathname !== steps[initialStep].path) router.replace(steps[initialStep].path);
    }
    fetch(`/api/me?tour=1&ts=${Date.now()}`, { cache: "no-store" })
      .then(r => r.json())
      .then((data: Me & { ok?: boolean }) => {
        if (!active || !data?.ok) return;
        setMe(data);
      })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  const saveModuleProgress = (moduleId: string) => {
    setCompletedModules(current => {
      const next = current.includes(moduleId) ? current : [...current, moduleId];
      localStorage.setItem(MODULE_PROGRESS_KEY, JSON.stringify(next));
      return next;
    });
  };

  const startFullTour = () => {
    setActiveModule(null); setLearningOpen(false); setTourOpen(true);
    goToStep(fullCourseSteps[0]);
  };

  const startModule = (moduleId: string, moduleStep: number) => {
    setActiveModule(moduleId); setLearningOpen(false); setTourOpen(true);
    goToStep(moduleStep);
  };

  const moduleEndStep = (moduleId: string) => {
    const index = learningModules.findIndex(module => module.id === moduleId);
    return index < 0 ? steps.length - 1 : (learningModules[index + 1]?.step ?? steps.length) - 1;
  };

  const advance = (currentStep: number) => {
    if (activeModule && currentStep >= moduleEndStep(activeModule)) {
      saveModuleProgress(activeModule); setTourOpen(false); setActiveModule(null); setLearningOpen(true);
      return;
    }
    const coursePosition = fullCourseSteps.indexOf(currentStep);
    const next = activeModule ? currentStep + 1 : fullCourseSteps[coursePosition + 1];
    if (next === undefined || next < 0) { finishTour(); return; }
    goToStep(next);
  };

  const visibleStepSequence = activeModule
    ? Array.from({ length: moduleEndStep(activeModule) - (learningModules.find(module => module.id === activeModule)?.step ?? step) + 1 }, (_, index) => (learningModules.find(module => module.id === activeModule)?.step ?? step) + index)
    : fullCourseSteps;
  const visibleStepPosition = Math.max(0, visibleStepSequence.indexOf(step));

  useEffect(() => {
    if (!tourOpen) return;
    const completion = steps[step]?.completion;
    if (!completion) return;
    let completionTimer = 0;
    const onComplete = (event: Event) => {
      if (!(event.target instanceof Element)) return;
      if (!event.target.closest(completion.selector)) return;
      if ((completion.requireValue || completion.event === "blur") && event.target instanceof HTMLInputElement && !event.target.value.trim()) return;
      if (completionTimer) window.clearTimeout(completionTimer);
      completionTimer = window.setTimeout(() => advance(step), completion.debounceMs ?? (completion.event === "blur" ? 700 : 80));
    };
    const observedEvent = completion.event === "blur" ? "input" : completion.event;
    document.addEventListener(observedEvent, onComplete, true);
    return () => { if (completionTimer) window.clearTimeout(completionTimer); document.removeEventListener(observedEvent, onComplete, true); };
  }, [activeModule, step, tourOpen]);

  useEffect(() => {
    if (tourOpen) document.documentElement.dataset.cmvOnboardingTour = "active";
    else delete document.documentElement.dataset.cmvOnboardingTour;
    return () => { delete document.documentElement.dataset.cmvOnboardingTour; };
  }, [tourOpen]);

  useEffect(() => {
    const onCategoryRequired = () => {
      const categoryStep = steps.findIndex(item => item.title === "Dê um nome à categoria");
      if (categoryStep >= 0) goToStep(categoryStep);
    };
    const onCategoryReturn = () => {
      const categorySelectStep = steps.findIndex(item => item.title === "Escolha a categoria criada");
      if (categorySelectStep >= 0) goToStep(categorySelectStep);
    };
    window.addEventListener("cmv:tour:category-required", onCategoryRequired);
    window.addEventListener("cmv:tour:category-return", onCategoryReturn);
    return () => { window.removeEventListener("cmv:tour:category-required", onCategoryRequired); window.removeEventListener("cmv:tour:category-return", onCategoryReturn); };
  }, [pathname]);

  useEffect(() => {
    if (!tourOpen || step === 0) return;
    const fullText = `${steps[step].text} ${steps[step].improvement}`;
    setTypedText("");
    let cursor = 0;
    const timer = window.setInterval(() => {
      cursor = Math.min(fullText.length, cursor + 9);
      setTypedText(fullText.slice(0, cursor));
      if (cursor >= fullText.length) window.clearInterval(timer);
    }, 28);
    return () => window.clearInterval(timer);
  }, [step, tourOpen]);

  useEffect(() => {
    if (!tourOpen || step === 0 || !steps[step].target) { setTargetRect(null); setRevealRect(null); setTargetUnavailable(false); return; }
    let didScroll = false;
    let timer = 0;
    setTargetUnavailable(false);
    const unavailableTimer = window.setTimeout(() => setTargetUnavailable(true), 2600);
    const locate = () => {
      const target = steps[step].target as { selector?: string; text?: string; tag?: string };
      let element = findTourTarget(target);
      if (element instanceof HTMLElement && element.dataset.cmvTourUi === "true") element = null;
      if (element instanceof HTMLElement && element.closest('[data-cmv-tour-ui="true"]')) element = null;
      if (element instanceof HTMLElement) {
        const outerRect = element.getBoundingClientRect();
        if (steps[step].passive && element.getAttribute("role") === "dialog" && outerRect.width > window.innerWidth * .82 && element.firstElementChild instanceof HTMLElement) {
          element = element.firstElementChild;
        }
        const rect = element.getBoundingClientRect();
        const revealElement = element.closest('[role="dialog"]') instanceof HTMLElement ? element.closest('[role="dialog"]') as HTMLElement : element;
        const visibleRect = revealElement.getBoundingClientRect();
        setTargetRect(previous => previous && Math.abs(previous.left - rect.left) < 1 && Math.abs(previous.top - rect.top) < 1 && Math.abs(previous.width - rect.width) < 1 && Math.abs(previous.height - rect.height) < 1 ? previous : rect);
        setRevealRect(previous => previous && Math.abs(previous.left - visibleRect.left) < 1 && Math.abs(previous.top - visibleRect.top) < 1 && Math.abs(previous.width - visibleRect.width) < 1 && Math.abs(previous.height - visibleRect.height) < 1 ? previous : visibleRect);
        const noSelectableValue = element instanceof HTMLSelectElement
          && Array.from(element.options).filter(option => !option.disabled && String(option.value).trim()).length === 0;
        setTargetUnavailable(noSelectableValue);
        if (!didScroll && (rect.top < 8 || rect.bottom > window.innerHeight - 8)) { didScroll = true; element.scrollIntoView({ block: "center", behavior: "smooth" }); }
        if (!noSelectableValue && timer) window.clearInterval(timer);
        return !noSelectableValue;
      }
      return false;
    };
    if (!locate()) timer = window.setInterval(locate, 160);
    window.addEventListener("resize", locate); window.addEventListener("scroll", locate, true);
    return () => { window.clearTimeout(unavailableTimer); if (timer) window.clearInterval(timer); window.removeEventListener("resize", locate); window.removeEventListener("scroll", locate, true); };
  }, [step, tourOpen, pathname]);

  useEffect(() => {
    if (!tourOpen || step === 0 || !steps[step].target) return;
    if (steps[step].passive) return;
    const onClick = (event: MouseEvent) => {
      const target = steps[step].target as { selector?: string; text?: string; tag?: string };
      const element = findTourTarget(target);
      if (!element || !(event.target instanceof Node) || !element.contains(event.target)) return;
      if (element instanceof HTMLAnchorElement) {
        event.preventDefault();
      }
      if (activeModule && step >= moduleEndStep(activeModule)) {
        saveModuleProgress(activeModule); setTourOpen(false); setActiveModule(null); setLearningOpen(true);
        return;
      }
      const coursePosition = fullCourseSteps.indexOf(step);
      const next = activeModule ? step + 1 : fullCourseSteps[coursePosition + 1];
      if (next === undefined || next < 0) { finishTour(); return; }
      sessionStorage.setItem(ACTIVE_TOUR_KEY, String(next)); setStep(next);
      const destination = steps[next]?.path;
      if (destination && pathname !== destination) router.push(destination);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [activeModule, pathname, router, step, tourOpen]);

  const goToStep = (nextStep: number) => {
    const bounded = Math.max(0, Math.min(steps.length - 1, nextStep));
    sessionStorage.setItem(ACTIVE_TOUR_KEY, String(bounded));
    setStep(bounded);
    const destination = steps[bounded].path;
    if (pathname !== destination) router.push(destination);
  };

  const fileLabel = useMemo(() => files.map(file => file.name).join(", "), [files]);
  const coachStyle = useMemo(() => {
    if (!targetRect || typeof window === "undefined") return undefined;
    const anchorRect = targetRect;
    const showingContainer = Boolean(revealRect && (Math.abs(revealRect.width - targetRect.width) > 4 || Math.abs(revealRect.height - targetRect.height) > 4));
    const cardWidth = Math.min(showingContainer ? 310 : 430, window.innerWidth - 32);
    const cardHeight = Math.min(showingContainer ? 520 : 440, window.innerHeight - 32);
    if (showingContainer && revealRect && window.innerWidth >= 700) {
      const gap = 14;
      const spaces = {
        top: revealRect.top - 16 - gap,
        bottom: window.innerHeight - revealRect.bottom - 16 - gap,
        left: revealRect.left - 16 - gap,
        right: window.innerWidth - revealRect.right - 16 - gap,
      };
      const hasExternalRoom = spaces.left >= cardWidth || spaces.right >= cardWidth || spaces.top >= 250 || spaces.bottom >= 250;
      if (!hasExternalRoom) {
        const targetIsRight = targetRect.left + targetRect.width / 2 > window.innerWidth / 2;
        const targetIsLow = targetRect.top + targetRect.height / 2 > window.innerHeight / 2;
        return {
          left: targetIsRight ? 16 : Math.max(16, window.innerWidth - cardWidth - 16),
          top: targetIsLow ? "auto" : 16,
          right: "auto",
          bottom: targetIsLow ? 16 : "auto",
          width: cardWidth,
          maxHeight: Math.max(260, window.innerHeight - 32),
          overflowY: "auto" as const,
        };
      }
      const side = (Object.entries(spaces).sort((a, b) => b[1] - a[1])[0]?.[0] || "top") as keyof typeof spaces;
      if (side === "top" || side === "bottom") {
        const available = Math.max(190, spaces[side]);
        return {
          left: Math.min(window.innerWidth - cardWidth - 16, Math.max(16, revealRect.left + revealRect.width / 2 - cardWidth / 2)),
          top: side === "top" ? 16 : revealRect.bottom + gap,
          right: "auto", bottom: "auto", width: cardWidth,
          maxHeight: available, overflowY: "auto" as const,
        };
      }
      const availableWidth = Math.max(250, spaces[side]);
      const width = Math.min(cardWidth, availableWidth);
      return {
        left: side === "left" ? 16 : Math.min(window.innerWidth - width - 16, revealRect.right + gap),
        top: Math.min(window.innerHeight - cardHeight - 16, Math.max(16, revealRect.top + revealRect.height / 2 - cardHeight / 2)),
        right: "auto", bottom: "auto", width,
        maxHeight: window.innerHeight - 32, overflowY: "auto" as const,
      };
    }
    if (window.innerWidth < 700) {
      const targetIsLow = anchorRect.top + anchorRect.height / 2 > window.innerHeight / 2;
      return { left: 10, top: targetIsLow ? 10 : Math.max(10, window.innerHeight - cardHeight - 10), right: "auto", bottom: "auto" };
    }
    const targetIsRight = anchorRect.left + anchorRect.width / 2 > window.innerWidth / 2;
    const left = targetIsRight
      ? Math.max(16, anchorRect.left - cardWidth - 24)
      : Math.min(window.innerWidth - cardWidth - 16, anchorRect.right + 24);
    const top = Math.min(window.innerHeight - cardHeight - 16, Math.max(16, anchorRect.top + anchorRect.height / 2 - cardHeight / 2));
    return { left, top, right: "auto", bottom: "auto", width: cardWidth };
  }, [targetRect, revealRect]);
  const finishTour = () => {
    localStorage.setItem(DONE_TOUR_KEY, "done");
    if (me?.userId) localStorage.setItem(`cmvfacil:onboarding:${TOUR_VERSION}:${me.userId}`, "done");
    sessionStorage.removeItem(ACTIVE_TOUR_KEY);
    setTourOpen(false); setStep(0);
  };
  const restartTour = () => {
    localStorage.removeItem(DONE_TOUR_KEY);
    setTourOpen(false); setActiveModule(null); setLearningOpen(true);
  };
  const onFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(event.target.files ?? []).filter(file => /^(image|video)\//.test(file.type)).slice(0, 3);
    setFiles(selected);
  };
  const submit = async () => {
    const bodyText = message.trim();
    if (!bodyText || sending) return;
    setLines(current => [...current, { from: "user", text: bodyText }]);
    setSending(true); setTicket(null);
    try {
      const body = new FormData(); body.set("message", bodyText); body.set("page", String(pathname || "/"));
      files.forEach(file => body.append("attachments", file));
      const response = await fetch("/api/support/ticket", { method: "POST", body });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.ok) throw new Error(data?.error || "Não foi possível registrar o chamado.");
      setTicket({ protocol: data.protocol, whatsappUrl: data.whatsappUrl, forwarded: data.forwarded === true });
      setLines(current => [...current, { from: "bot", text: data.forwarded === true
        ? `Chamado ${data.protocol} registrado e enviado automaticamente ao suporte. Você receberá o retorno pelo WhatsApp.`
        : `Chamado ${data.protocol} registrado. O envio automático não respondeu; use o botão abaixo para encaminhar pelo WhatsApp.` }]);
      setMessage(""); setFiles([]); if (inputRef.current) inputRef.current.value = "";
    } catch (error) {
      const fallback = `https://wa.me/${SUPPORT_PHONE}?text=${encodeURIComponent(`Olá, preciso de suporte no CMV Fácil.\nUsuário: ${me?.email || "não identificado"}\nEmpresa: ${me?.companyName || "não identificada"}\nPágina: ${pathname}\nProblema: ${bodyText}`)}`;
      setTicket({ protocol: "sem protocolo", whatsappUrl: fallback, forwarded: false });
      setLines(current => [...current, { from: "bot", text: error instanceof Error ? `${error.message} Você ainda pode encaminhar a mensagem pelo WhatsApp.` : "Você pode encaminhar a mensagem pelo WhatsApp." }]);
    } finally { setSending(false); }
  };

  return <>
    {learningOpen ? <div data-cmv-tour-ui="true" className={styles.overlay} role="dialog" aria-modal="true" aria-label="Academia CMV Fácil">
      <section className={`${styles.tourCard} ${styles.learningCard}`}>
        <header className={styles.tourHeader}><strong><span>cmv</span>fácil</strong><div>Academia CMV Fácil <b>{completedModules.length}/{learningModules.length}</b></div></header>
        <div className={styles.learningIntro}>
          <div><span className={styles.learningRobot}>🤖</span><div><div className={styles.eyebrow}>Seu guia permanente</div><h2>O que você quer aprender?</h2><p>Faça o treinamento completo se estiver começando ou abra somente uma rotina para relembrar. Seu progresso fica salvo.</p></div></div>
          <button className={styles.primary} onClick={startFullTour}>Começar curso completo <span>→</span></button>
        </div>
        <div className={styles.moduleGrid}>{learningModules.map(module => {
          const done = completedModules.includes(module.id);
          return <button key={module.id} className={styles.moduleCard} onClick={() => startModule(module.id, module.step)}>
            <span className={styles.moduleIcon}>{module.icon}</span><span><strong>{module.title}</strong><small>{module.description}</small></span><b>{done ? "✓ Revisado" : "Começar →"}</b>
          </button>;
        })}</div>
        <div className={styles.learningFooter}><button className={styles.skip} onClick={() => setLearningOpen(false)}>Fechar academia</button><small>Você poderá abrir novamente pelo botão Tutorial do sistema.</small></div>
      </section>
    </div> : null}
    {tourOpen && step === 0 ? <div data-cmv-tour-ui="true" className={styles.overlay} role="dialog" aria-modal="true" aria-label="Conheça o novo CMV Fácil">
      <section className={styles.tourCard}>
        <header className={styles.tourHeader}><strong><span>cmv</span>fácil</strong><div>Tour de novidades <b>{step + 1}/{steps.length}</b></div></header>
        <div className={styles.progress}>{steps.map((item, index) => <button key={item.title} aria-label={`Ir para etapa ${index + 1}`} onClick={() => goToStep(index)} className={index <= step ? styles.progressOn : ""}><span /></button>)}</div>
        <div className={styles.tourBody}>
          <div className={`${styles.visual} ${styles[`visual${step}`] || ""}`}>
            <span className={styles.orbOne} /><span className={styles.orbTwo} />
            <div className={styles.heroIcon}>{steps[step].icon}</div>
            <div className={styles.miniWindow}><i /><i /><i /><div><span /><span /><span /></div></div>
            <small>PASSO {String(step + 1).padStart(2, "0")}</small>
          </div>
          <div className={styles.copy}>
            <div className={styles.eyebrow}>{steps[step].kicker}</div>
            <h2>{steps[step].title}</h2><p>{steps[step].text}</p>
            <ul>{steps[step].bullets.map(item => <li key={item}><span>✓</span>{item}</li>)}</ul>
          </div>
        </div>
        <div className={styles.tourActions}>
          <button className={styles.skip} onClick={() => { setTourOpen(false); setLearningOpen(true); }}>Escolher um módulo</button>
          <div><button className={styles.ghost} disabled={step === 0} onClick={() => goToStep(step - 1)}>Voltar</button>
          <button className={styles.primary} onClick={startFullTour}>Aprender o sistema completo <span>→</span></button></div>
        </div>
      </section>
    </div> : null}
    {tourOpen && step > 0 ? <aside data-cmv-tour-ui="true" key={step} style={coachStyle} className={styles.coach} role="dialog" aria-label="Guia do novo CMV Fácil">
      <div className={styles.coachGlow} />
      <header className={styles.coachHeader}>
        <div className={styles.robot}><span>{steps[step].icon}</span><i>🤖</i></div>
        <div><strong>Fácil, seu guia</strong><small><i /> explicando esta tela</small></div>
        <b>{visibleStepPosition + 1}/{visibleStepSequence.length}</b>
      </header>
      <div className={styles.speech}>
        <div className={styles.coachKicker}>{steps[step].kicker}</div>
        <h3>{steps[step].title}</h3>
        <p>{typedText}<span className={styles.typingCursor} /></p>
        <div className={styles.benefits}>{steps[step].bullets.map(item => <span key={item}>✓ {item}</span>)}</div>
      </div>
      <div className={styles.coachProgress}>{visibleStepSequence.map((stepIndexValue, index) => <button aria-label={`Etapa ${index + 1}`} key={`${steps[stepIndexValue].title}-${stepIndexValue}`} onClick={() => goToStep(stepIndexValue)} className={index === visibleStepPosition ? styles.coachProgressOn : index < visibleStepPosition ? styles.coachProgressDone : ""} />)}</div>
      <div className={styles.coachActions}>
        <button className={styles.coachSkip} onClick={finishTour}>Encerrar tour</button>
        <div><button className={styles.coachBack} onClick={() => goToStep(step - 1)}>←</button>{steps[step].target && (!steps[step].passive || steps[step].completion) ? <strong className={styles.clickHint}>Faça a ação destacada para continuar</strong> : <button className={styles.coachNext} onClick={() => advance(step)}>{visibleStepPosition === 0 ? "Começar" : activeModule && step >= moduleEndStep(activeModule) ? "Concluir módulo" : "Continuar"} <span>→</span></button>}</div>
      </div>
    </aside> : null}
    {tourOpen && step > 0 && targetRect ? <div className={styles.spotlight} aria-hidden>
      <i style={{ left: 0, top: 0, width: "100%", height: Math.max(0, (revealRect ?? targetRect).top - 9) }} />
      <i style={{ left: 0, top: (revealRect ?? targetRect).bottom + 9, width: "100%", bottom: 0 }} />
      <i style={{ left: 0, top: Math.max(0, (revealRect ?? targetRect).top - 9), width: Math.max(0, (revealRect ?? targetRect).left - 9), height: (revealRect ?? targetRect).height + 18 }} />
      <i style={{ left: (revealRect ?? targetRect).right + 9, top: Math.max(0, (revealRect ?? targetRect).top - 9), right: 0, height: (revealRect ?? targetRect).height + 18 }} />
      <b style={{ left: targetRect.left - 7, top: targetRect.top - 7, width: targetRect.width + 14, height: targetRect.height + 14 }} />
    </div> : null}

    <div className={styles.helpActions}>
      <button className={styles.tourButton} onClick={restartTour}>🎓 Tutorial do sistema</button>
      <button data-tour="support" className={styles.chatButton} onClick={() => setChatOpen(value => !value)} aria-expanded={chatOpen}>💬 Ajuda</button>
    </div>
    {chatOpen ? <aside data-cmv-tour-ui="true" className={styles.chat} aria-label="Assistente de suporte">
      <header><div><strong>Assistente CMV Fácil</strong><small>Suporte e dúvidas</small></div><button onClick={() => setChatOpen(false)} aria-label="Fechar">×</button></header>
      <div className={styles.messages}>{lines.map((line, index) => <div key={index} className={line.from === "bot" ? styles.bot : styles.user}>{line.text}</div>)}</div>
      <div className={styles.composer}>
        <textarea value={message} onChange={event => setMessage(event.target.value)} placeholder="Descreva sua dúvida ou problema…" rows={3} />
        <input ref={inputRef} type="file" accept="image/*,video/*" multiple onChange={onFiles} />
        <button className={styles.attach} onClick={() => inputRef.current?.click()}>📎 Enviar imagem ou vídeo</button>
        {fileLabel ? <small className={styles.files}>{fileLabel}</small> : null}
        <button className={styles.primary} disabled={!message.trim() || sending} onClick={submit}>{sending ? "Registrando…" : "Registrar chamado"}</button>
        {ticket ? <a className={styles.whatsapp} href={ticket.whatsappUrl} target="_blank" rel="noreferrer">{ticket.forwarded ? "Abrir conversa no WhatsApp" : "Enviar pelo WhatsApp"}</a> : null}
      </div>
    </aside> : null}
  </>;
}
