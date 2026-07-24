import { NextRequest, NextResponse } from "next/server";
import { getBillingAccessForCurrentCompany, updateCompanyFromSubscription } from "../../../lib/billing";
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

function shouldConsiderSubscriptionActive(statusLower: string) {
  if (!statusLower) return false;
  return statusLower === "active" || statusLower === "trialing" || statusLower === "past_due" || statusLower === "unpaid";
}

function subscriptionSortScore(statusLower: string) {
  if (statusLower === "active") return 5;
  if (statusLower === "trialing") return 4;
  if (statusLower === "past_due") return 3;
  if (statusLower === "unpaid") return 2;
  if (statusLower === "canceled") return 0;
  return 1;
}

async function reconcileStripeCompanyState(ctx: Awaited<ReturnType<typeof getBillingAccessForCurrentCompany>>) {
  const company = ctx.company as any;
  const companyId = asString(ctx.companyId);
  if (!company || !companyId) return false;

  const customerId = asString(company?.stripe_customer_id);
  if (!customerId) return false;

  const stripe = tryGetStripe();
  if (!stripe) return false;

  const subStatusLower = String(company?.subscription_status ?? "").trim().toLowerCase();
  const checkoutStatusLower = String(company?.checkout_status ?? "").trim().toLowerCase();
  const existingSubId = asString(company?.stripe_subscription_id);
  const updatedAtIso = asString(company?.subscription_updated_at);
  const updatedAtMs = updatedAtIso ? Date.parse(updatedAtIso) : NaN;
  const isStale = !Number.isFinite(updatedAtMs) || Date.now() - updatedAtMs > 60_000;
  const shouldSync =
    checkoutStatusLower === "open" ||
    (!shouldConsiderSubscriptionActive(subStatusLower) &&
      (isStale || (subStatusLower === "trial_internal" && !existingSubId)));
  if (!shouldSync) return false;

  let subscription: any = null;
  const subId = asString(company?.stripe_subscription_id);
  if (subId) {
    try {
      subscription = await stripe.subscriptions.retrieve(subId, { expand: ["items.data.price"] });
    } catch {}
  }
  if (!subscription) {
    try {
      const list = await stripe.subscriptions.list({
        customer: customerId,
        status: "all",
        limit: 5,
        expand: ["data.items.data.price"],
      });
      const subs = (list?.data ?? []) as any[];
      if (subs.length) {
        subscription =
          subs
            .slice()
            .sort((a, b) => subscriptionSortScore(String(b?.status ?? "").trim().toLowerCase()) - subscriptionSortScore(String(a?.status ?? "").trim().toLowerCase()))[0] ??
          null;
      }
    } catch {}
  }
  if (!subscription) return false;

  await updateCompanyFromSubscription({ supabase: ctx.supabase, customerId, subscription });

  const newStatusLower = String(subscription?.status ?? "").trim().toLowerCase();
  if (checkoutStatusLower === "open" && shouldConsiderSubscriptionActive(newStatusLower)) {
    await ctx.supabase
      .from("companies")
      .update({
        checkout_status: null,
        checkout_plan: null,
        checkout_url: null,
        stripe_checkout_session_id: null,
        checkout_started_at: null,
        subscription_updated_at: new Date().toISOString(),
      } as any)
      .eq("id", companyId);
  }

  return true;
}

export async function GET(req: NextRequest) {
  try {
    let ctx = await getBillingAccessForCurrentCompany(req);
    const didReconcile = await reconcileStripeCompanyState(ctx);
    if (didReconcile) ctx = await getBillingAccessForCurrentCompany(req);
    const cardLast4 = await fetchCardLast4(ctx.company);
    return json({ ok: true, access: { ...ctx.access, cardLast4 } }, { status: 200 });
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

    let refreshed = await getBillingAccessForCurrentCompany(req);
    const didReconcile = await reconcileStripeCompanyState(refreshed);
    if (didReconcile) refreshed = await getBillingAccessForCurrentCompany(req);
    const cardLast4 = await fetchCardLast4(refreshed.company);
    return json({ ok: true, access: { ...refreshed.access, cardLast4 } }, { status: 200 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = msg === "unauthorized" ? 401 : 500;
    return json({ ok: false, error: msg }, { status });
  }
}
