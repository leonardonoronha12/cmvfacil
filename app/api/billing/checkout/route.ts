import { NextRequest, NextResponse } from "next/server";
import {
  createOrReuseCheckoutUrl,
  getBillingAccessForCurrentCompany,
  isSubscriptionBlockingNewCheckout,
  type CheckoutOrigin,
  type PlanKey,
} from "../../../lib/billing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return NextResponse.json(data, { ...init, headers });
}

function parsePlanKey(value: unknown): PlanKey | null {
  const v = String(value ?? "").trim().toLowerCase();
  if (v === "pro_monthly") return "pro_monthly";
  if (v === "pro_yearly") return "pro_yearly";
  return null;
}

function parseOrigin(value: unknown): CheckoutOrigin | null {
  const v = String(value ?? "").trim().toLowerCase();
  if (v === "signup") return "signup";
  if (v === "settings") return "settings";
  return null;
}

export async function POST(req: NextRequest) {
  try {
    let body: unknown;
    try {
      body = (await req.json()) as unknown;
    } catch {
      body = null;
    }

    const planKey = parsePlanKey((body as any)?.plan_key ?? (body as any)?.planKey ?? (body as any)?.plan);
    if (!planKey) return json({ ok: false, error: "invalid_plan" }, { status: 400 });

    const origin = parseOrigin((body as any)?.origin) ?? "settings";

    const { userId, supabase, companyId, company } = await getBillingAccessForCurrentCompany(req);
    if (!companyId || !company) return json({ ok: false, error: "company_not_found" }, { status: 400 });

    if (isSubscriptionBlockingNewCheckout(company)) {
      return json({ ok: false, error: "subscription_already_active" }, { status: 409 });
    }

    const url = await createOrReuseCheckoutUrl({ supabase, company, companyId, userId, planKey, origin });
    return json({ ok: true, url }, { status: 200 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = msg === "unauthorized" ? 401 : 500;
    return json({ ok: false, error: msg }, { status });
  }
}
