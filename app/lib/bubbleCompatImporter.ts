"use server";

import { getSupabaseAdmin } from "./supabaseAdmin";
import { parseObjectType } from "./bubbleObjRealMapping";

type DryRunMode = "dry_run";

type ControlRow = {
  bubble_object_type: string;
  bubble_unique_id: string;
  bubble_user_id: string | null;
  supabase_user_id: string | null;
  raw_payload_json: any;
  status: string;
};

type BubbleUserMapRow = {
  bubble_user_id: string;
  email: string | null;
  nome: string | null;
  supabase_user_id: string | null;
};

type PlanRow<T extends Record<string, unknown> = Record<string, unknown>> = {
  table: string;
  bubble_id: string;
  company_bubble_id: string | null;
  raw: any;
  mapped: T;
  mappedKeys: string[];
  relations: Array<{ name: string; to: string; bubble_id: string; resolved: boolean; reason?: string }>;
  ignoreReason?: string;
};

type DryRunTableStats = {
  sourceRows: number;
  plannedRows: number;
  wouldCreate: number;
  wouldUpdate: number;
  wouldIgnore: number;
  missingBubbleId: number;
  missingCompany: number;
  duplicatesInSource: number;
  brokenRelations: number;
};

type DryRunReport = {
  ok: boolean;
  mode: DryRunMode;
  requestedEmail: string;
  bubbleUser: BubbleUserMapRow | null;
  companyScope: {
    bubbleCompanyIds: string[];
    resolvedCompanies: number;
    missingCompanies: number;
  };
  tablesMissing: string[];
  statsByTable: Record<string, DryRunTableStats>;
  relations: {
    resolved: number;
    broken: number;
    brokenSamples: Array<{ table: string; bubble_id: string; relation: string; expectedBubbleId: string; reason: string }>;
  };
  unmapped: {
    baseTypes: Record<string, number>;
    topUnmappedKeysByBaseType: Record<string, Array<{ key: string; count: number }>>;
  };
  rowsByTable?: Record<string, Array<Pick<PlanRow, "table" | "bubble_id" | "company_bubble_id" | "mapped" | "relations" | "ignoreReason">>>;
  plannedByTable?: Record<string, Array<Pick<PlanRow, "table" | "bubble_id" | "company_bubble_id" | "mapped" | "relations">>>;
};

function normalizeText(v: unknown) {
  return String(v ?? "").replace(/\s+/g, " ").trim();
}

function normalizeLower(v: unknown) {
  return normalizeText(v).toLowerCase();
}

function extractBubbleId(input: unknown) {
  if (input == null) return "";
  if (typeof input === "object") {
    const v: any = input as any;
    const direct = String(v?.unique_id ?? v?._id ?? v?.id ?? v?.bubble_id ?? "").trim();
    if (direct) return direct;
    try {
      const s = JSON.stringify(input);
      const m = s.match(/\d{8,}x\d{6,}/);
      return m ? String(m[0]).trim() : "";
    } catch {
      return "";
    }
  }
  const s = String(input ?? "").trim();
  if (!s) return "";
  const m = s.match(/\d{8,}x\d{6,}/);
  return m ? String(m[0]).trim() : "";
}

function pickAny(obj: any, keys: string[]) {
  if (!obj || typeof obj !== "object") return "";
  for (const k of keys) {
    const v = (obj as any)[k];
    if (v == null) continue;
    const s = typeof v === "object" ? "" : String(v).trim();
    if (s) return s;
  }
  return "";
}

