import { formatMoneyBRL, parsePtNumber } from "./bubbleCsv";

export type ParsedObjectType = { objectType: string; baseType: string; companyId: string | null };

export function parseObjectType(objectType: string): ParsedObjectType {
  const raw = String(objectType ?? "").trim();
  const withoutScope = raw.includes("#") ? raw.split("#", 1)[0] : raw;
  const [base, rest] = withoutScope.split("@");
  const baseType = String(base ?? "").trim();
  const companyId = String(rest ?? "").trim() || null;
  return { objectType: raw, baseType, companyId };
}

export function isStagedOnlyBaseType(baseType: string) {
  const t = String(baseType ?? "").trim().toLowerCase();
  return t === "etiquetas" || t === "ingredientes" || t === "itens_lista_compras" || t === "qtd_compra_real" || t === "faturamentos";
}

export function isScopeOnlyBaseType(baseType: string) {
  const t = String(baseType ?? "").trim().toLowerCase();
  return t === "user" || t === "empresas";
}

export function isCountableFinalBaseType(baseType: string) {
  const t = String(baseType ?? "").trim().toLowerCase();
  return t === "item" || t === "fornecedores" || t === "inventarios" || t === "notas_fiscais" || t === "desperdicio";
}

export function isDerivedBaseType(baseType: string) {
  const t = String(baseType ?? "").trim().toLowerCase();
  return (
    t === "categorias" ||
    t === "custo_medio_item" ||
    t === "itens_fornecedores" ||
    t === "itens_inventarios" ||
    t === "itens_notas" ||
    t === "motivos_desperdicios"
  );
}

function pickAny(obj: any, keys: string[]) {
  for (const k of keys) {
    const v = obj?.[k];
    if (v == null) continue;
    const s = typeof v === "object" ? safeJsonString(v) : String(v).trim();
    if (s) return s;
  }
  try {
    const byNorm = new Map<string, any>();
    for (const [k, v] of Object.entries(obj ?? {})) byNorm.set(normalizeLower(k).replace(/[^a-z0-9]+/g, "_"), v);
    for (const k of keys) {
      const v = byNorm.get(normalizeLower(k).replace(/[^a-z0-9]+/g, "_"));
      if (v == null) continue;
      const s = typeof v === "object" ? safeJsonString(v) : String(v).trim();
      if (s) return s;
    }
  } catch {}
  return "";
}

function pickRawAny(obj: any, keys: string[]) {
  for (const k of keys) {
    const v = obj?.[k];
    if (v != null && String(v).trim() !== "") return v;
  }
  const byNorm = new Map<string, any>();
  for (const [k, v] of Object.entries(obj ?? {})) byNorm.set(normalizeLower(k).replace(/[^a-z0-9]+/g, "_"), v);
  for (const k of keys) {
    const v = byNorm.get(normalizeLower(k).replace(/[^a-z0-9]+/g, "_"));
    if (v != null && String(v).trim() !== "") return v;
  }
  return "";
}

function safeJsonString(value: unknown) {
  try {
    const s = JSON.stringify(value);
    return String(s ?? "").trim();
  } catch {
    return "";
  }
}

function extractBubbleId(input: unknown) {
  if (input == null) return "";
  if (typeof input === "object") {
    const v: any = input as any;
    const direct = String(v?.unique_id ?? v?._id ?? v?.id ?? v?.bubble_id ?? "").trim();
    if (direct) return direct;
    const s = safeJsonString(input);
    if (!s) return "";
    const m = s.match(/\d{8,}x\d{6,}/);
    return m ? String(m[0]).trim() : "";
  }
  const s = String(input ?? "").trim();
  if (!s) return "";
  const m = s.match(/\d{8,}x\d{6,}/);
  return m ? String(m[0]).trim() : "";
}

function normalizeText(v: unknown) {
  return String(v ?? "").replace(/\s+/g, " ").trim();
}

function normalizeLower(v: unknown) {
  return normalizeText(v).toLowerCase();
}

