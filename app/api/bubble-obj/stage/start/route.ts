import { NextRequest, NextResponse } from "next/server";
import { getUserIdFromRequest } from "../../../../lib/requestUserId";
import { getSupabaseAdmin } from "../../../../lib/supabaseAdmin";
import { getBubbleObjCredentials } from "../../../../lib/bubbleObjApi";

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

const DEFAULT_OBJECT_TYPES = ["empresa", "cliente", "veiculo", "ordem_servico", "financeiro", "anexos"];

export async function POST(req: NextRequest) {
  try {
    const host = String(req.headers.get("host") ?? "")
      .trim()
      .toLowerCase()
      .replace(/:\d+$/, "");
    const isProdHost = host === "cmvfacil.vercel.app" || host === "app.cmvfacil.com";
    const isProdEnv =
      String(process.env.VERCEL_ENV ?? "").trim().toLowerCase() === "production" ||
      String(process.env.NODE_ENV ?? "").trim().toLowerCase() === "production";
    if (isProdHost || isProdEnv) return json({ ok: false, error: "bulk_import_paused" }, { status: 503 });

    const bulkEnabled = String(process.env.BUBBLE_OBJ_BULK_IMPORT_ENABLED ?? "").trim().toLowerCase() === "true";
    if (!bulkEnabled) return json({ ok: false, error: "bulk_import_paused" }, { status: 503 });

    const { userId } = getUserIdFromRequest(req);
    if (!userId || !isUuid(userId)) return json({ ok: false, error: "unauthorized" }, { status: 401 });

    const body = (await req.json().catch(() => null)) as any;
    const batchLimit = typeof body?.batchLimit === "number" && Number.isFinite(body.batchLimit) && body.batchLimit > 0 ? Math.min(200, Math.floor(body.batchLimit)) : 100;
    const objectTypes = Array.isArray(body?.objectTypes) && body.objectTypes.length ? (body.objectTypes as any[]).map((x) => String(x ?? "").trim()).filter(Boolean) : DEFAULT_OBJECT_TYPES;
    const bubbleUserIdsFilter = Array.isArray(body?.bubbleUserIds) && body.bubbleUserIds.length ? (body.bubbleUserIds as any[]).map((x) => String(x ?? "").trim()).filter(Boolean) : null;

    let supabase: ReturnType<typeof getSupabaseAdmin>;
    try {
      supabase = getSupabaseAdmin();
    } catch {
      return json({ ok: false, error: "supabase_not_configured" }, { status: 500 });
    }

    const creds = await getBubbleObjCredentials();

    const usersQuery = supabase.from("bubble_obj_user_map").select("bubble_user_id,email,nome,supabase_user_id").eq("supabase_user_id", userId);
    const { data: mappedUsers, error: usersErr } = bubbleUserIdsFilter ? await usersQuery.in("bubble_user_id", bubbleUserIdsFilter) : await usersQuery;
    if (usersErr) return json({ ok: false, error: usersErr.message }, { status: 500 });
    const users = (mappedUsers ?? []) as any[];
    if (!users.length) return json({ ok: false, error: "no_mapped_bubble_users_for_this_supabase_user" }, { status: 400 });

    const { data: runRow, error: runErr } = await supabase
      .from("bubble_obj_import_run")
      .insert({ triggered_by_supabase_user_id: userId, base_url: creds.baseUrl, batch_limit: batchLimit, status: "running" } as any)
      .select("id")
      .maybeSingle();
    if (runErr) return json({ ok: false, error: runErr.message }, { status: 500 });
    const runId = String((runRow as any)?.id ?? "").trim();
    if (!runId) return json({ ok: false, error: "failed_to_create_run" }, { status: 500 });

    const bubbleUserIds = users.map((u) => String(u?.bubble_user_id ?? "").trim()).filter(Boolean);
    const { data: existingCp, error: existingErr } = await supabase
      .from("bubble_obj_import_checkpoint")
      .select("bubble_user_id,object_type,last_cursor,total_imported,status")
      .eq("supabase_user_id", userId)
      .in("bubble_user_id", bubbleUserIds)
      .in("object_type", objectTypes);
    if (existingErr) return json({ ok: false, error: existingErr.message }, { status: 500 });
    const existingMap = new Map<string, any>();
    for (const r of (existingCp ?? []) as any[]) {
      const k = `${String(r?.bubble_user_id ?? "").trim()}|${String(r?.object_type ?? "").trim()}`;
      if (k) existingMap.set(k, r);
    }

    const checkpointRows: any[] = [];
    const runItemRows: any[] = [];
    for (const u of users) {
      const bubbleUserId = String(u?.bubble_user_id ?? "").trim();
      if (!bubbleUserId) continue;
      const userEmail = String(u?.email ?? "").trim().toLowerCase();
      for (const t of objectTypes) {
        const ek = `${bubbleUserId}|${t}`;
        const prev = existingMap.get(ek);
        if (!prev) {
          checkpointRows.push({
            user_email: userEmail,
            bubble_user_id: bubbleUserId,
            supabase_user_id: userId,
            object_type: t,
            last_cursor: 0,
            total_imported: 0,
            status: "pending",
          });
        }
        runItemRows.push({
          run_id: runId,
          bubble_user_id: bubbleUserId,
          supabase_user_id: userId,
          object_type: t,
          status: String(prev?.status ?? "") === "done" ? "done" : "running",
          last_cursor: typeof prev?.last_cursor === "number" && Number.isFinite(prev.last_cursor) && prev.last_cursor >= 0 ? prev.last_cursor : 0,
        });
      }
    }

    const { error: cpErr } = checkpointRows.length
      ? await supabase.from("bubble_obj_import_checkpoint").upsert(checkpointRows as any, { onConflict: "bubble_user_id,object_type,supabase_user_id" })
      : { error: null as any };
    if (cpErr) return json({ ok: false, error: `checkpoint:${cpErr.message}`, runId }, { status: 500 });

    const { error: riErr } = await supabase.from("bubble_obj_import_run_item").upsert(runItemRows as any, { onConflict: "run_id,bubble_user_id,object_type,supabase_user_id" });
    if (riErr) return json({ ok: false, error: `run_item:${riErr.message}`, runId }, { status: 500 });

    return json({ ok: true, runId, bubbleUsers: users.length, objectTypes, totalCheckpoints: checkpointRows.length, baseUrl: creds.baseUrl, batchLimit }, { status: 200 });
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
