import type Stripe from "stripe";
import { planKeyFromPriceId, resolveCurrentCompanyForUser } from "./billing";
import { getStripe } from "./stripeServer";
import type { getSupabaseAdmin } from "./supabaseAdmin";

type SupabaseAdmin = ReturnType<typeof getSupabaseAdmin>;

const SUBSCRIPTION_PRIORITY: Record<string, number> = {
  active: 60,
  trialing: 50,
  past_due: 40,
  unpaid: 30,
  paused: 20,
  incomplete: 10,
  incomplete_expired: 5,
  canceled: 0,
};

function subscriptionScore(subscription: Stripe.Subscription) {
  const status = String(subscription.status ?? "").trim().toLowerCase();
  const created = Number(subscription.created ?? 0);
  return (SUBSCRIPTION_PRIORITY[status] ?? -10) * 10_000_000_000 + created;
}

function customerIdOf(subscription: Stripe.Subscription) {
  return typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;
}

function currentPeriod(subscription: Stripe.Subscription) {
  const item = subscription.items?.data?.[0] as any;
  const start =
    typeof (subscription as any)?.current_period_start === "number"
      ? (subscription as any).current_period_start
      : typeof item?.current_period_start === "number"
        ? item.current_period_start
        : null;
  const end =
    typeof (subscription as any)?.current_period_end === "number"
      ? (subscription as any).current_period_end
      : typeof item?.current_period_end === "number"
        ? item.current_period_end
        : null;
  return {
    start: start ? new Date(start * 1000).toISOString() : null,
    end: end ? new Date(end * 1000).toISOString() : null,
  };
}

export type MigrationBillingResult = {
  ok: boolean;
  status: "preserved" | "no_subscription" | "ambiguous" | "company_missing" | "conflict";
  companyId: string | null;
  customerId: string | null;
  subscriptionId: string | null;
  subscriptionStatus: string | null;
  plan: string | null;
  message?: string;
};

export async function reconcileMigrationBilling(params: {
  supabase: SupabaseAdmin;
  userId: string;
  email: string;
}): Promise<MigrationBillingResult> {
  const { supabase, userId } = params;
  const email = String(params.email ?? "").trim().toLowerCase();
  const { companyId, company } = await resolveCurrentCompanyForUser(supabase, userId);
  if (!companyId || !company) {
    return {
      ok: false,
      status: "company_missing",
      companyId: null,
      customerId: null,
      subscriptionId: null,
      subscriptionStatus: null,
      plan: null,
      message: "target_company_not_found",
    };
  }

  const stripe = getStripe();
  const existingCustomerId = String(company.stripe_customer_id ?? "").trim();
  const customerIds = new Set<string>();
  if (existingCustomerId) customerIds.add(existingCustomerId);

  if (!existingCustomerId && email) {
    const customers = await stripe.customers.list({ email, limit: 100 });
    for (const customer of customers.data) {
      if (!customer.deleted && String(customer.email ?? "").trim().toLowerCase() === email) {
        customerIds.add(customer.id);
      }
    }
  }

  const candidates: Stripe.Subscription[] = [];
  for (const customerId of customerIds) {
    const subscriptions = await stripe.subscriptions.list({
      customer: customerId,
      status: "all",
      limit: 100,
    });
    candidates.push(...subscriptions.data);
  }

  if (!candidates.length) {
    return {
      ok: true,
      status: "no_subscription",
      companyId,
      customerId: existingCustomerId || (customerIds.size === 1 ? Array.from(customerIds)[0] : null),
      subscriptionId: null,
      subscriptionStatus: null,
      plan: null,
    };
  }

  candidates.sort((a, b) => subscriptionScore(b) - subscriptionScore(a));
  const best = candidates[0];
  const bestScore = subscriptionScore(best);
  const equallyValid = candidates.filter((candidate) => subscriptionScore(candidate) === bestScore);
  if (equallyValid.length > 1 && new Set(equallyValid.map(customerIdOf)).size > 1) {
    return {
      ok: false,
      status: "ambiguous",
      companyId,
      customerId: null,
      subscriptionId: null,
      subscriptionStatus: null,
      plan: null,
      message: "multiple_equally_valid_stripe_subscriptions",
    };
  }

  const customerId = customerIdOf(best);
  const conflict = await supabase
    .from("companies")
    .select("id")
    .eq("stripe_customer_id", customerId)
    .neq("id", companyId)
    .limit(1);
  if (conflict.error) throw new Error(conflict.error.message);
  if ((conflict.data ?? []).length) {
    return {
      ok: false,
      status: "conflict",
      companyId,
      customerId,
      subscriptionId: best.id,
      subscriptionStatus: best.status,
      plan: null,
      message: "stripe_customer_already_linked_to_another_company",
    };
  }

  const item = best.items?.data?.[0] as any;
  const priceId = String(item?.price?.id ?? "").trim() || null;
  const plan = planKeyFromPriceId(priceId);
  const period = currentPeriod(best);
  const patch = {
    stripe_customer_id: customerId,
    stripe_subscription_id: best.id,
    stripe_price_id: priceId,
    subscription_status: String(best.status ?? "").trim() || null,
    subscription_plan: plan,
    cancel_at_period_end: Boolean(best.cancel_at_period_end),
    current_period_start: period.start,
    current_period_end: period.end,
    subscription_updated_at: new Date().toISOString(),
  };
  const updated = await supabase.from("companies").update(patch as any).eq("id", companyId);
  if (updated.error) throw new Error(updated.error.message);

  return {
    ok: true,
    status: "preserved",
    companyId,
    customerId,
    subscriptionId: best.id,
    subscriptionStatus: String(best.status ?? "").trim() || null,
    plan,
  };
}

