import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin";
import { getUserIdFromRequest } from "../../../lib/requestUserId";

export const dynamic = "force-dynamic";

const text = (value: unknown) => String(value ?? "").trim();
const number = (value: unknown) => {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export async function GET(req: NextRequest) {
  const { userId } = getUserIdFromRequest(req);
  const uid = text(userId);
  if (!uid) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  try {
    const db = getSupabaseAdmin();
    const memberships = await db.from("company_members").select("company_id").eq("user_id", uid).limit(100);
    if (memberships.error) throw memberships.error;
    const companyIds = Array.from(new Set((memberships.data ?? []).map((row: any) => text(row.company_id)).filter(Boolean)));
    if (!companyIds.length) {
      return NextResponse.json({
        ok: true,
        totals: { companies: 0, items: 0, inventories: 0, invoices: 0, invoiceItems: 0, purchasesTotal: 0 },
        companies: [],
      });
    }

    const [companiesResult, itemsResult, inventoriesResult, invoicesResult, invoiceItemsResult] = await Promise.all([
      db.from("companies").select("id,fantasy_name,legal_name").in("id", companyIds),
      db.from("items").select("id,company_id").in("company_id", companyIds).limit(50000),
      db.from("inventories").select("id,company_id,data_contagem").in("company_id", companyIds).limit(50000),
      db.from("invoices").select("id,company_id").in("company_id", companyIds).limit(50000),
      db.from("invoice_items").select("id,company_id,subtotal").in("company_id", companyIds).limit(50000),
    ]);
    const failed = [companiesResult, itemsResult, inventoriesResult, invoicesResult, invoiceItemsResult].find((result) => result.error);
    if (failed?.error) throw failed.error;

    const companies = (companiesResult.data ?? []).map((company: any) => {
      const id = text(company.id);
      const companyItems = (itemsResult.data ?? []).filter((row: any) => text(row.company_id) === id);
      const companyInventories = (inventoriesResult.data ?? []).filter((row: any) => text(row.company_id) === id);
      const companyInvoices = (invoicesResult.data ?? []).filter((row: any) => text(row.company_id) === id);
      const companyInvoiceItems = (invoiceItemsResult.data ?? []).filter((row: any) => text(row.company_id) === id);
      const lastInventoryDate = companyInventories
        .map((row: any) => text(row.data_contagem).slice(0, 10))
        .filter(Boolean)
        .sort()
        .at(-1) ?? null;
      return {
        id,
        name: text(company.fantasy_name) || text(company.legal_name) || "Empresa",
        items: companyItems.length,
        inventories: companyInventories.length,
        invoices: companyInvoices.length,
        invoiceItems: companyInvoiceItems.length,
        purchasesTotal: companyInvoiceItems.reduce((sum: number, row: any) => sum + number(row.subtotal), 0),
        lastInventoryDate,
      };
    });

    return NextResponse.json({
      ok: true,
      totals: companies.reduce(
        (totals, company) => ({
          companies: totals.companies + 1,
          items: totals.items + company.items,
          inventories: totals.inventories + company.inventories,
          invoices: totals.invoices + company.invoices,
          invoiceItems: totals.invoiceItems + company.invoiceItems,
          purchasesTotal: totals.purchasesTotal + company.purchasesTotal,
        }),
        { companies: 0, items: 0, inventories: 0, invoices: 0, invoiceItems: 0, purchasesTotal: 0 },
      ),
      companies,
    });
  } catch (error) {
    console.error("companies_consolidated_failed", error);
    return NextResponse.json({ ok: false, error: "Não foi possível carregar o consolidado." }, { status: 500 });
  }
}
