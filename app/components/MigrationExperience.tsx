"use client";

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import styles from "./MigrationExperience.module.css";

const TOUR_VERSION = "2026-09-academia-v16";
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
  completion?: { selector: string; event: "click" | "change" | "blur" };
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
  { path: "/entradas", target: { selector: '[data-tour="entry-items-form"]' }, passive: true, icon: "🧮", kicker: "Passo 4 — produtos", title: "Adicione os itens comprados", text: "Pesquise o insumo, informe quantidade, unidade, subtotal ou custo unitário e use o botão adicionar.", improvement: "O modal inteiro permanece visível, mas o contorno marca exatamente o formulário desta explicação. Todos os insumos aparecem no catálogo e o conversor ajusta caixas, unidades, quilos e litros.", bullets: ["Escolha o insumo", "Informe quantidade e custo", "Adicione e confira"] },
  { path: "/entradas", target: { selector: '[role="dialog"] input[placeholder="Pesquise por itens..."]' }, passive: true, icon: "🔎", kicker: "Passo 5 — catálogo", title: "Encontre qualquer insumo", text: "Digite parte do nome e escolha o item correto no dropdown.", improvement: "Se a embalagem da nota for diferente da unidade do estoque, selecione a conversão correta antes de adicionar.", bullets: ["Pesquise pelo nome", "Escolha o item", "Confira a conversão"] },
  { path: "/entradas", target: { selector: '[role="dialog"] button[aria-label="Fechar"]' }, icon: "✅", kicker: "Passo 6 — finalizar", title: "Confira e feche a nota", text: "Revise fornecedor, data, itens, quantidades, custos e total antes de sair.", improvement: "Clique no X iluminado quando terminar. A nota e os itens já adicionados ficam disponíveis no histórico de entradas.", bullets: ["Revise os itens", "Confira o total", "Feche a janela"] },
  { path: "/dashboard", icon: "📊", kicker: "Gestão e resultado", title: "Entenda o CMV Real", text: "O painel reúne estoque inicial, entradas, estoque final, saídas, custo médio e CMV para transformar a operação em uma leitura gerencial.", improvement: "Use os filtros de período, confira os dados de origem e calcule o indicador. Você pode voltar a este módulo sempre que quiser revisar o cálculo.", bullets: ["Indicadores do período", "Custos conectados", "Decisão mais segura"] },
  { path: "/dashboard", target: { text: "Calcular CMV", tag: "button" }, icon: "🧮", kicker: "Faça a leitura", title: "Calcule o período", text: "Depois de escolher o período e informar o faturamento, este botão atualiza o CMV Real.", improvement: "Confira os filtros antes de clicar. Durante o tutorial, você pode usar o botão para praticar com os dados já preenchidos.", bullets: ["Período conferido", "Faturamento informado", "Resultado atualizado"] },
  { path: "/insumos", icon: "🥫", kicker: "Base do sistema", title: "Organize seus insumos", text: "Insumos alimentam entradas, inventários, fichas técnicas, compras e desperdícios.", improvement: "Cadastre nome, unidade e setor com atenção. O conversor ajuda a relacionar caixas, unidades, quilos e litros sem contas manuais.", bullets: ["Cadastro central", "Conversão de unidades", "Histórico conectado"] },
  { path: "/insumos", target: { selector: '[data-tour="insumos-import-open"]' }, icon: "📥", kicker: "Cadastro em quantidade", title: "Importe uma planilha", text: "Além do cadastro individual, você pode trazer vários itens por planilha.", improvement: "Clique no botão destacado para abrir a importação. O guia só avançará depois do seu clique e não mostrará um atalho de Continuar.", bullets: ["Clique em Importar", "Abra a janela", "Avanço automático"] },
  { path: "/insumos", target: { selector: '[data-tour="insumos-import-close"]' }, icon: "📄", kicker: "Como importar", title: "Conheça a janela da planilha", text: "Aqui você baixa o modelo, preenche nome, categoria, unidade e demais campos e seleciona o arquivo pronto.", improvement: "Depois de importar, confira a prévia antes de confirmar. Neste treinamento, clique no X destacado para fechar sem alterar os dados e seguir ao cadastro manual.", bullets: ["Baixe o modelo", "Preencha e selecione", "Confira antes de importar"] },
  { path: "/insumos", target: { text: "Novo Item", tag: "button" }, icon: "➕", kicker: "Pratique sem salvar", title: "Abra um novo insumo", text: "Este é o início do cadastro que abastece todo o sistema.", improvement: "Clique em Novo Item para conhecer os campos. Nada será gravado sem você confirmar o salvamento.", bullets: ["Nome claro", "Unidade correta", "Setor organizado"] },
  { path: "/insumos", target: { selector: '[data-tour="insumos-new-dialog"]' }, passive: true, icon: "📝", kicker: "Cadastro do insumo", title: "Preencha a identidade do item", text: "O formulário reúne nome, categoria, setor, unidade de medida e informações usadas nas demais rotinas.", improvement: "Um cadastro consistente evita duplicidade e faz o mesmo item aparecer corretamente em notas, inventários, fichas e compras.", bullets: ["Nome padronizado", "Categoria e setor", "Unidade principal"] },
  { path: "/insumos", target: { selector: '[data-tour="insumos-unit"]' }, passive: true, completion: { selector: '[data-tour="insumos-unit"]', event: "change" }, icon: "⚖️", kicker: "Unidades e conversão", title: "Defina como o item é medido", text: "A unidade principal determina como o estoque será contado e calculado.", improvement: "Clique em Unidade de Medida e escolha Und, Kg, g ou L. O guia avançará somente depois da mudança desse campo — Categoria não será confundida com unidade.", bullets: ["Abra Unidade de Medida", "Escolha a unidade correta", "Avanço automático"] },
  { path: "/insumos", target: { selector: '[data-tour="insumos-new-close"]' }, icon: "✅", kicker: "Cadastro conhecido", title: "Confira e feche a janela", text: "Observe nome, categoria, unidade e os demais dados disponíveis.", improvement: "Feche pelo X iluminado para concluir esta prática sem criar um item.", bullets: ["Sem salvar", "Pode refazer depois"] },
  { path: "/fornecedores", icon: "🚚", kicker: "Compras organizadas", title: "Gerencie fornecedores", text: "Aqui você mantém os fornecedores e os produtos vinculados a cada um.", improvement: "Use os vínculos para acelerar notas, preservar o histórico de entradas e comparar de quem cada item foi comprado.", bullets: ["Contatos reunidos", "Produtos vinculados", "Histórico preservado"] },
  { path: "/fornecedores", target: { text: "Importar", tag: "button" }, passive: true, icon: "📥", kicker: "Cadastro em quantidade", title: "Importe fornecedores", text: "A planilha acelera o cadastro inicial de muitos fornecedores.", improvement: "Baixe ou siga o modelo, confira os dados e use o cadastro manual para ajustes individuais.", bullets: ["Planilha", "Conferência", "Edição posterior"] },
  { path: "/fornecedores", target: { text: "Novo Fornecedor", tag: "button" }, icon: "➕", kicker: "Conheça o cadastro", title: "Abra um fornecedor", text: "O cadastro organiza a empresa e os contatos usados nas compras.", improvement: "Clique no botão iluminado. Você poderá conhecer a janela sem salvar.", bullets: ["Dados do fornecedor", "Contato", "Vínculos"] },
  { path: "/fornecedores", target: { selector: '[role="dialog"]' }, passive: true, icon: "📝", kicker: "Cadastro completo", title: "Registre os dados do fornecedor", text: "Use nome, vendedor, telefone, endereço e observações para deixar as compras organizadas.", improvement: "Depois de cadastrar, abra o fornecedor na tabela para vincular os produtos que ele vende aos insumos do sistema.", bullets: ["Empresa", "Vendedor e telefone", "Endereço"] },
  { path: "/fornecedores", target: { selector: '[role="dialog"] button[aria-label="Fechar"]' }, icon: "✅", kicker: "Tudo conferido", title: "Feche o cadastro", text: "Depois do cadastro, os produtos podem ser vinculados ao fornecedor e usados nas entradas.", improvement: "Clique no X para concluir este módulo sem alterar dados.", bullets: ["Nenhuma alteração salva"] },
  { path: "/fichas-tecnicas", icon: "🍽️", kicker: "Custo dos produtos", title: "Monte fichas técnicas", text: "A ficha transforma ingredientes e quantidades no custo real do produto vendido.", improvement: "Inclua os ingredientes, informe o rendimento e confira custo unitário, CMV atual e preço sugerido.", bullets: ["Ingredientes", "Rendimento", "Preço sugerido"] },
  { path: "/fichas-tecnicas", target: { text: "Nova Ficha Técnica", tag: "button" }, icon: "➕", kicker: "Monte uma receita", title: "Abra uma nova ficha", text: "Aqui começa a composição de um produto vendido.", improvement: "Clique para conhecer ingredientes, rendimento e preço. Nada será salvo sem confirmação.", bullets: ["Ingredientes", "Quantidade", "Rendimento"] },
  { path: "/fichas-tecnicas", target: { selector: '[role="dialog"]' }, passive: true, icon: "📝", kicker: "Cadastro da ficha", title: "Conheça toda a composição", text: "Cadastre nome, categoria, preço de venda, CMV meta, rendimento, ingredientes e modo de preparo.", improvement: "Quantidades e custos dos ingredientes formam o custo total; o rendimento transforma esse valor em custo por porção e preço sugerido.", bullets: ["Preço e meta", "Ingredientes", "Rendimento e preparo"] },
  { path: "/fichas-tecnicas", target: { selector: '[role="dialog"] select' }, passive: true, icon: "🔎", kicker: "Ingredientes conectados", title: "Escolha insumos e pré-preparos", text: "A lista permite montar a receita com itens já cadastrados.", improvement: "Informe a quantidade na unidade correta; o sistema usa o custo atual para recalcular a ficha automaticamente.", bullets: ["Busca de ingredientes", "Quantidade", "Custo automático"] },
  { path: "/fichas-tecnicas", target: { selector: '[role="dialog"] button[aria-label="Fechar"]' }, icon: "✅", kicker: "Estrutura conhecida", title: "Feche a ficha", text: "O custo da receita será calculado a partir dos ingredientes informados.", improvement: "Feche a janela para continuar sem criar uma ficha.", bullets: ["Sem salvar dados"] },
  { path: "/pre-preparo", icon: "👨‍🍳", kicker: "Produção intermediária", title: "Cadastre pré-preparos", text: "Molhos, massas e outras bases podem ser produzidos antes e usados em várias fichas.", improvement: "Registre ingredientes e rendimento para que o custo seja reaproveitado corretamente nas receitas finais.", bullets: ["Bases reutilizáveis", "Custo automático", "Receitas conectadas"] },
  { path: "/pre-preparo", target: { text: "Nova Receita", tag: "button" }, icon: "➕", kicker: "Crie uma base", title: "Abra um pré-preparo", text: "Pré-preparos transformam vários ingredientes em uma base reutilizável.", improvement: "Clique para conhecer o cadastro de receita e rendimento.", bullets: ["Ingredientes", "Rendimento", "Validade"] },
  { path: "/pre-preparo", target: { selector: '[role="dialog"]' }, passive: true, icon: "📝", kicker: "Cadastro completo", title: "Defina receita, rendimento e validade", text: "O pré-preparo possui nome, categoria, unidade, rendimento, validade, ingredientes e instruções de preparo.", improvement: "O rendimento correto é essencial para calcular o custo da base utilizada nas fichas técnicas finais.", bullets: ["Receita", "Rendimento", "Validade e preparo"] },
  { path: "/pre-preparo", target: { selector: '[role="dialog"] button[aria-label="Abrir lista de insumos"]' }, passive: true, icon: "🔎", kicker: "Monte os ingredientes", title: "Use o catálogo de insumos", text: "A busca reúne os itens cadastrados para formar a receita.", improvement: "Escolha o insumo, informe quantidade e unidade e use o botão adicionar para compor a base.", bullets: ["Catálogo", "Quantidade", "Adicionar ingrediente"] },
  { path: "/pre-preparo", target: { selector: '[role="dialog"] button[aria-label="Fechar"]' }, icon: "✅", kicker: "Prática concluída", title: "Feche a receita", text: "Depois de salva, a base poderá ser usada como ingrediente em outras fichas.", improvement: "Feche pelo X para continuar sem gravar dados.", bullets: ["Sem salvar dados"] },
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
    const onComplete = (event: Event) => {
      if (!(event.target instanceof Element)) return;
      if (!event.target.closest(completion.selector)) return;
      window.setTimeout(() => advance(step), 80);
    };
    document.addEventListener(completion.event, onComplete, true);
    return () => document.removeEventListener(completion.event, onComplete, true);
  }, [activeModule, step, tourOpen]);

  useEffect(() => {
    if (tourOpen) document.documentElement.dataset.cmvOnboardingTour = "active";
    else delete document.documentElement.dataset.cmvOnboardingTour;
    return () => { delete document.documentElement.dataset.cmvOnboardingTour; };
  }, [tourOpen]);

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
        {targetUnavailable ? <div className={styles.prerequisiteNote}>Esta conta ainda não possui os dados necessários para praticar esta ação. Cadastre o item indicado primeiro; o guia permite seguir sem salvar dados de demonstração.</div> : null}
        <div className={styles.benefits}>{steps[step].bullets.map(item => <span key={item}>✓ {item}</span>)}</div>
      </div>
      <div className={styles.coachProgress}>{visibleStepSequence.map((stepIndexValue, index) => <button aria-label={`Etapa ${index + 1}`} key={`${steps[stepIndexValue].title}-${stepIndexValue}`} onClick={() => goToStep(stepIndexValue)} className={index === visibleStepPosition ? styles.coachProgressOn : index < visibleStepPosition ? styles.coachProgressDone : ""} />)}</div>
      <div className={styles.coachActions}>
        <button className={styles.coachSkip} onClick={finishTour}>Encerrar tour</button>
        <div><button className={styles.coachBack} onClick={() => goToStep(step - 1)}>←</button>{steps[step].target && (!steps[step].passive || steps[step].completion) && !targetUnavailable ? <strong className={styles.clickHint}>Faça a ação destacada para continuar</strong> : <button className={styles.coachNext} onClick={() => advance(step)}>{targetUnavailable ? "Seguir sem dados" : activeModule && step >= moduleEndStep(activeModule) ? "Concluir módulo" : "Continuar"} <span>→</span></button>}</div>
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
