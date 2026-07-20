import type { NextRequest } from "next/server";
import type Stripe from "stripe";
import { getSupabaseAdmin } from "./supabaseAdmin";
import { getUserIdFromRequest } from "./requestUserId";
import { getAppUrl, getStripe } from "./stripeServer";

export type PlanKey = "pro_monthly" | "pro_yearly";
export type CheckoutOrigin = "signup" | "settings";

export const LIVE_PRICES: Record<PlanKey, string> = {
  pro_monthly: "price_1RKM5AH2QavNEPHFhH1Ysixv",
  pro_yearly: "price_1RKM5AH2QavNEPHF24jrOXkm",
};

export function getAllowedPriceId(planKey: PlanKey) {
  const env =
    planKey === "pro_monthly"
      ? String(process.env.STRIPE_PRICE_PRO_MONTHLY ?? "").trim()
      : String(process.env.STRIPE_PRICE_PRO_YEARLY ?? "").trim();
  return env || LIVE_PRICES[planKey];
}

export function planKeyFromPriceId(priceId: string | null | undefined): PlanKey | null {
  const v = String(priceId ?? "").trim();
  if (!v) return null;
  if (v === getAllowedPriceId("pro_monthly")) return "pro_monthly";
  if (v === getAllowedPriceId("pro_yearly")) return "pro_yearly";
  if (v === LIVE_PRICES.pro_monthly) return "pro_monthly";
  if (v === LIVE_PRICES.pro_yearly) return "pro_yearly";
  return null;
}

function parsePermissionLevel(v: unknown) {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const n = Number(String(v ?? "").trim());
  return Number.isFinite(n) ? n : 0;
}

function scoreRole(role: unknown) {
  const r = String(role ?? "").trim().toLowerCase();
  if (!r) return 0;
  if (r.includes("owner") || r.includes("propriet")) return 30;
  if (r.includes("admin")) return 20;
  if (r.includes("manager") || r.includes("gerente")) return 10;
  return 0;
}

function pickBestCompanyId(memberRows: unknown[]) {
  let bestCompanyId = "";
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const row of memberRows ?? []) {
    const r = row as any;
    const companyId = String(r?.company_id ?? "").trim();
    if (!companyId) continue;
    const perm = parsePermissionLevel(r?.permission_level);
    const score = perm * 100 + scoreRole(r?.role);
    if (score > bestScore) {
      bestScore = score;
      bestCompanyId = companyId;
    }
  }
  return bestCompanyId;
}

