import { NextRequest, NextResponse } from "next/server";
import { getUserIdFromRequest } from "../../../../lib/requestUserId";
import { getSupabaseAdmin } from "../../../../lib/supabaseAdmin";
import { isLocalDevRequest } from "../../../../lib/localDevRequest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return NextResponse.json(data, { ...init, headers });
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function parseCsvEnv(value: string | undefined) {
  return String(value ?? "")
    .split(/[,\n;]/g)
    .map((x) => x.trim())
    .filter(Boolean);
}

function isAdminUserId(userId: string) {
  const ids = new Set(parseCsvEnv(process.env.ADMIN_USER_IDS).map((x) => x.toLowerCase()));
  const emails = new Set(
    [...parseCsvEnv(process.env.ADMIN_USER_EMAILS), ...parseCsvEnv(process.env.ADMIN_EMAILS), ...parseCsvEnv(process.env.ADMIN_EMAILS_LEGACY)].map((x) => x.toLowerCase()),
  );
  const raw = userId.toLowerCase();
  if (!isUuid(userId) && raw.includes("@") && process.env.ADMIN_SECRET) return true;
  if (ids.size && ids.has(raw)) return true;
  if (emails.size && emails.has(raw)) return true;
  return false;
}

async function getUserEmailFromDb(supabase: ReturnType<typeof getSupabaseAdmin>, userId: string) {
  if (!isUuid(userId)) return null;
  const { data, error } = await supabase.from("user_profiles").select("email").eq("user_id", userId).maybeSingle();
  if (error) return null;
  const email = String((data as any)?.email ?? "").trim().toLowerCase();
  return email && email.includes("@") ? email : null;
}

async function isAdminRequester(supabase: ReturnType<typeof getSupabaseAdmin>, requesterUserId: string) {
  if (isAdminUserId(requesterUserId)) return true;
  const requesterEmail = await getUserEmailFromDb(supabase, requesterUserId);
  if (!requesterEmail) return false;
  const allow = new Set(
    [...parseCsvEnv(process.env.ADMIN_USER_EMAILS), ...parseCsvEnv(process.env.ADMIN_EMAILS), ...parseCsvEnv(process.env.ADMIN_EMAILS_LEGACY)].map((x) => x.toLowerCase()),
  );
  return allow.has(requesterEmail);
}

function safeEmail(input: unknown) {
  const v = String(input ?? "").trim().toLowerCase();
  if (!v || !v.includes("@")) return "";
  return v;
}

export async function POST(req: NextRequest) {
  try {
    const isLocalDev = isLocalDevRequest(req);
    const { userId } = getUserIdFromRequest(req);
    if (!userId && !isLocalDev) return json({ ok: false, error: "unauthorized" }, { status: 401 });

    const body = (await req.json().catch(() => null)) as any;
    const email = safeEmail(body?.email);
    const companyId = String(body?.companyId ?? "").trim();
    if (!email) return json({ ok: false, error: "invalid_email" }, { status: 400 });
    if (!companyId) return json({ ok: false, error: "missing_company_id" }, { status: 400 });

    let supabase: ReturnType<typeof getSupabaseAdmin>;
    try {
      supabase = getSupabaseAdmin();
    } catch {
      return json({ ok: false, error: "supabase_not_configured" }, { status: 500 });
    }

    const requesterId = String(userId ?? "").trim();
    const requesterEmail = await getUserEmailFromDb(supabase, requesterId);
    const selfOk = isUuid(requesterId) && requesterEmail === email;
    const adminOk = isLocalDev ? true : await isAdminRequester(supabase, requesterId);
    if (!selfOk && !adminOk) return json({ ok: false, error: "forbidden" }, { status: 403 });

    const expectedByTable = (body?.expectedByTable && typeof body.expectedByTable === "object" ? (body.expectedByTable as any) : null) as
      | Record<string, number>
      | null;

    const tables = [
      "companies",
      "categories",
      "items",
      "suppliers",
      "labels",
      "invoices",
      "invoice_items",
      "inventories",
      "inventory_items",
      "waste_reasons",
      "wastes",
      "recipe_ingredients",
      "avg_cost_events",
    ];

    const counts: Record<string, number> = {};
    const perTable: Record<
      string,
      {
        count: number;
        expected: number | null;
        mismatch: boolean;
        missingBubbleIds: number;
        duplicateBubbleIds: Array<{ bubble_id: string; count: number }>;
        recent: Array<{ bubble_id: string | null; created_at?: any; updated_at?: any }>;
        truncated: boolean;
      }
    > = {};
    for (const table of tables) {
      const isCompanies = table === "companies";
      const qCount = supabase.from(table).select("id", { head: true, count: "exact" });
      const { count, error } = isCompanies ? await qCount.eq("id", companyId) : await qCount.eq("company_id", companyId);
      if (error) return json({ ok: false, error: `${table}:${error.message}` }, { status: 500 });
      counts[table] = Number(count ?? 0);

      const expected = expectedByTable && typeof expectedByTable[table] === "number" ? Number(expectedByTable[table]) : null;
      const qMissing = supabase.from(table).select("bubble_id", { head: true, count: "exact" }).is("bubble_id", null);
      const missingRes = isCompanies ? await qMissing.eq("id", companyId) : await qMissing.eq("company_id", companyId);
      const missingBubbleIds = Number(missingRes.count ?? 0);

      let truncated = false;
      const freq = new Map<string, number>();
      for (let offset = 0; offset < 50000; offset += 10000) {
        const qDup = supabase.from(table).select("bubble_id").range(offset, offset + 9999);
        const { data, error: e2 } = isCompanies ? await qDup.eq("id", companyId) : await qDup.eq("company_id", companyId);
        if (e2) break;
        const list = (data ?? []) as any[];
        for (const r of list) {
          const b = String((r as any)?.bubble_id ?? "").trim();
          if (!b) continue;
          freq.set(b, (freq.get(b) ?? 0) + 1);
        }
        if (list.length < 10000) break;
        if (offset + 10000 >= 50000) truncated = true;
      }
      const duplicateBubbleIds = Array.from(freq.entries())
        .filter(([, c]) => c >= 2)
        .map(([bubble_id, c]) => ({ bubble_id, count: c }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 50);

      let recent: Array<{ bubble_id: string | null; created_at?: any; updated_at?: any }> = [];
      try {
        let qRecent = supabase.from(table).select("bubble_id,created_at,updated_at").order("created_at", { ascending: false }).limit(10);
        qRecent = isCompanies ? qRecent.eq("id", companyId) : qRecent.eq("company_id", companyId);
        const { data: d3 } = await qRecent;
        recent = ((d3 ?? []) as any[]).map((r) => ({ bubble_id: (r as any)?.bubble_id ?? null, created_at: (r as any)?.created_at, updated_at: (r as any)?.updated_at }));
      } catch {
        recent = [];
      }

      const mismatch = expected != null ? Number(counts[table] ?? 0) !== expected : false;
      perTable[table] = { count: counts[table] ?? 0, expected, mismatch, missingBubbleIds, duplicateBubbleIds, recent, truncated };
    }

    const { count: membersCount } = await supabase.from("company_members").select("company_id", { head: true, count: "exact" }).eq("company_id", companyId);
    counts.company_members = Number(membersCount ?? 0);

    return json({ ok: true, companyId, capturedAt: new Date().toISOString(), counts, perTable }, { status: 200 });
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
