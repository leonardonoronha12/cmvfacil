import { NextRequest, NextResponse } from "next/server";
import { getUserIdFromRequest } from "../../../../lib/requestUserId";
import { getSupabaseAdmin } from "../../../../lib/supabaseAdmin";
import { isLocalDevRequest } from "../../../../lib/localDevRequest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return NextResponse.json(data, { ...init, headers });
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value ?? "").trim());
}

function normalizeText(v: unknown) {
  return String(v ?? "").replace(/\s+/g, " ").trim();
}

function normalizeNameKey(v: unknown) {
  return normalizeText(v).toLowerCase();
}

function normalizeExternalKeyPart(v: unknown) {
  return normalizeNameKey(v).replace(/:/g, "_").slice(0, 80);
}

function safeEmail(input: unknown) {
  const v = String(input ?? "").trim().toLowerCase();
  if (!v || !v.includes("@")) return "";
  return v;
}

function parseNumber(v: unknown) {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const s0 = normalizeText(v).replace(/\s+/g, "");
  if (!s0) return null;
  const s = s0.includes(",") && !s0.includes(".") ? s0.replace(",", ".") : s0.replace(/,/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function parseBool(v: unknown) {
  if (typeof v === "boolean") return v;
  const s = normalizeText(v).toLowerCase();
  if (!s) return false;
  return s === "1" || s === "true" || s === "yes" || s === "sim" || s === "on";
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

function looksLikeBubbleId(v: string) {
  const s = String(v ?? "").trim();
  if (!s) return false;
  return /\d{8,}x\d{6,}/.test(s) || /^\d{8,}x\d{6,}$/.test(s);
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

function parseDateTimeKey(v: unknown) {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const dt = new Date(s);
  const t = dt.getTime();
  if (!Number.isFinite(t)) return null;
  return String(Math.floor(t / 60_000));
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
    if (!invoiceItemRecords.length) {
      return json({ ok: false, error: "no_invoice_items_in_staging", stagedPath }, { status: 400 });
    }

    const { data: profile, error: pErr } = await supabase.from("user_profiles").select("user_id,email").eq("email", email).maybeSingle();
    if (pErr) return json({ ok: false, error: pErr.message }, { status: 500 });
    const targetUserId = String((profile as any)?.user_id ?? "").trim();
    if (!isUuid(targetUserId)) return json({ ok: false, error: "target_user_not_found" }, { status: 400 });

    const [{ count: beforeCount }, suppliersRes, itemsRes, invoicesRes] = await Promise.all([
      supabase.from("invoice_items").select("id", { head: true, count: "exact" }).eq("company_id", companyId),
      supabase.from("suppliers").select("id,bubble_id,nome,external_key").eq("company_id", companyId),
      supabase.from("items").select("id,bubble_id,name,external_key").eq("company_id", companyId),
      supabase.from("invoices").select("id,bubble_id,codigo,data_recebimento,data_criacao,fornecedor_id,external_key").eq("company_id", companyId),
    ]);

    if (suppliersRes.error) return json({ ok: false, error: suppliersRes.error.message }, { status: 500 });
    if (itemsRes.error) return json({ ok: false, error: itemsRes.error.message }, { status: 500 });
    if (invoicesRes.error) return json({ ok: false, error: invoicesRes.error.message }, { status: 500 });

    const supplierIdByBubbleId = new Map<string, string>();
    const supplierIdByName = new Map<string, string>();
    for (const s of (suppliersRes.data ?? []) as any[]) {
      const id = String(s?.id ?? "").trim();
      const b = String(s?.bubble_id ?? "").trim();
      const name = String(s?.nome ?? "").trim();
      if (id && b) supplierIdByBubbleId.set(b, id);
      if (id && name) supplierIdByName.set(normalizeNameKey(name), id);
    }

    const itemIdByBubbleId = new Map<string, string>();
    const itemIdByName = new Map<string, string>();
    for (const it of (itemsRes.data ?? []) as any[]) {
      const id = String(it?.id ?? "").trim();
      const b = String(it?.bubble_id ?? "").trim();
      const name = String(it?.name ?? "").trim();
      if (id && b) itemIdByBubbleId.set(b, id);
      if (id && name) itemIdByName.set(normalizeNameKey(name), id);
    }

    const invoiceIdByBubbleId = new Map<string, string>();
    const invoiceIdBySupplierDate = new Map<string, string>();
    const invoiceIdsByDate = new Map<string, string[]>();
    const invoiceIdsByDateTime = new Map<string, string[]>();
    const invoiceSupplierIdById = new Map<string, string>();
    for (const inv of (invoicesRes.data ?? []) as any[]) {
      const id = String(inv?.id ?? "").trim();
      const b = String(inv?.bubble_id ?? "").trim();
      const supplierId = String(inv?.fornecedor_id ?? "").trim();
      const d1 = parseDateOnlyLoose(inv?.data_criacao);
      const d2 = parseDateOnlyLoose(inv?.data_recebimento);
      const dt1 = parseDateTimeKey(inv?.data_criacao);
      const dt2 = parseDateTimeKey(inv?.data_recebimento);
      if (id && b) invoiceIdByBubbleId.set(b, id);
      if (id && supplierId && d1) invoiceIdBySupplierDate.set(`${supplierId}|${String(d1).toLowerCase()}`, id);
      if (id && supplierId && d2) invoiceIdBySupplierDate.set(`${supplierId}|${String(d2).toLowerCase()}`, id);
      if (id && supplierId) invoiceSupplierIdById.set(id, supplierId);
      for (const d of new Set([d1, d2].filter(Boolean) as string[])) {
        const list = invoiceIdsByDate.get(d) ?? [];
        if (!list.includes(id)) list.push(id);
        invoiceIdsByDate.set(d, list);
      }
      for (const dt of new Set([dt1, dt2].filter(Boolean) as string[])) {
        const list = invoiceIdsByDateTime.get(dt) ?? [];
        if (!list.includes(id)) list.push(id);
        invoiceIdsByDateTime.set(dt, list);
      }
    }

    const results: any[] = [];
    let attempted = 0;
    let upserted = 0;
    let skipped = 0;
    let failed = 0;

    const stagedBubbleIds = invoiceItemRecords.map((r: any) => String(r?.bubble_id ?? "").trim()).filter(Boolean);
    if (stagedBubbleIds.length) {
      await supabase.from("invoice_items").delete().eq("company_id", companyId).in("bubble_id", stagedBubbleIds);
    }

    for (const rec of invoiceItemRecords as any[]) {
      attempted += 1;
      const bubbleId = String(rec?.bubble_id ?? "").trim();
      const raw = rec?.normalized ?? rec?.raw ?? {};

      const itemRefRaw = pickAny(raw, ["item_id_custom_itens", "item_id", "item"]) ?? "";
      const itemRefText = normalizeText(itemRefRaw);
      const itemBubbleId = looksLikeBubbleId(itemRefText) ? extractBubbleId(itemRefRaw) : "";
      const itemId = itemBubbleId ? itemIdByBubbleId.get(itemBubbleId) ?? null : itemRefText ? itemIdByName.get(normalizeNameKey(itemRefText)) ?? null : null;

      const supplierRefRaw = pickAny(raw, ["fornecedor_id_custom_fornecedores", "fornecedor_id_custom_itens_notas", "fornecedor_id", "fornecedor", "supplier"]) ?? "";
      const supplierRefText = normalizeText(supplierRefRaw);
      const supplierBubbleId = looksLikeBubbleId(supplierRefText) ? extractBubbleId(supplierRefRaw) : "";
      const supplierId =
        (supplierBubbleId ? supplierIdByBubbleId.get(supplierBubbleId) ?? null : null) ??
        (supplierRefText ? supplierIdByName.get(normalizeNameKey(supplierRefText)) ?? null : null) ??
        null;

      const explicitInvoiceRaw = pickAny(raw, ["nota_id_custom_notas_fiscais", "nota_id", "invoice_id_custom_notas_fiscais", "nota", "invoice"]) ?? "";
      const explicitInvoiceText = normalizeText(explicitInvoiceRaw);
      const explicitInvoiceBubbleId = looksLikeBubbleId(explicitInvoiceText) ? extractBubbleId(explicitInvoiceRaw) : "";
      const explicitInvoiceDate = explicitInvoiceText ? parseDateOnlyLoose(explicitInvoiceText) : null;

      const dataRaw = pickAny(raw, ["data_lan_amento_date", "data_lancamento_date", "data_lancamento", "data_lancamento_custom_itens_notas", "Created Date"]) ?? "";
      const dataLancamento = parseDateOnlyLoose(dataRaw);
      const dataTimeKey = parseDateTimeKey(dataRaw);

      const quantidade = parseNumber(pickAny(raw, ["quantidade_number", "quantidade", "quantidade_custom_itens_notas"]));
      const custoUnitario = parseNumber(pickAny(raw, ["custo_unitario_number", "custo_unitario", "custo_unitario_custom_itens_notas"]));
      const subtotal = parseNumber(pickAny(raw, ["subtotal_number", "subtotal", "subtotal_custom_itens_notas"]));

      const resolvedByBubble = explicitInvoiceBubbleId ? invoiceIdByBubbleId.get(explicitInvoiceBubbleId) ?? null : null;
      const dtKey = explicitInvoiceDate ?? dataLancamento ?? null;
      const resolvedBySupplierDate = dtKey && supplierId ? invoiceIdBySupplierDate.get(`${supplierId}|${String(dtKey).toLowerCase()}`) ?? null : null;
      const exactTimeCandidates = dataTimeKey ? invoiceIdsByDateTime.get(dataTimeKey) ?? [] : [];
      const dateCandidates = dtKey ? invoiceIdsByDate.get(dtKey) ?? [] : [];
      const resolvedByTime = exactTimeCandidates.length === 1 ? exactTimeCandidates[0] : null;
      const resolvedByUniqueDate = dateCandidates.length === 1 ? dateCandidates[0] : null;
      const invoiceId = resolvedByBubble ?? resolvedBySupplierDate ?? resolvedByTime ?? resolvedByUniqueDate ?? null;
      const inferredSupplierId = invoiceId ? invoiceSupplierIdById.get(invoiceId) ?? null : null;
      const supplierIdFinal = supplierId ?? inferredSupplierId;

      const reason = (() => {
        if (!bubbleId) return "missing_bubble_id";
        if (!invoiceId) return "missing_invoice_relation";
        if (!supplierIdFinal) return "csv_orphan_missing_supplier";
        if (!itemId) return "missing_item_relation";
        return null;
      })();

      const resolved = {
        bubble_id: bubbleId || null,
        item_ref: itemRefText || null,
        nota_ref: explicitInvoiceText || null,
        fornecedor_ref: supplierRefText || null,
        quantidade,
        custo_unitario: custoUnitario,
        subtotal,
        resolved_invoice_id: invoiceId,
        resolved_item_id: itemId,
        reason,
      };

      if (reason) {
        results.push({ ...resolved, status: "skipped" });
        skipped += 1;
        continue;
      }

      const fornecedorIdFinal = invoiceId ? invoiceSupplierIdById.get(invoiceId) ?? supplierIdFinal : supplierIdFinal;

      const row = {
        company_id: companyId,
        bubble_id: bubbleId,
        invoice_id: invoiceId,
        item_id: itemId,
        fornecedor_id: fornecedorIdFinal,
        data_lancamento: dataLancamento,
        quantidade,
        custo_unitario: custoUnitario,
        subtotal,
        ocultar_cmv: parseBool(pickAny(raw, ["ocultar_cmv", "ocultar_cmv_custom_itens_notas"])),
        cadastro_item: parseBool(pickAny(raw, ["cadastro_item", "cadastro_Item"])),
        excluivel_detalhes_item: parseBool(pickAny(raw, ["excluivel_detalhes_item", "excluível_detalhes_item"])),
        created_by_user_id: targetUserId,
        raw: { bubble: raw, system: { repair: true, stagedPath } },
      };

      const { error: upErr } = await supabase.from("invoice_items").upsert([row], { onConflict: "company_id,bubble_id" } as any);
      if (upErr) {
        results.push({ ...resolved, status: "error", upsert_error: upErr.message });
        failed += 1;
        continue;
      }

      upserted += 1;
      results.push({ ...resolved, status: "upserted" });
    }

    const { count: afterCount } = await supabase.from("invoice_items").select("id", { head: true, count: "exact" }).eq("company_id", companyId);

    return json(
      {
        ok: true,
        companyId,
        email,
        staged: { bucket, path: stagedPath, rows: invoiceItemRecords.length },
        before: { invoice_items: Number(beforeCount ?? 0) },
        after: { invoice_items: Number(afterCount ?? 0) },
        summary: { attempted, upserted, skipped, failed },
        results,
      },
      { status: 200 },
    );
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
