import { NextRequest, NextResponse } from "next/server";
import {
  createOrReuseCheckoutUrl,
  getBillingAccessForCurrentCompany,
  isSubscriptionBlockingNewCheckout,
  requireAuthUserId,
  type CheckoutOrigin,
  type PlanKey,
} from "../../../lib/billing";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin";

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

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function requestOrigin(req: NextRequest) {
  const xfProto = String(req.headers.get("x-forwarded-proto") ?? "").trim();
  const proto = xfProto || "https";
  const xfHostRaw = String(req.headers.get("x-forwarded-host") ?? "").trim();
  const hostRaw = xfHostRaw || String(req.headers.get("host") ?? "").trim();
  const host = hostRaw.split(",")[0]?.trim() || "";
  if (!host) return "";
  return `${proto}://${host}`.replace(/\/+$/, "");
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
    const companyIdOverride = String((body as any)?.company_id ?? (body as any)?.companyId ?? "").trim();
    const appUrl = requestOrigin(req);

    if (companyIdOverride && isUuid(companyIdOverride)) {
      const userId = await requireAuthUserId(req);
      const supabase = getSupabaseAdmin();

      const membership = await supabase
        .from("company_members")
        .select("company_id")
        .eq("company_id", companyIdOverride)
        .eq("user_id", userId)
        .limit(1)
        .maybeSingle();
      if (membership.error) throw new Error(membership.error.message);

      if (!membership.data?.company_id) {
        const companyOwner = await (supabase.from("companies") as any)
          .select("id,created_by_user_id,created_by,owner_user_id,admin_user_id")
          .eq("id", companyIdOverride)
          .limit(1)
          .maybeSingle();
        if (companyOwner.error) throw new Error(companyOwner.error.message);
        const owner = String((companyOwner.data as any)?.created_by_user_id ?? (companyOwner.data as any)?.created_by ?? "").trim();
        const ownerAlt = String((companyOwner.data as any)?.owner_user_id ?? (companyOwner.data as any)?.admin_user_id ?? "").trim();
        if (owner !== userId && ownerAlt !== userId) return json({ ok: false, error: "company_forbidden" }, { status: 403 });

        const up = await supabase.from("company_members").upsert(
          { company_id: companyIdOverride, user_id: userId, role: "owner", permission_level: "3" } as any,
          { onConflict: "company_id,user_id" },
        );
        if (up.error) throw new Error(up.error.message);
      }

      const { data: company, error: companyErr } = await supabase.from("companies").select("*").eq("id", companyIdOverride).maybeSingle();
      if (companyErr) throw new Error(companyErr.message);
      if (!company) return json({ ok: false, error: "company_not_found" }, { status: 400 });

      if (isSubscriptionBlockingNewCheckout(company as any)) {
        return json({ ok: false, error: "subscription_already_active" }, { status: 409 });
      }

      const url = await createOrReuseCheckoutUrl({
        supabase,
        company: company as any,
        companyId: companyIdOverride,
        userId,
        planKey,
        origin,
        appUrl,
      });
      return json({ ok: true, url }, { status: 200 });
    }

    const { userId, supabase, companyId, company } = await getBillingAccessForCurrentCompany(req);
    if (!companyId || !company) return json({ ok: false, error: "company_not_found" }, { status: 400 });

    if (isSubscriptionBlockingNewCheckout(company)) {
      return json({ ok: false, error: "subscription_already_active" }, { status: 409 });
    }

    const url = await createOrReuseCheckoutUrl({ supabase, company, companyId, userId, planKey, origin, appUrl });
    return json({ ok: true, url }, { status: 200 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = msg === "unauthorized" ? 401 : 500;
    return json({ ok: false, error: msg }, { status });
  }
}
