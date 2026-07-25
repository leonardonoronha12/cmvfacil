import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  return NextResponse.json(data, { ...init, headers });
}

function safeText(v: unknown, max = 800) {
  const s = String(v ?? "").trim();
  if (!s) return "";
  return s.length > max ? s.slice(0, max) : s;
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function getEnv(name: string) {
  const v = (process.env[name] ?? "").trim();
  return v || null;
}

export async function POST(req: NextRequest) {
  const requiredSecret = getEnv("ADMIN_SECRET") ?? getEnv("DEBUG_SECRET");
  if (process.env.NODE_ENV === "production" && requiredSecret) {
    const got = safeText(req.headers.get("x-admin-secret") ?? "");
    if (!got || got !== requiredSecret) return json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as any;
  const sessionId = safeText(body?.sessionId ?? body?.session_id ?? "", 120);
  const runId = safeText(body?.runId ?? body?.run_id ?? "", 120);
  const hypothesisId = safeText(body?.hypothesisId ?? body?.hypothesis_id ?? "", 16);
  const traceIdRaw = safeText(body?.traceId ?? body?.trace_id ?? "", 80);
  const location = safeText(body?.location ?? "", 400);
  const msg = safeText(body?.msg ?? "", 2000);
  const data = (body?.data ?? null) as any;

  if (!sessionId || !runId || !hypothesisId || !msg) {
    return json({ ok: false, error: "invalid_payload" }, { status: 400 });
  }

  const traceId = traceIdRaw && isUuid(traceIdRaw) ? traceIdRaw : null;
  const companyIdRaw = safeText(data?.companyId ?? data?.company_id ?? "", 80);
  const userIdRaw = safeText(data?.userId ?? data?.user_id ?? "", 80);
  const companyId = companyIdRaw && isUuid(companyIdRaw) ? companyIdRaw : null;
  const userId = userIdRaw && isUuid(userIdRaw) ? userIdRaw : null;

  try {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase.from("debug_events").insert({
      session_id: sessionId,
      run_id: runId,
      hypothesis_id: hypothesisId,
      trace_id: traceId,
      location: location || null,
      msg,
      data: data ?? null,
      company_id: companyId,
      user_id: userId,
    } as any);
    if (error) return json({ ok: false, error: error.message }, { status: 500 });
    return json({ ok: true }, { status: 200 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err ?? "");
    return json({ ok: false, error: msg || "unknown_error" }, { status: 500 });
  }
}

