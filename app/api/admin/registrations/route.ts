import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin";
import { requireSystemAdmin } from "../../../lib/systemAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Company = { id: string; name: string; stripeSubscriptionId: string | null; subscriptionStatus: string | null };

async function listAuthUsers(db: ReturnType<typeof getSupabaseAdmin>) {
  const users: Array<Record<string, string | null>> = [];
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    for (const user of data.users) {
      users.push({ id: user.id, email: user.email ?? null, created_at: user.created_at ?? null, last_sign_in_at: user.last_sign_in_at ?? null, banned_until: String((user as any).banned_until || "") || null });
    }
    if (data.users.length < 1000) break;
  }
  return users;
}

function billingWasMigrated(row: any) {
  const billing = row?.validation_report?.billing;
  return Boolean(row?.validation_status === "validated" && billing?.ok && billing?.status === "preserved" && billing?.subscriptionId);
}

export async function GET(req: NextRequest) {
  try {
    const auth = await requireSystemAdmin(req);
    if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
    const db = getSupabaseAdmin();
    const [authUsers, mapResult, migrationsResult, companiesResult, membersResult] = await Promise.all([
      listAuthUsers(db),
      db.from("bubble_obj_user_map").select("bubble_user_id,email,nome,supabase_user_id"),
      db.from("bubble_obj_user_migration").select("email,supabase_user_id,status,validation_status,validation_report"),
      db.from("companies").select("id,fantasy_name,email,stripe_subscription_id,subscription_status"),
      db.from("company_members").select("user_id,company_id"),
    ]);
    if (mapResult.error) throw mapResult.error;
    if (migrationsResult.error) throw migrationsResult.error;

    const companies = companiesResult.data ?? [];
    const companyById = new Map<string, Company>(companies.map((company: any) => [String(company.id), {
      id: String(company.id),
      name: String(company.fantasy_name || "Sem nome"),
      stripeSubscriptionId: String(company.stripe_subscription_id || "").trim() || null,
      subscriptionStatus: String(company.subscription_status || "").trim() || null,
    }]));
    const companiesByUser = new Map<string, Company[]>();
    for (const member of membersResult.data ?? []) {
      const company = companyById.get(String((member as any).company_id));
      if (!company) continue;
      const userId = String((member as any).user_id);
      companiesByUser.set(userId, [...(companiesByUser.get(userId) ?? []), company]);
    }
    const companiesByEmail = new Map<string, Company[]>(companies.filter((company: any) => company.email).map((company: any) => [String(company.email).trim().toLowerCase(), [companyById.get(String(company.id))!]]));
    const migrationByEmail = new Map<string, any>();
    for (const row of migrationsResult.data ?? []) {
      const email = String((row as any).email || "").trim().toLowerCase();
      if (email) migrationByEmail.set(email, row);
    }

    const seen = new Set<string>();
    const legacyUsers = [];
    for (const row of [...(mapResult.data ?? []), ...(migrationsResult.data ?? [])]) {
      const email = String((row as any).email || "").trim().toLowerCase();
      if (!email || seen.has(email)) continue;
      seen.add(email);
      const migration = migrationByEmail.get(email);
      const userId = String(migration?.supabase_user_id || (row as any).supabase_user_id || "");
      const userCompanies = companiesByUser.get(userId) ?? companiesByEmail.get(email) ?? [];
      const hasLinkedStripeSubscription = userCompanies.some(company => Boolean(company.stripeSubscriptionId));
      legacyUsers.push({
        email,
        authUserId: userId || null,
        companies: userCompanies.map(({ id, name }) => ({ id, name })),
        companiesCount: userCompanies.length,
        subscriptionMigrated: billingWasMigrated(migration) || hasLinkedStripeSubscription,
        migrationStatus: String(migration?.validation_status || migration?.status || ""),
      });
    }
    return NextResponse.json({ ok: true, authUsers, legacyUsers }, { headers: { "cache-control": "private, max-age=30, stale-while-revalidate=120" } });
  } catch (error) {
    return NextResponse.json({ ok: false, error: "registrations_load_failed", detail: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
