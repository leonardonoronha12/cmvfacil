import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin, getSupabaseServerClient } from "../../../lib/supabaseAdmin";
import { getUserIdFromRequest } from "../../../lib/requestUserId";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(data: unknown, init: ResponseInit = {}) {
  return NextResponse.json(data, init);
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function normalizeItemName(value: unknown) {
  return String(value ?? "")
    .replace(/^\s*This\s+itens?_notas?/i, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function rawItemName(raw: any) {
  const source = raw?.bubble && typeof raw.bubble === "object" ? { ...raw, ...raw.bubble } : raw;
  return String(
    source?.nome ??
      source?.item_nome_migra__o_text ??
      source?.item_nome_migracao_text ??
      source?.["item_nome_migração_text"] ??
      source?.["item_nome_migraÃ§Ã£o_text"] ??
      source?.item_nome_text ??
      "",
  ).trim();
}

function pickCompany(rows: any[]) {
  const score = (row: any) => {
    const level = Number(row?.permission_level ?? 0) || 0;
    const role = String(row?.role ?? "").toLowerCase();
    return level * 100 + (role.includes("owner") || role.includes("propriet") ? 30 : role.includes("admin") ? 20 : 0);
  };
  return String(rows.slice().sort((a, b) => score(b) - score(a))[0]?.company_id ?? "").trim();
}

export async function GET(req: NextRequest) {
  try {
    const { accessToken, userId } = getUserIdFromRequest(req);
    if (!userId || !isUuid(userId)) return json({ error: "unauthorized" }, { status: 401 });
    const supabase = getSupabaseServerClient(accessToken);
    let admin: ReturnType<typeof getSupabaseAdmin> | null = null;
    try {
      admin = getSupabaseAdmin();
    } catch {}
    const db = admin ?? supabase;

    const url = new URL(req.url);
    const requestedId = String(url.searchParams.get("itemId") ?? "").trim();
    const requestedName = String(url.searchParams.get("name") ?? "").trim();
    if (!requestedId && !requestedName) return json({ error: "missing_item" }, { status: 400 });

    const { data: memberships, error: membershipError } = await db
      .from("company_members")
      .select("company_id,role,permission_level")
      .eq("user_id", userId)
      .limit(50);
    if (membershipError) return json({ error: membershipError.message }, { status: 500 });
    const companyId = pickCompany((memberships ?? []) as any[]);
    if (!companyId) return json({ error: "missing_company" }, { status: 404 });

    const cleanDbId = requestedId.toLowerCase().startsWith("db:") ? requestedId.slice(3) : requestedId;
    let itemQuery = db.from("items").select("id,bubble_id,name,unidade_medida").eq("company_id", companyId);
    if (isUuid(cleanDbId)) itemQuery = itemQuery.eq("id", cleanDbId);
    else if (/^\d{6,}x\d{6,}$/.test(requestedId)) itemQuery = itemQuery.eq("bubble_id", requestedId);
    else itemQuery = itemQuery.ilike("name", requestedName || requestedId);
    const { data: item, error: itemError } = await itemQuery.limit(1).maybeSingle();
    if (itemError) return json({ error: itemError.message }, { status: 500 });
    if (!item?.id) return json({ error: "item_not_found" }, { status: 404 });

    const itemId = String(item.id);
    let { data: invoiceItems, error: invoiceItemsError } = await db
      .from("invoice_items")
      .select("id,invoice_id,quantidade,custo_unitario,subtotal,raw")
      .eq("company_id", companyId)
      .eq("item_id", itemId)
      .limit(5000);
    if (invoiceItemsError) return json({ error: invoiceItemsError.message }, { status: 500 });

    // Some Bubble imports predate item_id linking. Recover those historical
    // rows by the readable item name stored in raw instead of hiding them.
    if (!(invoiceItems ?? []).length) {
      const { data: legacyInvoiceItems, error: legacyInvoiceItemsError } = await db
        .from("invoice_items")
        .select("id,invoice_id,item_id,quantidade,custo_unitario,subtotal,raw")
        .eq("company_id", companyId)
        .limit(5000);
      if (legacyInvoiceItemsError) return json({ error: legacyInvoiceItemsError.message }, { status: 500 });
      const wantedName = normalizeItemName(item.name);
      invoiceItems = (legacyInvoiceItems ?? []).filter((row: any) => normalizeItemName(rawItemName(row?.raw)) === wantedName);
    }

    const invoiceIds = Array.from(new Set((invoiceItems ?? []).map((row: any) => String(row?.invoice_id ?? "").trim()).filter(Boolean)));
    const { data: invoices, error: invoicesError } = invoiceIds.length
      ? await db.from("invoices").select("id,data_recebimento,data_criacao,supplier_id").eq("company_id", companyId).in("id", invoiceIds)
      : { data: [] as any[], error: null };
    if (invoicesError) return json({ error: invoicesError.message }, { status: 500 });

    const supplierIdsFromInvoices = (invoices ?? []).map((row: any) => String(row?.supplier_id ?? "").trim()).filter(Boolean);
    const { data: directLinks, error: directLinksError } = await db
      .from("supplier_items")
      .select("supplier_id")
      .eq("company_id", companyId)
      .eq("item_id", itemId)
      .limit(5000);
    if (directLinksError) return json({ error: directLinksError.message }, { status: 500 });
    const supplierIds = Array.from(
      new Set([...supplierIdsFromInvoices, ...(directLinks ?? []).map((row: any) => String(row?.supplier_id ?? "").trim())].filter(Boolean)),
    );
    const { data: suppliers, error: suppliersError } = supplierIds.length
      ? await db.from("suppliers").select("id,nome,vendedor,endereco").eq("company_id", companyId).in("id", supplierIds)
      : { data: [] as any[], error: null };
    if (suppliersError) return json({ error: suppliersError.message }, { status: 500 });

    const invoiceById = new Map((invoices ?? []).map((row: any) => [String(row.id), row]));
    const supplierById = new Map((suppliers ?? []).map((row: any) => [String(row.id), row]));
    const history = (invoiceItems ?? []).map((row: any) => {
      const invoice = invoiceById.get(String(row?.invoice_id ?? "")) as any;
      const supplier = supplierById.get(String(invoice?.supplier_id ?? "")) as any;
      return {
        id: String(row?.id ?? ""),
        date: invoice?.data_recebimento ?? invoice?.data_criacao ?? null,
        supplier: String(supplier?.nome ?? "").trim() || "-",
        quantity: Number(row?.quantidade ?? 0) || 0,
        unitCost: Number(row?.custo_unitario ?? 0) || 0,
        subtotal: Number(row?.subtotal ?? 0) || 0,
      };
    });

    return json({
      ok: true,
      item: { id: itemId, bubbleId: item.bubble_id ?? null, name: item.name, unit: item.unidade_medida || "Und" },
      history,
      suppliers: (suppliers ?? []).map((row: any) => ({
        key: `db:${String(row.id)}`,
        fornecedor: String(row?.nome ?? "").trim() || "-",
        vendedor: String(row?.vendedor ?? "").trim() || "-",
        endereco: String(row?.endereco ?? "").trim() || "-",
      })),
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
