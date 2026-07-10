import { NextRequest, NextResponse } from "next/server";
import { getUserIdFromRequest } from "../../../../lib/requestUserId";
import { getSupabaseAdmin } from "../../../../lib/supabaseAdmin";
import { isLocalDevRequest } from "../../../../lib/localDevRequest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return NextResponse.json(data, { ...init, headers });
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value ?? "").trim());
}

function parseCsvEnv(value: string | undefined) {
  return String(value ?? "")
    .split(/[,\n;]/g)
    .map((x) => x.trim())
    .filter(Boolean);
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

function safeEmail(input: unknown) {
  const v = String(input ?? "").trim().toLowerCase();
  if (!v || !v.includes("@")) return "";
  return v;
}

function normalizeText(v: unknown) {
  return String(v ?? "").replace(/\s+/g, " ").trim();
}

function normalizeNameKey(v: unknown) {
  return normalizeText(v).toLowerCase();
}

function parseNumber(v: unknown) {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const s0 = normalizeText(v).replace(/\s+/g, "");
  if (!s0) return null;
  const s = s0.includes(",") && !s0.includes(".") ? s0.replace(",", ".") : s0.replace(/,/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function parseDateOnlyLoose(v: unknown) {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dt = new Date(s);
  const t = dt.getTime();
  if (!Number.isFinite(t)) return null;
  return dt.toISOString().slice(0, 10);
}

function formatMoneyBRL(value: number) {
  if (!Number.isFinite(value)) return "R$0,00";
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function pickAny(obj: any, keys: string[]) {
  for (const k of keys) {
    if (!obj) continue;
    if (obj[k] != null) return obj[k];
    const nk = k.toLowerCase();
    if (obj[nk] != null) return obj[nk];
  }
  return undefined;
}

async function getUserEmailFromDb(supabase: ReturnType<typeof getSupabaseAdmin>, userId: string) {
  if (!isUuid(userId)) return null;
  const { data, error } = await supabase.from("user_profiles").select("email").eq("user_id", userId).maybeSingle();
  if (error) return null;
  const email = String((data as any)?.email ?? "").trim().toLowerCase();
  return email && email.includes("@") ? email : null;
}

async function isAdminRequester(supabase: ReturnType<typeof getSupabaseAdmin>, requesterUserId: string) {
  if (isAdminUserId(requesterUserId)) return true;
  const requesterEmail = await getUserEmailFromDb(supabase, requesterUserId);
  if (!requesterEmail) return false;
  const allow = new Set(
    [...parseCsvEnv(process.env.ADMIN_USER_EMAILS), ...parseCsvEnv(process.env.ADMIN_EMAILS), ...parseCsvEnv(process.env.ADMIN_EMAILS_LEGACY)].map((x) => x.toLowerCase()),
  );
  return allow.has(requesterEmail);
}

async function ensureBucket(supabase: ReturnType<typeof getSupabaseAdmin>, bucket: string) {
  const got = await supabase.storage.getBucket(bucket);
  if (!got.error) return;
  await supabase.storage.createBucket(bucket, { public: false }).catch(() => {});
}

async function downloadJson(supabase: ReturnType<typeof getSupabaseAdmin>, bucket: string, filePath: string) {
  const { data, error } = await supabase.storage.from(bucket).download(filePath);
  if (error) throw new Error(error.message);
  const text = await data.text();
  return JSON.parse(text);
}

export async function POST(req: NextRequest) {
  try {
    const isLocalDev = isLocalDevRequest(req);
    const { userId } = getUserIdFromRequest(req);
    if (!userId && !isLocalDev) return json({ ok: false, error: "unauthorized" }, { status: 401 });

    const body = (await req.json().catch(() => null)) as any;
    const email = safeEmail(body?.email);
    const companyId = String(body?.companyId ?? "").trim();
    if (!email) return json({ ok: false, error: "invalid_email" }, { status: 400 });
    if (!companyId) return json({ ok: false, error: "missing_company_id" }, { status: 400 });

    let supabase: ReturnType<typeof getSupabaseAdmin>;
    try {
      supabase = getSupabaseAdmin();
    } catch {
      return json({ ok: false, error: "supabase_not_configured" }, { status: 500 });
    }

    const requesterId = String(userId ?? "").trim();
    const requesterEmail = await getUserEmailFromDb(supabase, requesterId);
    const selfOk = isUuid(requesterId) && requesterEmail === email;
    const adminOk = isLocalDev ? true : await isAdminRequester(supabase, requesterId);
    if (!selfOk && !adminOk) return json({ ok: false, error: "forbidden" }, { status: 403 });

    const bucket = "admin-importacao-manual";
    await ensureBucket(supabase, bucket);
    const stagedPath = String(body?.stagedPath ?? `sessions/csv/${normalizeNameKey(email)}/${companyId}/staging/invoice_items_latest.json`).trim();
    const staged = await downloadJson(supabase, bucket, stagedPath);
    const records = Array.isArray(staged?.records) ? staged.records : [];
    const invoiceItemRecords = records.filter((r: any) => String(r?.base_type ?? "").toLowerCase().endsWith("itens_notas"));

    const expectedByGroupKey = new Map<
      string,
      { fornecedor: string; data: string; total: number; itens: number; bubble_ids: string[]; samples: any[] }
    >();
    for (const rec of invoiceItemRecords as any[]) {
      const bubbleId = String(rec?.bubble_id ?? "").trim();
      const raw = rec?.normalized ?? rec?.raw ?? {};
      const fornecedor = normalizeText(pickAny(raw, ["fornecedor_id_custom_fornecedores", "fornecedor_id_custom_itens_notas", "fornecedor_id", "fornecedor", "supplier"]) ?? "") || "Sem fornecedor";
      const dt =
        parseDateOnlyLoose(pickAny(raw, ["nota_id_custom_notas_fiscais", "nota_id", "invoice_id_custom_notas_fiscais", "nota", "invoice"]) ?? "") ??
        parseDateOnlyLoose(pickAny(raw, ["data_lancamento", "data_lancamento_custom_itens_notas", "Created Date"]) ?? "") ??
        "sem_data";
      const key = `${normalizeNameKey(fornecedor)}|${String(dt).toLowerCase()}`;
      const subtotal = parseNumber(pickAny(raw, ["subtotal", "subtotal_custom_itens_notas"])) ?? 0;

      const curr = expectedByGroupKey.get(key) ?? { fornecedor, data: String(dt), total: 0, itens: 0, bubble_ids: [], samples: [] };
      curr.total += subtotal;
      curr.itens += 1;
      if (bubbleId) curr.bubble_ids.push(bubbleId);
      if (curr.samples.length < 5) {
        curr.samples.push({
          bubble_id: bubbleId || null,
          item: normalizeText(pickAny(raw, ["item_id_custom_itens", "item_id", "item"]) ?? "") || null,
          quantidade: pickAny(raw, ["quantidade", "quantidade_custom_itens_notas"]) ?? null,
          subtotal,
        });
      }
      expectedByGroupKey.set(key, curr);
    }

    const { data: invoicesDb, error: invErr } = await supabase
      .from("invoices")
      .select("id,bubble_id,codigo,data_recebimento,raw,responsavel_user_id,fornecedor:suppliers(id,nome)")
      .eq("company_id", companyId)
      .order("data_recebimento", { ascending: true })
      .order("created_at", { ascending: true });
    if (invErr) return json({ ok: false, error: invErr.message }, { status: 500 });

    const invoiceIds = (invoicesDb ?? []).map((r: any) => String(r?.id ?? "").trim()).filter(Boolean);
    const { data: invoiceItemsDb, error: itemsErr } = invoiceIds.length
      ? await supabase.from("invoice_items").select("id,invoice_id,subtotal").eq("company_id", companyId).in("invoice_id", invoiceIds)
      : ({ data: [], error: null } as any);
    if (itemsErr) return json({ ok: false, error: itemsErr.message }, { status: 500 });

    const dbTotalsByInvoiceId = new Map<string, { total: number; itens: number }>();
    for (const it of (invoiceItemsDb ?? []) as any[]) {
      const invId = String(it?.invoice_id ?? "").trim();
      if (!invId) continue;
      const subtotal = typeof it?.subtotal === "number" ? it.subtotal : Number(it?.subtotal);
      const sub = Number.isFinite(subtotal) ? subtotal : 0;
      const curr = dbTotalsByInvoiceId.get(invId) ?? { total: 0, itens: 0 };
      curr.total += sub;
      curr.itens += 1;
      dbTotalsByInvoiceId.set(invId, curr);
    }

    const invoices = (invoicesDb ?? []).map((inv: any) => {
      const invId = String(inv?.id ?? "").trim();
      const fornecedorNome = normalizeText(inv?.fornecedor?.nome ?? "") || "Sem fornecedor";
      const dt = parseDateOnlyLoose(inv?.data_recebimento ?? "") ?? "sem_data";
      const matchKey = `${normalizeNameKey(fornecedorNome)}|${String(dt).toLowerCase()}`;
      const expected = expectedByGroupKey.get(matchKey) ?? null;

      const dbAgg = dbTotalsByInvoiceId.get(invId) ?? { total: 0, itens: 0 };
      const rawValorNota =
        (inv?.raw as any)?.valor_nota ??
        (inv?.raw as any)?.valorNota ??
        (inv?.raw as any)?.bubble?.valor_nota ??
        (inv?.raw as any)?.bubble?.valorNota ??
        (inv?.raw as any)?.bubble?.valor_nota_custom_notas_fiscais ??
        (inv?.raw as any)?.bubble?.valorNota_custom_notas_fiscais;
      const rawValorNum = parseNumber(rawValorNota) ?? 0;
      const uiValorNum = rawValorNum > 0 ? rawValorNum : dbAgg.total;

      const responsavelExpected = normalizeText((inv?.raw as any)?.bubble?.responsavel_id ?? "") || null;
      const responsavelUi = normalizeText(
        inv?.responsavel_user_id ??
          (inv?.raw as any)?.responsavel_id ??
          (inv?.raw as any)?.bubble?.responsavel_id ??
          (inv?.raw as any)?.bubble?.responsavel_id_custom_notas_fiscais ??
          (inv?.raw as any)?.bubble?.creator ??
          "",
      );

      return {
        invoice_id: invId,
        codigo: String(inv?.codigo ?? "").trim() || null,
        fornecedor: fornecedorNome,
        data: String(dt),
        bubble: expected
          ? { valor_esperado: expected.total, itens_esperado: expected.itens, sample: expected.samples }
          : { valor_esperado: null, itens_esperado: null, sample: [] },
        banco: { valor_total_itens: dbAgg.total, itens: dbAgg.itens },
        ui: { valor: uiValorNum, valorLabel: formatMoneyBRL(uiValorNum), responsavel: responsavelUi || null },
        responsavel: { esperado: responsavelExpected, salvo: inv?.responsavel_user_id ?? null, ui: responsavelUi || null },
        match: {
          chave: matchKey,
          valor_ok: expected ? Math.abs(expected.total - uiValorNum) < 0.0001 : null,
          itens_ok: expected ? expected.itens === dbAgg.itens : null,
        },
      };
    });

    const { data: recipeItems, error: rErr } = await supabase
      .from("items")
      .select("id,bubble_id,name,rendimento,custo_total_receita,custo_medio,cmv_desejado,preco_venda_total,item_receita,item_do_cardapio,raw")
      .eq("company_id", companyId)
      .eq("item_receita", true)
      .order("name", { ascending: true });
    if (rErr) return json({ ok: false, error: rErr.message }, { status: 500 });

    const recipeIds = (recipeItems ?? []).map((r: any) => String(r?.id ?? "").trim()).filter(Boolean);
    const { data: ingDb, error: iErr } = recipeIds.length
      ? await supabase
          .from("recipe_ingredients")
          .select("id,bubble_id,recipe_item_id,ingredient_item_id,quantidade,custo,ingredient:items!recipe_ingredients_ingredient_item_id_fkey(id,name,unidade_medida)")
          .eq("company_id", companyId)
          .in("recipe_item_id", recipeIds)
      : ({ data: [], error: null } as any);
    if (iErr) return json({ ok: false, error: iErr.message }, { status: 500 });

    const ingredientsByRecipeId = new Map<string, any[]>();
    for (const row of (ingDb ?? []) as any[]) {
      const rid = String(row?.recipe_item_id ?? "").trim();
      if (!rid) continue;
      const list = ingredientsByRecipeId.get(rid) ?? [];
      list.push(row);
      ingredientsByRecipeId.set(rid, list);
    }

    const fichas = (recipeItems ?? []).map((r: any) => {
      const id = String(r?.id ?? "").trim();
      const bubble = (r?.raw as any)?.bubble ?? {};
      const precoBubble = parseNumber(bubble?.preco_venda_total ?? bubble?.preco_venda_total_custom_itens ?? null);
      const custoTotalBubble = parseNumber(bubble?.custo_total_receita ?? bubble?.custo_total_receita_custom_itens ?? null);
      const cmvMetaBubble = parseNumber(bubble?.cmv_desejado ?? bubble?.cmv_desejado_custom_itens ?? null);

      const precoBanco = typeof r?.preco_venda_total === "number" ? r.preco_venda_total : null;
      const custoTotalBanco = typeof r?.custo_total_receita === "number" ? r.custo_total_receita : null;
      const cmvMetaBanco = typeof r?.cmv_desejado === "number" ? r.cmv_desejado : null;

      const ingredientes = (ingredientsByRecipeId.get(id) ?? []).map((it: any) => ({
        bubble_id: String(it?.bubble_id ?? "").trim() || null,
        item: normalizeText(it?.ingredient?.name ?? "") || null,
        quantidade: typeof it?.quantidade === "number" ? it.quantidade : parseNumber(it?.quantidade),
        custo: typeof it?.custo === "number" ? it.custo : parseNumber(it?.custo),
        unidade: normalizeText(it?.ingredient?.unidade_medida ?? "") || null,
      }));

      return {
        recipe_id: id,
        bubble_id: String(r?.bubble_id ?? "").trim() || null,
        nome: normalizeText(r?.name ?? "") || null,
        flags: { item_receita: Boolean(r?.item_receita), item_do_cardapio: Boolean(r?.item_do_cardapio) },
        bubble: { preco_venda_total: precoBubble, custo_total_receita: custoTotalBubble, cmv_desejado: cmvMetaBubble },
        banco: { preco_venda_total: precoBanco, custo_total_receita: custoTotalBanco, cmv_desejado: cmvMetaBanco },
        ingredientes,
      };
    });

    return json(
      {
        ok: true,
        companyId,
        email,
        capturedAt: new Date().toISOString(),
        staged: { bucket, path: stagedPath, itens_notas: invoiceItemRecords.length },
        entradas: { invoices },
        fichas: { total: fichas.length, rows: fichas },
      },
      { status: 200 },
    );
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

