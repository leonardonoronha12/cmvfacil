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

function parseRetryAfterIso(lastError: string) {
  const s = String(lastError ?? "");
  const m = s.match(/retry_after=([^|]+)/i);
  return m ? String(m[1]).trim() : "";
}

function isTransientBubbleError(msg: string) {
  const s = String(msg ?? "");
  return (
    s.startsWith("bubble_timeout:") ||
    s.startsWith("bubble_429:") ||
    s.startsWith("bubble_500:") ||
    s.startsWith("bubble_502:") ||
    s.startsWith("bubble_503:") ||
    s.startsWith("bubble_504:")
  );
}

export async function GET(req: NextRequest) {
  try {
    const { userId } = getUserIdFromRequest(req);
    if (!userId || !isUuid(userId)) return json({ ok: false, error: "unauthorized" }, { status: 401 });

    let supabase: ReturnType<typeof getSupabaseAdmin>;
    try {
      supabase = getSupabaseAdmin();
    } catch {
      return json({ ok: false, error: "supabase_not_configured" }, { status: 500 });
    }

    const { data, error } = await supabase.from("bubble_obj_user_migration").select("*").eq("supabase_user_id", userId).maybeSingle();
    if (error) return json({ ok: false, error: error.message }, { status: 500 });

    if (!data) {
      return json(
        {
          ok: true,
          migration: {
            supabaseUserId: userId,
            status: "not_started",
            lastRunId: null,
            lastAttemptAt: null,
            completedAt: null,
            lastError: "",
            totals: { received: 0, savedStaging: 0, duplicateIgnored: 0, pendingReview: 0, error: 0, processed: 0 },
          },
        },
        { status: 200 },
      );
    }

    const row = data as any;
    const lastRunId = row.last_run_id ? String(row.last_run_id) : null;
    const { data: attemptRow, error: attErr } = lastRunId
      ? await supabase
          .from("bubble_obj_user_migration_attempt")
          .select("validation_status,validated_at,validation_report")
          .eq("supabase_user_id", userId)
          .eq("run_id", lastRunId)
          .order("started_at", { ascending: false })
          .limit(1)
          .maybeSingle()
      : { data: null as any, error: null as any };
    if (attErr) return json({ ok: false, error: attErr.message }, { status: 500 });

    const migStatusRaw = String(row.validation_status ?? "not_started");
    const migValidatedAtMs = row.validated_at ? Date.parse(String(row.validated_at)) : 0;
    const attStatusRaw = attemptRow ? String((attemptRow as any)?.validation_status ?? "") : "";
    const attValidatedAtMs = attemptRow?.validated_at ? Date.parse(String((attemptRow as any).validated_at)) : 0;
    const useAttemptValidation = (() => {
      if (!attemptRow) return false;
      if (!attStatusRaw) return false;
      if (migValidatedAtMs && !attValidatedAtMs) return false;
      if (migValidatedAtMs && attValidatedAtMs) return attValidatedAtMs >= migValidatedAtMs;
      if (!migValidatedAtMs && attValidatedAtMs) return true;
      return migStatusRaw === "not_started";
    })();
    const validationStatus = useAttemptValidation ? String((attemptRow as any).validation_status ?? "not_started") : String(row.validation_status ?? "not_started");
    const validatedAt = useAttemptValidation ? ((attemptRow as any).validated_at ? String((attemptRow as any).validated_at) : null) : row.validated_at ? String(row.validated_at) : null;
    const validationReport = useAttemptValidation ? ((attemptRow as any).validation_report ?? null) : row.validation_report ?? null;

    if (useAttemptValidation && (validationStatus !== String(row.validation_status ?? "") || validatedAt !== (row.validated_at ? String(row.validated_at) : null))) {
      try {
        await supabase
          .from("bubble_obj_user_migration")
          .update({ validation_status: validationStatus, validated_at: validatedAt, validation_report: validationReport } as any)
          .eq("supabase_user_id", userId);
      } catch {}
    }
    const { data: items, error: itemsErr } = lastRunId
      ? await supabase
          .from("bubble_obj_import_run_item")
          .select("object_type,status,total_expected,total_received,total_saved_staging,total_duplicate_ignored,total_pending_review,total_error,total_processed,last_cursor,last_error,updated_at")
          .eq("run_id", lastRunId)
          .eq("supabase_user_id", userId)
          .order("object_type", { ascending: true })
      : { data: null as any, error: null as any };
    if (itemsErr) return json({ ok: false, error: itemsErr.message }, { status: 500 });

    const nowMs = Date.now();
    const perTypeLive = Array.isArray(items)
      ? (items as any[]).map((it) => {
          const lastError = String(it.last_error ?? "");
          const updatedAt = it.updated_at ? String(it.updated_at) : null;
          const updatedAtMs = updatedAt ? Date.parse(updatedAt) : 0;
          const updatedAgoSec = updatedAtMs ? Math.max(0, Math.floor((nowMs - updatedAtMs) / 1000)) : null;
          const retryAfter = parseRetryAfterIso(lastError) || null;
          const retryAfterMs = retryAfter ? Date.parse(retryAfter) : 0;
          const waitingRetry = String(it.status ?? "") === "retrying" && Boolean(retryAfterMs ? nowMs < retryAfterMs : isTransientBubbleError(lastError));
          return {
            objectType: String(it.object_type ?? ""),
            status: String(it.status ?? ""),
            expected: Number(it.total_expected ?? 0),
            received: Number(it.total_received ?? 0),
            savedStaging: Number(it.total_saved_staging ?? 0),
            duplicateIgnored: Number(it.total_duplicate_ignored ?? 0),
            pendingReview: Number(it.total_pending_review ?? 0),
            error: Number(it.total_error ?? 0),
            processed: Number(it.total_processed ?? 0),
            lastCursor: Number(it.last_cursor ?? 0),
            lastError,
            updatedAt,
            updatedAgoSec,
            retryAfter,
            waitingRetry,
          };
        })
      : [];

    const runningObjectTypes = perTypeLive.filter((x) => x.status === "running" || x.status === "pending").map((x) => x.objectType);
    const retryingObjectTypes = perTypeLive.filter((x) => x.status === "retrying").map((x) => x.objectType);
    const active = (() => {
      const running = perTypeLive.filter((x) => x.status === "running");
      const base = running.length ? running : perTypeLive.filter((x) => x.status === "pending");
      if (!base.length) return null;
      base.sort((a, b) => (b.received - a.received) || (b.savedStaging - a.savedStaging) || (b.updatedAgoSec ?? 0) - (a.updatedAgoSec ?? 0));
      const top = base[0];
      return {
        objectType: top.objectType,
        status: top.status,
        received: top.received,
        savedStaging: top.savedStaging,
        processed: top.processed,
        lastCursor: top.lastCursor,
        updatedAgoSec: top.updatedAgoSec,
        lastError: top.lastError,
        waitingRetry: top.waitingRetry,
        retryAfter: top.retryAfter,
      };
    })();

    return json(
      {
        ok: true,
        migration: {
          supabaseUserId: userId,
          email: String(row.email ?? ""),
          bubbleUserId: String(row.bubble_user_id ?? ""),
          status: String(row.status ?? ""),
          lastRunId,
          lastAttemptAt: row.last_attempt_at ? String(row.last_attempt_at) : null,
          completedAt: row.completed_at ? String(row.completed_at) : null,
          lastError: String(row.last_error ?? ""),
          perTypeStats: row.per_type_stats ?? null,
          validation: {
            status: validationStatus,
            validatedAt,
            report: validationReport,
          },
          totals: {
            received: Number(row.total_received ?? 0),
            savedStaging: Number(row.total_saved_staging ?? 0),
            duplicateIgnored: Number(row.total_duplicate_ignored ?? 0),
            pendingReview: Number(row.total_pending_review ?? 0),
            error: Number(row.total_error ?? 0),
            processed: Number(row.total_processed ?? 0),
          },
          runningObjectTypes,
          retryingObjectTypes,
          active,
          perTypeLive,
        },
      },
      { status: 200 },
    );
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
