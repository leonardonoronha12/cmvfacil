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

function asString(value: unknown) {
  const v = String(value ?? "").trim();
  return v || null;
}

function cardLast4FromPaymentMethod(pm: any) {
  const last4 = asString(pm?.card?.last4);
  const digits = last4 ? last4.replace(/[^\d]/g, "") : "";
  return digits.length === 4 ? digits : null;
}

function tryGetStripe() {
  try {
    return getStripe() as any;
  } catch {
    return null;
  }
}

async function fetchCardLast4(company: any) {
  const customerId = asString(company?.stripe_customer_id);
  if (!customerId) return null;
  const stripe = tryGetStripe();
  if (!stripe) return null;

  const subId = asString(company?.stripe_subscription_id);
  if (subId) {
    try {
      const sub = await stripe.subscriptions.retrieve(subId, { expand: ["default_payment_method"] });
      const pm = sub?.default_payment_method;
      const last4 = cardLast4FromPaymentMethod(pm);
      if (last4) return last4;
    } catch {}
  }

  try {
    const customer = await stripe.customers.retrieve(customerId, { expand: ["invoice_settings.default_payment_method"] });
    const pm = customer?.invoice_settings?.default_payment_method;
    const last4 = cardLast4FromPaymentMethod(pm);
    if (last4) return last4;
  } catch {}

  try {
    const list = await stripe.paymentMethods.list({ customer: customerId, type: "card", limit: 1 });
    const pm = (list?.data ?? [])[0];
    const last4 = cardLast4FromPaymentMethod(pm);
    if (last4) return last4;
  } catch {}

  return null;
}

export async function GET(req: NextRequest) {
  try {
    const { access, company } = await getBillingAccessForCurrentCompany(req);
    const cardLast4 = await fetchCardLast4(company);
    return json({ ok: true, access: { ...access, cardLast4 } }, { status: 200 });
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
      const sessionId = asString((company as any)?.stripe_checkout_session_id);
      const status = String((company as any)?.checkout_status ?? "").trim().toLowerCase();
      if (sessionId && (status === "open" || !status)) {
        const stripe = tryGetStripe();
        if (stripe) {
          try {
            await stripe.checkout.sessions.expire(sessionId);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (!msg.toLowerCase().includes("only open sessions")) throw new Error("stripe_expire_failed");
          }
        }
      }
      patch.checkout_status = "canceled";
      patch.checkout_plan = null;
      patch.checkout_url = null;
      patch.stripe_checkout_session_id = null;
      patch.checkout_started_at = null;
      if (!String(company.checkout_abandoned_at ?? "").trim()) patch.checkout_abandoned_at = nowIso;
    } else if (action === "checkout_abandoned") {
      const sessionId = asString((company as any)?.stripe_checkout_session_id);
      const status = String((company as any)?.checkout_status ?? "").trim().toLowerCase();
      if (sessionId && (status === "open" || !status)) {
        const stripe = tryGetStripe();
        if (stripe) {
          try {
            await stripe.checkout.sessions.expire(sessionId);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (!msg.toLowerCase().includes("only open sessions")) throw new Error("stripe_expire_failed");
          }
        }
      }
      patch.checkout_status = "abandoned";
      patch.checkout_plan = null;
      patch.checkout_url = null;
      patch.stripe_checkout_session_id = null;
      patch.checkout_started_at = null;
      if (!String(company.checkout_abandoned_at ?? "").trim()) patch.checkout_abandoned_at = nowIso;
    }

    if (Object.keys(patch).length > 1) await supabase.from("companies").update(patch).eq("id", companyId);

    const refreshed = await getBillingAccessForCurrentCompany(req);
    const cardLast4 = await fetchCardLast4(refreshed.company);
    return json({ ok: true, access: { ...refreshed.access, cardLast4 } }, { status: 200 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = msg === "unauthorized" ? 401 : 500;
    return json({ ok: false, error: msg }, { status });
  }
}
