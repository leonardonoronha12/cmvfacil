import { NextRequest, NextResponse } from "next/server";
import { getBillingAccessForCurrentCompany } from "../../../lib/billing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return NextResponse.json(data, { ...init, headers });
}

export async function GET(req: NextRequest) {
  try {
    const { access } = await getBillingAccessForCurrentCompany(req);
    return json({ ok: true, access }, { status: 200 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = msg === "unauthorized" ? 401 : 500;
    return json({ ok: false, error: msg }, { status });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { userId, supabase, companyId, company } = await getBillingAccessForCurrentCompany(req);
    if (!companyId || !company) return json({ ok: false, error: "company_not_found" }, { status: 400 });

    let body: unknown = null;
    try {
      body = (await req.json()) as unknown;
    } catch {
      body = null;
    }
    const action = String((body as any)?.action ?? "").trim().toLowerCase();

    if (action && action !== "checkout_cancel" && action !== "checkout_abandoned") {
      return json({ ok: false, error: "invalid_action" }, { status: 400 });
    }

    const nowIso = new Date().toISOString();
    const patch: any = { subscription_updated_at: nowIso };
    if (action === "checkout_cancel") {
      patch.checkout_status = "canceled";
      patch.checkout_plan = null;
      patch.checkout_url = null;
      if (!String(company.checkout_abandoned_at ?? "").trim()) patch.checkout_abandoned_at = nowIso;
    } else if (action === "checkout_abandoned") {
      patch.checkout_status = "abandoned";
      patch.checkout_plan = null;
      patch.checkout_url = null;
      if (!String(company.checkout_abandoned_at ?? "").trim()) patch.checkout_abandoned_at = nowIso;
    }

    if (Object.keys(patch).length > 1) await supabase.from("companies").update(patch).eq("id", companyId);

    const refreshed = await getBillingAccessForCurrentCompany(req);
    return json({ ok: true, access: refreshed.access }, { status: 200 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = msg === "unauthorized" ? 401 : 500;
    return json({ ok: false, error: msg }, { status });
  }
}
