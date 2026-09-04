import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../lib/supabaseAdmin";
import { getUserIdFromRequest } from "../../lib/requestUserId";
import { resolveCurrentCompanyForUser } from "../../lib/billing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(data: unknown, init: ResponseInit = {}) {
  return NextResponse.json(data, init);
}

function validIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

async function scope(req: NextRequest) {
  const { userId } = getUserIdFromRequest(req);
  if (!userId) throw new Error("unauthorized");
  const supabase = getSupabaseAdmin();
  const { companyId } = await resolveCurrentCompanyForUser(supabase, userId);
  if (!companyId) throw new Error("missing_company");
  return { supabase, companyId, userId };
}

export async function GET(req: NextRequest) {
  try {
    const startDate = String(req.nextUrl.searchParams.get("startDate") ?? "").trim();
    const endDate = String(req.nextUrl.searchParams.get("endDate") ?? "").trim();
    if (!validIsoDate(startDate) || !validIsoDate(endDate)) return json({ error: "invalid_period" }, { status: 400 });
    const { supabase, companyId } = await scope(req);
    const result = await supabase
      .from("revenues")
      .select("id,faturamento,updated_at,created_at")
      .eq("company_id", companyId)
      .eq("data_inicial", startDate)
      .eq("data_final", endDate)
      .order("updated_at", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (result.error) throw new Error(result.error.message);
    return json({ revenue: result.data?.faturamento ?? null, persisted: Boolean(result.data?.id) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return json({ error: message }, { status: message === "unauthorized" ? 401 : 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const startDate = String(body?.startDate ?? "").trim();
    const endDate = String(body?.endDate ?? "").trim();
    const revenueCents = Number(body?.revenueCents);
    if (!validIsoDate(startDate) || !validIsoDate(endDate)) return json({ error: "invalid_period" }, { status: 400 });
    if (!Number.isInteger(revenueCents) || revenueCents <= 0) return json({ error: "invalid_revenue" }, { status: 400 });

    const { supabase, companyId } = await scope(req);
    const existing = await supabase
      .from("revenues")
      .select("id")
      .eq("company_id", companyId)
      .eq("data_inicial", startDate)
      .eq("data_final", endDate)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existing.error) throw new Error(existing.error.message);

    const values = {
      company_id: companyId,
      data_inicial: startDate,
      data_final: endDate,
      faturamento: revenueCents / 100,
      raw: { source: "cmv_real", revenue_cents: revenueCents },
      updated_at: new Date().toISOString(),
    };
    const saved = existing.data?.id
      ? await supabase.from("revenues").update(values).eq("id", existing.data.id).select("id,faturamento").single()
      : await supabase.from("revenues").insert(values).select("id,faturamento").single();
    if (saved.error) throw new Error(saved.error.message);
    return json({ ok: true, id: saved.data.id, revenue: saved.data.faturamento });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return json({ error: message }, { status: message === "unauthorized" ? 401 : 500 });
  }
}
