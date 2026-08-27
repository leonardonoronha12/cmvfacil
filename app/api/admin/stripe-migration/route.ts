import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { requireSystemAdmin } from "../../../lib/systemAdmin";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin";
import { planKeyFromPriceId } from "../../../lib/billing";
import { getStripe } from "../../../lib/stripeServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ELIGIBLE_STATUSES = new Set(["active", "trialing", "past_due"]);
const clean = (value: unknown) => String(value ?? "").trim();
const emailKey = (value: unknown) => clean(value).toLowerCase();
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });

function customerFrom(subscription: Stripe.Subscription) {
  return typeof subscription.customer === "string" ? null : subscription.customer;
}

function customerEmail(customer: Stripe.Customer | Stripe.DeletedCustomer | null) {
  return customer && !("deleted" in customer) ? emailKey(customer.email) : "";
}

function subscriptionPeriod(subscription: Stripe.Subscription) {
  const item = subscription.items?.data?.[0] as any;
  const start = Number((subscription as any).current_period_start ?? item?.current_period_start ?? 0);
  const end = Number((subscription as any).current_period_end ?? item?.current_period_end ?? 0);
  return {
    start: start > 0 ? new Date(start * 1000).toISOString() : null,
    end: end > 0 ? new Date(end * 1000).toISOString() : null,
  };
}

async function companyCandidatesByEmail(db: ReturnType<typeof getSupabaseAdmin>) {
  const [companiesResult, membersResult] = await Promise.all([
    db.from("companies").select("id,fantasy_name,email,stripe_customer_id,stripe_subscription_id,subscription_status"),
    db.from("company_members").select("user_id,company_id"),
  ]);
  if (companiesResult.error) throw companiesResult.error;
  if (membersResult.error) throw membersResult.error;

  const companies = companiesResult.data ?? [];
  const companyById = new Map(companies.map((row: any) => [String(row.id), row]));
  const companyIdsByUser = new Map<string, Set<string>>();
  for (const member of membersResult.data ?? []) {
    const userId = String((member as any).user_id);
    const companyId = String((member as any).company_id);
    const set = companyIdsByUser.get(userId) ?? new Set<string>();
    set.add(companyId);
    companyIdsByUser.set(userId, set);
  }

  const userByEmail = new Map<string, string>();
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    for (const user of data.users) {
      const email = emailKey(user.email);
      if (email) userByEmail.set(email, user.id);
    }
    if (data.users.length < 1000) break;
  }

  return (email: string) => {
    const ids = new Set<string>();
    for (const company of companies) if (emailKey((company as any).email) === email) ids.add(String((company as any).id));
    const userId = userByEmail.get(email);
    if (userId) for (const companyId of companyIdsByUser.get(userId) ?? []) ids.add(companyId);
    return [...ids].map(id => companyById.get(id)).filter(Boolean) as any[];
  };
}

async function migratedEmails(db: ReturnType<typeof getSupabaseAdmin>) {
  const { data, error } = await db.from("subscription_migration_registry").select("email");
  if (error) throw error;
  return new Set((data ?? []).map((row: any) => emailKey(row.email)).filter(Boolean));
}

