import { NextRequest, NextResponse } from "next/server";
import { getUserIdFromRequest } from "../../lib/requestUserId";
import { getSupabaseServerClient } from "../../lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

async function dbg(hypothesisId: string, location: string, msg: string, data: unknown) {
  // #region debug-point E:csv-only-audit
  try {
    const fs = await import("node:fs");
    const p = ".dbg/csv-only-audit.env";
    let u = "http://127.0.0.1:7777/event";
    let s = "csv-only-audit";
    try {
      const e = fs.readFileSync(p, "utf8");
      u = e.match(/DEBUG_SERVER_URL=(.+)/)?.[1]?.trim() || u;
      s = e.match(/DEBUG_SESSION_ID=(.+)/)?.[1]?.trim() || s;
    } catch {}
    await fetch(u, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: s, runId: "pre", hypothesisId, location, msg: `[DEBUG] ${msg}`, data, ts: Date.now() }),
    }).catch(() => {});
  } catch {}
  // #endregion
}

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return NextResponse.json(data, { ...init, headers });
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function parseCsvEnv(value: string | undefined) {
  return String(value ?? "")
    .split(/[,\n;]/g)
    .map((x) => x.trim())
    .filter(Boolean);
}

function normalizeNameKey(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

function isAdminUserId(userId: string) {
  const ids = new Set(parseCsvEnv(process.env.ADMIN_USER_IDS).map((x) => x.toLowerCase()));
  const emails = new Set(
    [...parseCsvEnv(process.env.ADMIN_USER_EMAILS), ...parseCsvEnv(process.env.ADMIN_EMAILS), ...parseCsvEnv(process.env.ADMIN_EMAILS_LEGACY)].map((x) => x.toLowerCase()),
  );
  const raw = userId.toLowerCase();
  if (!isUuid(userId) && raw.includes("@") && process.env.ADMIN_SECRET) return true;
  if (ids.size && ids.has(raw)) return true;
  if (emails.size && emails.has(raw)) return true;
  return false;
}

function resolveUserScopedId(req: NextRequest) {
  const { accessToken, userId } = getUserIdFromRequest(req);
  if (!userId) return { accessToken, id: null as string | null, rawUserId: null as string | null };
  if (isUuid(userId)) return { accessToken, id: `user:${userId}`, rawUserId: userId };
  const url = new URL(req.url);
  const override = String(url.searchParams.get("userId") ?? "").trim();
  if (override && isUuid(override) && isAdminUserId(userId)) return { accessToken, id: `user:${override}`, rawUserId: userId };
  return { accessToken, id: null as string | null, rawUserId: userId };
}

async function shouldUseCompatSource(args: { req: NextRequest; supabase: ReturnType<typeof getSupabaseServerClient>; userId: string; isAdmin: boolean }) {
  return false;
}

function extractBubbleId(input: unknown) {
  if (input == null) return "";
  if (typeof input === "object") {
    const v: any = input as any;
    const direct = String(v?.unique_id ?? v?._id ?? v?.id ?? v?.bubble_id ?? "").trim();
    if (direct) return direct;
    let s = "";
    try {
      s = JSON.stringify(input);
    } catch {
      s = "";
    }
    const m = s.match(/\d{8,}x\d{6,}/);
    return m ? String(m[0]).trim() : "";
  }
  const s = String(input ?? "").trim();
  const m = s.match(/\d{8,}x\d{6,}/);
  return m ? String(m[0]).trim() : "";
}

function parseNumber(v: unknown) {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const s = String(v ?? "")
    .trim()
    .replace(/\./g, "")
    .replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

export async function GET(req: NextRequest) {
  try {
    const { accessToken, id, rawUserId } = resolveUserScopedId(req);
    if (!id) return json({ ok: true, source: "legacy", readOnly: false, rows: [] }, { status: 200 });
    const supabaseServer = getSupabaseServerClient(accessToken);
    const userId = id.slice("user:".length);

    const isAdmin = Boolean(rawUserId && isAdminUserId(rawUserId));
    const useCompat = await shouldUseCompatSource({ req, supabase: supabaseServer, userId, isAdmin });
    await dbg("E", "api/lista-de-compras", "source_selected", {
      useCompat,
      rawUserId: rawUserId ? String(rawUserId) : null,
      userId,
      flags: { BUBBLE_COMPAT_READ_LISTA_DE_COMPRAS: process.env.BUBBLE_COMPAT_READ_LISTA_DE_COMPRAS ?? null },
    });
    if (useCompat) {
      const { data: memberRows, error: memberErr } = await supabaseServer.from("company_members").select("company_id").eq("user_id", userId).limit(1);
      if (memberErr) return json({ ok: false, error: memberErr.message, source: "compat", readOnly: true }, { status: 500 });
      const companyId = String(((memberRows ?? [])[0] as any)?.company_id ?? "").trim();
      if (!companyId) return json({ ok: false, error: "missing_company", source: "compat", readOnly: true }, { status: 500 });

      const url = new URL(req.url);
      const startInventoryId = String(url.searchParams.get("startInventoryId") ?? "").trim();
      const endInventoryId = String(url.searchParams.get("endInventoryId") ?? "").trim();
      const diasEstoqueParam = String(url.searchParams.get("diasEstoque") ?? "").trim();
      const prazoFornecedorParam = String(url.searchParams.get("prazoFornecedor") ?? "").trim();
      const diasEstoqueNumRaw = diasEstoqueParam ? Number(diasEstoqueParam.replace(/[^\d.]/g, "")) : NaN;
      const prazoFornecedorNumRaw = prazoFornecedorParam ? Number(prazoFornecedorParam.replace(/[^\d.]/g, "")) : NaN;
      const diasEstoque = Number.isFinite(diasEstoqueNumRaw) && diasEstoqueNumRaw > 0 ? Math.floor(diasEstoqueNumRaw) : 7;
      const prazoFornecedor = Number.isFinite(prazoFornecedorNumRaw) && prazoFornecedorNumRaw >= 0 ? Math.floor(prazoFornecedorNumRaw) : 1;

      const { data: invRows, error: invErr } = await supabaseServer
        .from("inventories")
        .select("id,bubble_id,nome,data_contagem")
        .eq("company_id", companyId)
        .order("data_contagem", { ascending: false })
        .limit(200);
      if (invErr) return json({ ok: false, error: invErr.message, source: "compat", readOnly: true }, { status: 500 });
      await dbg("E", "api/lista-de-compras", "compat_inventories_loaded", {
        companyId,
        inventories: (invRows ?? []).length,
        sample: (invRows ?? []).slice(0, 5).map((r: any) => ({ id: String(r?.id ?? ""), data_contagem: r?.data_contagem ?? null })),
      });

      const inventories = (invRows ?? []).map((r: any) => ({
        id: String(r?.id ?? "").trim(),
        bubble_id: r?.bubble_id ? String(r.bubble_id) : null,
        nome: String(r?.nome ?? "").trim(),
        data_contagem: r?.data_contagem ? String(r.data_contagem) : null,
      }));

      const endInvId =
        (endInventoryId && inventories.some((x) => x.id === endInventoryId) ? endInventoryId : "") || (inventories[0]?.id ? inventories[0].id : "");
      const startInvId =
        (startInventoryId && inventories.some((x) => x.id === startInventoryId) ? startInventoryId : "") || (inventories[1]?.id ? inventories[1].id : endInvId);

      const invById = new Map<string, any>(inventories.map((x) => [x.id, x]));
      const startInv = invById.get(startInvId) ?? null;
      const endInv = invById.get(endInvId) ?? null;

      const toDateOnly = (value: string | null) => {
        if (!value) return null;
        const d = new Date(value);
        if (!Number.isFinite(d.getTime())) return null;
        return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
      };
      const startDate = toDateOnly(String(startInv?.data_contagem ?? "")) ?? null;
      const endDate = toDateOnly(String(endInv?.data_contagem ?? "")) ?? null;

      const daysBetweenDateOnly = (a: string, b: string) => {
        const parse = (s: string) => {
          const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
          if (!m) return NaN;
          return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
        };
        const ta = parse(a);
        const tb = parse(b);
        if (!Number.isFinite(ta) || !Number.isFinite(tb)) return 0;
        return Math.round((tb - ta) / 86_400_000);
      };
      const invIdsToLoad = Array.from(new Set([startInvId, endInvId].filter(Boolean)));
      const { data: invItemRows, error: invItemErr } = invIdsToLoad.length
        ? await supabaseServer
            .from("inventory_items")
            .select("inventory_id,item_id,quantidade_contada")
            .eq("company_id", companyId)
            .in("inventory_id", invIdsToLoad)
            .limit(50_000)
        : { data: [], error: null as any };
      if (invItemErr) return json({ ok: false, error: invItemErr.message, source: "compat", readOnly: true }, { status: 500 });

      const estoqueInicialByItemId = new Map<string, number>();
      const estoqueFinalByItemId = new Map<string, number>();
      for (const r of (invItemRows ?? []) as any[]) {
        const iid = String(r?.inventory_id ?? "").trim();
        const itemId = String(r?.item_id ?? "").trim();
        if (!iid || !itemId) continue;
        const qty = typeof r?.quantidade_contada === "number" ? r.quantidade_contada : 0;
        if (iid === startInvId) estoqueInicialByItemId.set(itemId, qty);
        if (iid === endInvId) estoqueFinalByItemId.set(itemId, qty);
      }

      const { data: entradaRows, error: entradaErr } =
        startDate && endDate
          ? await supabaseServer
              .from("invoice_items")
              .select("item_id,quantidade,subtotal,cadastro_item,data_lancamento")
              .eq("company_id", companyId)
              .eq("cadastro_item", false)
              .gte("data_lancamento", startDate)
              .lte("data_lancamento", endDate)
              .limit(50_000)
          : { data: [], error: null as any };
      if (entradaErr) return json({ ok: false, error: entradaErr.message, source: "compat", readOnly: true }, { status: 500 });
      const entradasByItemId = new Map<string, number>();
      const entradasSubtotalByItemId = new Map<string, number>();
      for (const r of (entradaRows ?? []) as any[]) {
        const itemId = String(r?.item_id ?? "").trim();
        if (!itemId) continue;
        const qty = typeof r?.quantidade === "number" ? r.quantidade : 0;
        const subtotal = typeof r?.subtotal === "number" ? r.subtotal : 0;
        if (qty) entradasByItemId.set(itemId, (entradasByItemId.get(itemId) ?? 0) + qty);
        if (subtotal) entradasSubtotalByItemId.set(itemId, (entradasSubtotalByItemId.get(itemId) ?? 0) + subtotal);
      }

      const { data: itemsRows, error: itemsErr } = await supabaseServer
        .from("items")
        .select("id,bubble_id,name,unidade_medida,custo_medio,category_id,item_receita")
        .eq("company_id", companyId)
        .eq("item_receita", false)
        .order("name", { ascending: true })
        .limit(50_000);
      if (itemsErr) return json({ ok: false, error: itemsErr.message, source: "compat", readOnly: true }, { status: 500 });

      const categoryIds = Array.from(new Set((itemsRows ?? []).map((r: any) => String(r?.category_id ?? "").trim()).filter(Boolean)));
      const { data: catRows, error: catErr } = categoryIds.length
        ? await supabaseServer.from("categories").select("id,name").eq("company_id", companyId).in("id", categoryIds)
        : { data: [], error: null as any };
      if (catErr) return json({ ok: false, error: catErr.message, source: "compat", readOnly: true }, { status: 500 });
      const categoryNameById = new Map<string, string>((catRows ?? []).map((r: any) => [String(r?.id ?? "").trim(), String(r?.name ?? "").trim()]));

      const { data: selectedRows, error: selErr } = await supabaseServer
        .from("shopping_list_items")
        .select("id,bubble_id,item_id,item_nome,item_medida,qtd_compra,qtd_sugestao,tipo")
        .eq("company_id", companyId)
        .in("tipo", ["", "itens"])
        .order("created_at", { ascending: true })
        .limit(50_000);
      if (selErr) return json({ ok: false, error: selErr.message, source: "compat", readOnly: true }, { status: 500 });

      const selectedByItemId = new Map<string, any>();
      for (const r of (selectedRows ?? []) as any[]) {
        const itemId = String(r?.item_id ?? "").trim();
        if (!itemId) continue;
        selectedByItemId.set(itemId, r);
      }

      const { data: realRows, error: realErr } = await supabaseServer.from("purchase_real_qty").select("item_id,quantidade").eq("company_id", companyId).limit(50_000);
      if (realErr) return json({ ok: false, error: realErr.message, source: "compat", readOnly: true }, { status: 500 });
      const realByItemId = new Map<string, number>();
      for (const r of (realRows ?? []) as any[]) {
        const itemId = String(r?.item_id ?? "").trim();
        if (!itemId) continue;
        const q = typeof r?.quantidade === "number" ? r.quantidade : 0;
        realByItemId.set(itemId, q);
      }

      const { data: supplierItemRows, error: siErr } = await supabaseServer.from("supplier_items").select("item_id,supplier_id").eq("company_id", companyId).limit(50_000);
      if (siErr) return json({ ok: false, error: siErr.message, source: "compat", readOnly: true }, { status: 500 });
      const supplierIds = Array.from(new Set((supplierItemRows ?? []).map((r: any) => String(r?.supplier_id ?? "").trim()).filter(Boolean)));
      const { data: supRows, error: supErr } = supplierIds.length
        ? await supabaseServer.from("suppliers").select("id,nome").eq("company_id", companyId).in("id", supplierIds)
        : { data: [], error: null as any };
      if (supErr) return json({ ok: false, error: supErr.message, source: "compat", readOnly: true }, { status: 500 });
      const supplierNameById = new Map<string, string>();
      for (const r of (supRows ?? []) as any[]) {
        const id = String(r?.id ?? "").trim();
        const nome = String(r?.nome ?? "").trim();
        if (!id || !nome) continue;
        if (normalizeNameKey(nome) === "sem fornecedor") continue;
        supplierNameById.set(id, nome);
      }
      const supplierNamesByItemId = new Map<string, string[]>();
      for (const r of (supplierItemRows ?? []) as any[]) {
        const itemId = String(r?.item_id ?? "").trim();
        const supplierId = String(r?.supplier_id ?? "").trim();
        if (!itemId || !supplierId) continue;
        const nome = supplierNameById.get(supplierId) ?? "";
        if (!nome) continue;
        const cur = supplierNamesByItemId.get(itemId) ?? [];
        cur.push(nome);
        supplierNamesByItemId.set(itemId, cur);
      }
      for (const [itemId, list] of supplierNamesByItemId.entries()) {
        const uniq = Array.from(new Set(list.map((x) => x.trim()).filter(Boolean)));
        uniq.sort((a, b) => a.localeCompare(b, "pt-BR", { sensitivity: "base" }));
        supplierNamesByItemId.set(itemId, uniq);
      }

      const itemsById = new Map<string, any>((itemsRows ?? []).map((r: any) => [String(r?.id ?? "").trim(), r]));

      const diasCorridosBubble = startDate && endDate ? daysBetweenDateOnly(startDate, endDate) : 0;

      const rowsCompat = (itemsRows ?? [])
        .map((item: any) => {
          const itemId = String(item?.id ?? "").trim();
          if (!itemId) return null;
          const sel = selectedByItemId.get(itemId) ?? null;

          const bubbleItemId = String(item?.bubble_id ?? "").trim();
          const outId = bubbleItemId || `db:${itemId}`;

          const categoria = categoryNameById.get(String(item?.category_id ?? "").trim()) || "Sem categoria";
          const unidade = String(item?.unidade_medida ?? "").trim() || "Und";
          const custoMedio = typeof item?.custo_medio === "number" ? item.custo_medio : 0;

          const estoqueInicial = estoqueInicialByItemId.get(itemId) ?? 0;
          const estoqueAtual = estoqueFinalByItemId.get(itemId) ?? 0;
          const entradas = entradasByItemId.get(itemId) ?? 0;

          const saidas = estoqueInicial + (entradas - estoqueAtual);
          const consumoDiario = diasCorridosBubble > 0 ? saidas / diasCorridosBubble : 0;
          const consumoDiasManter = consumoDiario * diasEstoque;
          const consumoPrazoFornecedor = consumoDiario * prazoFornecedor;
          const sugestaoCalc = consumoDiasManter - (estoqueAtual + consumoPrazoFornecedor);

          const qtdCompraStored = sel && typeof sel?.qtd_compra === "number" ? sel.qtd_compra : 0;
          const qtdSugestaoStored = sel && typeof sel?.qtd_sugestao === "number" ? sel.qtd_sugestao : 0;
          const comprar = Math.max(qtdCompraStored > 0 ? qtdCompraStored : sugestaoCalc, 0);

          const realQty = realByItemId.get(itemId) ?? 0;
          const fornecedores = supplierNamesByItemId.get(itemId) ?? [];
          const fornecedor = fornecedores[0] ?? "-";
          const custoPrevisto = comprar * custoMedio;
          const custoReal = realQty * custoMedio;

          return {
            id: outId,
            bubble_id: bubbleItemId || null,
            db_item_id: itemId,
            itemNome: String(item?.name ?? "").trim() || "Item",
            categoria,
            unidade,
            fornecedor,
            fornecedores,
            quantidadeSugerida: sugestaoCalc,
            quantidadeCompra: comprar,
            quantidadeReal: realQty,
            custoMedio,
            custoPrevisto,
            custoReal,
            selected: Boolean(sel),
            selection: sel
              ? {
                  id: String(sel?.id ?? "").trim() || null,
                  bubble_id: sel?.bubble_id ? String(sel.bubble_id) : null,
                  qtd_compra: qtdCompraStored,
                  qtd_sugestao: qtdSugestaoStored,
                  tipo: String(sel?.tipo ?? "").trim(),
                }
              : null,
            calc: {
              startInventoryId: startInvId || null,
              endInventoryId: endInvId || null,
              startDate,
              endDate,
              diasCorridos: diasCorridosBubble,
              diasEstoque,
              prazoFornecedor,
              estoqueInicial,
              estoqueAtual,
              entradas,
              saidas,
              consumoDiario,
              consumoDiasManter,
              consumoPrazoFornecedor,
              sugestaoCalc,
            },
          };
        })
        .filter(Boolean);

      const totals = rowsCompat.reduce(
        (acc: any, r: any) => {
          acc.itens += 1;
          acc.custoPrevisto += typeof r?.custoPrevisto === "number" ? r.custoPrevisto : 0;
          acc.custoReal += typeof r?.custoReal === "number" ? r.custoReal : 0;
          return acc;
        },
        { itens: 0, custoPrevisto: 0, custoReal: 0 },
      );

      return json(
        {
          ok: true,
          source: "compat",
          readOnly: true,
          banner: "Fonte: Banco compatível Bubble",
          rows: rowsCompat,
          totals,
          filters: { startInventoryId: startInvId || null, endInventoryId: endInvId || null, diasEstoque, prazoFornecedor },
          inventories,
        },
        { status: 200 },
      );
    }
    return json({ ok: true, source: "legacy", readOnly: false, rows: [] }, { status: 200 });
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
