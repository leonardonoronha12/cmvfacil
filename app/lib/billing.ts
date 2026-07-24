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
  checkout_plan?: string | null;
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

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function findAuthUserIdByEmail(supabase: ReturnType<typeof getSupabaseAdmin>, email: string) {
  const target = email.trim().toLowerCase();
  for (let page = 1; page <= 2000; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(error.message);
    const users = (data?.users ?? []) as any[];
    for (const u of users) {
      const id = String(u?.id ?? "").trim();
      const em = String(u?.email ?? "").trim().toLowerCase();
      if (id && em === target) return id;
    }
    if (users.length < 1000) break;
  }
  return null;
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
  const rawUserId = String(userId ?? "").trim();
  let effectiveUserId = rawUserId;
  let emailForFallback = "";
  let bubbleUserIdsForFallback: string[] = [];
  let bubbleCompanyIdsForFallback: string[] = [];

  if (!isUuid(effectiveUserId) && effectiveUserId.includes("@")) {
    const email = effectiveUserId.trim().toLowerCase();
    emailForFallback = email;
    const profile = await supabase.from("user_profiles").select("user_id").ilike("email", email).maybeSingle();
    const mapped = String((profile.data as any)?.user_id ?? "").trim();
    if (mapped && isUuid(mapped)) effectiveUserId = mapped;
  }

  if (isUuid(effectiveUserId)) {
    try {
      const authUser = await supabase.auth.admin.getUserById(effectiveUserId);
      const email = String(authUser.data?.user?.email ?? "")
        .trim()
        .toLowerCase();
      if (email) emailForFallback = email;
    } catch {}
  }

  try {
    const mappedRows = isUuid(effectiveUserId)
      ? await supabase.from("bubble_obj_user_map").select("bubble_user_id").eq("supabase_user_id", effectiveUserId).limit(20)
      : emailForFallback
        ? await supabase.from("bubble_obj_user_map").select("bubble_user_id,supabase_user_id").ilike("email", emailForFallback).limit(20)
        : { data: [] as any[], error: null as any };
    const rows = (mappedRows as any)?.data ?? [];
    const ids = rows.map((r: any) => String(r?.bubble_user_id ?? "").trim()).filter(Boolean);
    bubbleUserIdsForFallback = Array.from(new Set(ids));
    if (!isUuid(effectiveUserId) && rows.length) {
      const mappedUid = String(rows[0]?.supabase_user_id ?? "").trim();
      if (mappedUid && isUuid(mappedUid)) effectiveUserId = mappedUid;
    }
  } catch {}

  if (!isUuid(effectiveUserId) && emailForFallback) {
    try {
      const mappedUid = await findAuthUserIdByEmail(supabase, emailForFallback);
      if (mappedUid && isUuid(mappedUid)) effectiveUserId = mappedUid;
    } catch {}
  }

  if (isUuid(effectiveUserId)) {
    try {
      const profile = await supabase.from("user_profiles").select("bubble_user_id,empresa_id").eq("user_id", effectiveUserId).maybeSingle();
      const bubbleUserId = String((profile.data as any)?.bubble_user_id ?? "").trim();
      if (bubbleUserId) bubbleUserIdsForFallback = Array.from(new Set([...bubbleUserIdsForFallback, bubbleUserId]));
      const empresaId = String((profile.data as any)?.empresa_id ?? "").trim();
      if (empresaId) bubbleCompanyIdsForFallback = Array.from(new Set([...bubbleCompanyIdsForFallback, empresaId]));
    } catch {}
  }

  const { data: memberRows, error: memberError } = await supabase
    .from("company_members")
    .select("company_id,role,permission_level")
    .eq("user_id", effectiveUserId)
    .limit(50);
  if (memberError) throw new Error(memberError.message);
  let resolvedMemberRows = (memberRows ?? []) as any[];
  if ((!resolvedMemberRows || !resolvedMemberRows.length) && bubbleUserIdsForFallback.length) {
    const fallback = await supabase.from("company_members").select("company_id,role,permission_level").in("bubble_user_id", bubbleUserIdsForFallback).limit(50);
    resolvedMemberRows = (fallback.data ?? []) as any[];
  }

  let companyId = pickBestCompanyId(resolvedMemberRows);
  if (!companyId && isUuid(effectiveUserId)) {
    for (const col of [
      "created_by_user_id",
      "created_by",
      "owner_user_id",
      "supabase_user_id",
      "user_id",
      "admin_user_id",
      "proprietario_user_id",
      "created_by_supabase_user_id",
    ]) {
      try {
        const byOwner = await (supabase.from("companies") as any).select("id").eq(col, effectiveUserId).limit(1).maybeSingle();
        if (!byOwner.error) {
          companyId = String((byOwner.data as any)?.id ?? "").trim();
          if (companyId) break;
        }
      } catch {}
    }
  }
  if (!companyId && isUuid(effectiveUserId)) {
    try {
      const byBubbleObj = await supabase
        .from("bubble_obj_empresa")
        .select("bubble_unique_id,updated_at,created_at")
        .eq("supabase_user_id", effectiveUserId)
        .order("updated_at", { ascending: false })
        .limit(10);
      if (!byBubbleObj.error) {
        const bubbleIds = ((byBubbleObj.data ?? []) as any[]).map((r: any) => String(r?.bubble_unique_id ?? "").trim()).filter(Boolean);
        bubbleCompanyIdsForFallback = Array.from(new Set([...bubbleCompanyIdsForFallback, ...bubbleIds]));
      }
    } catch {}
  }
  if (!companyId && bubbleUserIdsForFallback.length) {
    try {
      const byBubbleObj = await supabase.from("bubble_obj_empresa").select("bubble_unique_id").in("bubble_user_id", bubbleUserIdsForFallback).limit(10);
      if (!byBubbleObj.error) {
        const bubbleIds = ((byBubbleObj.data ?? []) as any[]).map((r: any) => String(r?.bubble_unique_id ?? "").trim()).filter(Boolean);
        bubbleCompanyIdsForFallback = Array.from(new Set([...bubbleCompanyIdsForFallback, ...bubbleIds]));
      }
    } catch {}
  }
  if (!companyId && bubbleCompanyIdsForFallback.length) {
    for (const col of ["bubble_id", "bubble_unique_id", "bubble_company_id", "bubble_empresa_id", "empresa_bubble_id", "company_bubble_id"]) {
      try {
        const byCompanyBubbleId = await (supabase.from("companies") as any).select("id").in(col, bubbleCompanyIdsForFallback).limit(1).maybeSingle();
        if (!byCompanyBubbleId.error) {
          companyId = String((byCompanyBubbleId.data as any)?.id ?? "").trim();
          if (companyId) break;
        }
      } catch {}
    }
  }
  if (!companyId && emailForFallback) {
    const fallback = await supabase.from("companies").select("id").ilike("email", emailForFallback).limit(1).maybeSingle();
    if (!fallback.error) companyId = String((fallback.data as any)?.id ?? "").trim();
  }
  if (companyId && isUuid(effectiveUserId) && (!resolvedMemberRows || !resolvedMemberRows.length)) {
    const bubbleUserId = bubbleUserIdsForFallback.length ? bubbleUserIdsForFallback[0] : "";
    await supabase
      .from("company_members")
      .upsert({ company_id: companyId, user_id: effectiveUserId, role: "owner", permission_level: "3", bubble_user_id: bubbleUserId } as any, {
        onConflict: "company_id,user_id",
      });
  }
  if (!companyId) return { companyId: null as string | null, company: null as BillingCompany | null };

  const selectFull =
    "id,fantasy_name,legal_name,cnpj,email,phone_e164,industry,logo_url," +
    "stripe_customer_id,stripe_subscription_id,stripe_price_id,subscription_status,subscription_plan," +
    "trial_started_at,trial_ends_at,current_period_start,current_period_end,cancel_at_period_end,subscription_updated_at," +
    "stripe_checkout_session_id,checkout_status,checkout_started_at,checkout_abandoned_at,checkout_url,checkout_plan," +
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
  checkout: { status: string | null; url: string | null; plan: PlanKey | null };
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
  const statusLower = String(status ?? "").toLowerCase();
  const hideTrial =
    (cancelAtPeriodEnd && periodActive) ||
    statusLower === "active" ||
    statusLower === "trialing" ||
    statusLower === "past_due" ||
    statusLower === "unpaid";
  const trialOut = hideTrial ? { startedAt: null, endsAt: null, daysRemaining: null } : { startedAt: trialStartedAt, endsAt: trialEndsAt, daysRemaining };

  const checkoutStatus = String(company?.checkout_status ?? "").trim() || null;
  const checkoutUrl = String(company?.checkout_url ?? "").trim() || null;
  const checkoutPlanRaw = String((company as any)?.checkout_plan ?? "").trim();
  const checkoutPlan = checkoutPlanRaw === "pro_monthly" ? "pro_monthly" : checkoutPlanRaw === "pro_yearly" ? "pro_yearly" : null;

  if (!hasTrial && !status) {
    return {
      allowed: true,
      reason: "legacy_untracked",
      trial: trialOut,
      subscription: { status, plan, priceId, currentPeriodEnd, cancelAtPeriodEnd },
      checkout: { status: checkoutStatus, url: checkoutUrl, plan: checkoutPlan },
    };
  }

  if (cancelAtPeriodEnd && periodActive) {
    return {
      allowed: true,
      reason: "canceling",
      trial: trialOut,
      subscription: { status, plan, priceId, currentPeriodEnd, cancelAtPeriodEnd },
      checkout: { status: checkoutStatus, url: checkoutUrl, plan: checkoutPlan },
    };
  }
  if (statusLower === "active") {
    return {
      allowed: true,
      reason: "active",
      trial: trialOut,
      subscription: { status, plan, priceId, currentPeriodEnd, cancelAtPeriodEnd },
      checkout: { status: checkoutStatus, url: checkoutUrl, plan: checkoutPlan },
    };
  }
  if (statusLower === "trialing") {
    return {
      allowed: true,
      reason: "trialing",
      trial: trialOut,
      subscription: { status, plan, priceId, currentPeriodEnd, cancelAtPeriodEnd },
      checkout: { status: checkoutStatus, url: checkoutUrl, plan: checkoutPlan },
    };
  }
  if (statusLower === "past_due") {
    return {
      allowed: true,
      reason: "past_due",
      trial: trialOut,
      subscription: { status, plan, priceId, currentPeriodEnd, cancelAtPeriodEnd },
      checkout: { status: checkoutStatus, url: checkoutUrl, plan: checkoutPlan },
    };
  }

  if (hasTrial && trialEndsMs > nowMs) {
    return {
      allowed: true,
      reason: "trial_internal",
      trial: { startedAt: trialStartedAt, endsAt: trialEndsAt, daysRemaining },
      subscription: { status, plan, priceId, currentPeriodEnd, cancelAtPeriodEnd },
      checkout: { status: checkoutStatus, url: checkoutUrl, plan: checkoutPlan },
    };
  }

  return {
    allowed: false,
    reason: hasTrial ? "expired" : "payment_required",
    trial: { startedAt: trialStartedAt, endsAt: trialEndsAt, daysRemaining },
    subscription: { status, plan, priceId, currentPeriodEnd, cancelAtPeriodEnd },
    checkout: { status: checkoutStatus, url: checkoutUrl, plan: checkoutPlan },
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
  appUrl?: string;
}) {
  const { supabase, company, companyId, userId, planKey, origin } = params;

  const checkoutUrl = String(company.checkout_url ?? "").trim();
  const startedAt = String(company.checkout_started_at ?? "").trim();
  const startedMs = startedAt ? Date.parse(startedAt) : NaN;
  if (origin !== "signup" && checkoutUrl && startedAt && Number.isFinite(startedMs) && Date.now() - startedMs < 30 * 60 * 1000) {
    const status = String(company.checkout_status ?? "").trim().toLowerCase();
    if (status === "open" || !status) return checkoutUrl;
  }

  const stripe = getStripe();
  const customerId = await ensureStripeCustomerId({ supabase, stripe, company, companyId, userId });
  const priceId = getAllowedPriceId(planKey);

  const appUrl = String(params.appUrl ?? "").trim() || getAppUrl();
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
    checkout_plan: planKey,
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
