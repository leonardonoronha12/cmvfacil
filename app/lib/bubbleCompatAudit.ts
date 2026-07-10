"use server";

import { getSupabaseAdmin } from "./supabaseAdmin";
import { dryRunBubbleCompatImportForEmail } from "./bubbleCompatImporter";

function normalizeText(v: unknown) {
  return String(v ?? "").replace(/\s+/g, " ").trim();
}

function normalizeLower(v: unknown) {
  return normalizeText(v).toLowerCase();
}

function eqText(a: unknown, b: unknown) {
  return normalizeText(a) === normalizeText(b);
}

function eqLower(a: unknown, b: unknown) {
  return normalizeLower(a) === normalizeLower(b);
}

function eqNumber(a: unknown, b: unknown, eps = 0.0001) {
  const na = a == null || a === "" ? null : Number(a);
  const nb = b == null || b === "" ? null : Number(b);
  if (na == null && nb == null) return true;
  if (na == null || nb == null) return false;
  if (!Number.isFinite(na) || !Number.isFinite(nb)) return false;
  return Math.abs(na - nb) <= eps;
}

function eqDateOnly(a: unknown, b: unknown) {
  const sa = String(a ?? "").trim().slice(0, 10);
  const sb = String(b ?? "").trim().slice(0, 10);
  if (!sa && !sb) return true;
  return sa === sb;
}

type AuditFieldDiff = { field: string; expected: any; actual: any };

type AuditRowDiff = {
  bubble_id: string;
  diffs: AuditFieldDiff[];
  relationDiffs?: Array<{ relation: string; expectedBubbleId: string; actualBubbleId: string }>;
};

type PerTableAudit = {
  table: string;
  expected: { stagingTotal: number; plannedTotal: number; ignoredTotal: number };
  actualTotal: number;
  diff: number;
  missingBubbleIds: string[];
  extraBubbleIds: string[];
  relationsBroken: number;
  mainFieldDiffs: {
    rowsCompared: number;
    rowsWithDiff: number;
    samples: AuditRowDiff[];
  };
  ignoredBubbleIds?: string[];
};

export type BubbleCompatAuditReport = {
  ok: boolean;
  email: string;
  companyBubbleId: string | null;
  companyId: string | null;
  tables: Record<string, PerTableAudit>;
  summary: {
    tablesPerfect: string[];
    tablesWithDivergence: string[];
    critical: Array<{ table: string; reason: string }>;
    acceptable: Array<{ table: string; reason: string }>;
    nextFixes: Array<{ table: string; suggestion: string }>;
  };
};