export async function GET(req: NextRequest) {
  const auth = await requireSystemAdmin(req);
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);
  try {
    const url = new URL(req.url);
    const startingAfter = clean(url.searchParams.get("starting_after"));
    const stripe = getStripe();
    const db = getSupabaseAdmin();
    const [page, findCompanies, migrated] = await Promise.all([
      stripe.subscriptions.list({ status: "all", limit: 100, ...(startingAfter ? { starting_after: startingAfter } : {}), expand: ["data.customer"] }),
      companyCandidatesByEmail(db),
      migratedEmails(db),
    ]);

    const rows = page.data.map(subscription => {
      const customer = customerFrom(subscription);
      const email = customerEmail(customer);
      const item = subscription.items?.data?.[0] as any;
      const priceId = clean(item?.price?.id);
      const plan = planKeyFromPriceId(priceId);
      const companies = email ? findCompanies(email) : [];
      const exactCompany = companies.length === 1 ? companies[0] : null;
      const existingSubscriptionId = clean(exactCompany?.stripe_subscription_id);
      let reason = "ready";
      if (!email) reason = "missing_customer_email";
      else if (!ELIGIBLE_STATUSES.has(subscription.status)) reason = "inactive_subscription";
      else if (!plan) reason = "unknown_price";
      else if (!companies.length) reason = "missing_company";
      else if (companies.length > 1) reason = "ambiguous_company";
      else if (existingSubscriptionId && existingSubscriptionId !== subscription.id) reason = "different_subscription_linked";
      else if (migrated.has(email) && existingSubscriptionId === subscription.id) reason = "already_migrated";
      return {
        email,
        customerId: clean(customer?.id ?? subscription.customer),
        subscriptionId: subscription.id,
        subscriptionStatus: subscription.status,
        priceId,
        plan,
        companyId: exactCompany ? String(exactCompany.id) : null,
        companyName: exactCompany ? clean(exactCompany.fantasy_name) : "",
        companyCandidates: companies.map(company => ({ id: String(company.id), name: clean(company.fantasy_name) })),
        migrated: migrated.has(email),
        reason,
        eligible: reason === "ready",
      };
    });
    return json({ ok: true, rows, hasMore: page.has_more, nextCursor: page.has_more ? page.data.at(-1)?.id ?? null : null });
  } catch (error) {
    return json({ ok: false, error: "stripe_migration_scan_failed", detail: error instanceof Error ? error.message : String(error) }, 500);
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireSystemAdmin(req);
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);
  try {
    const body = await req.json();
    const email = emailKey(body?.email);
    const companyId = clean(body?.companyId);
    const subscriptionId = clean(body?.subscriptionId);
    if (!email || !companyId || !subscriptionId) return json({ ok: false, error: "missing_fields" }, 400);

    const stripe = getStripe();
    const db = getSupabaseAdmin();
    const subscription = await stripe.subscriptions.retrieve(subscriptionId, { expand: ["customer"] });
    const customer = customerFrom(subscription);
    const stripeEmail = customerEmail(customer);
    if (stripeEmail !== email) return json({ ok: false, error: "stripe_email_mismatch" }, 409);
    if (!ELIGIBLE_STATUSES.has(subscription.status)) return json({ ok: false, error: "inactive_subscription" }, 409);
    const item = subscription.items?.data?.[0] as any;
    const priceId = clean(item?.price?.id);
    const plan = planKeyFromPriceId(priceId);
    if (!plan) return json({ ok: false, error: "unknown_price" }, 409);

    const findCompanies = await companyCandidatesByEmail(db);
    const candidates = findCompanies(email);
    if (candidates.length !== 1 || String(candidates[0].id) !== companyId) return json({ ok: false, error: "company_match_changed" }, 409);
    const company = candidates[0];
    const linkedSubscription = clean(company.stripe_subscription_id);
    if (linkedSubscription && linkedSubscription !== subscription.id) return json({ ok: false, error: "different_subscription_linked" }, 409);

    const period = subscriptionPeriod(subscription);
    const patch = {
      stripe_customer_id: clean(customer?.id ?? subscription.customer),
      stripe_subscription_id: subscription.id,
      stripe_price_id: priceId,
      subscription_plan: plan,
      subscription_status: subscription.status,
      cancel_at_period_end: Boolean(subscription.cancel_at_period_end),
      current_period_start: period.start,
      current_period_end: period.end,
      subscription_updated_at: new Date().toISOString(),
    };
    const updated = await db.from("companies").update(patch).eq("id", companyId).select("id").single();
    if (updated.error) throw updated.error;

    const existing = await db.from("subscription_migration_registry").select("id").ilike("email", email).maybeSingle();
    if (existing.error) throw existing.error;
    const registryPatch = { email, source: "stripe_reconciliation", migrated_at: new Date().toISOString(), notes: `Stripe ${subscription.id} reconciliada automaticamente com a empresa ${companyId}` };
    const registry = existing.data
      ? await db.from("subscription_migration_registry").update(registryPatch).eq("id", (existing.data as any).id)
      : await db.from("subscription_migration_registry").insert(registryPatch);
    if (registry.error) throw registry.error;

    return json({ ok: true, email, companyId, subscriptionId, plan, status: subscription.status });
  } catch (error) {
    return json({ ok: false, error: "stripe_migration_apply_failed", detail: error instanceof Error ? error.message : String(error) }, 500);
  }
}
