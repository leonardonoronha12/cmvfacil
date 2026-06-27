import { NextRequest, NextResponse } from "next/server";
import { getUserIdFromRequest } from "../../../../../lib/requestUserId";
import { getSupabaseAdmin } from "../../../../../lib/supabaseAdmin";

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

export async function GET(req: NextRequest) {
  try {
    const { userId } = getUserIdFromRequest(req);
    if (!userId) return json({ ok: false, error: "unauthorized" }, { status: 401 });
    if (isUuid(String(userId))) return json({ ok: false, error: "forbidden" }, { status: 403 });

    let supabase: ReturnType<typeof getSupabaseAdmin>;
    try {
      supabase = getSupabaseAdmin();
    } catch {
      return json({ ok: false, error: "supabase_not_configured" }, { status: 500 });
    }

    const url = new URL(req.url);
    const status = String(url.searchParams.get("status") ?? "").trim();
    const limit = Math.min(200, Math.max(1, Number.parseInt(String(url.searchParams.get("limit") ?? "50"), 10) || 50));
    const offset = Math.max(0, Number.parseInt(String(url.searchParams.get("offset") ?? "0"), 10) || 0);

    let q = supabase
      .from("bubble_obj_user_migration")
      .select("*", { count: "exact" })
      .order("last_attempt_at", { ascending: false, nullsFirst: false });

    if (status) q = q.eq("status", status);

    const { data, error, count } = await q.range(offset, offset + limit - 1);
    if (error) return json({ ok: false, error: error.message }, { status: 500 });

    const rows = (data ?? []) as any[];
    return json(
      {
        ok: true,
        total: typeof count === "number" ? count : null,
        offset,
        limit,
        rows: rows.map((r) => ({
          supabaseUserId: String(r.supabase_user_id ?? ""),
          email: String(r.email ?? ""),
          bubbleUserId: String(r.bubble_user_id ?? ""),
          status: String(r.status ?? ""),
          lastRunId: r.last_run_id ? String(r.last_run_id) : null,
          lastAttemptAt: r.last_attempt_at ? String(r.last_attempt_at) : null,
          completedAt: r.completed_at ? String(r.completed_at) : null,
          lastError: String(r.last_error ?? ""),
          perTypeStats: r.per_type_stats ?? null,
          validation: { status: String(r.validation_status ?? "not_started"), validatedAt: r.validated_at ? String(r.validated_at) : null },
          totals: {
            received: Number(r.total_received ?? 0),
            savedStaging: Number(r.total_saved_staging ?? 0),
            duplicateIgnored: Number(r.total_duplicate_ignored ?? 0),
            pendingReview: Number(r.total_pending_review ?? 0),
            error: Number(r.total_error ?? 0),
            processed: Number(r.total_processed ?? 0),
          },
        })),
      },
      { status: 200 },
    );
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
