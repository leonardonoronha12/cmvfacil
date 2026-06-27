import { NextRequest, NextResponse } from "next/server";
import { getUserIdFromRequest } from "../../../../lib/requestUserId";
import { getSupabaseAdmin } from "../../../../lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return NextResponse.json(data, { ...init, headers });
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function pickAny(obj: any, keys: string[]) {
  if (!obj || typeof obj !== "object") return "";
  for (const k of keys) {
    const v = obj[k];
    if (v == null) continue;
    const s = String(v).trim();
    if (s) return s;
  }
  return "";
}

function pendingReasonsForRow(row: any) {
  const reasons: string[] = [];
  const bubbleUserId = String(row?.bubble_user_id ?? "").trim();
  const bubbleUniqueId = String(row?.bubble_unique_id ?? "").trim();
  const raw = row?.raw_payload_json ?? {};
  const name = pickAny(raw, ["nome", "name", "titulo", "title", "descricao", "description"]);

  if (!bubbleUserId) reasons.push("missing_bubble_user_id");
  if (!bubbleUniqueId || bubbleUniqueId.startsWith("noid_")) reasons.push("missing_unique_id");
  if (!String(name ?? "").trim()) reasons.push("missing_name");

  if (raw && typeof raw === "object") {
    const keys = Object.keys(raw);
    const nonMeta = keys.filter((k) => {
      const kk = k.toLowerCase();
      if (kk.includes("created") || kk.includes("modified") || kk.includes("updated")) return false;
      return !["unique_id", "_id", "id", "bubble_id"].includes(kk);
    });
    if (nonMeta.length <= 1) reasons.push("insufficient_payload");
  }

  return reasons;
}

export async function GET(req: NextRequest) {
  try {
    const { userId } = getUserIdFromRequest(req);
    if (!userId || !isUuid(userId)) return json({ ok: false, error: "unauthorized" }, { status: 401 });

    const url = new URL(req.url);
    const runId = String(url.searchParams.get("runId") ?? "").trim();
    const objectType = String(url.searchParams.get("objectType") ?? "").trim();
    const bubbleUserId = String(url.searchParams.get("bubbleUserId") ?? "").trim();
    const limit = Math.min(200, Math.max(1, Number.parseInt(String(url.searchParams.get("limit") ?? "50"), 10) || 50));
    const offset = Math.max(0, Number.parseInt(String(url.searchParams.get("offset") ?? "0"), 10) || 0);

    let supabase: ReturnType<typeof getSupabaseAdmin>;
    try {
      supabase = getSupabaseAdmin();
    } catch {
      return json({ ok: false, error: "supabase_not_configured" }, { status: 500 });
    }

    let q = supabase
      .from("bubble_obj_import_staging")
      .select("id,bubble_object_type,bubble_unique_id,bubble_user_id,supabase_user_id,run_id,cursor,fetched_at,status,error_message,raw_payload_json", { count: "exact" })
      .eq("supabase_user_id", userId)
      .eq("status", "pending_review")
      .order("fetched_at", { ascending: false });

    if (runId) q = q.eq("run_id", runId);
    if (objectType) q = q.eq("bubble_object_type", objectType);
    if (bubbleUserId) q = q.eq("bubble_user_id", bubbleUserId);

    const { data, error, count } = await q.range(offset, offset + limit - 1);
    if (error) return json({ ok: false, error: error.message }, { status: 500 });

    const rows = (data ?? []) as any[];
    const out = rows.map((r) => ({
      id: String(r.id ?? ""),
      bubbleObjectType: String(r.bubble_object_type ?? ""),
      bubbleUniqueId: String(r.bubble_unique_id ?? ""),
      bubbleUserId: String(r.bubble_user_id ?? ""),
      runId: String(r.run_id ?? ""),
      cursor: typeof r.cursor === "number" ? r.cursor : null,
      fetchedAt: String(r.fetched_at ?? ""),
      reasons: pendingReasonsForRow(r),
      raw: r.raw_payload_json,
    }));

    return json({ ok: true, total: typeof count === "number" ? count : null, offset, limit, rows: out }, { status: 200 });
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