export type BillingCompany = {
  id: string;
  fantasy_name: string | null;
  legal_name: string | null;
  cnpj: string | null;
  email: string | null;
  phone_e164: string | null;
  industry: string | null;
  logo_url: string | null;
  stripe_customer_id?: string | null;
  stripe_subscription_id?: string | null;
  stripe_price_id?: string | null;
  subscription_status?: string | null;
  subscription_plan?: string | null;
  trial_started_at?: string | null;
  trial_ends_at?: string | null;
  current_period_start?: string | null;
  current_period_end?: string | null;
  cancel_at_period_end?: boolean | null;
  subscription_updated_at?: string | null;
  stripe_checkout_session_id?: string | null;
  checkout_status?: string | null;
  checkout_started_at?: string | null;
  checkout_abandoned_at?: string | null;
  checkout_url?: string | null;
  whatsapp_automation_triggered_at?: string | null;
  whatsapp_automation_status?: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toIsoOrNull(value: unknown) {
  const s = String(value ?? "").trim();
  return s ? s : null;
}

export async function requireAuthUserId(req: NextRequest) {
  const { userId } = getUserIdFromRequest(req);
  if (!userId) throw new Error("unauthorized");
  return String(userId).trim();
}

export async function getBillingAccessForCurrentCompany(req: NextRequest) {
  const userId = await requireAuthUserId(req);
  const supabase = getSupabaseAdmin();
  const { companyId, company } = await resolveCurrentCompanyForUser(supabase, userId);
  const access = computeBillingAccess(company);
  return { userId, supabase, companyId, company, access };
}

export async function resolveCurrentCompanyForUser(supabase: ReturnType<typeof getSupabaseAdmin>, userId: string) {
  const { data: memberRows, error: memberError } = await supabase
    .from("company_members")
    .select("company_id,role,permission_level")
    .eq("user_id", userId)
    .limit(50);
  if (memberError) throw new Error(memberError.message);
  const companyId = pickBestCompanyId((memberRows ?? []) as any[]);
  if (!companyId) return { companyId: null as string | null, company: null as BillingCompany | null };

  const selectFull =
    "id,fantasy_name,legal_name,cnpj,email,phone_e164,industry,logo_url," +
    "stripe_customer_id,stripe_subscription_id,stripe_price_id,subscription_status,subscription_plan," +
    "trial_started_at,trial_ends_at,current_period_start,current_period_end,cancel_at_period_end,subscription_updated_at," +
    "stripe_checkout_session_id,checkout_status,checkout_started_at,checkout_abandoned_at,checkout_url," +
    "whatsapp_automation_triggered_at,whatsapp_automation_status";

  const full = await supabase.from("companies").select(selectFull).eq("id", companyId).maybeSingle();
  if (full.error) {
    const minimal = await supabase
      .from("companies")
      .select("id,fantasy_name,legal_name,cnpj,email,phone_e164,industry,logo_url")
      .eq("id", companyId)
      .maybeSingle();
    if (minimal.error) throw new Error(minimal.error.message);
    return { companyId, company: (minimal.data as any) as BillingCompany };
  }

  return { companyId, company: (full.data as any) as BillingCompany };
}

export type BillingAccessReason =
  | "trial_internal"
  | "active"
  | "trialing"
  | "canceling"
  | "past_due"
  | "expired"
  | "payment_required"
  | "legacy_untracked";

export type BillingAccessPayload = {
  allowed: boolean;
  reason: BillingAccessReason;
  trial: { startedAt: string | null; endsAt: string | null; daysRemaining: number | null };
  subscription: { status: string | null; plan: PlanKey | null; priceId: string | null; currentPeriodEnd: string | null; cancelAtPeriodEnd: boolean };
  checkout: { status: string | null; url: string | null };
};

export function computeBillingAccess(company: BillingCompany | null): BillingAccessPayload {
  const nowMs = Date.now();
  const trialStartedAt = toIsoOrNull(company?.trial_started_at);
  const trialEndsAt = toIsoOrNull(company?.trial_ends_at);
  const trialEndsMs = trialEndsAt ? Date.parse(trialEndsAt) : NaN;
  const hasTrial = Boolean(trialStartedAt && trialEndsAt && Number.isFinite(trialEndsMs));
  const daysRemaining =
    hasTrial && Number.isFinite(trialEndsMs)
      ? Math.max(0, Math.ceil((trialEndsMs - nowMs) / (1000 * 60 * 60 * 24)))
      : null;

  const status = String(company?.subscription_status ?? "").trim() || null;
  const priceId = String(company?.stripe_price_id ?? "").trim() || null;
  const plan = planKeyFromPriceId(priceId);
  const currentPeriodEnd = toIsoOrNull(company?.current_period_end);
  const currentPeriodEndMs = currentPeriodEnd ? Date.parse(currentPeriodEnd) : NaN;
  const cancelAtPeriodEnd = Boolean(company?.cancel_at_period_end);
  const periodActive = currentPeriodEnd && Number.isFinite(currentPeriodEndMs) ? nowMs < currentPeriodEndMs : false;

  const checkoutStatus = String(company?.checkout_status ?? "").trim() || null;
  const checkoutUrl = String(company?.checkout_url ?? "").trim() || null;

  if (!hasTrial && !status) {
    return {
      allowed: true,
      reason: "legacy_untracked",
      trial: { startedAt: trialStartedAt, endsAt: trialEndsAt, daysRemaining },
      subscription: { status, plan, priceId, currentPeriodEnd, cancelAtPeriodEnd },
      checkout: { status: checkoutStatus, url: checkoutUrl },
    };
  }

  if (hasTrial && trialEndsMs > nowMs) {
    return {
      allowed: true,
      reason: "trial_internal",
      trial: { startedAt: trialStartedAt, endsAt: trialEndsAt, daysRemaining },
      subscription: { status, plan, priceId, currentPeriodEnd, cancelAtPeriodEnd },
      checkout: { status: checkoutStatus, url: checkoutUrl },
    };
  }

  const statusLower = String(status ?? "").toLowerCase();
  if (cancelAtPeriodEnd && periodActive) {
    return {
      allowed: true,
      reason: "canceling",
      trial: { startedAt: trialStartedAt, endsAt: trialEndsAt, daysRemaining },
      subscription: { status, plan, priceId, currentPeriodEnd, cancelAtPeriodEnd },
      checkout: { status: checkoutStatus, url: checkoutUrl },
    };
  }
  if (statusLower === "active") {
    return {
      allowed: true,
      reason: "active",
      trial: { startedAt: trialStartedAt, endsAt: trialEndsAt, daysRemaining },
      subscription: { status, plan, priceId, currentPeriodEnd, cancelAtPeriodEnd },
      checkout: { status: checkoutStatus, url: checkoutUrl },
    };
  }
  if (statusLower === "trialing") {
    return {
      allowed: true,
      reason: "trialing",
      trial: { startedAt: trialStartedAt, endsAt: trialEndsAt, daysRemaining },
      subscription: { status, plan, priceId, currentPeriodEnd, cancelAtPeriodEnd },
      checkout: { status: checkoutStatus, url: checkoutUrl },
    };
  }
  if (statusLower === "past_due") {
    return {
      allowed: true,
      reason: "past_due",
      trial: { startedAt: trialStartedAt, endsAt: trialEndsAt, daysRemaining },
      subscription: { status, plan, priceId, currentPeriodEnd, cancelAtPeriodEnd },
      checkout: { status: checkoutStatus, url: checkoutUrl },
    };
  }

  return {
    allowed: false,
    reason: hasTrial ? "expired" : "payment_required",
    trial: { startedAt: trialStartedAt, endsAt: trialEndsAt, daysRemaining },
    subscription: { status, plan, priceId, currentPeriodEnd, cancelAtPeriodEnd },
    checkout: { status: checkoutStatus, url: checkoutUrl },
  };
}

export function isSubscriptionBlockingNewCheckout(company: BillingCompany | null) {
  const status = String(company?.subscription_status ?? "").trim().toLowerCase();
  if (!status) return false;
  if (status === "active" || status === "trialing" || status === "past_due") return true;
  const cancelAtPeriodEnd = Boolean(company?.cancel_at_period_end);
  if (!cancelAtPeriodEnd) return false;
  const cpe = String(company?.current_period_end ?? "").trim();
  if (!cpe) return false;
  const ms = Date.parse(cpe);
  return Number.isFinite(ms) ? Date.now() < ms : false;
}

export async function ensureStripeCustomerId(params: {
  supabase: ReturnType<typeof getSupabaseAdmin>;
  stripe: Stripe;
  company: BillingCompany;
  companyId: string;
  userId: string;
}) {
  const { supabase, stripe, company, companyId, userId } = params;
  const existing = String(company.stripe_customer_id ?? "").trim();
  if (existing) return existing;

  let userEmail: string | undefined = undefined;
  try {
    const u = await supabase.auth.admin.getUserById(userId);
    const email = String(u.data?.user?.email ?? "").trim();
    if (email) userEmail = email;
  } catch {}

  const name = String(company.fantasy_name ?? company.legal_name ?? "").trim() || undefined;
  const email = userEmail || String(company.email ?? "").trim() || undefined;
  const phone = String(company.phone_e164 ?? "").trim() || undefined;

  const created = await stripe.customers.create(
    {
      name,
      email,
      phone,
      metadata: { company_id: companyId, user_id: userId, environment: "live" },
    },
    { idempotencyKey: `customer:create:${companyId}` },
  );

  const patch = { stripe_customer_id: created.id, subscription_updated_at: new Date().toISOString() } as any;
  await supabase.from("companies").update(patch).eq("id", companyId);
  return created.id;
}

export async function createOrReuseCheckoutUrl(params: {
  supabase: ReturnType<typeof getSupabaseAdmin>;
  company: BillingCompany;
  companyId: string;
  userId: string;
  planKey: PlanKey;
  origin: CheckoutOrigin;
}) {
  const { supabase, company, companyId, userId, planKey, origin } = params;

  const checkoutUrl = String(company.checkout_url ?? "").trim();
  const startedAt = String(company.checkout_started_at ?? "").trim();
  const startedMs = startedAt ? Date.parse(startedAt) : NaN;
  if (checkoutUrl && startedAt && Number.isFinite(startedMs) && Date.now() - startedMs < 30 * 60 * 1000) {
    const status = String(company.checkout_status ?? "").trim().toLowerCase();
    if (status === "open" || !status) return checkoutUrl;
  }

  const stripe = getStripe();
  const customerId = await ensureStripeCustomerId({ supabase, stripe, company, companyId, userId });
  const priceId = getAllowedPriceId(planKey);

  const appUrl = getAppUrl();
  const returnUrl = `${appUrl}/billing/return`;
  const successUrl = `${returnUrl}?checkout=success&origin=${origin}&session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = `${returnUrl}?checkout=cancel&origin=${origin}`;

  const bucket = Math.floor(Date.now() / (30 * 60 * 1000));
  const idempotencyKey = `checkout:create:${companyId}:${planKey}:${bucket}`;

  const session = await stripe.checkout.sessions.create(
    {
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      allow_promotion_codes: false,
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: { company_id: companyId, user_id: userId, plan_key: planKey, origin, environment: "live" },
      subscription_data: {
        metadata: { company_id: companyId, user_id: userId, plan_key: planKey, origin, environment: "live" },
      },
    },
    { idempotencyKey },
  );

  const url = String(session.url ?? "").trim();
  if (!url) throw new Error("checkout_url_missing");

  const patch = {
    stripe_customer_id: customerId,
    stripe_checkout_session_id: session.id,
    checkout_status: "open",
    checkout_started_at: new Date().toISOString(),
    checkout_url: url,
    stripe_price_id: priceId,
    subscription_plan: planKey,
    subscription_updated_at: new Date().toISOString(),
  } as any;
  await supabase.from("companies").update(patch).eq("id", companyId);

  return url;
}

export async function updateCompanyFromSubscription(params: {
  supabase: ReturnType<typeof getSupabaseAdmin>;
  customerId: string;
  subscription: Stripe.Subscription;
}) {
  const { supabase, customerId, subscription } = params;
  const item = subscription.items?.data?.[0] as any;
  const priceId = (() => {
    return String(item?.price?.id ?? "").trim() || null;
  })();
  const planKey = planKeyFromPriceId(priceId);

  const existing = await supabase
    .from("companies")
    .select("id,current_period_end")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();
  if (existing.error) throw new Error(existing.error.message);
  const companyId = String((existing.data as any)?.id ?? "").trim() || null;
  if (!companyId) return;
  const existingCpeIso = String((existing.data as any)?.current_period_end ?? "").trim() || null;
  const existingCpeMs = existingCpeIso ? Date.parse(existingCpeIso) : NaN;
  const cpe = typeof (subscription as any)?.current_period_end === "number" ? (subscription as any).current_period_end : null;
  const cps = typeof (subscription as any)?.current_period_start === "number" ? (subscription as any).current_period_start : null;
  const fallbackCpe = typeof item?.current_period_end === "number" ? item.current_period_end : null;
  const fallbackCps = typeof item?.current_period_start === "number" ? item.current_period_start : null;
  const chosenCpe = cpe ?? fallbackCpe;
  const chosenCps = cps ?? fallbackCps;
  const newCpeIso = chosenCpe ? new Date(chosenCpe * 1000).toISOString() : null;
  const newCpeMs = newCpeIso ? Date.parse(newCpeIso) : NaN;
  if (Number.isFinite(existingCpeMs) && Number.isFinite(newCpeMs) && newCpeMs < existingCpeMs) return;

  const patch = {
    stripe_customer_id: customerId,
    stripe_subscription_id: subscription.id,
    stripe_price_id: priceId,
    subscription_plan: planKey,
    subscription_status: String(subscription.status ?? "").trim() || null,
    cancel_at_period_end: Boolean(subscription.cancel_at_period_end),
    current_period_start: chosenCps ? new Date(chosenCps * 1000).toISOString() : null,
    current_period_end: newCpeIso,
    subscription_updated_at: new Date().toISOString(),
  } as any;

  await supabase.from("companies").update(patch).eq("id", companyId);
}