export async function auditBubbleCompatForEmail(email: string): Promise<BubbleCompatAuditReport> {
  const supabase = getSupabaseAdmin();
  const e = normalizeLower(email);

  const dry = await dryRunBubbleCompatImportForEmail(e, { includeRows: true, includePlanned: true });
  if (!dry.ok) return { ok: false, email: e, companyBubbleId: null, companyId: null, tables: {}, summary: { tablesPerfect: [], tablesWithDivergence: [], critical: [], acceptable: [], nextFixes: [] } };

  const companyBubbleId = String(dry.companyScope?.bubbleCompanyIds?.[0] ?? "").trim() || null;
  const { data: companyRow, error: companyErr } = companyBubbleId
    ? await supabase.from("companies").select("id,bubble_id").eq("bubble_id", companyBubbleId).maybeSingle()
    : ({ data: null, error: null } as any);
  if (companyErr) throw new Error(companyErr.message);
  const companyId = String((companyRow as any)?.id ?? "").trim() || null;

  const rowsByTable = (dry.rowsByTable ?? {}) as Record<string, any[]>;
  const plannedByTable = (dry.plannedByTable ?? {}) as Record<string, any[]>;

  const wantedTables = [
    "companies",
    "user_profiles",
    "company_members",
    "categories",
    "items",
    "suppliers",
    "invoices",
    "invoice_items",
    "inventories",
    "inventory_items",
    "waste_reasons",
    "wastes",
    "labels",
    "recipe_ingredients",
    "avg_cost_events",
  ];

  const tableAudits: Record<string, PerTableAudit> = {};

  const byCompany = async (table: string, select: string) => {
    if (!companyId) return [];
    const { data, error } = await supabase.from(table).select(select).eq("company_id", companyId);
    if (error) throw new Error(error.message);
    return (data ?? []) as any[];
  };

  const getBubbleIdById = (rows: any[]) => {
    const m = new Map<string, string>();
    for (const r of rows) {
      const id = String(r?.id ?? "").trim();
      const b = String(r?.bubble_id ?? "").trim();
      if (id && b) m.set(id, b);
    }
    return m;
  };

  const categoriesRows = await byCompany("categories", "id,bubble_id,name");
  const itemsRows = await byCompany("items", "id,bubble_id,name,unidade_medida,custo_medio,category_id,item_receita,item_do_cardapio,descricao");
  const suppliersRows = await byCompany("suppliers", "id,bubble_id,nome,whatsapp");
  const invoicesRows = await byCompany("invoices", "id,bubble_id,codigo,fornecedor_id,data_criacao,data_recebimento");
  const inventoriesRows = await byCompany("inventories", "id,bubble_id,nome,data_contagem");
  const labelsRows = await byCompany("labels", "id,bubble_id,codigo,item_nome,data_producao,data_validade");
  const wasteReasonsRows = await byCompany("waste_reasons", "id,bubble_id,titulo");

  const categoryBubbleById = getBubbleIdById(categoriesRows);
  const itemBubbleById = getBubbleIdById(itemsRows);
  const supplierBubbleById = getBubbleIdById(suppliersRows);
  const invoiceBubbleById = getBubbleIdById(invoicesRows);
  const inventoryBubbleById = getBubbleIdById(inventoriesRows);
  const labelBubbleById = getBubbleIdById(labelsRows);
  const wasteReasonBubbleById = getBubbleIdById(wasteReasonsRows);

  const companiesActual = (() => {
    if (!companyBubbleId) return [];
    return supabase
      .from("companies")
      .select("bubble_id,fantasy_name,legal_name,cnpj,email,phone_e164,meta_cmv,plan_code,plan_status")
      .eq("bubble_id", companyBubbleId)
      .then(({ data, error }) => {
        if (error) throw new Error(error.message);
        return (data ?? []) as any[];
      });
  })();

  const userId = String(dry.bubbleUser?.supabase_user_id ?? "").trim();
  const userProfilesActual = userId
    ? ((await supabase.from("user_profiles").select("user_id,bubble_user_id,email,nome,sobrenome,nome_completo,whatsapp,nivel_permissao,proprietario_empresa").eq("user_id", userId)).data ?? [])
    : [];

  const companyMembersActual =
    companyId && userId
      ? ((await supabase
          .from("company_members")
          .select("company_id,user_id,role,permission_level,bubble_user_id")
          .eq("company_id", companyId)
          .eq("user_id", userId)).data ?? [])
      : [];

  const avgCostEventsRows = await byCompany("avg_cost_events", "bubble_id,item_id,data_lancamento,custo_medio,alteracao_custo_inicial,created_at");
  const invoiceItemsRows = await byCompany("invoice_items", "bubble_id,invoice_id,item_id,fornecedor_id,data_lancamento,quantidade,custo_unitario,subtotal");
  const inventoryItemsRows = await byCompany("inventory_items", "bubble_id,inventory_id,item_id,data_contagem,quantidade_contada");
  const wastesRows = await byCompany("wastes", "bubble_id,lancamento,quantidade,custo_total,custo_unitario,unidade_medida,item_id,motivo_id,etiqueta_id,motivo_text");
  const recipeIngredientsRows = await byCompany("recipe_ingredients", "bubble_id,recipe_item_id,ingredient_item_id,quantidade,custo,ingrediente_temporario");

  const actualByTable: Record<string, any[]> = {
    companies: await companiesActual,
    user_profiles: userProfilesActual,
    company_members: companyMembersActual,
    categories: categoriesRows,
    items: itemsRows,
    suppliers: suppliersRows,
    invoices: invoicesRows,
    invoice_items: invoiceItemsRows,
    inventories: inventoriesRows,
    inventory_items: inventoryItemsRows,
    waste_reasons: wasteReasonsRows,
    wastes: wastesRows,
    labels: labelsRows,
    recipe_ingredients: recipeIngredientsRows,
    avg_cost_events: avgCostEventsRows,
  };

  const expectedBubbleIdsForTable = (table: string, kind: "staging" | "planned") => {
    const source = kind === "staging" ? rowsByTable[table] ?? [] : plannedByTable[table] ?? [];
    return source.map((r: any) => String(r?.bubble_id ?? "").trim()).filter(Boolean);
  };

  const indexExpectedByBubbleId = (table: string) => {
    const idx = new Map<string, any>();
    for (const r of plannedByTable[table] ?? []) {
      const b = String(r?.bubble_id ?? "").trim();
      if (b) idx.set(b, r);
    }
    return idx;
  };

  for (const table of wantedTables) {
    const stagingIds = expectedBubbleIdsForTable(table, "staging");
    const plannedIds = expectedBubbleIdsForTable(table, "planned");
    const stagingSet = new Set(stagingIds);
    const plannedSet = new Set(plannedIds);
    const ignoredIds = Array.from(stagingSet).filter((b) => !plannedSet.has(b)).sort();

    const actualRows = actualByTable[table] ?? [];
    const idKey = (() => {
      if (table === "user_profiles") return (r: any) => String(r?.bubble_user_id ?? "").trim();
      if (table === "company_members") {
        return (r: any) => {
          const uid = String(r?.user_id ?? "").trim();
          if (!companyBubbleId || !uid) return "";
          return `${companyBubbleId}::${uid}`;
        };
      }
      return (r: any) => String(r?.bubble_id ?? "").trim();
    })();
    const actualIds = actualRows.map(idKey).filter(Boolean).sort();
    const actualSet = new Set(actualIds);

    const missing = Array.from(plannedSet).filter((b) => !actualSet.has(b)).sort();
    const extra = Array.from(actualSet).filter((b) => !plannedSet.has(b)).sort();

    const expectedIdx = indexExpectedByBubbleId(table);
    let relationsBroken = 0;
    let rowsCompared = 0;
    let rowsWithDiff = 0;
    const samples: AuditRowDiff[] = [];

    const actualByBubbleId = new Map<string, any>();
    for (const r of actualRows) {
      const b = idKey(r);
      if (b) actualByBubbleId.set(b, r);
    }

    for (const bubbleId of Array.from(plannedSet)) {
      const expected = expectedIdx.get(bubbleId);
      const actual = actualByBubbleId.get(bubbleId);
      if (!expected || !actual) continue;
      rowsCompared += 1;
      const diffs: AuditFieldDiff[] = [];
      const relDiffs: Array<{ relation: string; expectedBubbleId: string; actualBubbleId: string }> = [];

      if (table === "items") {
        const expName = expected.mapped?.name;
        if (!eqText(expName, actual.name)) diffs.push({ field: "name", expected: expName, actual: actual.name });

        const expUnit = expected.mapped?.unidade_medida;
        if (!eqLower(expUnit, actual.unidade_medida)) diffs.push({ field: "unidade_medida", expected: expUnit, actual: actual.unidade_medida });

        const expCost = expected.mapped?.custo_medio;
        if (!eqNumber(expCost, actual.custo_medio)) diffs.push({ field: "custo_medio", expected: expCost, actual: actual.custo_medio });

        const expReceita = Boolean(expected.mapped?.item_receita);
        if (Boolean(actual.item_receita) !== expReceita) diffs.push({ field: "item_receita", expected: expReceita, actual: Boolean(actual.item_receita) });

        const expCardapio = Boolean(expected.mapped?.item_do_cardapio);
        if (Boolean(actual.item_do_cardapio) !== expCardapio) diffs.push({ field: "item_do_cardapio", expected: expCardapio, actual: Boolean(actual.item_do_cardapio) });

        const expCatRel = (expected.relations ?? []).find((r: any) => r.name === "category");
        const expCatBubble = String(expCatRel?.bubble_id ?? "").trim();
        const actualCatBubble = String(actual.category_id ? categoryBubbleById.get(String(actual.category_id)) ?? "" : "").trim();
        if (expCatBubble || actualCatBubble) {
          if (expCatBubble !== actualCatBubble) relDiffs.push({ relation: "category", expectedBubbleId: expCatBubble, actualBubbleId: actualCatBubble });
        }
      }

      if (table === "invoice_items") {
        const expInvoiceRel = (expected.relations ?? []).find((r: any) => r.name === "invoice");
        const expInvBubble = String(expInvoiceRel?.bubble_id ?? "").trim();
        const actInvBubble = String(actual.invoice_id ? invoiceBubbleById.get(String(actual.invoice_id)) ?? "" : "").trim();
        if (expInvBubble !== actInvBubble) relDiffs.push({ relation: "invoice", expectedBubbleId: expInvBubble, actualBubbleId: actInvBubble });

        const expItemRel = (expected.relations ?? []).find((r: any) => r.name === "item");
        const expItemBubble = String(expItemRel?.bubble_id ?? "").trim();
        const actItemBubble = String(actual.item_id ? itemBubbleById.get(String(actual.item_id)) ?? "" : "").trim();
        if (expItemBubble || actItemBubble) {
          if (expItemBubble !== actItemBubble) relDiffs.push({ relation: "item", expectedBubbleId: expItemBubble, actualBubbleId: actItemBubble });
        }

        const expSupRel = (expected.relations ?? []).find((r: any) => r.name === "supplier");
        const expSupBubble = String(expSupRel?.bubble_id ?? "").trim();
        const actSupBubble = String(actual.fornecedor_id ? supplierBubbleById.get(String(actual.fornecedor_id)) ?? "" : "").trim();
        if (expSupBubble || actSupBubble) {
          if (expSupBubble !== actSupBubble) relDiffs.push({ relation: "supplier", expectedBubbleId: expSupBubble, actualBubbleId: actSupBubble });
        }

        const expQty = expected.mapped?.quantidade;
        if (!eqNumber(expQty, actual.quantidade)) diffs.push({ field: "quantidade", expected: expQty, actual: actual.quantidade });
        const expCost = expected.mapped?.custo_unitario;
        if (!eqNumber(expCost, actual.custo_unitario)) diffs.push({ field: "custo_unitario", expected: expCost, actual: actual.custo_unitario });
        const expSubtotal = expected.mapped?.subtotal;
        if (!eqNumber(expSubtotal, actual.subtotal)) diffs.push({ field: "subtotal", expected: expSubtotal, actual: actual.subtotal });
      }

      if (table === "inventory_items") {
        const expInvRel = (expected.relations ?? []).find((r: any) => r.name === "inventory");
        const expInvBubble = String(expInvRel?.bubble_id ?? "").trim();
        const actInvBubble = String(actual.inventory_id ? inventoryBubbleById.get(String(actual.inventory_id)) ?? "" : "").trim();
        if (expInvBubble !== actInvBubble) relDiffs.push({ relation: "inventory", expectedBubbleId: expInvBubble, actualBubbleId: actInvBubble });

        const expItemRel = (expected.relations ?? []).find((r: any) => r.name === "item");
        const expItemBubble = String(expItemRel?.bubble_id ?? "").trim();
        const actItemBubble = String(actual.item_id ? itemBubbleById.get(String(actual.item_id)) ?? "" : "").trim();
        if (expItemBubble || actItemBubble) {
          if (expItemBubble !== actItemBubble) relDiffs.push({ relation: "item", expectedBubbleId: expItemBubble, actualBubbleId: actItemBubble });
        }

        const expQty = expected.mapped?.quantidade_contada;
        if (!eqNumber(expQty, actual.quantidade_contada)) diffs.push({ field: "quantidade_contada", expected: expQty, actual: actual.quantidade_contada });
        const expDt = expected.mapped?.data_contagem;
        if (!eqDateOnly(expDt, actual.data_contagem)) diffs.push({ field: "data_contagem", expected: expDt, actual: actual.data_contagem });
      }

      if (table === "wastes") {
        const expItemRel = (expected.relations ?? []).find((r: any) => r.name === "item");
        const expItemBubble = String(expItemRel?.bubble_id ?? "").trim();
        const actItemBubble = String(actual.item_id ? itemBubbleById.get(String(actual.item_id)) ?? "" : "").trim();
        if (expItemBubble || actItemBubble) {
          if (expItemBubble !== actItemBubble) relDiffs.push({ relation: "item", expectedBubbleId: expItemBubble, actualBubbleId: actItemBubble });
        }

        const expMotivoRel = (expected.relations ?? []).find((r: any) => r.name === "reason");
        const expMotivoBubble = String(expMotivoRel?.bubble_id ?? "").trim();
        const actMotivoBubble = String(actual.motivo_id ? wasteReasonBubbleById.get(String(actual.motivo_id)) ?? "" : "").trim();
        if (expMotivoBubble || actMotivoBubble) {
          if (expMotivoBubble !== actMotivoBubble) relDiffs.push({ relation: "waste_reason", expectedBubbleId: expMotivoBubble, actualBubbleId: actMotivoBubble });
        }

        const expQty = expected.mapped?.quantidade;
        if (!eqNumber(expQty, actual.quantidade)) diffs.push({ field: "quantidade", expected: expQty, actual: actual.quantidade });
        const expCusto = expected.mapped?.custo_total;
        if (!eqNumber(expCusto, actual.custo_total)) diffs.push({ field: "custo_total", expected: expCusto, actual: actual.custo_total });
      }

      if (table === "recipe_ingredients") {
        const expRecipeRel = (expected.relations ?? []).find((r: any) => r.name === "recipe_item");
        const expRecipeBubble = String(expRecipeRel?.bubble_id ?? "").trim();
        const actRecipeBubble = String(actual.recipe_item_id ? itemBubbleById.get(String(actual.recipe_item_id)) ?? "" : "").trim();
        if (expRecipeBubble || actRecipeBubble) {
          if (expRecipeBubble !== actRecipeBubble) relDiffs.push({ relation: "recipe_item", expectedBubbleId: expRecipeBubble, actualBubbleId: actRecipeBubble });
        }

        const expIngRel = (expected.relations ?? []).find((r: any) => r.name === "ingredient_item");
        const expIngBubble = String(expIngRel?.bubble_id ?? "").trim();
        const actIngBubble = String(actual.ingredient_item_id ? itemBubbleById.get(String(actual.ingredient_item_id)) ?? "" : "").trim();
        if (expIngBubble || actIngBubble) {
          if (expIngBubble !== actIngBubble) relDiffs.push({ relation: "ingredient_item", expectedBubbleId: expIngBubble, actualBubbleId: actIngBubble });
        }

        const expQty = expected.mapped?.quantidade;
        if (!eqNumber(expQty, actual.quantidade)) diffs.push({ field: "quantidade", expected: expQty, actual: actual.quantidade });
        const expCusto = expected.mapped?.custo;
        if (!eqNumber(expCusto, actual.custo)) diffs.push({ field: "custo", expected: expCusto, actual: actual.custo });
      }

      if (relDiffs.length) relationsBroken += relDiffs.length;
      if (diffs.length || relDiffs.length) {
        rowsWithDiff += 1;
        if (samples.length < 50) samples.push({ bubble_id: bubbleId, diffs, relationDiffs: relDiffs.length ? relDiffs : undefined });
      }
    }

    const audit: PerTableAudit = {
      table,
      expected: { stagingTotal: stagingSet.size, plannedTotal: plannedSet.size, ignoredTotal: ignoredIds.length },
      actualTotal: actualSet.size,
      diff: actualSet.size - plannedSet.size,
      missingBubbleIds: missing,
      extraBubbleIds: extra,
      relationsBroken,
      mainFieldDiffs: { rowsCompared, rowsWithDiff, samples },
      ignoredBubbleIds: ignoredIds.length ? ignoredIds : undefined,
    };
    tableAudits[table] = audit;
  }

  const tablesPerfect: string[] = [];
  const tablesWithDivergence: string[] = [];
  const critical: Array<{ table: string; reason: string }> = [];
  const acceptable: Array<{ table: string; reason: string }> = [];
  const nextFixes: Array<{ table: string; suggestion: string }> = [];

  for (const [table, a] of Object.entries(tableAudits)) {
    const perfect = a.missingBubbleIds.length === 0 && a.extraBubbleIds.length === 0 && a.relationsBroken === 0 && a.mainFieldDiffs.rowsWithDiff === 0;
    if (perfect) tablesPerfect.push(table);
    else tablesWithDivergence.push(table);

    if (table === "invoice_items" && a.expected.ignoredTotal > 0 && a.missingBubbleIds.length === 0 && a.extraBubbleIds.length === 0 && a.mainFieldDiffs.rowsWithDiff === 0) {
      acceptable.push({ table, reason: `existem ${a.expected.ignoredTotal} itens_notas sem vínculo obrigatório, mantidos staged-only/raw` });
      continue;
    }

    if (a.missingBubbleIds.length > 0) critical.push({ table, reason: `faltando ${a.missingBubbleIds.length} bubble_id(s) importáveis no Supabase` });
    if (a.relationsBroken > 0) critical.push({ table, reason: `relações divergentes/quebradas em ${a.relationsBroken} ponto(s)` });
    if (a.mainFieldDiffs.rowsWithDiff > 0) critical.push({ table, reason: `campos divergentes em ${a.mainFieldDiffs.rowsWithDiff} linha(s)` });
  }

  if (tableAudits.invoice_items?.expected?.ignoredTotal) {
    nextFixes.push({ table: "invoice_items", suggestion: "manter os 2 itens_notas sem nota como staged-only; se quiser importar no futuro, definir regra explícita no Bubble (nota_id obrigatório ou lista_itens consistente)" });
  }

  return {
    ok: true,
    email: e,
    companyBubbleId,
    companyId,
    tables: tableAudits,
    summary: { tablesPerfect, tablesWithDivergence, critical, acceptable, nextFixes },
  };
}
