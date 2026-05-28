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
  const { userId } = getUserIdFromRequest(req);
  if (!userId) return json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (!isUuid(userId)) return json({ ok: false, error: "user_not_supabase_uuid" }, { status: 400 });

  let supabase: ReturnType<typeof getSupabaseAdmin>;
  try {
    supabase = getSupabaseAdmin();
  } catch {
    return json({ ok: false, error: "supabase_not_configured" }, { status: 500 });
  }

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

  const infoMap: Record<string, any> = {};
  const produtosMap: Record<string, string[]> = {};
  const equivalenciasMap: Record<string, any[]> = {};

  const insumosByKey = new Map<string, any>();
  const custoByItemKey = new Map<string, string>();

  const prefix = `user:${userId}:`;

  async function processCsvGroups(kind: string, onRow: (row: CsvObjectRow, fileName: string) => void) {
    const list = byKind.get(kind) ?? [];
    for (const g of list) {
      for (const part of g.parts) {
        const text = await downloadText(supabase, bucket, part.path);
        const parsed = parseBubbleCsvToObjects(text);
        for (const r of parsed.rows) onRow(r, part.name);
      }
    }
  }

  await processCsvGroups("custo_medio", (row) => {
    const item = pickFirst(row, ["item", "nome", "ingrediente", "insumo"]);
    const itemKey = normalizeItemName(item);
    if (!itemKey) return;
    const custo = pickFirst(row, ["custo_medio", "custo", "valor", "preco", "preco_unitario", "custo_medio_label"]);
    const num = parsePtNumber(custo);
    if (!num) return;
    custoByItemKey.set(itemKey, formatMoneyBRL(num));
  });

  await processCsvGroups("ingredientes", (row) => {
    const item = pickFirst(row, ["item", "ingrediente", "nome", "insumo"]);
    const itemKey = normalizeItemName(item);
    if (!itemKey) return;
    const bubbleId = pickBubbleId(row);
    const medida = pickFirst(row, ["medida", "unidade", "unidade_medida", "unidade_de_medida"]) || "Und";
    const categoria = pickFirst(row, ["categoria", "category", "grupo"]);
    const especificacao = pickFirst(row, ["especificacao", "especificacao_do_item", "descricao", "observacao", "obs"]);
    const ocultarRaw = pickFirst(row, ["ocultar", "hidden", "removido"]);
    const ocultar = ocultarRaw ? ocultarRaw.toLowerCase() === "sim" || ocultarRaw.toLowerCase() === "true" || ocultarRaw === "1" : undefined;
    const custo = pickFirst(row, ["custo_medio", "custo", "valor", "preco", "custo_medio_label"]);
    const custoNum = parsePtNumber(custo);
    const custoMedio = custoNum ? formatMoneyBRL(custoNum) : custoByItemKey.get(itemKey) ?? "";
    const prev = insumosByKey.get(itemKey) ?? {};
    insumosByKey.set(itemKey, {
      id: bubbleId || prev.id || String(insumosByKey.size + 1),
      item: item.trim(),
      medida: medida.trim() || "Und",
      custoMedio: custoMedio || prev.custoMedio || undefined,
      categoria: categoria.trim() || prev.categoria || undefined,
      especificacao: especificacao.trim() || prev.especificacao || undefined,
      ocultar: typeof ocultar === "boolean" ? ocultar : prev.ocultar,
    });
  });

  await processCsvGroups("itens", (row) => {
    const item = pickFirst(row, ["item", "nome", "ingrediente", "insumo"]);
    const itemKey = normalizeItemName(item);
    if (!itemKey) return;
    const bubbleId = pickBubbleId(row);
    const medida = pickFirst(row, ["medida", "unidade", "unidade_medida", "unidade_de_medida"]) || "Und";
    const categoria = pickFirst(row, ["categoria", "category", "grupo"]);
    const especificacao = pickFirst(row, ["especificacao", "descricao", "observacao", "obs"]);
    const custo = pickFirst(row, ["custo_medio", "custo", "valor", "preco", "custo_medio_label"]);
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
      ocultar: prev.ocultar,
    });
  });

  await processCsvGroups("fornecedores", (row) => {
    const fornecedor = pickFirst(row, ["fornecedor", "nome", "empresa", "empresa_nome"]);
    const key = normalizeFornecedorKey(fornecedor);
    if (!key) return;
    infoMap[key] = {
      fornecedor: fornecedor.trim() || fornecedor,
      vendedor: pickFirst(row, ["vendedor", "contato", "nome_vendedor"]),
      whatsapp: pickFirst(row, ["whatsapp", "telefone", "celular"]),
      endereco: pickFirst(row, ["endereco", "endereco_completo", "rua", "address"]),
    };
  });

  await processCsvGroups("itens_fornecedores", (row) => {
    const fornecedor = pickFirst(row, ["fornecedor", "fornecedor_nome", "empresa", "empresa_nome"]);
    const item = pickFirst(row, ["item", "produto", "nome", "nome_item", "ingrediente", "insumo"]);
    const key = normalizeFornecedorKey(fornecedor);
    if (!key || !item.trim()) return;
    const list = produtosMap[key] ?? [];
    list.push(item.trim());
    produtosMap[key] = list;
  });

  await processCsvGroups("equivalencias", (row) => {
    const fornecedor = pickFirst(row, ["fornecedor", "fornecedor_nome", "empresa", "empresa_nome"]);
    const key = normalizeFornecedorKey(fornecedor);
    if (!key) return;
    const nomeNaNota = pickFirst(row, ["nome_na_nota", "nomeNaNota", "nome", "item", "produto"]);
    const insumoEquivalente = pickFirst(row, ["insumo_equivalente", "insumoEquivalente", "equivalente", "insumo"]);
    if (!nomeNaNota || !insumoEquivalente) return;
    const unidadeNaNota = pickFirst(row, ["unidade_na_nota", "unidadeNaNota", "unidade", "medida"]) || "Und";
    const equivalenteQuantidade = pickFirst(row, ["equivalente_quantidade", "equivalenteQuantidade", "quantidade", "qtd"]);
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
  });

  for (const k of Object.keys(produtosMap)) {
    produtosMap[k] = Array.from(new Set(produtosMap[k].filter(Boolean))).sort((a, b) => a.localeCompare(b, "pt-BR", { sensitivity: "base", numeric: true }));
  }

  const insumosRows = Array.from(insumosByKey.values()).filter((r) => r && r.item);
  const insumoCategories = Array.from(new Set(insumosRows.map((r) => String(r.categoria ?? "").trim()).filter(Boolean)));

  const stateId = `user:${userId}`;
  const { error: insErr } = await supabase.from("insumos_state").upsert({ id: stateId, payload: { rows: insumosRows, categories: insumoCategories } } as any, { onConflict: "id" });
  if (insErr) return json({ ok: false, error: `insumos_state:${insErr.message}` }, { status: 500 });

  const { error: fornErr } = await supabase.from("fornecedores_state").upsert({ id: stateId, info: infoMap, produtos: produtosMap, equivalencias: equivalenciasMap } as any, { onConflict: "id" });
  if (fornErr) return json({ ok: false, error: `fornecedores_state:${fornErr.message}` }, { status: 500 });

  const prePreparoRows: any[] = [];
  await processCsvGroups("pre_preparo", (row) => {
    const receita = pickFirst(row, ["receita", "nome", "pre_preparo", "prepreparo"]);
    if (!receita) return;
    const bubbleId = pickBubbleId(row) || String(prePreparoRows.length + 1);
    const categoria = pickFirst(row, ["categoria", "category", "grupo"]) || "-";
    const custoTotal = pickFirst(row, ["custo_total", "custoTotal", "custo", "total"]) || "-";
    const rendimento = pickFirst(row, ["rendimento", "yield"]) || "-";
    const custoUnitario = pickFirst(row, ["custo_unitario", "custoUnitario", "unitario"]) || "-";
    const validade = pickFirst(row, ["validade_dias", "validadeDias", "validade"]);
    const validadeDiasNum = validade ? Math.max(0, Math.floor(parsePtNumber(validade))) : undefined;
    const ingredientesRaw = pickFirst(row, ["ingredientes", "ingredientes_json", "itens", "items"]);
    let ingredientes: any[] | undefined;
    if (ingredientesRaw && (ingredientesRaw.trim().startsWith("[") || ingredientesRaw.trim().startsWith("{"))) {
      try {
        const parsed = JSON.parse(ingredientesRaw);
        ingredientes = Array.isArray(parsed) ? parsed : undefined;
      } catch {}
    }
    const modoPreparo = pickFirst(row, ["modo_preparo", "modoPreparo", "preparo", "modo"]) || "";
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
  });

  if (prePreparoRows.length) {
    const { error: ppErr } = await supabase.from("pre_preparo_state").upsert({ id: stateId, payload: prePreparoRows } as any, { onConflict: "id" });
    if (ppErr) return json({ ok: false, error: `pre_preparo_state:${ppErr.message}` }, { status: 500 });
  }

  const fichasRows: any[] = [];
  await processCsvGroups("fichas_tecnicas", (row) => {
    const receita = pickFirst(row, ["receita", "nome", "recipe"]);
    if (!receita) return;
    const bubbleId = pickBubbleId(row) || String(fichasRows.length + 1);
    const precoVenda = pickFirst(row, ["preco_venda", "precoVenda", "preco", "valor_venda"]) || "";
    const custoUnitario = pickFirst(row, ["custo_unitario", "custoUnitario", "custo"]) || "";
    const cmvMeta = pickFirst(row, ["cmv_meta", "cmvMeta", "meta_cmv"]) || "";
    const cmvAtual = pickFirst(row, ["cmv_atual", "cmvAtual"]) || "";
    const cmvDelta = pickFirst(row, ["cmv_delta", "cmvDelta"]) || "";
    const bcgRaw = pickFirst(row, ["bcg", "matriz_bcg", "matriz"]) || "quebra-cabeca";
    const bcg = bcgRaw === "estrela" || bcgRaw === "cavalo" || bcgRaw === "quebra-cabeca" || bcgRaw === "abacaxi" ? bcgRaw : "quebra-cabeca";
    const thumbRaw = pickFirst(row, ["thumb", "tipo", "burger"]) || "burger";
    const thumb = thumbRaw === "burger" || thumbRaw === "duplo" || thumbRaw === "triplo" ? thumbRaw : "burger";
    const recipeImage = pickFirst(row, ["recipe_image", "recipeImage", "imagem", "image"]) || "";
    const popularidadeRaw = pickFirst(row, ["popularidade"]) || "";
    const popularidade = popularidadeRaw.toLowerCase() === "alta" || popularidadeRaw.toLowerCase() === "baixa" ? popularidadeRaw.toLowerCase() : undefined;
    const ingredientsTotal = pickFirst(row, ["ingredients_total", "ingredientsTotal"]);
    const recipeYield = pickFirst(row, ["recipe_yield", "recipeYield", "rendimento"]);
    const ingredientRowsRaw = pickFirst(row, ["ingredient_rows", "ingredientRows", "ingredientes"]);
    let ingredientRows: any[] | undefined;
    if (ingredientRowsRaw && (ingredientRowsRaw.trim().startsWith("[") || ingredientRowsRaw.trim().startsWith("{"))) {
      try {
        const parsed = JSON.parse(ingredientRowsRaw);
        ingredientRows = Array.isArray(parsed) ? parsed : undefined;
      } catch {}
    }
    const modoPreparo = pickFirst(row, ["modo_preparo", "modoPreparo"]) || "";
    fichasRows.push({
      id: bubbleId,
      receita: receita.trim(),
      precoVenda: precoVenda.trim(),
      custoUnitario: custoUnitario.trim(),
      cmvMeta: cmvMeta.trim(),
      cmvAtual: cmvAtual.trim(),
      cmvDelta: cmvDelta.trim(),
      bcg,
      thumb,
      recipeImage: recipeImage.trim() || undefined,
      popularidade,
      ingredientsTotal: ingredientsTotal ? Math.max(0, Math.floor(parsePtNumber(ingredientsTotal))) : undefined,
      recipeYield: recipeYield ? Math.max(0, parsePtNumber(recipeYield)) : undefined,
      ingredientRows: ingredientRows && ingredientRows.length ? ingredientRows : undefined,
      modoPreparo: modoPreparo.trim() || undefined,
    });
  });

  if (fichasRows.length) {
    const { error: ftErr } = await supabase.from("fichas_tecnicas_state").upsert({ id: stateId, payload: fichasRows } as any, { onConflict: "id" });
    if (ftErr) return json({ ok: false, error: `fichas_tecnicas_state:${ftErr.message}` }, { status: 500 });
  }

  const inventarioRows: any[] = [];
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
    if (!dataLabel || !categorias.length) return;
    inventarioRows.push({ id: `${prefix}inventario:${bubbleId}`, data: dataLabel, categorias });
  });

  const inventarioInserted = inventarioRows.length ? await upsertInBatches(supabase, "inventario", inventarioRows, 100) : 0;

  const desperdiciosRows: any[] = [];
  await processCsvGroups("desperdicios", (row) => {
    const item = pickFirst(row, ["item", "insumo", "ingrediente", "nome"]);
    if (!item) return;
    const bubbleId = pickBubbleId(row) || String(desperdiciosRows.length + 1);
    const data = buildDateLabel(pickFirst(row, ["data", "date", "created_date", "created_at"]));
    const quantidade = pickFirst(row, ["quantidade", "qtd", "qtde"]);
    const custo = pickFirst(row, ["custo", "valor", "total", "subtotal"]);
    const motivo = pickFirst(row, ["motivo", "reason", "descricao"]);
    const custoNum = parsePtNumber(custo);
    desperdiciosRows.push({
      id: `${prefix}desperdicio:${bubbleId}`,
      data: data || "-",
      item: item.trim(),
      quantidade: quantidade.trim(),
      custo: custoNum ? formatMoneyBRL(custoNum) : String(custo ?? "").trim(),
      motivo: motivo.trim(),
    });
  });

  const desperdiciosInserted = desperdiciosRows.length ? await upsertInBatches(supabase, "desperdicios", desperdiciosRows, 500) : 0;

  const notaItemsByNotaKey = new Map<string, any[]>();
  await processCsvGroups("itens_notas", (row) => {
    const notaId = pickFirst(row, ["nota_id", "nota", "nota_fiscal_id", "notas_fiscais_id", "notas_fiscais"]);
    if (!notaId) return;
    const nome = pickFirst(row, ["nome", "item", "produto", "descricao"]);
    if (!nome) return;
    const bubbleId = pickBubbleId(row) || String(Date.now());
    const qtd = pickFirst(row, ["quantidade", "qtd", "qtde", "quantidade_label"]);
    const subtotal = pickFirst(row, ["subtotal", "total", "valor", "subtotal_label"]);
    const unit = pickFirst(row, ["custo_unitario", "preco_unitario", "valor_unitario", "custo_unitario_label"]);
    const list = notaItemsByNotaKey.get(notaId) ?? [];
    list.push({
      id: `${prefix}nota_item:${bubbleId}`,
      nome: nome.trim(),
      quantidadeLabel: qtd.trim(),
      subtotalLabel: subtotal ? (parsePtNumber(subtotal) ? formatMoneyBRL(parsePtNumber(subtotal)) : subtotal.trim()) : "",
      custoUnitarioLabel: unit ? (parsePtNumber(unit) ? formatMoneyBRL(parsePtNumber(unit)) : unit.trim()) : "",
    });
    notaItemsByNotaKey.set(notaId, list);
  });

  const entradasRows: any[] = [];
  await processCsvGroups("notas_fiscais", (row) => {
    const fornecedor = pickFirst(row, ["fornecedor", "fornecedor_nome", "empresa", "empresa_nome"]);
    const numero = pickFirst(row, ["numero", "num", "nf", "n_nf", "nota_numero"]);
    const dataLanc = buildDateLabel(pickFirst(row, ["data_lancamento", "data", "data_nota", "data_recebimento", "date"]));
    const bubbleId = pickBubbleId(row) || `${numero || "nf"}_${entradasRows.length + 1}`;
    if (!fornecedor || !numero) return;
    const valor = pickFirst(row, ["valor_nota", "valor", "total", "subtotal"]);
    const valorNum = parsePtNumber(valor);
    const responsavel = pickFirst(row, ["responsavel", "usuario", "user", "nome_usuario"]) || "-";
    const dataCriacao = buildDateLabel(pickFirst(row, ["data_criacao", "created_date", "created_at", "created"]));
    const itensList = notaItemsByNotaKey.get(bubbleId) ?? notaItemsByNotaKey.get(numero) ?? [];
    const itensCount = itensList.length;
    entradasRows.push({
      id: `${prefix}entrada:${bubbleId}`,
      user_id: userId,
      numero: numero.trim(),
      data_lancamento: dataLanc || "-",
      fornecedor: fornecedor.trim(),
      valor_nota: valorNum ? formatMoneyBRL(valorNum) : String(valor ?? "").trim() || "R$0,00",
      itens: `${itensCount || parsePtNumber(pickFirst(row, ["itens", "qtd_itens", "quantidade_itens"])) || 0} Itens`,
      responsavel: responsavel.trim(),
      data_criacao: dataCriacao || dataLanc || "-",
      itens_nota: itensList.length ? itensList : null,
    });
  });

  const entradasInserted = entradasRows.length ? await upsertInBatches(supabase, "entradas", entradasRows, 300) : 0;

  return json(
    {
      ok: true,
      summary: {
        files: files.length,
        insumos: insumosRows.length,
        fornecedores: Object.keys(infoMap).length,
        fornecedoresProdutos: Object.keys(produtosMap).length,
        fichasTecnicas: fichasRows.length,
        prePreparo: prePreparoRows.length,
        inventario: inventarioInserted,
        desperdicios: desperdiciosInserted,
        entradas: entradasInserted,
      },
    },
    { status: 200 },
  );
}
