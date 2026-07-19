import { NextRequest, NextResponse } from "next/server";
import { getBillingAccessForCurrentCompany } from "../../../lib/billing";
import { getStripe } from "../../../lib/stripeServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return NextResponse.json(data, { ...init, headers });
}

export async function POST(req: NextRequest) {
  try {
    const { companyId, company } = await getBillingAccessForCurrentCompany(req);
    if (!companyId || !company) return json({ ok: false, error: "company_not_found" }, { status: 400 });

    const customerId = String(company.stripe_customer_id ?? "").trim();
    if (!customerId) return json({ ok: false, error: "stripe_customer_missing" }, { status: 409 });

    const stripe = getStripe();
    const returnUrl = `https://cmvfacil.vercel.app/ajustes?tab=planos`;
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });

    const url = String(session.url ?? "").trim();
    if (!url) return json({ ok: false, error: "portal_url_missing" }, { status: 500 });
    return json({ ok: true, url }, { status: 200 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = msg === "unauthorized" ? 401 : 500;
    return json({ ok: false, error: msg }, { status });
  }
}
