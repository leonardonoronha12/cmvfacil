import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin";
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

export async function GET(req: NextRequest) {
  const traceId = crypto.randomUUID();
  try {
    const { accessToken, userId } = getUserIdFromRequest(req);
    if (!userId || !accessToken) return json({ ok: false, traceId, error: "unauthorized" }, { status: 401 });

    const url = new URL(req.url);
    const limitRaw = Number(url.searchParams.get("limit") ?? "200");
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(400, Math.floor(limitRaw))) : 200;

    const supabase = getSupabaseAdmin();
    const { data: memberRows, error: memberErr } = await supabase
      .from("company_members")
      .select("company_id,role,permission_level")
      .eq("user_id", userId)
      .limit(50);
    if (memberErr) return json({ ok: false, traceId, error: memberErr.message }, { status: 500 });
    const companyId = pickBestCompanyId((memberRows ?? []) as any[]);
    if (!companyId) return json({ ok: true, traceId, companyId: null, events: [] }, { status: 200 });

    const { data: defaultSupplier, error: supplierErr } = await supabase
      .from("suppliers")
      .select("id,raw")
      .eq("company_id", companyId)
      .eq("external_key", "supplier:default:sem_fornecedor")
      .limit(1)
      .maybeSingle();
    if (supplierErr) return json({ ok: false, traceId, error: supplierErr.message }, { status: 500 });

    const raw = (defaultSupplier as any)?.raw ?? {};
    const system = (raw as any)?.system ?? {};
    const events = Array.isArray((system as any)?.debug_events) ? (system as any).debug_events : [];
    const out = events.slice(-limit);
    return json({ ok: true, traceId, companyId, events: out }, { status: 200 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err ?? "");
    return json({ ok: false, traceId, error: msg || "unknown_error" }, { status: 500 });
  }
}

