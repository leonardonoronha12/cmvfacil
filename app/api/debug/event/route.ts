import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "../../../lib/supabaseAdmin";
import { getUserIdFromRequest } from "../../../lib/requestUserId";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  return NextResponse.json(data, { ...init, headers });
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

function safeString(v: unknown) {
  return String(v ?? "").trim();
}

export async function POST(req: NextRequest) {
  const traceId = crypto.randomUUID();
  try {
    const { accessToken, userId } = getUserIdFromRequest(req);
    if (!userId || !accessToken) return json({ ok: false, traceId, error: "unauthorized" }, { status: 401 });

    const payload = (await req.json().catch(() => null)) as any;
    const sessionId = safeString(payload?.sessionId);
    const runId = safeString(payload?.runId);
    const hypothesisId = safeString(payload?.hypothesisId);
    const location = safeString(payload?.location);
    const msg = safeString(payload?.msg);
    const data = typeof payload?.data === "undefined" || payload?.data === null ? {} : payload?.data;
    const ts = typeof payload?.ts === "number" && Number.isFinite(payload.ts) ? payload.ts : Date.now();

    if (!sessionId || !hypothesisId || !location || !msg) {
      return json({ ok: false, traceId, error: "invalid_payload" }, { status: 400 });
    }

    const supabase = getSupabaseServerClient(accessToken);
    const { data: memberRows, error: memberErr } = await supabase
      .from("company_members")
      .select("company_id,role,permission_level")
      .eq("user_id", userId)
      .limit(50);
    if (memberErr) return json({ ok: false, traceId, error: memberErr.message }, { status: 500 });
    const companyId = pickBestCompanyId((memberRows ?? []) as any[]);
    if (!companyId) return json({ ok: true, traceId, companyId: null }, { status: 200 });

    try {
      const { error: insErr } = await supabase.from("debug_events").insert({
        session_id: sessionId,
        run_id: runId || "prod",
        hypothesis_id: hypothesisId,
        trace_id: safeString(payload?.traceId) || null,
        location,
        msg,
        data: { ...(typeof data === "object" ? data : { value: data }), ts },
        company_id: companyId,
        user_id: userId,
      } as any);
      if (!insErr) return json({ ok: true, traceId, companyId }, { status: 200 });
    } catch {}

    const { data: defaultSupplier, error: supplierErr1 } = await supabase
      .from("suppliers")
      .select("id,raw")
      .eq("company_id", companyId)
      .ilike("external_key", "supplier:default:sem_fornecedor")
      .limit(1)
      .maybeSingle();
    if (supplierErr1) return json({ ok: false, traceId, error: supplierErr1.message }, { status: 500 });
    const supplierId = safeString((defaultSupplier as any)?.id);
    if (!supplierId) return json({ ok: true, traceId, companyId, stored: "no_default_supplier" }, { status: 200 });
    const rawBase = (defaultSupplier as any)?.raw ?? {};
    const systemBase = (rawBase as any)?.system ?? {};
    const prev = Array.isArray((systemBase as any)?.debug_events) ? (systemBase as any).debug_events : [];
    const next = [...prev, { sessionId, runId: runId || "prod", hypothesisId, traceId, location, msg, data, ts }].slice(-200);
    const nextRaw = { ...(rawBase as any), system: { ...(systemBase as any), debug_events: next } };
    await supabase.from("suppliers").update({ raw: nextRaw } as any).eq("company_id", companyId).eq("id", supplierId);
    return json({ ok: true, traceId, companyId, stored: "supplier_raw" }, { status: 200 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err ?? "");
    return json({ ok: false, traceId, error: msg || "unknown_error" }, { status: 500 });
  }
}

