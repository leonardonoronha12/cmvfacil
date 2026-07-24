import { NextRequest, NextResponse } from "next/server";
import { createOrReuseCheckoutUrl, isSubscriptionBlockingNewCheckout, requireAuthUserId, type PlanKey } from "../../../lib/billing";
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

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function digitsOnly(value: string) {
  return value.replace(/\D/g, "");
}

function normalizePhoneBR(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("+")) return trimmed;
  const d = digitsOnly(trimmed);
  if (!d) return null;
  if (d.startsWith("55")) return `+${d}`;
  return `+55${d}`;
}

function parsePlanKey(value: unknown): PlanKey | null {
  const v = String(value ?? "").trim().toLowerCase();
  if (v === "pro_monthly") return "pro_monthly";
  if (v === "pro_yearly") return "pro_yearly";
  return null;
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

    const userId = await requireAuthUserId(req);
    const supabase = getSupabaseAdmin();
    const appUrl = requestOrigin(req);

    const planKey = parsePlanKey((body as any)?.plan_key ?? (body as any)?.planKey ?? (body as any)?.plan) ?? "pro_monthly";
    const companyIdOverride = String((body as any)?.company_id ?? (body as any)?.companyId ?? "").trim();

    if (companyIdOverride && isUuid(companyIdOverride)) {
      const membership = await supabase
        .from("company_members")
        .select("company_id")
        .eq("company_id", companyIdOverride)
        .eq("user_id", userId)
        .limit(1)
        .maybeSingle();
      if (membership.error) throw new Error(membership.error.message);
      if (!membership.data?.company_id) return json({ ok: false, error: "company_forbidden" }, { status: 403 });

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
        origin: "signup",
        appUrl,
      });
      return json({ ok: true, url, company_id: companyIdOverride }, { status: 200 });
    }

    const { data: company, error: createErr } = await (supabase.from("companies") as any)
      .insert({
        fantasy_name: "Minha Empresa",
        legal_name: "Minha Empresa",
        email: null,
        phone_e164: null,
        raw: { source: "onboarding_start" },
      })
      .select("*")
      .single();
    if (createErr) throw new Error(createErr.message);

    const companyId = String((company as any)?.id ?? "").trim();
    if (!companyId || !isUuid(companyId)) return json({ ok: false, error: "company_create_failed" }, { status: 500 });

    const up = await supabase.from("company_members").upsert(
      { company_id: companyId, user_id: userId, role: "owner", permission_level: "3" } as any,
      { onConflict: "company_id,user_id" },
    );
    if (up.error) throw new Error(up.error.message);

    try {
      const au = await supabase.auth.admin.getUserById(userId);
      const email = String((au.data as any)?.user?.email ?? "").trim().toLowerCase() || null;
      const meta = ((au.data as any)?.user?.user_metadata ?? {}) as any;
      const phoneRaw = String(meta?.whatsapp ?? "").trim();
      const phoneE164 = phoneRaw ? normalizePhoneBR(phoneRaw) : null;
      if (email || phoneE164) {
        await (supabase.from("companies") as any)
          .update({ ...(email ? { email } : {}), ...(phoneE164 ? { phone_e164: phoneE164 } : {}), subscription_updated_at: new Date().toISOString() })
          .eq("id", companyId);
      }
    } catch {}

    const url = await createOrReuseCheckoutUrl({
      supabase,
      company: company as any,
      companyId,
      userId,
      planKey,
      origin: "signup",
      appUrl,
    });
    return json({ ok: true, url, company_id: companyId }, { status: 200 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = msg === "unauthorized" ? 401 : 500;
    return json({ ok: false, error: msg }, { status });
  }
}
