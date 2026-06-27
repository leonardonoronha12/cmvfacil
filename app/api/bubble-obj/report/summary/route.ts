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

function sum(arr: any[], key: string) {
  let out = 0;
  for (const r of arr) {
    const n = Number((r as any)?.[key] ?? 0);
    out += Number.isFinite(n) ? n : 0;
  }
  return out;
}

export async function GET(req: NextRequest) {
  try {
    const { userId } = getUserIdFromRequest(req);
    if (!userId || !isUuid(userId)) return json({ ok: false, error: "unauthorized" }, { status: 401 });

    const url = new URL(req.url);
    const runIdParam = String(url.searchParams.get("runId") ?? "").trim();

    let supabase: ReturnType<typeof getSupabaseAdmin>;
    try {
      supabase = getSupabaseAdmin();
    } catch {
      return json({ ok: false, error: "supabase_not_configured" }, { status: 500 });
    }

    const { data: run } = runIdParam
      ? await supabase.from("bubble_obj_import_run").select("*").eq("id", runIdParam).maybeSingle()
      : await supabase.from("bubble_obj_import_run").select("*").eq("triggered_by_supabase_user_id", userId).order("started_at", { ascending: false }).limit(1).maybeSingle();

    const runId = String((run as any)?.id ?? "").trim();
    if (!runId) return json({ ok: false, error: "run_not_found" }, { status: 404 });
    if (String((run as any)?.triggered_by_supabase_user_id ?? "").trim() !== userId) return json({ ok: false, error: "forbidden" }, { status: 403 });

    const { data: items, error: itemsErr } = await supabase
      .from("bubble_obj_import_run_item")
      .select("*")
      .eq("run_id", runId)
      .eq("supabase_user_id", userId);
    if (itemsErr) return json({ ok: false, error: itemsErr.message }, { status: 500 });
    const runItems = (items ?? []) as any[];

    const bubbleUserIdsInRun = Array.from(new Set(runItems.map((x) => String(x?.bubble_user_id ?? "").trim()).filter(Boolean)));

    const { data: cps, error: cpsErr } = await supabase.from("bubble_obj_import_checkpoint").select("*").eq("supabase_user_id", userId);
    if (cpsErr) return json({ ok: false, error: cpsErr.message }, { status: 500 });
    const allCheckpoints = (cps ?? []) as any[];
    const bubbleUsersSet = new Set(bubbleUserIdsInRun);
    const checkpoints = bubbleUserIdsInRun.length ? allCheckpoints.filter((c) => bubbleUsersSet.has(String((c as any)?.bubble_user_id ?? "").trim())) : allCheckpoints;

    const { count: bubbleUsersTotal, error: umTotalErr } = await supabase.from("bubble_obj_user_map").select("bubble_user_id", { count: "exact", head: true });
    if (umTotalErr) return json({ ok: false, error: umTotalErr.message }, { status: 500 });
    const { count: bubbleUsersLinked, error: umLinkedErr } = await supabase
      .from("bubble_obj_user_map")
      .select("bubble_user_id", { count: "exact", head: true })
      .not("supabase_user_id", "is", null);
    if (umLinkedErr) return json({ ok: false, error: umLinkedErr.message }, { status: 500 });
    const { count: bubbleUsersLinkedToMe, error: umMineErr } = await supabase
      .from("bubble_obj_user_map")
      .select("bubble_user_id", { count: "exact", head: true })
      .eq("supabase_user_id", userId);
    if (umMineErr) return json({ ok: false, error: umMineErr.message }, { status: 500 });

    const bubbleUsersTotalSafe = typeof bubbleUsersTotal === "number" ? bubbleUsersTotal : 0;
    const bubbleUsersLinkedSafe = typeof bubbleUsersLinked === "number" ? bubbleUsersLinked : 0;
    const bubbleUsersUnlinked = Math.max(0, bubbleUsersTotalSafe - bubbleUsersLinkedSafe);

    const byType = new Map<string, any[]>();
    for (const it of runItems) {
      const t = String(it?.object_type ?? "").trim() || "unknown";
      const list = byType.get(t) ?? [];
      list.push(it);
      byType.set(t, list);
    }

    const perType = Array.from(byType.entries())
      .map(([objectType, list]) => {
        return {
          objectType,
          totalExpected: sum(list, "total_expected"),
          totalReceived: sum(list, "total_received"),
          totalSavedStaging: sum(list, "total_saved_staging"),
          totalDuplicateIgnored: sum(list, "total_duplicate_ignored"),
          totalPendingReview: sum(list, "total_pending_review"),
          totalError: sum(list, "total_error"),
          totalProcessed: sum(list, "total_processed"),
          doneCount: list.filter((x) => String(x?.status ?? "") === "done").length,
          runningCount: list.filter((x) => String(x?.status ?? "") === "running").length,
          errorCount: list.filter((x) => String(x?.status ?? "") === "error").length,
        };
      })
      .sort((a, b) => a.objectType.localeCompare(b.objectType, "pt-BR", { sensitivity: "base", numeric: true }));

    const cpDone = checkpoints.filter((c) => String(c?.status ?? "") === "done").length;
    const cpError = checkpoints.filter((c) => String(c?.status ?? "") === "error").length;
    const cpPending = checkpoints.length - cpDone - cpError;

    return json(
      {
        ok: true,
        run: {
          id: runId,
          status: String((run as any)?.status ?? ""),
          startedAt: String((run as any)?.started_at ?? ""),
          finishedAt: String((run as any)?.finished_at ?? ""),
          baseUrl: String((run as any)?.base_url ?? ""),
          batchLimit: Number((run as any)?.batch_limit ?? 100),
        },
        users: {
          bubbleUsersTotalFound: bubbleUsersTotalSafe,
          bubbleUsersLinkedToSupabase: bubbleUsersLinkedSafe,
          bubbleUsersWithoutLink: bubbleUsersUnlinked,
          bubbleUsersLinkedToMe: typeof bubbleUsersLinkedToMe === "number" ? bubbleUsersLinkedToMe : 0,
          bubbleUsersInRun: bubbleUserIdsInRun.length,
        },
        totals: {
          totalExpected: sum(runItems, "total_expected"),
          totalReceived: sum(runItems, "total_received"),
          totalSavedStaging: sum(runItems, "total_saved_staging"),
          totalDuplicateIgnored: sum(runItems, "total_duplicate_ignored"),
          totalPendingReview: sum(runItems, "total_pending_review"),
          totalError: sum(runItems, "total_error"),
          totalProcessed: sum(runItems, "total_processed"),
        },
        perType,
        checkpoints: {
          total: checkpoints.length,
          done: cpDone,
          pending: cpPending,
          error: cpError,
        },
      },
      { status: 200 },
    );
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
