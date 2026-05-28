import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin";
import { getUserIdFromRequest } from "../../../lib/requestUserId";
import { formatDateLabelPT, formatMoneyBRL, parseBubbleCsvToObjects, parseDateLoose, parsePtNumber, pickFirst, type CsvObjectRow } from "../../../lib/bubbleCsv";

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  return NextResponse.json(data, { ...init, headers });
}

async function ensureBucket(supabase: ReturnType<typeof getSupabaseAdmin>, bucket: string) {
  const got = await supabase.storage.getBucket(bucket);
  if (!got.error) return;
  await supabase.storage.createBucket(bucket, { public: false }).catch(() => {});
}

async function listAllPaths(supabase: ReturnType<typeof getSupabaseAdmin>, bucket: string, userPrefix: string) {
  const { data: level1, error: err1 } = await supabase.storage.from(bucket).list(userPrefix, { limit: 1000, sortBy: { column: "name", order: "asc" } });
  if (err1) throw new Error(err1.message);
  const paths: { path: string; name: string; updated_at?: string; size?: number }[] = [];
  const folders = (level1 ?? []).filter((it) => (it as any).id == null);
  const files = (level1 ?? []).filter((it) => (it as any).id != null);

  for (const f of files) {
    paths.push({ path: `${userPrefix}/${f.name}`, name: f.name, updated_at: (f as any).updated_at, size: (f as any)?.metadata?.size });
  }

  for (const folder of folders) {
    const prefix2 = `${userPrefix}/${folder.name}`;
    const { data: level2, error: err2 } = await supabase.storage.from(bucket).list(prefix2, { limit: 1000, sortBy: { column: "name", order: "asc" } });
    if (err2) continue;
    for (const f of level2 ?? []) {
      if ((f as any).id == null) continue;
      paths.push({ path: `${prefix2}/${f.name}`, name: f.name, updated_at: (f as any).updated_at, size: (f as any)?.metadata?.size });
    }
  }

  return paths.filter((p) => p.name.toLowerCase().endsWith(".csv")).sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? "") || b.name.localeCompare(a.name));
}

async function downloadText(supabase: ReturnType<typeof getSupabaseAdmin>, bucket: string, path: string) {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 60);
  if (error || !data?.signedUrl) throw new Error(error?.message || "failed_to_sign");
  const res = await fetch(data.signedUrl);
  if (!res.ok) throw new Error(`failed_to_download_${res.status}`);
  return await res.text();
}

function groupParts(files: { path: string; name: string }[]) {
  const groups = new Map<string, { base: string; parts: { path: string; name: string; part: number }[] }>();
  for (const f of files) {
    const lower = f.name.toLowerCase();
    const m = lower.match(/^(.*)_part(\d+)\.csv$/);
    const base = m ? `${m[1]}.csv` : lower;
    const part = m ? Number.parseInt(m[2] ?? "0", 10) : 0;
    const g = groups.get(base) ?? { base, parts: [] };
    g.parts.push({ path: f.path, name: f.name, part: Number.isFinite(part) ? part : 0 });
    groups.set(base, g);
  }
  return Array.from(groups.values()).map((g) => ({ ...g, parts: g.parts.sort((a, b) => a.part - b.part || a.name.localeCompare(b.name)) }));
}

function classifyFile(name: string) {
  const n = name.toLowerCase();
  if (n.includes("equival")) return "equivalencias";
  if (n.includes("invent")) return "inventario";
  if (n.includes("pre") && n.includes("preparo")) return "pre_preparo";
  if (n.includes("ficha") || n.includes("fichas") || (n.includes("receita") && !n.includes("itens"))) return "fichas_tecnicas";
  if ((n.includes("itens") || n.includes("items")) && n.includes("nota")) return "itens_notas";
  if (n.includes("itens-fornecedores") || n.includes("items_fornecedores") || n.includes("itens_fornecedores")) return "itens_fornecedores";
  if (n.includes("fornecedores")) return "fornecedores";
  if (n.includes("notas") || n.includes("nota") || n.includes("fiscais")) return "notas_fiscais";
  if (n.includes("desperd")) return "desperdicios";
  if (n.includes("custo") && n.includes("medio")) return "custo_medio";
  if (n.includes("ingred")) return "ingredientes";
  if (n.includes("items") || /\bitens\b/.test(n)) return "itens";
  return "unknown";
}