function parseNumber(v: unknown) {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const s = String(v ?? "").trim();
  if (!s) return null;
  const cleaned = s.replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function parseBool(v: unknown) {
  const s = normalizeLower(v);
  if (s === "1" || s === "true" || s === "sim" || s === "yes") return true;
  if (s === "0" || s === "false" || s === "nao" || s === "não" || s === "no") return false;
  return Boolean(v);
}

function parseDateOnly(v: unknown) {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const d = new Date(s);
  if (!Number.isFinite(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function parseTime(v: unknown) {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const d = new Date(s);
  if (!Number.isFinite(d.getTime())) return null;
  return d.toISOString();
}

function countKeysNotMapped(raw: any, mappedKeys: string[]) {
  const ignore = new Set<string>([
    "_id",
    "unique_id",
    "id",
    "created date",
    "created by",
    "modified date",
    "slug",
    "bubble_id",
  ]);
  const mapped = new Set(mappedKeys.map((k) => normalizeLower(k)));
  const counts: Record<string, number> = {};
  for (const k of Object.keys(raw ?? {})) {
    const key = normalizeLower(k);
    if (!key) continue;
    if (ignore.has(key)) continue;
    if (mapped.has(key)) continue;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

async function tableExists(supabase: ReturnType<typeof getSupabaseAdmin>, table: string) {
  const { error } = await supabase.from(table).select("*").limit(1);
  if (!error) return true;
  const msg = String((error as any)?.message ?? "").toLowerCase();
  return !msg.includes("does not exist") && !msg.includes("relation") ? true : false;
}

async function fetchAllControlRowsForBubbleUser(args: { supabase: ReturnType<typeof getSupabaseAdmin>; bubbleUserId: string; supabaseUserId: string | null }) {
  const out: ControlRow[] = [];
  const pageSize = 1000;
  for (let from = 0; from < 200_000; from += pageSize) {
    let q = args.supabase
      .from("bubble_obj_import_control")
      .select("bubble_object_type,bubble_unique_id,bubble_user_id,supabase_user_id,raw_payload_json,status")
      .eq("bubble_user_id", args.bubbleUserId)
      .order("created_at", { ascending: true })
      .range(from, from + pageSize - 1);
    if (args.supabaseUserId) q = q.eq("supabase_user_id", args.supabaseUserId);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as any[];
    for (const r of rows) out.push(r as ControlRow);
    if (rows.length < pageSize) break;
  }
  return out;
}

async function resolveBubbleUserByEmail(supabase: ReturnType<typeof getSupabaseAdmin>, email: string) {
  const e = normalizeLower(email);
  const { data, error } = await supabase
    .from("bubble_obj_user_map")
    .select("bubble_user_id,email,nome,supabase_user_id")
    .eq("email", e)
    .limit(1);
  if (error) throw new Error(error.message);
  const row = ((data ?? [])[0] ?? null) as any;
  if (!row) return null;
  return {
    bubble_user_id: String(row.bubble_user_id ?? "").trim(),
    email: row.email ? String(row.email) : null,
    nome: row.nome ? String(row.nome) : null,
    supabase_user_id: row.supabase_user_id ? String(row.supabase_user_id) : null,
  } as BubbleUserMapRow;
}

type PlannedId = { kind: "existing"; id: string } | { kind: "new"; key: string };

function plannedKey(prefix: string, companyBubbleId: string | null, bubbleId: string) {
  return `${prefix}:${companyBubbleId ?? "-"}:${bubbleId}`;
}

async function existsByBubbleId(supabase: ReturnType<typeof getSupabaseAdmin>, table: string, bubbleIds: string[]) {
  const existing = new Set<string>();
  const chunk = 800;
  for (let i = 0; i < bubbleIds.length; i += chunk) {
    const part = bubbleIds.slice(i, i + chunk);
    const { data, error } = await supabase.from(table).select("bubble_id").in("bubble_id", part);
    if (error) throw new Error(error.message);
    for (const r of (data ?? []) as any[]) {
      const b = String(r?.bubble_id ?? "").trim();
      if (b) existing.add(b);
    }
  }
  return existing;
}

async function existsByCompanyBubbleId(supabase: ReturnType<typeof getSupabaseAdmin>, table: string, pairs: Array<{ company_id: string; bubble_id: string }>) {
  const existing = new Set<string>();
  const chunk = 500;
  for (let i = 0; i < pairs.length; i += chunk) {
    const part = pairs.slice(i, i + chunk);
    const byCompany = new Map<string, string[]>();
    for (const p of part) {
      const list = byCompany.get(p.company_id) ?? [];
      list.push(p.bubble_id);
      byCompany.set(p.company_id, list);
    }
    for (const [company_id, bubble_ids] of byCompany.entries()) {
      const { data, error } = await supabase.from(table).select("bubble_id").eq("company_id", company_id).in("bubble_id", bubble_ids);
      if (error) throw new Error(error.message);
      for (const r of (data ?? []) as any[]) {
        const b = String(r?.bubble_id ?? "").trim();
        if (b) existing.add(`${company_id}::${b}`);
      }
    }
  }
  return existing;
}

export async function dryRunBubbleCompatImportForEmail(
  email: string,
  options?: { includeRows?: boolean; includePlanned?: boolean },
): Promise<DryRunReport> {
  const supabase = getSupabaseAdmin();
  const requestedEmail = normalizeLower(email);
  const bubbleUser = await resolveBubbleUserByEmail(supabase, requestedEmail);
  if (!bubbleUser?.bubble_user_id) {
    return {
      ok: false,
      mode: "dry_run",
      requestedEmail,
      bubbleUser: null,
      companyScope: { bubbleCompanyIds: [], resolvedCompanies: 0, missingCompanies: 0 },
      tablesMissing: [],
      statsByTable: {},
      relations: { resolved: 0, broken: 0, brokenSamples: [] },
      unmapped: { baseTypes: {}, topUnmappedKeysByBaseType: {} },
    };
  }

  const tablesToCheck = [
    "companies",
    "user_profiles",
    "company_members",
    "categories",
    "items",
    "suppliers",
    "supplier_items",
    "invoices",
    "invoice_items",
    "inventories",
    "inventory_items",
    "waste_reasons",
    "wastes",
    "labels",
    "recipe_ingredients",
    "shopping_list_items",
    "purchase_real_qty",
    "revenues",
    "avg_cost_events",
  ];

  const tablesMissing: string[] = [];
  for (const t of tablesToCheck) {
    const ok = await tableExists(supabase, t).catch(() => false);
    if (!ok) tablesMissing.push(t);
  }

  const controlRows = await fetchAllControlRowsForBubbleUser({ supabase, bubbleUserId: bubbleUser.bubble_user_id, supabaseUserId: bubbleUser.supabase_user_id });

  const baseTypesCount: Record<string, number> = {};
  const topUnmapped: Record<string, Record<string, number>> = {};

  const empresas: PlanRow[] = [];
  const users: PlanRow[] = [];
  const companyMembers: PlanRow[] = [];
  const categorias: PlanRow[] = [];
  const items: PlanRow[] = [];
  const fornecedores: PlanRow[] = [];
  const itensFornecedores: PlanRow[] = [];
  const notas: PlanRow[] = [];
  const itensNotas: PlanRow[] = [];
  const inventarios: PlanRow[] = [];
  const itensInventarios: PlanRow[] = [];
  const motivos: PlanRow[] = [];
  const desperdicios: PlanRow[] = [];
  const etiquetas: PlanRow[] = [];
  const ingredientes: PlanRow[] = [];
  const itensListaCompras: PlanRow[] = [];
  const qtdCompraReal: PlanRow[] = [];
  const faturamentos: PlanRow[] = [];
  const custoMedioItem: PlanRow[] = [];

  const addUnmapped = (baseType: string, raw: any, mappedKeys: string[]) => {
    const bt = normalizeLower(baseType) || "unknown";
    const counts = countKeysNotMapped(raw, mappedKeys);
    const cur = topUnmapped[bt] ?? {};
    for (const [k, c] of Object.entries(counts)) cur[k] = (cur[k] ?? 0) + c;
    topUnmapped[bt] = cur;
  };

  const seenByBaseTypeCompany: Record<string, Set<string>> = {};
  const dupByTable: Record<string, number> = {};

  for (const r of controlRows) {
    const parsed = parseObjectType(String(r.bubble_object_type ?? ""));
    const baseType = String(parsed.baseType ?? "").trim();
    const baseTypeKey = normalizeLower(baseType || "unknown");
    baseTypesCount[baseTypeKey] = (baseTypesCount[baseTypeKey] ?? 0) + 1;

    const raw = (r as any).raw_payload_json ?? {};
    const bubbleId = String(r.bubble_unique_id ?? "").trim() || extractBubbleId(raw);
    const companyBubbleId = parsed.companyId;
    const dedupeKey = `${baseTypeKey}@@${companyBubbleId ?? "-"}@@${bubbleId}`;
    if (bubbleId) {
      const setKey = `${baseTypeKey}@@${companyBubbleId ?? "-"}`;
      const set = (seenByBaseTypeCompany[setKey] ??= new Set<string>());
      if (set.has(bubbleId)) {
        dupByTable[baseTypeKey] = (dupByTable[baseTypeKey] ?? 0) + 1;
        continue;
      }
      set.add(bubbleId);
    }

    if (baseTypeKey === "empresas") {
      const mappedKeys = ["nome", "cnpj", "email", "whatsapp", "meta_cmv", "plano", "status_plano"];
      empresas.push({
        table: "companies",
        bubble_id: bubbleId,
        company_bubble_id: null,
        raw,
        mappedKeys,
        relations: [],
        mapped: {
          bubble_id: bubbleId,
          fantasy_name: normalizeText(pickAny(raw, ["nome"])),
          legal_name: normalizeText(pickAny(raw, ["nome"])),
          cnpj: normalizeText(pickAny(raw, ["cnpj"])) || null,
          email: normalizeLower(pickAny(raw, ["email"])) || null,
          phone_e164: normalizeText(pickAny(raw, ["whatsapp"])) || null,
          meta_cmv: parseNumber((raw as any)?.meta_cmv),
          plan_code: normalizeText((raw as any)?.plano) || null,
          plan_status: normalizeText((raw as any)?.status_plano) || null,
          raw,
        },
      });
      addUnmapped(baseTypeKey, raw, mappedKeys);
      continue;
    }

    if (baseTypeKey === "user") {
      const mappedKeys = ["nome", "sobrenome", "nome_completo", "whatsapp", "proprietario_empresa", "nivel_permissao", "empresa_id"];
      users.push({
        table: "user_profiles",
        bubble_id: bubbleId,
        company_bubble_id: null,
        raw,
        mappedKeys,
        relations: [],
        mapped: {
          bubble_user_id: bubbleId,
          email: normalizeLower(pickAny(raw, ["email"])) || null,
          nome: normalizeText(pickAny(raw, ["nome"])),
          sobrenome: normalizeText(pickAny(raw, ["sobrenome"])),
          nome_completo: normalizeText(pickAny(raw, ["nome_completo"])),
          whatsapp: normalizeText(pickAny(raw, ["whatsapp"])),
          proprietario_empresa: parseBool((raw as any)?.proprietario_empresa),
          nivel_permissao: normalizeText((raw as any)?.nivel_permissao) || null,
          empresa_id: extractBubbleId((raw as any)?.empresa_id) || normalizeText((raw as any)?.empresa_id),
          raw,
        },
      });
      addUnmapped(baseTypeKey, raw, mappedKeys);
      continue;
    }

    const companyIdForType = companyBubbleId || extractBubbleId((raw as any)?.empresa_id) || null;

    if (baseTypeKey === "categorias") {
      const mappedKeys = ["nome", "empresa_id"];
      categorias.push({
        table: "categories",
        bubble_id: bubbleId,
        company_bubble_id: companyIdForType,
        raw,
        mappedKeys,
        relations: [{ name: "company", to: "companies", bubble_id: companyIdForType || "", resolved: Boolean(companyIdForType), reason: companyIdForType ? undefined : "missing_company_id" }],
        mapped: { bubble_id: bubbleId, name: normalizeText(pickAny(raw, ["nome"])), raw },
        ignoreReason: !bubbleId ? "missing_bubble_id" : !companyIdForType ? "missing_company" : undefined,
      });
      addUnmapped(baseTypeKey, raw, mappedKeys);
      continue;
    }

    if (baseTypeKey === "item") {
      const mappedKeys = [
        "nome",
        "descricao",
        "modo_preparo",
        "rendimento",
        "custo_medio",
        "validade_data",
        "validade_dias",
        "cmv_desejado",
        "dias_estoque_minimo",
        "boolean_ocultar_cmv",
        "boolean_item_receita",
        "boolean_item_do_cardapio",
        "preco_venda_total",
        "custo_total_receita",
        "dias_prazo_fornecedor",
        "dias_total_estoque_minimo",
        "popularidade",
        "quadrante_ficha_tecnica",
        "unidade_medida",
        "categoria_id",
        "empresa_id",
      ];
      const categoriaBubbleId = extractBubbleId((raw as any)?.categoria_id) || normalizeText((raw as any)?.categoria_id);
      const relations: Array<{ name: string; to: string; bubble_id: string; resolved: boolean; reason?: string }> = [
        { name: "company", to: "companies", bubble_id: companyIdForType || "", resolved: Boolean(companyIdForType), reason: companyIdForType ? undefined : "missing_company_id" },
      ];
      if (categoriaBubbleId) relations.push({ name: "category", to: "categories", bubble_id: categoriaBubbleId, resolved: true });
      items.push({
        table: "items",
        bubble_id: bubbleId,
        company_bubble_id: companyIdForType,
        raw,
        mappedKeys,
        relations,
        mapped: {
          bubble_id: bubbleId,
          name: normalizeText(pickAny(raw, ["nome"])),
          descricao: normalizeText(pickAny(raw, ["descricao"])),
          modo_preparo: normalizeText(pickAny(raw, ["modo_preparo"])),
          rendimento: parseNumber((raw as any)?.rendimento),
          custo_medio: parseNumber((raw as any)?.custo_medio),
          validade_data: parseDateOnly((raw as any)?.validade_data),
          validade_dias: parseNumber((raw as any)?.validade_dias),
          cmv_desejado: parseNumber((raw as any)?.cmv_desejado),
          dias_estoque_minimo: parseNumber((raw as any)?.dias_estoque_minimo),
          ocultar_cmv: parseBool((raw as any)?.boolean_ocultar_cmv),
          item_receita: parseBool((raw as any)?.boolean_item_receita),
          item_do_cardapio: parseBool((raw as any)?.boolean_item_do_cardapio),
          preco_venda_total: parseNumber((raw as any)?.preco_venda_total),
          custo_total_receita: parseNumber((raw as any)?.custo_total_receita),
          dias_prazo_fornecedor: parseNumber((raw as any)?.dias_prazo_fornecedor),
          dias_total_estoque_minimo: parseNumber((raw as any)?.dias_total_estoque_minimo),
          popularidade: normalizeText((raw as any)?.popularidade) || null,
          quadrante_ficha_tecnica: normalizeText((raw as any)?.quadrante_ficha_tecnica) || null,
          unidade_medida: normalizeText((raw as any)?.unidade_medida) || null,
          categoria_bubble_id: categoriaBubbleId || null,
          raw,
        },
        ignoreReason: !bubbleId ? "missing_bubble_id" : !companyIdForType ? "missing_company" : undefined,
      });
      addUnmapped(baseTypeKey, raw, mappedKeys);
      continue;
    }

    if (baseTypeKey === "fornecedores") {
      const mappedKeys = ["nome", "endereco", "vendedor", "whatsapp", "empresa_id"];
      fornecedores.push({
        table: "suppliers",
        bubble_id: bubbleId,
        company_bubble_id: companyIdForType,
        raw,
        mappedKeys,
        relations: [{ name: "company", to: "companies", bubble_id: companyIdForType || "", resolved: Boolean(companyIdForType), reason: companyIdForType ? undefined : "missing_company_id" }],
        mapped: {
          bubble_id: bubbleId,
          nome: normalizeText((raw as any)?.nome),
          endereco: normalizeText((raw as any)?.endereco),
          vendedor: normalizeText((raw as any)?.vendedor),
          whatsapp: normalizeText((raw as any)?.whatsapp),
          raw,
        },
        ignoreReason: !bubbleId ? "missing_bubble_id" : !companyIdForType ? "missing_company" : undefined,
      });
      addUnmapped(baseTypeKey, raw, mappedKeys);
      continue;
    }

    if (baseTypeKey === "itens_fornecedores") {
      const mappedKeys = ["item_id", "fornecedor_id", "empresa_id"];
      const bubbleItemId = extractBubbleId((raw as any)?.item_id) || normalizeText((raw as any)?.item_id);
      const bubbleFornecedorId = extractBubbleId((raw as any)?.fornecedor_id) || normalizeText((raw as any)?.fornecedor_id);
      itensFornecedores.push({
        table: "supplier_items",
        bubble_id: bubbleId,
        company_bubble_id: companyIdForType,
        raw,
        mappedKeys,
        relations: [
          { name: "company", to: "companies", bubble_id: companyIdForType || "", resolved: Boolean(companyIdForType), reason: companyIdForType ? undefined : "missing_company_id" },
          { name: "supplier", to: "suppliers", bubble_id: bubbleFornecedorId || "", resolved: Boolean(bubbleFornecedorId), reason: bubbleFornecedorId ? undefined : "missing_fornecedor_id" },
          { name: "item", to: "items", bubble_id: bubbleItemId || "", resolved: Boolean(bubbleItemId), reason: bubbleItemId ? undefined : "missing_item_id" },
        ],
        mapped: { bubble_id: bubbleId, fornecedor_bubble_id: bubbleFornecedorId || null, item_bubble_id: bubbleItemId || null, raw },
        ignoreReason: !bubbleId ? "missing_bubble_id" : !companyIdForType ? "missing_company" : undefined,
      });
      addUnmapped(baseTypeKey, raw, mappedKeys);
      continue;
    }

    if (baseTypeKey === "notas_fiscais") {
      const mappedKeys = ["codigo", "responsavel_id", "data_criacao", "data_recebimento", "empresa_id", "fornecedor_id"];
      const fornecedorBubbleId = extractBubbleId((raw as any)?.fornecedor_id) || normalizeText((raw as any)?.fornecedor_id);
      notas.push({
        table: "invoices",
        bubble_id: bubbleId,
        company_bubble_id: companyIdForType,
        raw,
        mappedKeys,
        relations: [
          { name: "company", to: "companies", bubble_id: companyIdForType || "", resolved: Boolean(companyIdForType), reason: companyIdForType ? undefined : "missing_company_id" },
          { name: "supplier", to: "suppliers", bubble_id: fornecedorBubbleId || "", resolved: Boolean(fornecedorBubbleId), reason: fornecedorBubbleId ? undefined : "missing_fornecedor_id" },
        ],
        mapped: {
          bubble_id: bubbleId,
          codigo: normalizeText((raw as any)?.codigo),
          data_criacao: parseTime((raw as any)?.data_criacao),
          data_recebimento: parseDateOnly((raw as any)?.data_recebimento),
          fornecedor_bubble_id: fornecedorBubbleId || null,
          raw,
        },
        ignoreReason: !bubbleId ? "missing_bubble_id" : !companyIdForType ? "missing_company" : undefined,
      });
      addUnmapped(baseTypeKey, raw, mappedKeys);
      continue;
    }

    if (baseTypeKey === "itens_notas") {
      const mappedKeys = ["subtotal", "quantidade", "ocultar_cmv", "data_lancamento", "item_id", "custo_unitario", "empresa_id", "nota_id", "fornecedor_id"];
      const bubbleItemId = extractBubbleId((raw as any)?.item_id) || normalizeText((raw as any)?.item_id);
      const bubbleNotaId = extractBubbleId((raw as any)?.nota_id) || normalizeText((raw as any)?.nota_id);
      const bubbleFornecedorId = extractBubbleId((raw as any)?.fornecedor_id) || normalizeText((raw as any)?.fornecedor_id);
      itensNotas.push({
        table: "invoice_items",
        bubble_id: bubbleId,
        company_bubble_id: companyIdForType,
        raw,
        mappedKeys,
        relations: [
          { name: "company", to: "companies", bubble_id: companyIdForType || "", resolved: Boolean(companyIdForType), reason: companyIdForType ? undefined : "missing_company_id" },
          { name: "invoice", to: "invoices", bubble_id: bubbleNotaId || "", resolved: Boolean(bubbleNotaId), reason: bubbleNotaId ? undefined : "missing_nota_id" },
          { name: "item", to: "items", bubble_id: bubbleItemId || "", resolved: Boolean(bubbleItemId), reason: bubbleItemId ? undefined : "missing_item_id" },
          { name: "supplier", to: "suppliers", bubble_id: bubbleFornecedorId || "", resolved: Boolean(bubbleFornecedorId), reason: bubbleFornecedorId ? undefined : "missing_fornecedor_id" },
        ],
        mapped: {
          bubble_id: bubbleId,
          invoice_bubble_id: bubbleNotaId || null,
          item_bubble_id: bubbleItemId || null,
          fornecedor_bubble_id: bubbleFornecedorId || null,
          data_lancamento: parseDateOnly((raw as any)?.data_lancamento),
          quantidade: parseNumber((raw as any)?.quantidade),
          custo_unitario: parseNumber((raw as any)?.custo_unitario),
          subtotal: parseNumber((raw as any)?.subtotal),
          ocultar_cmv: parseBool((raw as any)?.ocultar_cmv),
          cadastro_item: parseBool((raw as any)?.cadastro_Item),
          excluivel_detalhes_item: parseBool((raw as any)?.excluível_detalhes_item),
          raw,
        },
        ignoreReason: !bubbleId ? "missing_bubble_id" : !companyIdForType ? "missing_company" : undefined,
      });
      addUnmapped(baseTypeKey, raw, mappedKeys);
      continue;
    }

    if (baseTypeKey === "inventarios") {
      const mappedKeys = ["nome", "data_contagem", "empresa_id"];
      inventarios.push({
        table: "inventories",
        bubble_id: bubbleId,
        company_bubble_id: companyIdForType,
        raw,
        mappedKeys,
        relations: [{ name: "company", to: "companies", bubble_id: companyIdForType || "", resolved: Boolean(companyIdForType), reason: companyIdForType ? undefined : "missing_company_id" }],
        mapped: {
          bubble_id: bubbleId,
          nome: normalizeText((raw as any)?.nome),
          data_contagem: parseTime((raw as any)?.data_contagem),
          raw,
        },
        ignoreReason: !bubbleId ? "missing_bubble_id" : !companyIdForType ? "missing_company" : undefined,
      });
      addUnmapped(baseTypeKey, raw, mappedKeys);
      continue;
    }

    if (baseTypeKey === "itens_inventarios") {
      const mappedKeys = ["data_contagem", "item_temporario", "ocultar_cmv", "item_id", "quantidade_contada", "empresa_id", "inventario_id"];
      const bubbleInventarioId = extractBubbleId((raw as any)?.inventario_id) || normalizeText((raw as any)?.inventario_id);
      const bubbleItemId = extractBubbleId((raw as any)?.item_id) || normalizeText((raw as any)?.item_id);
      itensInventarios.push({
        table: "inventory_items",
        bubble_id: bubbleId,
        company_bubble_id: companyIdForType,
        raw,
        mappedKeys,
        relations: [
          { name: "company", to: "companies", bubble_id: companyIdForType || "", resolved: Boolean(companyIdForType), reason: companyIdForType ? undefined : "missing_company_id" },
          { name: "inventory", to: "inventories", bubble_id: bubbleInventarioId || "", resolved: Boolean(bubbleInventarioId), reason: bubbleInventarioId ? undefined : "missing_inventario_id" },
          { name: "item", to: "items", bubble_id: bubbleItemId || "", resolved: Boolean(bubbleItemId), reason: bubbleItemId ? undefined : "missing_item_id" },
        ],
        mapped: {
          bubble_id: bubbleId,
          inventory_bubble_id: bubbleInventarioId || null,
          item_bubble_id: bubbleItemId || null,
          data_contagem: parseTime((raw as any)?.data_contagem),
          quantidade_contada: parseNumber((raw as any)?.quantidade_contada),
          ocultar_cmv: parseBool((raw as any)?.ocultar_cmv),
          item_temporario: parseBool((raw as any)?.item_temporario),
          raw,
        },
        ignoreReason: !bubbleId ? "missing_bubble_id" : !companyIdForType ? "missing_company" : undefined,
      });
      addUnmapped(baseTypeKey, raw, mappedKeys);
      continue;
    }

    if (baseTypeKey === "motivos_desperdicios") {
      const mappedKeys = ["titulo", "empresa_id"];
      motivos.push({
        table: "waste_reasons",
        bubble_id: bubbleId,
        company_bubble_id: companyIdForType,
        raw,
        mappedKeys,
        relations: [{ name: "company", to: "companies", bubble_id: companyIdForType || "", resolved: Boolean(companyIdForType), reason: companyIdForType ? undefined : "missing_company_id" }],
        mapped: { bubble_id: bubbleId, titulo: normalizeText((raw as any)?.titulo), raw },
        ignoreReason: !bubbleId ? "missing_bubble_id" : !companyIdForType ? "missing_company" : undefined,
      });
      addUnmapped(baseTypeKey, raw, mappedKeys);
      continue;
    }

    if (baseTypeKey === "desperdicio") {
      const mappedKeys = ["lancamento", "motivo_text", "quantidade", "custo_total", "unidade_medida", "item_id", "empresa_id", "etiqueta_id", "motivo", "custo_unitario"];
      const bubbleItemId = extractBubbleId((raw as any)?.item_id) || normalizeText((raw as any)?.item_id);
      const bubbleEtiquetaId = extractBubbleId((raw as any)?.etiqueta_id) || normalizeText((raw as any)?.etiqueta_id);
      const bubbleMotivoId = extractBubbleId((raw as any)?.motivo) || normalizeText((raw as any)?.motivo);
      desperdicios.push({
        table: "wastes",
        bubble_id: bubbleId,
        company_bubble_id: companyIdForType,
        raw,
        mappedKeys,
        relations: [
          { name: "company", to: "companies", bubble_id: companyIdForType || "", resolved: Boolean(companyIdForType), reason: companyIdForType ? undefined : "missing_company_id" },
          { name: "item", to: "items", bubble_id: bubbleItemId || "", resolved: Boolean(bubbleItemId), reason: bubbleItemId ? undefined : "missing_item_id" },
          { name: "label", to: "labels", bubble_id: bubbleEtiquetaId || "", resolved: Boolean(bubbleEtiquetaId) || !String((raw as any)?.etiqueta_id ?? "").trim(), reason: bubbleEtiquetaId ? undefined : String((raw as any)?.etiqueta_id ?? "").trim() ? "missing_etiqueta_id" : undefined },
          { name: "reason", to: "waste_reasons", bubble_id: bubbleMotivoId || "", resolved: Boolean(bubbleMotivoId) || !String((raw as any)?.motivo ?? "").trim(), reason: bubbleMotivoId ? undefined : String((raw as any)?.motivo ?? "").trim() ? "missing_motivo_id" : undefined },
        ],
        mapped: {
          bubble_id: bubbleId,
          lancamento: parseDateOnly((raw as any)?.lancamento),
          motivo_text: normalizeText((raw as any)?.motivo_text),
          quantidade: parseNumber((raw as any)?.quantidade),
          custo_total: parseNumber((raw as any)?.custo_total),
          custo_unitario: parseNumber((raw as any)?.custo_unitario),
          unidade_medida: normalizeText((raw as any)?.unidade_medida),
          item_bubble_id: bubbleItemId || null,
          etiqueta_bubble_id: bubbleEtiquetaId || null,
          motivo_bubble_id: bubbleMotivoId || null,
          raw,
        },
        ignoreReason: !bubbleId ? "missing_bubble_id" : !companyIdForType ? "missing_company" : undefined,
      });
      addUnmapped(baseTypeKey, raw, mappedKeys);
      continue;
    }

    if (baseTypeKey === "etiquetas") {
      const mappedKeys = [
        "codigo",
        "item_nome",
        "data_criacao_log",
        "data_producao",
        "data_validade",
        "responsavel_id",
        "boolean_desperdiçado",
        "dias_validade",
        "item_id",
        "boolean_baixa_vencimento",
        "empresa_id",
        "quantidade_produzida",
        "responsavel_nome_completo",
      ];
      const bubbleItemId = extractBubbleId((raw as any)?.item_id) || normalizeText((raw as any)?.item_id);
      etiquetas.push({
        table: "labels",
        bubble_id: bubbleId,
        company_bubble_id: companyIdForType,
        raw,
        mappedKeys,
        relations: [
          { name: "company", to: "companies", bubble_id: companyIdForType || "", resolved: Boolean(companyIdForType), reason: companyIdForType ? undefined : "missing_company_id" },
          { name: "item", to: "items", bubble_id: bubbleItemId || "", resolved: Boolean(bubbleItemId) || !String((raw as any)?.item_id ?? "").trim(), reason: bubbleItemId ? undefined : String((raw as any)?.item_id ?? "").trim() ? "missing_item_id" : undefined },
        ],
        mapped: {
          bubble_id: bubbleId,
          codigo: normalizeText((raw as any)?.codigo),
          item_nome: normalizeText((raw as any)?.item_nome),
          data_criacao_log: parseTime((raw as any)?.data_criacao_log),
          data_producao: parseDateOnly((raw as any)?.data_producao),
          data_validade: parseDateOnly((raw as any)?.data_validade),
          boolean_desperdicado: parseBool((raw as any)?.boolean_desperdiçado),
          dias_validade: parseNumber((raw as any)?.dias_validade),
          item_bubble_id: bubbleItemId || null,
          boolean_baixa_vencimento: parseBool((raw as any)?.boolean_baixa_vencimento),
          quantidade_produzida: parseNumber((raw as any)?.quantidade_produzida),
          responsavel_nome_completo: normalizeText((raw as any)?.responsavel_nome_completo),
          raw,
        },
        ignoreReason: !bubbleId ? "missing_bubble_id" : !companyIdForType ? "missing_company" : undefined,
      });
      addUnmapped(baseTypeKey, raw, mappedKeys);
      continue;
    }

    if (baseTypeKey === "ingredientes") {
      const mappedKeys = ["custo", "item_id", "quantidade", "receita_id", "ingrediente_temporario"];
      const bubbleIngredientItemId = extractBubbleId((raw as any)?.item_id) || normalizeText((raw as any)?.item_id);
      const bubbleRecipeItemId = extractBubbleId((raw as any)?.receita_id) || normalizeText((raw as any)?.receita_id);
      ingredientes.push({
        table: "recipe_ingredients",
        bubble_id: bubbleId,
        company_bubble_id: companyIdForType,
        raw,
        mappedKeys,
        relations: [
          { name: "company", to: "companies", bubble_id: companyIdForType || "", resolved: Boolean(companyIdForType), reason: companyIdForType ? undefined : "missing_company_id" },
          { name: "recipe_item", to: "items", bubble_id: bubbleRecipeItemId || "", resolved: Boolean(bubbleRecipeItemId), reason: bubbleRecipeItemId ? undefined : "missing_receita_id" },
          { name: "ingredient_item", to: "items", bubble_id: bubbleIngredientItemId || "", resolved: Boolean(bubbleIngredientItemId), reason: bubbleIngredientItemId ? undefined : "missing_item_id" },
        ],
        mapped: {
          bubble_id: bubbleId,
          recipe_item_bubble_id: bubbleRecipeItemId || null,
          ingredient_item_bubble_id: bubbleIngredientItemId || null,
          quantidade: parseNumber((raw as any)?.quantidade),
          custo: parseNumber((raw as any)?.custo),
          ingrediente_temporario: parseBool((raw as any)?.ingrediente_temporario),
          raw,
        },
        ignoreReason: !bubbleId ? "missing_bubble_id" : undefined,
      });
      addUnmapped(baseTypeKey, raw, mappedKeys);
      continue;
    }

    if (baseTypeKey === "itens_lista_compras") {
      const mappedKeys = ["Item_nome", "item_id", "qtd_compra", "qtd_sugestao", "empresa_id", "tipo", "item_medida"];
      const bubbleItemId = extractBubbleId((raw as any)?.item_id) || normalizeText((raw as any)?.item_id);
      itensListaCompras.push({
        table: "shopping_list_items",
        bubble_id: bubbleId,
        company_bubble_id: companyIdForType,
        raw,
        mappedKeys,
        relations: [
          { name: "company", to: "companies", bubble_id: companyIdForType || "", resolved: Boolean(companyIdForType), reason: companyIdForType ? undefined : "missing_company_id" },
          { name: "item", to: "items", bubble_id: bubbleItemId || "", resolved: Boolean(bubbleItemId) || !String((raw as any)?.item_id ?? "").trim(), reason: bubbleItemId ? undefined : String((raw as any)?.item_id ?? "").trim() ? "missing_item_id" : undefined },
        ],
        mapped: {
          bubble_id: bubbleId,
          item_bubble_id: bubbleItemId || null,
          item_nome: normalizeText((raw as any)?.Item_nome),
          item_medida: normalizeText((raw as any)?.item_medida),
          qtd_compra: parseNumber((raw as any)?.qtd_compra),
          qtd_sugestao: parseNumber((raw as any)?.qtd_sugestao),
          tipo: normalizeText((raw as any)?.tipo),
          raw,
        },
        ignoreReason: !bubbleId ? "missing_bubble_id" : !companyIdForType ? "missing_company" : undefined,
      });
      addUnmapped(baseTypeKey, raw, mappedKeys);
      continue;
    }

    if (baseTypeKey === "qtd_compra_real") {
      const mappedKeys = ["item_id", "quantidade", "empresa_id"];
      const bubbleItemId = extractBubbleId((raw as any)?.item_id) || normalizeText((raw as any)?.item_id);
      qtdCompraReal.push({
        table: "purchase_real_qty",
        bubble_id: bubbleId,
        company_bubble_id: companyIdForType,
        raw,
        mappedKeys,
        relations: [
          { name: "company", to: "companies", bubble_id: companyIdForType || "", resolved: Boolean(companyIdForType), reason: companyIdForType ? undefined : "missing_company_id" },
          { name: "item", to: "items", bubble_id: bubbleItemId || "", resolved: Boolean(bubbleItemId), reason: bubbleItemId ? undefined : "missing_item_id" },
        ],
        mapped: {
          bubble_id: bubbleId,
          item_bubble_id: bubbleItemId || null,
          quantidade: parseNumber((raw as any)?.quantidade) ?? 0,
          raw,
        },
        ignoreReason: !bubbleId ? "missing_bubble_id" : !companyIdForType ? "missing_company" : undefined,
      });
      addUnmapped(baseTypeKey, raw, mappedKeys);
      continue;
    }

    if (baseTypeKey === "faturamentos") {
      const mappedKeys = ["data_final", "faturamento", "responsavel_id", "data_inicial", "empresa_id", "inventario_final", "inventario_inicial"];
      const invFinalBubbleId = extractBubbleId((raw as any)?.inventario_final) || normalizeText((raw as any)?.inventario_final);
      const invInicialBubbleId = extractBubbleId((raw as any)?.inventario_inicial) || normalizeText((raw as any)?.inventario_inicial);
      faturamentos.push({
        table: "revenues",
        bubble_id: bubbleId,
        company_bubble_id: companyIdForType,
        raw,
        mappedKeys,
        relations: [
          { name: "company", to: "companies", bubble_id: companyIdForType || "", resolved: Boolean(companyIdForType), reason: companyIdForType ? undefined : "missing_company_id" },
          { name: "inventario_inicial", to: "inventories", bubble_id: invInicialBubbleId || "", resolved: Boolean(invInicialBubbleId) || !String((raw as any)?.inventario_inicial ?? "").trim(), reason: invInicialBubbleId ? undefined : String((raw as any)?.inventario_inicial ?? "").trim() ? "missing_inventario_inicial" : undefined },
          { name: "inventario_final", to: "inventories", bubble_id: invFinalBubbleId || "", resolved: Boolean(invFinalBubbleId) || !String((raw as any)?.inventario_final ?? "").trim(), reason: invFinalBubbleId ? undefined : String((raw as any)?.inventario_final ?? "").trim() ? "missing_inventario_final" : undefined },
        ],
        mapped: {
          bubble_id: bubbleId,
          data_inicial: parseDateOnly((raw as any)?.data_inicial),
          data_final: parseDateOnly((raw as any)?.data_final),
          faturamento: parseNumber((raw as any)?.faturamento),
          inventario_inicial_bubble_id: invInicialBubbleId || null,
          inventario_final_bubble_id: invFinalBubbleId || null,
          raw,
        },
        ignoreReason: !bubbleId ? "missing_bubble_id" : !companyIdForType ? "missing_company" : undefined,
      });
      addUnmapped(baseTypeKey, raw, mappedKeys);
      continue;
    }

    if (baseTypeKey === "custo_medio_item") {
      const mappedKeys = ["data_lancamento", "item", "custo_medio", "empresa_id", "alteracao_custo_inicial"];
      const bubbleItemId = extractBubbleId((raw as any)?.item) || normalizeText((raw as any)?.item);
      custoMedioItem.push({
        table: "avg_cost_events",
        bubble_id: bubbleId,
        company_bubble_id: companyIdForType,
        raw,
        mappedKeys,
        relations: [
          { name: "company", to: "companies", bubble_id: companyIdForType || "", resolved: Boolean(companyIdForType), reason: companyIdForType ? undefined : "missing_company_id" },
          { name: "item", to: "items", bubble_id: bubbleItemId || "", resolved: Boolean(bubbleItemId) || !String((raw as any)?.item ?? "").trim(), reason: bubbleItemId ? undefined : String((raw as any)?.item ?? "").trim() ? "missing_item_id" : undefined },
        ],
        mapped: {
          bubble_id: bubbleId,
          data_lancamento: parseDateOnly((raw as any)?.data_lancamento),
          item_bubble_id: bubbleItemId || null,
          custo_medio: parseNumber((raw as any)?.custo_medio),
          alteracao_custo_inicial: parseBool((raw as any)?.alteracao_custo_inicial),
          raw,
        },
        ignoreReason: !bubbleId ? "missing_bubble_id" : !companyIdForType ? "missing_company" : undefined,
      });
      addUnmapped(baseTypeKey, raw, mappedKeys);
      continue;
    }
  }

  if (notas.length && itensNotas.length) {
    const invoicesByItemId = new Map<
      string,
      Array<{ invoiceId: string; supplierId: string; dataRecebimento: string; dataCriacao: string }>
    >();

    for (const n of notas) {
      const invoiceId = String(n.bubble_id ?? "").trim();
      if (!invoiceId) continue;
      const supplierId = String((n.mapped as any)?.fornecedor_bubble_id ?? "").trim();
      const dataRecebimento = String((n.mapped as any)?.data_recebimento ?? "").trim();
      const dataCriacao = String((n.mapped as any)?.data_criacao ?? "").trim();
      const raw = n.raw ?? {};

      const list = (raw as any)?.lista_itens;
      const entries = Array.isArray(list)
        ? list
        : typeof list === "string"
          ? (() => {
              const s = String(list ?? "").trim();
              if (!s) return [];
              if (s.startsWith("[") && s.endsWith("]")) {
                try {
                  const parsed = JSON.parse(s);
                  return Array.isArray(parsed) ? parsed : [s];
                } catch {
                  return [s];
                }
              }
              return [s];
            })()
          : [];

      for (const e of entries) {
        const itemId = extractBubbleId(e) || normalizeText(e);
        if (!itemId) continue;
        const arr = invoicesByItemId.get(itemId) ?? [];
        arr.push({ invoiceId, supplierId, dataRecebimento, dataCriacao });
        invoicesByItemId.set(itemId, arr);
      }
    }

    const dateOnly = (s: string) => String(s ?? "").trim().slice(0, 10);
    const timeMs = (s: string) => {
      const d = new Date(String(s ?? "").trim());
      const t = d.getTime();
      return Number.isFinite(t) ? t : null;
    };

    for (const it of itensNotas) {
      const mapped = it.mapped as any;
      const raw = it.raw ?? {};

      const existingInvoiceId = String(mapped?.invoice_bubble_id ?? "").trim();
      const itemId = String(mapped?.item_bubble_id ?? "").trim();
      const candidates = itemId ? invoicesByItemId.get(itemId) ?? [] : [];

      const chosenInvoiceId = (() => {
        if (existingInvoiceId) return existingInvoiceId;
        if (!candidates.length) return "";
        if (candidates.length === 1) return candidates[0]!.invoiceId;
        const itemDate = dateOnly(String((raw as any)?.data_lancamento ?? ""));
        const itemTime = timeMs(String((raw as any)?.data_lancamento ?? ""));
        const sorted = candidates
          .slice()
          .map((c) => {
            const invDate = dateOnly(c.dataRecebimento);
            const datePenalty = itemDate && invDate ? (invDate === itemDate ? 0 : 1) : 1;
            const invTime = timeMs(c.dataCriacao);
            const timePenalty = itemTime != null && invTime != null ? Math.abs(invTime - itemTime) : Number.MAX_SAFE_INTEGER;
            return { c, datePenalty, timePenalty };
          })
          .sort((a, b) => (a.datePenalty - b.datePenalty) || (a.timePenalty - b.timePenalty));
        return sorted[0]?.c.invoiceId ?? "";
      })();

      if (chosenInvoiceId && !existingInvoiceId) mapped.invoice_bubble_id = chosenInvoiceId;

      const existingSupplierId = String(mapped?.fornecedor_bubble_id ?? "").trim();
      const chosenSupplierId =
        existingSupplierId ||
        (chosenInvoiceId
          ? candidates.find((c) => c.invoiceId === chosenInvoiceId)?.supplierId ??
            String(notas.find((n) => String(n.bubble_id ?? "").trim() === chosenInvoiceId)?.mapped?.["fornecedor_bubble_id"] ?? "").trim()
          : "");
      if (chosenSupplierId && !existingSupplierId) mapped.fornecedor_bubble_id = chosenSupplierId;

      const invoiceRel = it.relations.find((r) => r.name === "invoice");
      if (invoiceRel) {
        invoiceRel.bubble_id = chosenInvoiceId || "";
        invoiceRel.resolved = Boolean(chosenInvoiceId);
        invoiceRel.reason = chosenInvoiceId ? undefined : "missing_nota_id";
      }

      const supplierRel = it.relations.find((r) => r.name === "supplier");
      if (supplierRel) {
        supplierRel.bubble_id = chosenSupplierId || "";
        supplierRel.resolved = Boolean(chosenSupplierId);
        supplierRel.reason = chosenSupplierId ? undefined : "missing_fornecedor_id";
      }

      if (!chosenInvoiceId) it.ignoreReason = "missing_invoice_link";
    }
  }

  if (items.length && ingredientes.length) {
    const recipeByIngredientRowId = new Map<string, string>();
    for (const it of items) {
      const recipeId = String(it.bubble_id ?? "").trim();
      if (!recipeId) continue;
      const raw = it.raw ?? {};
      const list = (raw as any)?.lista_ingredientes;
      const entries = Array.isArray(list)
        ? list
        : typeof list === "string"
          ? (() => {
              const s = String(list ?? "").trim();
              if (!s) return [];
              if (s.startsWith("[") && s.endsWith("]")) {
                try {
                  const parsed = JSON.parse(s);
                  return Array.isArray(parsed) ? parsed : [s];
                } catch {
                  return [s];
                }
              }
              return [s];
            })()
          : [];
      for (const e of entries) {
        const ingredientRowId = extractBubbleId(e) || normalizeText(e);
        if (ingredientRowId) recipeByIngredientRowId.set(ingredientRowId, recipeId);
      }
    }

    for (const ing of ingredientes) {
      const mapped = ing.mapped as any;
      const raw = ing.raw ?? {};
      const currentRecipeId = String(mapped?.recipe_item_bubble_id ?? "").trim();
      const derivedRecipeId = currentRecipeId || recipeByIngredientRowId.get(String(ing.bubble_id ?? "").trim()) || "";
      if (derivedRecipeId && !currentRecipeId) mapped.recipe_item_bubble_id = derivedRecipeId;

      const recipeRel = ing.relations.find((r) => r.name === "recipe_item");
      if (recipeRel) {
        recipeRel.bubble_id = derivedRecipeId || "";
        recipeRel.resolved = Boolean(derivedRecipeId);
        recipeRel.reason = derivedRecipeId ? undefined : String((raw as any)?.receita_id ?? "").trim() ? "missing_receita_id" : "missing_receita_id";
      }

      if (!derivedRecipeId) ing.ignoreReason = "missing_recipe_link";
    }
  }

  const empresasCompanyBubbleIds = empresas.map((x) => x.bubble_id).filter(Boolean);
  const referencedCompanyBubbleIds = Array.from(
    new Set(
      [
        ...categorias,
        ...items,
        ...fornecedores,
        ...itensFornecedores,
        ...notas,
        ...itensNotas,
        ...inventarios,
        ...itensInventarios,
        ...motivos,
        ...desperdicios,
        ...etiquetas,
        ...ingredientes,
        ...itensListaCompras,
        ...qtdCompraReal,
        ...faturamentos,
        ...custoMedioItem,
      ]
        .map((r) => r.company_bubble_id)
        .filter(Boolean) as string[],
    ),
  );

  const companyBubbleIds = Array.from(new Set([...empresasCompanyBubbleIds, ...referencedCompanyBubbleIds]));

  {
    const supabaseUserId = bubbleUser.supabase_user_id;
    const userPayload = users[0]?.mapped ?? null;
    const permissionLevel = normalizeText((userPayload as any)?.nivel_permissao) || "";
    const ownerFlag = Boolean((userPayload as any)?.proprietario_empresa);
    const role = ownerFlag ? "owner" : /admin|administrador/i.test(permissionLevel) ? "admin" : "member";
    for (const companyBubbleId of empresasCompanyBubbleIds) {
      companyMembers.push({
        table: "company_members",
        bubble_id: `${companyBubbleId}::${supabaseUserId ?? ""}`.trim(),
        company_bubble_id: companyBubbleId,
        raw: users[0]?.raw ?? {},
        mappedKeys: [],
        relations: [
          { name: "company", to: "companies", bubble_id: companyBubbleId, resolved: Boolean(companyBubbleId), reason: companyBubbleId ? undefined : "missing_company_id" },
          { name: "user", to: "user_profiles", bubble_id: supabaseUserId ?? "", resolved: Boolean(supabaseUserId), reason: supabaseUserId ? undefined : "missing_supabase_user_id" },
        ],
        mapped: {
          user_id: supabaseUserId,
          role,
          permission_level: permissionLevel,
          bubble_user_id: bubbleUser.bubble_user_id,
          raw: users[0]?.raw ?? {},
        },
        ignoreReason: !companyBubbleId ? "missing_company" : !supabaseUserId ? "missing_supabase_user_id" : undefined,
      });
    }
  }

  const existingCompaniesByBubbleIdAll =
    tablesMissing.includes("companies") || !companyBubbleIds.length ? new Set<string>() : await existsByBubbleId(supabase, "companies", companyBubbleIds).catch(() => new Set<string>());
  const existingCompaniesByBubbleIdEmpresas =
    tablesMissing.includes("companies") || !empresasCompanyBubbleIds.length
      ? new Set<string>()
      : await existsByBubbleId(supabase, "companies", empresasCompanyBubbleIds).catch(() => new Set<string>());
  const companyIdMap = new Map<string, PlannedId>();
  for (const cid of empresasCompanyBubbleIds) {
    if (existingCompaniesByBubbleIdEmpresas.has(cid)) companyIdMap.set(cid, { kind: "existing", id: `existing:companies:${cid}` });
    else companyIdMap.set(cid, { kind: "new", key: plannedKey("companies", null, cid) });
  }

  const companyResolved = existingCompaniesByBubbleIdAll.size + empresasCompanyBubbleIds.filter((id) => !existingCompaniesByBubbleIdAll.has(id)).length;
  const companyMissing = referencedCompanyBubbleIds.filter((id) => !existingCompaniesByBubbleIdAll.has(id) && !companyIdMap.has(id)).length;

  const companyIsUsable = (companyBubbleId: string | null) => {
    if (!companyBubbleId) return false;
    return existingCompaniesByBubbleIdAll.has(companyBubbleId) || companyIdMap.has(companyBubbleId);
  };

  const markCompanyRelation = (rows: PlanRow[]) => {
    for (const r of rows) {
      for (const rel of r.relations) {
        if (rel.to !== "companies" && rel.name !== "company") continue;
        const ok = companyIsUsable(rel.bubble_id || r.company_bubble_id);
        rel.resolved = ok;
        if (!ok && !rel.reason) rel.reason = "company_not_found";
      }
    }
  };

  markCompanyRelation([
    ...categorias,
    ...items,
    ...fornecedores,
    ...itensFornecedores,
    ...notas,
    ...itensNotas,
    ...inventarios,
    ...itensInventarios,
    ...motivos,
    ...desperdicios,
    ...etiquetas,
    ...ingredientes,
    ...itensListaCompras,
    ...qtdCompraReal,
    ...faturamentos,
    ...custoMedioItem,
    ...companyMembers,
  ]);

  const bubbleToInternal: Record<string, Map<string, PlannedId>> = {
    categories: new Map(),
    items: new Map(),
    suppliers: new Map(),
    invoices: new Map(),
    inventories: new Map(),
    waste_reasons: new Map(),
    labels: new Map(),
  };

  const claimPlanned = (table: keyof typeof bubbleToInternal, companyBubbleId: string | null, bubbleId: string) => {
    if (!bubbleId) return null;
    const key = plannedKey(String(table), companyBubbleId, bubbleId);
    const map = bubbleToInternal[table];
    if (map.has(key)) return map.get(key)!;
    map.set(key, { kind: "new", key });
    return map.get(key)!;
  };

  for (const c of categorias) claimPlanned("categories", c.company_bubble_id, c.bubble_id);
  for (const it of items) claimPlanned("items", it.company_bubble_id, it.bubble_id);
  for (const f of fornecedores) claimPlanned("suppliers", f.company_bubble_id, f.bubble_id);
  for (const n of notas) claimPlanned("invoices", n.company_bubble_id, n.bubble_id);
  for (const inv of inventarios) claimPlanned("inventories", inv.company_bubble_id, inv.bubble_id);
  for (const m of motivos) claimPlanned("waste_reasons", m.company_bubble_id, m.bubble_id);
  for (const e of etiquetas) claimPlanned("labels", e.company_bubble_id, e.bubble_id);

  const brokenSamples: DryRunReport["relations"]["brokenSamples"] = [];
  let resolvedRelations = 0;
  let brokenRelations = 0;

  const resolveRelation = (row: PlanRow, relName: string, table: keyof typeof bubbleToInternal, bubbleId: string) => {
    if (!bubbleId) return null;
    const pid = claimPlanned(table, row.company_bubble_id, bubbleId);
    if (pid) {
      resolvedRelations += 1;
      return pid;
    }
    brokenRelations += 1;
    if (brokenSamples.length < 40) brokenSamples.push({ table: row.table, bubble_id: row.bubble_id, relation: relName, expectedBubbleId: bubbleId, reason: "not_planned" });
    return null;
  };

  const perTableRows: Array<{ name: string; rows: PlanRow[] }> = [
    { name: "companies", rows: empresas },
    { name: "user_profiles", rows: users },
    { name: "company_members", rows: companyMembers },
    { name: "categories", rows: categorias },
    { name: "items", rows: items },
    { name: "suppliers", rows: fornecedores },
    { name: "supplier_items", rows: itensFornecedores },
    { name: "invoices", rows: notas },
    { name: "invoice_items", rows: itensNotas },
    { name: "inventories", rows: inventarios },
    { name: "inventory_items", rows: itensInventarios },
    { name: "waste_reasons", rows: motivos },
    { name: "wastes", rows: desperdicios },
    { name: "labels", rows: etiquetas },
    { name: "recipe_ingredients", rows: ingredientes },
    { name: "shopping_list_items", rows: itensListaCompras },
    { name: "purchase_real_qty", rows: qtdCompraReal },
    { name: "revenues", rows: faturamentos },
    { name: "avg_cost_events", rows: custoMedioItem },
  ];

  const statsByTable: Record<string, DryRunTableStats> = {};

  const existingCompanies = existingCompaniesByBubbleIdEmpresas;
  const companiesWouldCreate = tablesMissing.includes("companies") ? empresas.length : empresasCompanyBubbleIds.filter((b) => b && !existingCompanies.has(b)).length;
  const companiesWouldUpdate = tablesMissing.includes("companies") ? 0 : empresasCompanyBubbleIds.filter((b) => b && existingCompanies.has(b)).length;

  statsByTable.companies = {
    sourceRows: baseTypesCount["empresas"] ?? 0,
    plannedRows: empresas.length,
    wouldCreate: companiesWouldCreate,
    wouldUpdate: companiesWouldUpdate,
    wouldIgnore: (baseTypesCount["empresas"] ?? 0) - empresas.length,
    missingBubbleId: empresas.filter((x) => !x.bubble_id).length,
    missingCompany: 0,
    duplicatesInSource: dupByTable["empresas"] ?? 0,
    brokenRelations: 0,
  };

  const companyUuidByBubbleId = new Map<string, string>();
  if (!tablesMissing.includes("companies") && companyBubbleIds.length) {
    const { data, error } = await supabase.from("companies").select("id,bubble_id").in("bubble_id", companyBubbleIds);
    if (!error) {
      for (const r of (data ?? []) as any[]) {
        const b = String(r?.bubble_id ?? "").trim();
        const id = String(r?.id ?? "").trim();
        if (b && id) companyUuidByBubbleId.set(b, id);
      }
    }
  }

  const resolveCompanyUuid = (companyBubbleId: string | null) => {
    if (!companyBubbleId) return null;
    const got = companyUuidByBubbleId.get(companyBubbleId);
    return got ?? null;
  };

  const isPlannedNewCompany = (companyBubbleId: string | null) => {
    if (!companyBubbleId) return false;
    return empresasCompanyBubbleIds.includes(companyBubbleId) && !existingCompaniesByBubbleIdAll.has(companyBubbleId);
  };

  const computeStatsForTable = async (table: string, rows: PlanRow[]) => {
    const missingBubbleId = rows.filter((x) => !x.bubble_id).length;
    const missingCompany = rows.filter((x) => x.company_bubble_id == null && table !== "user_profiles").length;
    const duplicatesInSource = dupByTable[normalizeLower(table)] ?? 0;

    const planned: PlanRow[] = [];
    let wouldIgnore = 0;
    let brokenRel = 0;

    for (const r of rows) {
      if (!r.bubble_id) {
        wouldIgnore += 1;
        continue;
      }
      if (table !== "user_profiles" && !r.company_bubble_id) {
        wouldIgnore += 1;
        continue;
      }
      if (r.ignoreReason) {
        wouldIgnore += 1;
        continue;
      }
      for (const rel of r.relations) {
        if (!rel.resolved) {
          brokenRel += 1;
          if (brokenSamples.length < 40) brokenSamples.push({ table: r.table, bubble_id: r.bubble_id, relation: rel.name, expectedBubbleId: rel.bubble_id, reason: rel.reason || "unresolved" });
        } else {
          resolvedRelations += 1;
        }
      }
      planned.push(r);
    }

    if (tablesMissing.includes(table)) {
      statsByTable[table] = {
        sourceRows: rows.length,
        plannedRows: planned.length,
        wouldCreate: planned.length,
        wouldUpdate: 0,
        wouldIgnore,
        missingBubbleId,
        missingCompany,
        duplicatesInSource,
        brokenRelations: brokenRel,
      };
      return;
    }

    if (table === "user_profiles") {
      const has = Boolean(bubbleUser.supabase_user_id);
      const { data } = has ? await supabase.from("user_profiles").select("user_id").eq("user_id", bubbleUser.supabase_user_id).limit(1) : ({ data: [] } as any);
      const exists = has && Array.isArray(data) && data.length > 0;
      statsByTable[table] = {
        sourceRows: rows.length,
        plannedRows: planned.length,
        wouldCreate: exists ? 0 : has ? 1 : 0,
        wouldUpdate: exists ? 1 : 0,
        wouldIgnore: has ? wouldIgnore : planned.length + wouldIgnore,
        missingBubbleId,
        missingCompany,
        duplicatesInSource,
        brokenRelations: brokenRel,
      };
      return;
    }

    if (table === "company_members") {
      const supabaseUserId = bubbleUser.supabase_user_id;
      const pairs: Array<{ company_id: string; user_id: string }> = [];
      let wouldCreateFromPlannedCompanies = 0;
      for (const r of planned) {
        const company_id = resolveCompanyUuid(r.company_bubble_id);
        if (!supabaseUserId) {
          wouldIgnore += 1;
          brokenRel += 1;
          if (brokenSamples.length < 40) brokenSamples.push({ table: r.table, bubble_id: r.bubble_id, relation: "user", expectedBubbleId: "", reason: "missing_supabase_user_id" });
          continue;
        }
        if (company_id) {
          pairs.push({ company_id, user_id: supabaseUserId });
          continue;
        }
        if (isPlannedNewCompany(r.company_bubble_id)) {
          wouldCreateFromPlannedCompanies += 1;
          continue;
        }
        wouldIgnore += 1;
        brokenRel += 1;
        if (brokenSamples.length < 40)
          brokenSamples.push({ table: r.table, bubble_id: r.bubble_id, relation: "company", expectedBubbleId: String(r.company_bubble_id ?? ""), reason: "company_not_resolved" });
      }
      let wouldCreate = 0;
      let wouldUpdate = 0;
      const chunk = 500;
      for (let i = 0; i < pairs.length; i += chunk) {
        const part = pairs.slice(i, i + chunk);
        const byCompany = new Map<string, string[]>();
        for (const p of part) {
          const list = byCompany.get(p.company_id) ?? [];
          list.push(p.user_id);
          byCompany.set(p.company_id, list);
        }
        for (const [company_id, user_ids] of byCompany.entries()) {
          const { data, error } = await supabase.from("company_members").select("company_id,user_id").eq("company_id", company_id).in("user_id", user_ids);
          if (error) throw new Error(error.message);
          const existing = new Set<string>();
          for (const r of (data ?? []) as any[]) existing.add(`${String(r.company_id)}::${String(r.user_id)}`);
          for (const uid of user_ids) {
            if (existing.has(`${company_id}::${uid}`)) wouldUpdate += 1;
            else wouldCreate += 1;
          }
        }
      }
      wouldCreate += wouldCreateFromPlannedCompanies;
      statsByTable[table] = {
        sourceRows: rows.length,
        plannedRows: planned.length,
        wouldCreate,
        wouldUpdate,
        wouldIgnore,
        missingBubbleId,
        missingCompany,
        duplicatesInSource,
        brokenRelations: brokenRel,
      };
      return;
    }

    const pairs: Array<{ company_id: string; bubble_id: string }> = [];
    let wouldCreateFromPlannedCompanies = 0;
    for (const r of planned) {
      const company_id = resolveCompanyUuid(r.company_bubble_id);
      if (company_id) {
        pairs.push({ company_id, bubble_id: r.bubble_id });
        continue;
      }
      if (isPlannedNewCompany(r.company_bubble_id)) {
        wouldCreateFromPlannedCompanies += 1;
        continue;
      }
      wouldIgnore += 1;
      brokenRel += 1;
      if (brokenSamples.length < 40)
        brokenSamples.push({
          table: r.table,
          bubble_id: r.bubble_id,
          relation: "company",
          expectedBubbleId: String(r.company_bubble_id ?? ""),
          reason: "company_not_resolved",
        });
    }
    const existing = pairs.length ? await existsByCompanyBubbleId(supabase, table, pairs).catch(() => new Set<string>()) : new Set<string>();
    let wouldUpdate = 0;
    let wouldCreate = 0;
    for (const p of pairs) {
      if (existing.has(`${p.company_id}::${p.bubble_id}`)) wouldUpdate += 1;
      else wouldCreate += 1;
    }
    wouldCreate += wouldCreateFromPlannedCompanies;
    statsByTable[table] = {
      sourceRows: rows.length,
      plannedRows: planned.length,
      wouldCreate,
      wouldUpdate,
      wouldIgnore,
      missingBubbleId,
      missingCompany,
      duplicatesInSource,
      brokenRelations: brokenRel,
    };
  };

  for (const t of perTableRows) {
    if (t.name === "companies") continue;
    await computeStatsForTable(t.name, t.rows);
  }

  const topUnmappedKeysByBaseType: DryRunReport["unmapped"]["topUnmappedKeysByBaseType"] = {};
  for (const [bt, counts] of Object.entries(topUnmapped)) {
    const list = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([key, count]) => ({ key, count }));
    topUnmappedKeysByBaseType[bt] = list;
  }

  const includeRows = Boolean(options?.includeRows);
  const includePlanned = Boolean(options?.includePlanned);
  const rowsByTable: DryRunReport["rowsByTable"] = includeRows ? {} : undefined;
  const plannedByTable: DryRunReport["plannedByTable"] = includePlanned ? {} : undefined;
  const rowPassesPlannedFilter = (table: string, r: PlanRow) => {
    if (!r.bubble_id) return false;
    if (table !== "user_profiles" && table !== "companies" && !r.company_bubble_id) return false;
    if (r.ignoreReason) return false;
    return true;
  };
  if (includeRows || includePlanned) {
    for (const t of perTableRows) {
      if (includeRows) {
        rowsByTable![t.name] = t.rows.map((r) => ({
          table: r.table,
          bubble_id: r.bubble_id,
          company_bubble_id: r.company_bubble_id,
          mapped: r.mapped,
          relations: r.relations,
          ignoreReason: r.ignoreReason,
        }));
      }
      if (includePlanned) {
        plannedByTable![t.name] = t.rows
          .filter((r) => rowPassesPlannedFilter(t.name, r))
          .map((r) => ({
            table: r.table,
            bubble_id: r.bubble_id,
            company_bubble_id: r.company_bubble_id,
            mapped: r.mapped,
            relations: r.relations,
          }));
      }
    }
  }

  return {
    ok: true,
    mode: "dry_run",
    requestedEmail,
    bubbleUser,
    companyScope: {
      bubbleCompanyIds: companyBubbleIds,
      resolvedCompanies: companyResolved,
      missingCompanies: companyMissing,
    },
    tablesMissing,
    statsByTable,
    relations: {
      resolved: resolvedRelations,
      broken: brokenRelations,
      brokenSamples,
    },
    unmapped: {
      baseTypes: baseTypesCount,
      topUnmappedKeysByBaseType,
    },
    rowsByTable,
    plannedByTable,
  };
}