function normalizeKey(v: unknown) {
  return normalizeText(v)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function parseBool(v: unknown) {
  const s = normalizeLower(v);
  if (!s) return false;
  if (s === "1" || s === "true" || s === "sim" || s === "yes") return true;
  if (s === "0" || s === "false" || s === "nao" || s === "não" || s === "no") return false;
  return Boolean(v);
}

export function parseBubbleNumber(v: unknown) {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return parsePtNumber(String(v ?? ""));
}

export function formatBubbleQuantity3(v: unknown) {
  const value = parseBubbleNumber(v);
  return value.toLocaleString("pt-BR", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}

function normalizeCategoryName(v: unknown) {
  return normalizeText(v);
}

export function userScopedId(userId: string) {
  return `user:${String(userId ?? "").trim()}:`;
}

export function buildInsumoId(userId: string, bubbleItemId: string) {
  return `${userScopedId(userId)}insumo:${bubbleItemId}`;
}

export function buildInventarioId(userId: string, bubbleInventarioId: string) {
  return `${userScopedId(userId)}inventario:${bubbleInventarioId}`;
}

export function buildEntradaId(userId: string, bubbleNotaId: string) {
  return `${userScopedId(userId)}entrada:${bubbleNotaId}`;
}

export function buildDesperdicioId(userId: string, bubbleDesperdicioId: string) {
  return `${userScopedId(userId)}desperdicio:${bubbleDesperdicioId}`;
}

export function mapCategoriaName(raw: any) {
  return normalizeText(pickAny(raw, ["nome"]));
}

export function mapItemToInsumo(raw: any, args: { userId: string; categoriaNameById?: Record<string, string> }) {
  const bubbleItemId = normalizeText(pickAny(raw, ["_id"]));
  const item = normalizeText(pickAny(raw, ["nome"]));
  const medida = normalizeText(pickAny(raw, ["unidade_medida"])) || "Und";
  const categoriaIdRaw = normalizeText(pickAny(raw, ["categoria_id"]));
  const categoriaId = extractBubbleId(categoriaIdRaw) || categoriaIdRaw;
  const categoriaFromId = categoriaId && args.categoriaNameById ? String(args.categoriaNameById[categoriaId] ?? "").trim() : "";
  const categoria = (() => {
    const fromId = String(categoriaFromId ?? "").trim();
    if (fromId) return normalizeCategoryName(fromId) || "Sem categoria";
    return "Sem categoria";
  })();
  const especificacao = normalizeText(pickAny(raw, ["descricao"]));
  const ocultar = parseBool(pickAny(raw, ["boolean_ocultar_cmv"]));
  const custoRaw = pickRawAny(raw, ["custo_medio"]);
  const custoNum = parseBubbleNumber(custoRaw);
  const custoMedio = custoNum ? formatMoneyBRL(custoNum) : "";

  return {
    ok: Boolean(bubbleItemId && item),
    bubbleItemId,
    insumo: {
      id: buildInsumoId(args.userId, bubbleItemId || `noid:${item.toLowerCase()}`),
      item: item || "Insumo",
      medida,
      categoria,
      custoMedio,
      especificacao,
      ocultar,
    },
  };
}

export function mapCustoMedioItem(raw: any) {
  const bubbleItemId = extractBubbleId(pickAny(raw, ["item"])) || "";
  const custoRaw = pickRawAny(raw, ["custo_medio"]);
  const num = parseBubbleNumber(custoRaw);
  const custoMedio = num ? formatMoneyBRL(num) : "";
  const createdAt = normalizeText(pickAny(raw, ["data_lancamento"]));
  return { bubbleItemId, custoMedio, createdAt };
}

export function mapFornecedor(raw: any) {
  const bubbleFornecedorId = normalizeText(pickAny(raw, ["_id"]));
  const nome = normalizeText(pickAny(raw, ["nome"]));
  const vendedor = normalizeText(pickAny(raw, ["vendedor"]));
  const whatsapp = normalizeText(pickAny(raw, ["whatsapp"]));
  const endereco = normalizeText(pickAny(raw, ["endereco"]));
  return { bubbleFornecedorId, nome, vendedor, whatsapp, endereco };
}

export function mapItemFornecedor(raw: any) {
  const bubbleFornecedorId = extractBubbleId(pickAny(raw, ["fornecedor_id"])) || "";
  const bubbleItemId = extractBubbleId(pickAny(raw, ["item_id"])) || "";
  const nomeItem = "";
  return { bubbleFornecedorId, bubbleItemId, nomeItem };
}

export function mapInventario(raw: any) {
  const bubbleInventarioId = normalizeText(pickAny(raw, ["_id"]));
  const data = formatBubbleDateNumericPT(pickAny(raw, ["data_contagem"]));
  return { bubbleInventarioId, data };
}

export function mapItemInventario(raw: any) {
  const bubbleInventarioId = extractBubbleId(pickAny(raw, ["inventario_id"])) || "";
  const bubbleItemId = extractBubbleId(pickAny(raw, ["item_id"])) || "";
  const categoriaId = "";
  const categoriaNome = "";
  const unidade = "";
  const quantidadeRaw = pickRawAny(raw, ["quantidade_contada"]);
  const estoqueFinal = quantidadeRaw === "" ? "" : formatBubbleQuantity3(quantidadeRaw);
  return { bubbleInventarioId, bubbleItemId, categoriaId, categoriaNome, unidade, estoqueFinal };
}

export function mapNotaFiscal(raw: any) {
  const bubbleNotaId = normalizeText(pickAny(raw, ["_id"]));
  const numero = normalizeText(pickAny(raw, ["codigo"]));
  const dataLancamento = normalizeText(pickAny(raw, ["data_recebimento"]));
  const fornecedorId = extractBubbleId(pickAny(raw, ["fornecedor_id"])) || "";
  const fornecedorNome = "";
  const valorNotaRaw = pickRawAny(raw, ["valor_nota"]);
  const valorNota = (() => {
    const n = parseBubbleNumber(valorNotaRaw);
    return n ? formatMoneyBRL(n) : normalizeText(valorNotaRaw);
  })();
  const responsavel = extractBubbleId(pickAny(raw, ["responsavel_id"])) || "";
  const dataCriacao = normalizeText(pickAny(raw, ["data_criacao"]));
  const listaItensRaw = (raw as any)?.lista_itens;
  const listaItens = Array.isArray(listaItensRaw) ? (listaItensRaw as any[]).map((x) => String(x ?? "").trim()).filter(Boolean) : [];
  return { bubbleNotaId, numero, dataLancamento, fornecedorId, fornecedorNome, valorNota, responsavel, dataCriacao, listaItens };
}

export function formatBubbleDateLabelPT(value: unknown) {
  const raw = normalizeText(value);
  if (!raw) return "-";
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return raw;
  const month = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"][Number(match[2]) - 1];
  return month ? `${match[3]} ${month}, ${match[1]}` : raw;
}

export function formatBubbleDateNumericPT(value: unknown) {
  const raw = normalizeText(value);
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return `${match[3]}/${match[2]}/${match[1]}`;
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(raw)) return raw;
  const today = new Date();
  return `${String(today.getDate()).padStart(2, "0")}/${String(today.getMonth() + 1).padStart(2, "0")}/${today.getFullYear()}`;
}

export function mapItemNota(raw: any) {
  const bubbleItemNotaId = normalizeText(pickAny(raw, ["_id"]));
  const bubbleNotaId = extractBubbleId(pickAny(raw, ["nota_id"])) || "";
  const bubbleItemId = extractBubbleId(pickAny(raw, ["item_id"])) || "";
  const nomeItem = "";
  const quantidadeRaw = pickRawAny(raw, ["quantidade"]);
  const quantidade = quantidadeRaw === "" ? "" : formatBubbleQuantity3(quantidadeRaw);
  const subtotalRaw = pickRawAny(raw, ["subtotal"]);
  const subtotal = (() => {
    const n = parseBubbleNumber(subtotalRaw);
    return n ? formatMoneyBRL(n) : normalizeText(subtotalRaw);
  })();
  const custoUnitRaw = pickRawAny(raw, ["custo_unitario"]);
  const custoUnitario = (() => {
    const n = parseBubbleNumber(custoUnitRaw);
    return n ? formatMoneyBRL(n) : normalizeText(custoUnitRaw);
  })();
  return { bubbleItemNotaId, bubbleNotaId, bubbleItemId, nomeItem, quantidade, subtotal, custoUnitario };
}

export function mapMotivoDesperdicio(raw: any) {
  const bubbleMotivoId = normalizeText(pickAny(raw, ["_id"]));
  const nome = normalizeText(pickAny(raw, ["titulo"]));
  return { bubbleMotivoId, nome };
}

export function mapDesperdicio(raw: any) {
  const bubbleDesperdicioId = normalizeText(pickAny(raw, ["_id"]));
  const data = formatBubbleDateNumericPT(pickAny(raw, ["lancamento"]));
  const bubbleItemId = extractBubbleId(pickAny(raw, ["item_id"])) || "";
  const itemNome = "";
  const quantidadeRaw = pickRawAny(raw, ["quantidade"]);
  const quantidade = quantidadeRaw === "" ? "" : formatBubbleQuantity3(quantidadeRaw);
  const custoRaw = pickRawAny(raw, ["custo_total"]);
  const custo = (() => {
    const n = parseBubbleNumber(custoRaw);
    return n ? formatMoneyBRL(n) : normalizeText(custoRaw);
  })();
  const bubbleMotivoId = extractBubbleId(pickAny(raw, ["motivo"])) || "";
  const motivoNome = normalizeText(pickAny(raw, ["motivo_text"]));
  return { bubbleDesperdicioId, data, bubbleItemId, itemNome, quantidade, custo, bubbleMotivoId, motivoNome };
}
