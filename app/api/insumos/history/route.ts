import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin, getSupabaseServerClient } from "../../../lib/supabaseAdmin";
import { getUserIdFromRequest } from "../../../lib/requestUserId";
import { parsePtNumber } from "../../../lib/bubbleCsv";

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

async function loadAllInvoiceItemsForCompany(db: any, companyId: string) {
  const pageSize = 1000;
  const rows: any[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await db
      .from("invoice_items")
      .select("id,invoice_id,item_id,quantidade,custo_unitario,subtotal,raw,item:items(name,bubble_id)")
      .eq("company_id", companyId)
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const page = (data ?? []) as any[];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

async function loadAllLegacyEntriesForUser(db: any, userId: string) {
  const pageSize = 1000;
  const rows: any[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await db
      .from("entradas")
      .select("id,data_lancamento,data_criacao,fornecedor,itens_nota")
      .like("id", `user:${userId}:%`)
      .order("created_at", { ascending: false })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const page = (data ?? []) as any[];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
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
      const legacyInvoiceItems = await loadAllInvoiceItemsForCompany(db, companyId);
      const wantedName = normalizeItemName(item.name);
      invoiceItems = legacyInvoiceItems.filter((row: any) => {
        const linkedName = normalizeItemName(row?.item?.name);
        const storedName = normalizeItemName(rawItemName(row?.raw));
        return linkedName === wantedName || storedName === wantedName;
      });
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

    // The production Entries screen still uses the legacy `entradas` table for
    // migrated Bubble accounts. Read the same source so the item modal does not
    // hide valid history merely because no compat invoice_item was generated.
    if (!history.length) {
      const wantedName = normalizeItemName(item.name);
      const legacyEntries = await loadAllLegacyEntriesForUser(db, userId);
      for (const entry of legacyEntries) {
        const entryItems = Array.isArray(entry?.itens_nota) ? entry.itens_nota : [];
        for (const legacyItem of entryItems) {
          const legacyItemId = String(legacyItem?.itemId ?? legacyItem?.insumoId ?? "").replace(/^db:/i, "").trim();
          const candidateNames = [
            legacyItem?.insumoEquivalente,
            legacyItem?.nomeNaNota,
            legacyItem?.nome,
            legacyItem?.item_nome_migra__o_text,
            legacyItem?.item_nome_migracao_text,
            legacyItem?.item_nome_text,
          ].map(normalizeItemName);
          const idMatches =
            legacyItemId === String(item.bubble_id ?? "").trim() ||
            legacyItemId === itemId ||
            legacyItemId === `db:${itemId}`;
          if (!idMatches && !candidateNames.includes(wantedName)) continue;
          const quantity =
            parsePtNumber(String(legacyItem?.equivalenteQuantidade ?? legacyItem?.quantidadeLabel ?? legacyItem?.quantidade ?? "")) || 0;
          const unitCost =
            parsePtNumber(String(legacyItem?.custoUnitario ?? legacyItem?.custoUnitarioLabel ?? legacyItem?.custo_unitario ?? "")) || 0;
          const subtotal =
            parsePtNumber(String(legacyItem?.subtotal ?? legacyItem?.subtotalLabel ?? "")) || (quantity > 0 ? quantity * unitCost : 0);
          history.push({
            id: String(legacyItem?.id ?? `${entry?.id ?? "entry"}:${history.length}`),
            date: entry?.data_lancamento ?? entry?.data_criacao ?? null,
            supplier: String(entry?.fornecedor ?? "").trim() || "-",
            quantity,
            unitCost,
            subtotal,
          });
        }
      }
    }

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
