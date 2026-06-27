import { NextRequest, NextResponse } from "next/server";
import { getUserIdFromRequest } from "../../../../lib/requestUserId";
import { getSupabaseAdmin } from "../../../../lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return NextResponse.json(data, { ...init, headers });
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function POST(req: NextRequest) {
  try {
    const { userId } = getUserIdFromRequest(req);
    if (!userId) return json({ ok: false, error: "unauthorized" }, { status: 401 });

    const body = (await req.json().catch(() => null)) as any;
    const bubbleUserId = String(body?.bubbleUserId ?? "").trim();
    const supabaseUserId = String(body?.supabaseUserId ?? "").trim();
    if (!bubbleUserId) return json({ ok: false, error: "missing_bubbleUserId" }, { status: 400 });
    if (!supabaseUserId || !isUuid(supabaseUserId)) return json({ ok: false, error: "invalid_supabaseUserId" }, { status: 400 });
    if (isUuid(userId) && supabaseUserId !== userId) return json({ ok: false, error: "forbidden" }, { status: 403 });

    let supabase: ReturnType<typeof getSupabaseAdmin>;
    try {
      supabase = getSupabaseAdmin();
    } catch {
      return json({ ok: false, error: "supabase_not_configured" }, { status: 500 });
    }

    const { error } = await supabase.from("bubble_obj_user_map").upsert({ bubble_user_id: bubbleUserId, supabase_user_id: supabaseUserId } as any, { onConflict: "bubble_user_id" });
    if (error) return json({ ok: false, error: error.message }, { status: 500 });
    return json({ ok: true }, { status: 200 });
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

