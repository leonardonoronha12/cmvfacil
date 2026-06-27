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

export async function GET(req: NextRequest) {
  try {
    const { userId } = getUserIdFromRequest(req);
    if (!userId || !isUuid(userId)) return json({ ok: false, error: "unauthorized" }, { status: 401 });

    const url = new URL(req.url);
    const runId = String(url.searchParams.get("runId") ?? "").trim();

    let supabase: ReturnType<typeof getSupabaseAdmin>;
    try {
      supabase = getSupabaseAdmin();
    } catch {
      return json({ ok: false, error: "supabase_not_configured" }, { status: 500 });
    }

    const { data: run } = runId
      ? await supabase.from("bubble_obj_import_run").select("*").eq("id", runId).maybeSingle()
      : await supabase.from("bubble_obj_import_run").select("*").eq("triggered_by_supabase_user_id", userId).order("started_at", { ascending: false }).limit(1).maybeSingle();

    const resolvedRunId = String((run as any)?.id ?? "").trim();
    const { data: items } = resolvedRunId
      ? await supabase.from("bubble_obj_import_run_item").select("*").eq("run_id", resolvedRunId).eq("supabase_user_id", userId).order("object_type", { ascending: true })
      : { data: [] as any[] };

    const { data: checkpoints } = await supabase
      .from("bubble_obj_import_checkpoint")
      .select("*")
      .eq("supabase_user_id", userId)
      .order("updated_at", { ascending: false })
      .limit(300);

    return json({ ok: true, run: run ?? null, runItems: items ?? [], checkpoints: checkpoints ?? [] }, { status: 200 });
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