function pickBubbleId(row: CsvObjectRow) {
  return pickFirst(row, ["unique_id", "_id", "id", "bubble_id"]);
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function normalizeFornecedorKey(value: string) {
  return String(value ?? "").trim().toUpperCase();
}

function normalizeItemName(value: string) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function pickKeyLike(row: CsvObjectRow, parts: string[], opts?: { excludeParts?: string[] }) {
  const exclude = opts?.excludeParts ?? [];
  for (const k of Object.keys(row)) {
    const kk = k.toLowerCase();
    if (exclude.some((p) => kk.includes(p))) continue;
    if (!parts.some((p) => kk.includes(p))) continue;
    const v = String(row[k] ?? "").trim();
    if (v) return v;
  }
  return "";
}

function pickTextValue(row: CsvObjectRow) {
  let best = "";
  for (const k of Object.keys(row)) {
    const kk = k.toLowerCase();
    if (
      kk.includes("id") ||
      kk.includes("unique") ||
      kk.includes("created") ||
      kk.includes("updated") ||
      kk.includes("data") ||
      kk.includes("date") ||
      kk.includes("custo") ||
      kk.includes("preco") ||
      kk.includes("valor") ||
      kk.includes("quant") ||
      kk.includes("qtd") ||
      kk.includes("medida") ||
      kk.includes("unidade") ||
      kk.includes("categoria") ||
      kk.includes("fornecedor") ||
      kk.includes("empresa") ||
      kk.includes("whatsapp") ||
      kk.includes("telefone") ||
      kk.includes("celular")
    ) {
      continue;
    }
    const v = String(row[k] ?? "").trim();
    if (!v) continue;
    if (parsePtNumber(v) !== 0) continue;
    const hasLetters = /[A-Za-zÀ-ÿ]/.test(v);
    if (!hasLetters) continue;
    if (v.length > best.length) best = v;
  }
  return best;
}

function guessItemLabel(row: CsvObjectRow) {
  const direct = pickFirst(row, ["item", "item_completo", "nome_item", "nome_do_item", "nome", "produto", "descricao", "ingrediente", "insumo", "titulo", "title", "name"]);
  if (direct) return direct;
  const like = pickKeyLike(row, ["item", "ingred", "insumo", "produto", "nome"], { excludeParts: ["fornecedor", "empresa"] });
  if (like) return like;
  return pickTextValue(row);
}

function buildDateLabel(value: string) {
  const d = parseDateLoose(value);
  return d ? formatDateLabelPT(d) : String(value ?? "").trim();
}

async function upsertInBatches<T extends Record<string, unknown>>(supabase: ReturnType<typeof getSupabaseAdmin>, table: string, rows: T[], batchSize = 500) {
  let inserted = 0;
  for (let i = 0; i < rows.length; i += batchSize) {
    const chunk = rows.slice(i, i + batchSize);
    const { error } = await supabase.from(table).upsert(chunk as any, { onConflict: "id" });
    if (error) throw new Error(error.message);
    inserted += chunk.length;
  }
  return inserted;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as unknown;
    const only = Array.isArray((body as any)?.only) ? ((body as any).only as unknown[]).map((x) => String(x ?? "").trim()).filter(Boolean) : null;
    const includeUnknown = typeof (body as any)?.includeUnknown === "boolean" ? Boolean((body as any).includeUnknown) : true;

    const enabled = (k: string) => !only || only.includes(k);
    const enableInsumos = enabled("insumos");
    const enableFornecedores = enabled("fornecedores");
    const enableDesperdicios = enabled("desperdicios");
    const enableEntradas = enabled("entradas");
    const enablePrePreparo = enabled("pre_preparo");
    const enableFichas = enabled("fichas_tecnicas");
    const enableInventario = enabled("inventario");

    let stage = "init";

    const { userId } = getUserIdFromRequest(req);
    if (!userId) return json({ ok: false, error: "unauthorized" }, { status: 401 });
    if (!isUuid(userId)) return json({ ok: false, error: "user_not_supabase_uuid" }, { status: 400 });

    let supabase: ReturnType<typeof getSupabaseAdmin>;
    try {
      supabase = getSupabaseAdmin();
    } catch {
      return json({ ok: false, error: "supabase_not_configured" }, { status: 500 });
    }

    stage = "list_files";
    const bucket = "bubble-imports";
    await ensureBucket(supabase, bucket);
    const userPrefix = `user:${userId}`;

    const files = await listAllPaths(supabase, bucket, userPrefix);
    const groups = groupParts(files);
    const byKind = new Map<string, { base: string; parts: { path: string; name: string; part: number }[] }[]>();
    for (const g of groups) {
      const kind = classifyFile(g.base);
      const list = byKind.get(kind) ?? [];
      list.push(g);
      byKind.set(kind, list);
    }

    const enabledKinds = new Set<string>();
    if (enableInsumos) ["custo_medio", "ingredientes", "itens"].forEach((k) => enabledKinds.add(k));
    if (enableFornecedores) ["fornecedores", "itens_fornecedores", "equivalencias"].forEach((k) => enabledKinds.add(k));
    if (enableDesperdicios) enabledKinds.add("desperdicios");
    if (enableEntradas) ["itens_notas", "notas_fiscais"].forEach((k) => enabledKinds.add(k));
    if (enablePrePreparo) enabledKinds.add("pre_preparo");
    if (enableFichas) enabledKinds.add("fichas_tecnicas");
    if (enableInventario) enabledKinds.add("inventario");
    if (includeUnknown) enabledKinds.add("unknown");

    const infoMap: Record<string, any> = {};
    const produtosMap: Record<string, string[]> = {};
    const equivalenciasMap: Record<string, any[]> = {};

    const insumosByKey = new Map<string, any>();
    const custoByItemKey = new Map<string, string>();

    const prefix = `user:${userId}:`;

    function handleCustoMedio(row: CsvObjectRow) {
      if (!enableInsumos) return;
      const item = guessItemLabel(row);
      const itemKey = normalizeItemName(item);
      if (!itemKey) return;
      const custo =
        pickFirst(row, ["custo_medio", "custo_medio_label", "custo", "valor", "preco", "preco_unitario", "custo_unitario", "valor_unitario"]) ||
        pickKeyLike(row, ["custo", "preco", "valor"]);
      const num = parsePtNumber(custo);
      if (!num) return;
      custoByItemKey.set(itemKey, formatMoneyBRL(num));
    }

    function handleInsumo(row: CsvObjectRow) {
      if (!enableInsumos) return;
      const item = guessItemLabel(row);
      const itemKey = normalizeItemName(item);
      if (!itemKey) return;
      const bubbleId = pickBubbleId(row);
      const medida =
        pickFirst(row, ["medida", "unidade", "unidade_medida", "unidade_de_medida", "unidade_de_compra", "unidade_base"]) ||
        pickKeyLike(row, ["medida", "unidade"]) ||
        "Und";
      const categoria = pickFirst(row, ["categoria", "category", "grupo", "grupo_categoria"]) || pickKeyLike(row, ["categoria", "grupo"]);
      const especificacao = pickFirst(row, ["especificacao", "especificacao_do_item", "descricao", "observacao", "obs", "detalhe"]) || pickKeyLike(row, ["especific", "descr", "obs"]);
      const ocultarRaw = pickFirst(row, ["ocultar", "hidden", "removido", "apagado"]);
      const ocultar = ocultarRaw ? ocultarRaw.toLowerCase() === "sim" || ocultarRaw.toLowerCase() === "true" || ocultarRaw === "1" : undefined;
      const custo =
        pickFirst(row, ["custo_medio", "custo_medio_label", "custo", "valor", "preco", "custo_unitario", "preco_unitario", "valor_unitario"]) ||
        pickKeyLike(row, ["custo", "preco", "valor"]);
      const custoNum = parsePtNumber(custo);
      const custoMedio = custoNum ? formatMoneyBRL(custoNum) : custoByItemKey.get(itemKey) ?? "";
      const prev = insumosByKey.get(itemKey) ?? {};
      insumosByKey.set(itemKey, {
        id: bubbleId || prev.id || String(insumosByKey.size + 1),
        item: item.trim(),
        medida: medida.trim() || prev.medida || "Und",
        custoMedio: custoMedio || prev.custoMedio || undefined,
        categoria: categoria.trim() || prev.categoria || undefined,
        especificacao: especificacao.trim() || prev.especificacao || undefined,
        ocultar: typeof ocultar === "boolean" ? ocultar : prev.ocultar,
      });
    }

    function handleFornecedorInfo(row: CsvObjectRow) {
      if (!enableFornecedores) return;
      const fornecedor =
        pickFirst(row, ["fornecedor", "fornecedor_nome", "nome_fornecedor", "empresa", "empresa_nome", "razao_social", "nome"]) || pickKeyLike(row, ["fornecedor", "empresa"]);
      const key = normalizeFornecedorKey(fornecedor);
      if (!key) return;
      infoMap[key] = {
        fornecedor: fornecedor.trim() || fornecedor,
        vendedor: pickFirst(row, ["vendedor", "contato", "nome_vendedor", "responsavel"]) || pickKeyLike(row, ["vendedor", "contato", "responsavel"]),
        whatsapp: pickFirst(row, ["whatsapp", "telefone", "celular", "fone"]) || pickKeyLike(row, ["whatsapp", "telefone", "celular"]),
        endereco: pickFirst(row, ["endereco", "endereco_completo", "rua", "address"]) || pickKeyLike(row, ["endereco", "rua", "address"]),
      };
    }

    function handleFornecedorProduto(row: CsvObjectRow) {
      if (!enableFornecedores) return;
      const fornecedor = pickFirst(row, ["fornecedor", "fornecedor_nome", "empresa", "empresa_nome", "nome_fornecedor"]) || pickKeyLike(row, ["fornecedor", "empresa"]);
      const item =
        pickFirst(row, ["produto", "item", "nome_item", "nome_do_item", "nome", "descricao", "ingrediente", "insumo"]) ||
        pickKeyLike(row, ["produto", "item", "nome"], { excludeParts: ["fornecedor", "empresa"] }) ||
        guessItemLabel(row);
      const key = normalizeFornecedorKey(fornecedor);
      if (!key || !item.trim()) return;
      const list = produtosMap[key] ?? [];
      list.push(item.trim());
      produtosMap[key] = list;
    }

    function handleEquivalencia(row: CsvObjectRow) {
      if (!enableFornecedores) return;
      const fornecedor = pickFirst(row, ["fornecedor", "fornecedor_nome", "empresa", "empresa_nome"]) || pickKeyLike(row, ["fornecedor", "empresa"]);
      const key = normalizeFornecedorKey(fornecedor);
      if (!key) return;
      const nomeNaNota =
        pickFirst(row, ["nome_na_nota", "nomeNaNota", "nome", "item", "produto"]) || pickKeyLike(row, ["nome", "item", "produto"], { excludeParts: ["fornecedor", "empresa"] });
      const insumoEquivalente = pickFirst(row, ["insumo_equivalente", "insumoEquivalente", "equivalente", "insumo"]) || pickKeyLike(row, ["insumo", "equival"]);
      if (!nomeNaNota || !insumoEquivalente) return;
      const unidadeNaNota = pickFirst(row, ["unidade_na_nota", "unidadeNaNota", "unidade", "medida"]) || pickKeyLike(row, ["unidade", "medida"]) || "Und";
      const equivalenteQuantidade = pickFirst(row, ["equivalente_quantidade", "equivalenteQuantidade", "quantidade", "qtd"]) || pickKeyLike(row, ["quantidade", "qtd"]);
      const equivalenteUnidade = pickFirst(row, ["equivalente_unidade", "equivalenteUnidade", "unidade_equivalente", "unidade"]) || "";
      const bubbleId = pickBubbleId(row) || String(Date.now());
      const list = equivalenciasMap[key] ?? [];
      list.push({
        id: bubbleId,
        nomeNaNota: nomeNaNota.trim(),
        unidadeNaNota: unidadeNaNota.trim() || "Und",
        insumoEquivalente: insumoEquivalente.trim(),
        equivalenteQuantidade: equivalenteQuantidade.trim(),
        equivalenteUnidade: equivalenteUnidade.trim(),
      });
      equivalenciasMap[key] = list;
    }

    const notaItemsByNotaKey = new Map<string, any[]>();
    function handleNotaItem(row: CsvObjectRow) {
      if (!enableEntradas) return;
    const notaId =
        pickFirst(row, ["nota_id", "nota_fiscal_id", "nota", "notas_fiscais_id", "notas_fiscais", "entrada_id", "entrada"]) || pickKeyLike(row, ["nota", "entrada"]);
      if (!notaId) return;
      const nome = pickFirst(row, ["nome", "item", "produto", "descricao", "nome_item"]) || guessItemLabel(row);
      if (!nome) return;
      const bubbleId = pickBubbleId(row) || String(Date.now());
      const qtd = pickFirst(row, ["quantidade_label", "quantidade", "qtd", "qtde"]) || pickKeyLike(row, ["quantidade", "qtd"]);
      const subtotal = pickFirst(row, ["subtotal_label", "subtotal", "total", "valor"]) || pickKeyLike(row, ["subtotal", "total", "valor"]);
      const unit =
        pickFirst(row, ["custo_unitario_label", "custo_unitario", "preco_unitario", "valor_unitario"]) || pickKeyLike(row, ["custo", "preco", "valor"]);
      const list = notaItemsByNotaKey.get(notaId) ?? [];
      list.push({
        id: `${prefix}nota_item:${bubbleId}`,
        nome: nome.trim(),
        quantidadeLabel: qtd.trim(),
        subtotalLabel: subtotal ? (parsePtNumber(subtotal) ? formatMoneyBRL(parsePtNumber(subtotal)) : subtotal.trim()) : "",
        custoUnitarioLabel: unit ? (parsePtNumber(unit) ? formatMoneyBRL(parsePtNumber(unit)) : unit.trim()) : "",
      });
      notaItemsByNotaKey.set(notaId, list);
    }

    const entradasRows: any[] = [];
    function handleNotaFiscal(row: CsvObjectRow) {
      if (!enableEntradas) return;
    const fornecedor =
      pickFirst(row, ["fornecedor", "fornecedor_nome", "nome_fornecedor", "empresa", "empresa_nome", "razao_social"]) || pickKeyLike(row, ["fornecedor", "empresa"]);
    if (!fornecedor) return;
    const numero =
      pickFirst(row, ["numero", "numero_nf", "numero_nota", "nota_numero", "n_nf", "nf", "num", "num_nf"]) || pickKeyLike(row, ["numero", "nf"]);
    const dataLanc = buildDateLabel(pickFirst(row, ["data_lancamento", "data_nota", "data_recebimento", "data", "date", "created_at", "created_date"]) || pickKeyLike(row, ["data", "date"]));
    const bubbleId = pickBubbleId(row) || `${numero || "nf"}_${entradasRows.length + 1}`;
    const numeroFinal = numero.trim() || `NF-${String(bubbleId).slice(0, 8)}`;
    const valor = pickFirst(row, ["valor_nota", "valor_total", "valor", "total", "subtotal"]) || pickKeyLike(row, ["valor", "total", "subtotal"]);
    const valorNum = parsePtNumber(valor);
    const responsavel = pickFirst(row, ["responsavel", "usuario", "user", "nome_usuario", "criado_por"]) || pickKeyLike(row, ["responsavel", "usuario"]) || "-";
    const dataCriacao = buildDateLabel(pickFirst(row, ["data_criacao", "created_date", "created_at", "created"]) || "");
    const itensList = notaItemsByNotaKey.get(bubbleId) ?? notaItemsByNotaKey.get(numero) ?? notaItemsByNotaKey.get(numeroFinal) ?? [];
    const itensCount = itensList.length;
    entradasRows.push({
      id: `${prefix}entrada:${bubbleId}`,
      user_id: userId,
      numero: numeroFinal,
      data_lancamento: dataLanc || "-",
      fornecedor: fornecedor.trim(),
      valor_nota: valorNum ? formatMoneyBRL(valorNum) : String(valor ?? "").trim() || "R$0,00",
      itens: `${itensCount || parsePtNumber(pickFirst(row, ["itens", "qtd_itens", "quantidade_itens"]) || pickKeyLike(row, ["itens", "qtd"])) || 0} Itens`,
      responsavel: responsavel.trim(),
      data_criacao: dataCriacao || dataLanc || "-",
      itens_nota: itensList.length ? itensList : null,
    });
  }

    const desperdiciosRows: any[] = [];
    function handleDesperdicio(row: CsvObjectRow) {
      if (!enableDesperdicios) return;
    const item = guessItemLabel(row);
    if (!item) return;
    const bubbleId = pickBubbleId(row) || String(desperdiciosRows.length + 1);
    const data = buildDateLabel(pickFirst(row, ["data", "date", "data_desperdicio", "created_date", "created_at"]) || pickKeyLike(row, ["data", "date"]));
    const quantidade = pickFirst(row, ["quantidade", "qtd", "qtde", "quantidade_label"]) || pickKeyLike(row, ["quantidade", "qtd"]);
    const custo = pickFirst(row, ["custo", "valor", "total", "subtotal"]) || pickKeyLike(row, ["custo", "valor", "total", "subtotal"]);
    const motivo = pickFirst(row, ["motivo", "reason", "descricao", "obs", "observacao"]) || pickKeyLike(row, ["motivo", "reason", "obs", "descr"]);
    const custoNum = parsePtNumber(custo);
    desperdiciosRows.push({
      id: `${prefix}desperdicio:${bubbleId}`,
      data: data || "-",
      item: item.trim(),
      quantidade: quantidade.trim(),
      custo: custoNum ? formatMoneyBRL(custoNum) : String(custo ?? "").trim(),
      motivo: motivo.trim(),
    });
  }

    const prePreparoRows: any[] = [];
    function handlePrePreparo(row: CsvObjectRow) {
      if (!enablePrePreparo) return;
    const receita =
      pickFirst(row, ["receita", "pre_preparo", "prepreparo", "nome", "recipe"]) ||
      pickKeyLike(row, ["receita", "pre", "preparo", "nome"], { excludeParts: ["fornecedor", "empresa"] }) ||
      pickTextValue(row);
    if (!receita) return;
    const bubbleId = pickBubbleId(row) || String(prePreparoRows.length + 1);
    const categoria = pickFirst(row, ["categoria", "category", "grupo"]) || pickKeyLike(row, ["categoria", "grupo"]) || "-";
    const custoTotal = pickFirst(row, ["custo_total", "custoTotal", "custo", "total", "valor"]) || pickKeyLike(row, ["custo", "total", "valor"]) || "-";
    const rendimento = pickFirst(row, ["rendimento", "yield"]) || pickKeyLike(row, ["rendimento", "yield"]) || "-";
    const custoUnitario = pickFirst(row, ["custo_unitario", "custoUnitario", "unitario"]) || pickKeyLike(row, ["unitario", "custo"]) || "-";
    const validade = pickFirst(row, ["validade_dias", "validadeDias", "validade"]) || pickKeyLike(row, ["validade"]);
    const validadeDiasNum = validade ? Math.max(0, Math.floor(parsePtNumber(validade))) : undefined;
    const ingredientesRaw = pickFirst(row, ["ingredientes", "ingredientes_json", "ingredientRows", "ingredient_rows", "itens", "items"]) || pickKeyLike(row, ["ingred", "ingredient", "itens"]);
    let ingredientes: any[] | undefined;
    if (ingredientesRaw && (ingredientesRaw.trim().startsWith("[") || ingredientesRaw.trim().startsWith("{"))) {
      try {
        const parsed = JSON.parse(ingredientesRaw);
        ingredientes = Array.isArray(parsed) ? parsed : undefined;
      } catch {}
    }
    const modoPreparo = pickFirst(row, ["modo_preparo", "modoPreparo", "preparo", "modo"]) || pickKeyLike(row, ["modo", "preparo"]) || "";
    prePreparoRows.push({
      id: bubbleId,
      categoria: categoria.trim() || "-",
      receita: receita.trim(),
      custoTotal: custoTotal.trim() || "-",
      rendimento: rendimento.trim() || "-",
      custoUnitario: custoUnitario.trim() || "-",
      validadeDias: typeof validadeDiasNum === "number" ? validadeDiasNum : undefined,
      ingredientes: ingredientes && ingredientes.length ? ingredientes : undefined,
      modoPreparo: modoPreparo.trim() || undefined,
    });
  }

    const fichasRows: any[] = [];
    function handleFicha(row: CsvObjectRow) {
      if (!enableFichas) return;
    const receita =
      pickFirst(row, ["receita", "nome", "recipe"]) ||
      pickKeyLike(row, ["receita", "recipe", "nome"], { excludeParts: ["fornecedor", "empresa"] }) ||
      pickTextValue(row);
    if (!receita) return;
    const bubbleId = pickBubbleId(row) || String(fichasRows.length + 1);
    const precoVenda = pickFirst(row, ["preco_venda", "precoVenda", "preco", "valor_venda"]) || pickKeyLike(row, ["preco", "venda", "valor"]);
    const custoUnitario = pickFirst(row, ["custo_unitario", "custoUnitario", "custo"]) || pickKeyLike(row, ["custo", "unitario"]);
    const cmvMeta = pickFirst(row, ["cmv_meta", "cmvMeta", "meta_cmv"]) || pickKeyLike(row, ["cmv", "meta"]);
    const cmvAtual = pickFirst(row, ["cmv_atual", "cmvAtual"]) || pickKeyLike(row, ["cmv", "atual"]);
    const cmvDelta = pickFirst(row, ["cmv_delta", "cmvDelta"]) || pickKeyLike(row, ["cmv", "delta"]);
    const bcgRaw = pickFirst(row, ["bcg", "matriz_bcg", "matriz"]) || pickKeyLike(row, ["bcg", "matriz"]) || "quebra-cabeca";
    const bcg = bcgRaw === "estrela" || bcgRaw === "cavalo" || bcgRaw === "quebra-cabeca" || bcgRaw === "abacaxi" ? bcgRaw : "quebra-cabeca";
    const thumbRaw = pickFirst(row, ["thumb", "tipo", "burger"]) || pickKeyLike(row, ["thumb", "tipo"]) || "burger";
    const thumb = thumbRaw === "burger" || thumbRaw === "duplo" || thumbRaw === "triplo" ? thumbRaw : "burger";
    const recipeImage = pickFirst(row, ["recipe_image", "recipeImage", "imagem", "image"]) || pickKeyLike(row, ["image", "imagem"]);
    const popularidadeRaw = pickFirst(row, ["popularidade"]) || pickKeyLike(row, ["popular"]);
    const popularidade = popularidadeRaw.toLowerCase() === "alta" || popularidadeRaw.toLowerCase() === "baixa" ? popularidadeRaw.toLowerCase() : undefined;
    const ingredientsTotal = pickFirst(row, ["ingredients_total", "ingredientsTotal"]) || pickKeyLike(row, ["ingredients", "ingredientes", "total"]);
    const recipeYield = pickFirst(row, ["recipe_yield", "recipeYield", "rendimento"]) || pickKeyLike(row, ["yield", "rendimento"]);
    const ingredientRowsRaw = pickFirst(row, ["ingredient_rows", "ingredientRows", "ingredientes"]) || pickKeyLike(row, ["ingredient", "ingredientes"]);
    let ingredientRows: any[] | undefined;
    if (ingredientRowsRaw && (ingredientRowsRaw.trim().startsWith("[") || ingredientRowsRaw.trim().startsWith("{"))) {
      try {
        const parsed = JSON.parse(ingredientRowsRaw);
        ingredientRows = Array.isArray(parsed) ? parsed : undefined;
      } catch {}
    }
    const modoPreparo = pickFirst(row, ["modo_preparo", "modoPreparo"]) || pickKeyLike(row, ["modo", "preparo"]) || "";
    fichasRows.push({
      id: bubbleId,
      receita: receita.trim(),
      precoVenda: String(precoVenda ?? "").trim(),
      custoUnitario: String(custoUnitario ?? "").trim(),
      cmvMeta: String(cmvMeta ?? "").trim(),
      cmvAtual: String(cmvAtual ?? "").trim(),
      cmvDelta: String(cmvDelta ?? "").trim(),
      bcg,
      thumb,
      recipeImage: recipeImage ? String(recipeImage).trim() || undefined : undefined,
      popularidade,
      ingredientsTotal: ingredientsTotal ? Math.max(0, Math.floor(parsePtNumber(ingredientsTotal))) : undefined,
      recipeYield: recipeYield ? Math.max(0, parsePtNumber(recipeYield)) : undefined,
      ingredientRows: ingredientRows && ingredientRows.length ? ingredientRows : undefined,
      modoPreparo: modoPreparo.trim() || undefined,
    });
  }

    type InvItem = { id: string; item: string; unidade: string; estoqueFinal: string; removido?: boolean };
    type InvCat = { id: string; nome: string; status: "pendente" | "concluida"; itens: InvItem[] };
    const inventarioMap = new Map<string, { id: string; data: string; cats: Map<string, { id: string; nome: string; itens: Map<string, InvItem> }> }>();

    function handleInventarioFlat(row: CsvObjectRow) {
      if (!enableInventario) return;
    const dateRaw = pickFirst(row, ["data", "date", "data_inventario", "data_contagem"]) || pickKeyLike(row, ["data", "date"]);
    const d = parseDateLoose(dateRaw);
    if (!d) return;
    const iso = d.toISOString().slice(0, 10);
    const dataLabel = formatDateLabelPT(d);
    const tipo = pickFirst(row, ["tipo", "tipo_inventario", "inventario_tipo"]) || pickKeyLike(row, ["tipo"]);
    const invId = `${prefix}inventario:${iso}${tipo ? `:${String(tipo).trim().toLowerCase()}` : ""}`;
    const invKey = invId;

    const categoria =
      pickFirst(row, ["categoria", "category", "grupo"]) || pickKeyLike(row, ["categoria", "grupo"]) || "Importado";
    const catName = String(categoria).trim() || "Importado";
    const catKey = normalizeItemName(catName);

    const item = guessItemLabel(row);
    if (!item) return;
    const itemName = item.trim();
    const unidade = pickFirst(row, ["unidade", "medida", "unidade_medida"]) || pickKeyLike(row, ["unidade", "medida"]) || "Und";
    const estoqueFinal =
      pickFirst(row, ["estoque_final", "estoqueFinal", "quantidade", "qtd", "qtde", "estoque"]) || pickKeyLike(row, ["estoque", "quantidade", "qtd"]);
    const bubbleId = pickBubbleId(row) || `${iso}:${catKey}:${normalizeItemName(itemName)}`;
    const itemId = `${invId}:${bubbleId}`;

    const inv = inventarioMap.get(invKey) ?? { id: invId, data: dataLabel, cats: new Map() };
    const cat = inv.cats.get(catKey) ?? { id: `${invId}:${catKey}`, nome: catName, itens: new Map() };
    cat.itens.set(itemId, { id: itemId, item: itemName, unidade: String(unidade).trim() || "Und", estoqueFinal: String(estoqueFinal ?? "").trim() });
    inv.cats.set(catKey, cat);
    inventarioMap.set(invKey, inv);
  }

    function detectUnknownKind(row: CsvObjectRow) {
    const keys = Object.keys(row).map((k) => k.toLowerCase());
    const has = (p: string) => keys.some((k) => k.includes(p));
    if (has("valor_nota") || (has("fornecedor") && (has("numero") || has("nf")) && has("data"))) return "notas_fiscais";
    if ((has("nota") || has("entrada")) && has("quantidade") && (has("subtotal") || has("total") || has("valor"))) return "itens_notas";
    if ((has("fornecedor") || has("empresa")) && (has("whatsapp") || has("telefone") || has("endereco") || has("vendedor"))) return "fornecedores";
    if ((has("fornecedor") || has("empresa")) && (has("produto") || has("item")) && !has("numero")) return "itens_fornecedores";
    if (has("equival") && (has("insumo") || has("item"))) return "equivalencias";
    if (has("motivo") && (has("quantidade") || has("qtd"))) return "desperdicios";
    if ((has("pre") && has("preparo")) || (has("validade") && (has("rendimento") || has("yield")))) return "pre_preparo";
    if (has("cmv") || has("bcg") || (has("preco") && has("venda") && has("custo"))) return "fichas_tecnicas";
    if (has("categorias") || (has("estoque") && (has("categoria") || has("grupo")))) return "inventario_flat";
    if (has("custo_medio") || (has("custo") && (has("medida") || has("unidade")))) return "itens";
    return "unknown";
  }

    stage = "process_unknown";
    if (includeUnknown && enabledKinds.has("unknown")) {
      const unknownGroups = byKind.get("unknown") ?? [];
      for (const g of unknownGroups) {
        for (const part of g.parts) {
          const text = await downloadText(supabase, bucket, part.path);
          const parsed = parseBubbleCsvToObjects(text);
          const sample = parsed.rows[0];
          const kind = sample ? detectUnknownKind(sample) : "unknown";
          for (const r of parsed.rows) {
            if (kind === "notas_fiscais" && enableEntradas) handleNotaFiscal(r);
            else if (kind === "itens_notas" && enableEntradas) handleNotaItem(r);
            else if (kind === "fornecedores" && enableFornecedores) handleFornecedorInfo(r);
            else if (kind === "itens_fornecedores" && enableFornecedores) handleFornecedorProduto(r);
            else if (kind === "equivalencias" && enableFornecedores) handleEquivalencia(r);
            else if (kind === "desperdicios" && enableDesperdicios) handleDesperdicio(r);
            else if (kind === "pre_preparo" && enablePrePreparo) handlePrePreparo(r);
            else if (kind === "fichas_tecnicas" && enableFichas) handleFicha(r);
            else if (kind === "inventario_flat" && enableInventario) handleInventarioFlat(r);
            else if (kind === "itens" && enableInsumos) handleInsumo(r);
          }
        }
      }
    }

    async function processCsvGroups(kind: string, onRow: (row: CsvObjectRow, fileName: string) => void) {
      if (!enabledKinds.has(kind)) return;
      const list = byKind.get(kind) ?? [];
      for (const g of list) {
        for (const part of g.parts) {
          const text = await downloadText(supabase, bucket, part.path);
          const parsed = parseBubbleCsvToObjects(text);
          for (const r of parsed.rows) onRow(r, part.name);
        }
      }
    }

    stage = "process_files";
    await processCsvGroups("custo_medio", (row) => handleCustoMedio(row));
    await processCsvGroups("ingredientes", (row) => handleInsumo(row));
    await processCsvGroups("itens", (row) => handleInsumo(row));
    await processCsvGroups("fornecedores", (row) => handleFornecedorInfo(row));
    await processCsvGroups("itens_fornecedores", (row) => handleFornecedorProduto(row));
    await processCsvGroups("equivalencias", (row) => handleEquivalencia(row));
    await processCsvGroups("pre_preparo", (row) => handlePrePreparo(row));
    await processCsvGroups("fichas_tecnicas", (row) => handleFicha(row));

    for (const k of Object.keys(produtosMap)) {
      produtosMap[k] = Array.from(new Set(produtosMap[k].filter(Boolean))).sort((a, b) => a.localeCompare(b, "pt-BR", { sensitivity: "base", numeric: true }));
    }

    stage = "save_supabase";
    const stateId = `user:${userId}`;

    const insumosRows = Array.from(insumosByKey.values()).filter((r) => r && r.item);
    const insumoCategories = Array.from(new Set(insumosRows.map((r) => String(r.categoria ?? "").trim()).filter(Boolean)));
    if (enableInsumos) {
      const { error: insErr } = await supabase.from("insumos_state").upsert({ id: stateId, payload: { rows: insumosRows, categories: insumoCategories } } as any, { onConflict: "id" });
      if (insErr) return json({ ok: false, error: `insumos_state:${insErr.message}`, stage }, { status: 500 });
    }

    if (enableFornecedores) {
      const { error: fornErr } = await supabase
        .from("fornecedores_state")
        .upsert({ id: stateId, info: infoMap, produtos: produtosMap, equivalencias: equivalenciasMap } as any, { onConflict: "id" });
      if (fornErr) return json({ ok: false, error: `fornecedores_state:${fornErr.message}`, stage }, { status: 500 });
    }

    if (enablePrePreparo && prePreparoRows.length) {
      const { error: ppErr } = await supabase.from("pre_preparo_state").upsert({ id: stateId, payload: prePreparoRows } as any, { onConflict: "id" });
      if (ppErr) return json({ ok: false, error: `pre_preparo_state:${ppErr.message}`, stage }, { status: 500 });
    }

    if (enableFichas && fichasRows.length) {
      const { error: ftErr } = await supabase.from("fichas_tecnicas_state").upsert({ id: stateId, payload: fichasRows } as any, { onConflict: "id" });
      if (ftErr) return json({ ok: false, error: `fichas_tecnicas_state:${ftErr.message}`, stage }, { status: 500 });
    }

    const inventarioRows: any[] = [];
    if (enableInventario) {
      await processCsvGroups("inventario", (row) => {
        const dataLabel = buildDateLabel(pickFirst(row, ["data", "date", "data_inventario"]));
        const bubbleId = pickBubbleId(row) || String(inventarioRows.length + 1);
        const categoriasRaw = pickFirst(row, ["categorias", "categories", "payload"]);
        let categorias: any[] = [];
        if (categoriasRaw && (categoriasRaw.trim().startsWith("[") || categoriasRaw.trim().startsWith("{"))) {
          try {
            const parsed = JSON.parse(categoriasRaw);
            categorias = Array.isArray(parsed) ? parsed : [];
          } catch {}
        }
        if (dataLabel && categorias.length) {
          inventarioRows.push({ id: `${prefix}inventario:${bubbleId}`, data: dataLabel, categorias });
          return;
        }
        handleInventarioFlat(row);
      });
    }

    const inventarioRowsFromFlat = enableInventario
      ? Array.from(inventarioMap.values()).map((inv) => {
          const categorias: any[] = Array.from(inv.cats.values()).map((c) => ({
            id: c.id,
            nome: c.nome,
            status: "concluida",
            itens: Array.from(c.itens.values()),
          }));
          return { id: inv.id, data: inv.data, categorias };
        })
      : [];

    const inventarioInserted =
      enableInventario && (inventarioRows.length || inventarioRowsFromFlat.length)
        ? await upsertInBatches(supabase, "inventario", [...inventarioRows, ...inventarioRowsFromFlat], 100)
        : 0;

    await processCsvGroups("desperdicios", (row) => handleDesperdicio(row));
    const desperdiciosInserted = enableDesperdicios && desperdiciosRows.length ? await upsertInBatches(supabase, "desperdicios", desperdiciosRows, 500) : 0;

    await processCsvGroups("itens_notas", (row) => handleNotaItem(row));
    await processCsvGroups("notas_fiscais", (row) => handleNotaFiscal(row));
    const entradasInserted = enableEntradas && entradasRows.length ? await upsertInBatches(supabase, "entradas", entradasRows, 300) : 0;

    return json(
      {
        ok: true,
        summary: {
          files: files.length,
          insumos: enableInsumos ? insumosRows.length : 0,
          fornecedores: enableFornecedores ? Object.keys(infoMap).length : 0,
          fornecedoresProdutos: enableFornecedores ? Object.keys(produtosMap).length : 0,
          fichasTecnicas: enableFichas ? fichasRows.length : 0,
          prePreparo: enablePrePreparo ? prePreparoRows.length : 0,
          inventario: inventarioInserted,
          desperdicios: desperdiciosInserted,
          entradas: entradasInserted,
        },
      },
      { status: 200 },
    );
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
