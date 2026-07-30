import { NextRequest, NextResponse } from "next/server";
import { getUserIdFromRequest } from "../../../../lib/requestUserId";
import { getSupabaseAdmin } from "../../../../lib/supabaseAdmin";
import { applyBubbleCompatForEmail } from "../../../../lib/bubbleCompatApply";
import { auditBubbleCompatForEmail } from "../../../../lib/bubbleCompatAudit";
import { reconcileMigrationBilling } from "../../../../lib/bubbleMigrationBilling";
import { getBubbleObjCredentials, updateBubbleObjThing } from "../../../../lib/bubbleObjApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

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
    if (!userId || !isUuid(userId)) return json({ ok: false, error: "unauthorized" }, { status: 401 });

    const supabase = getSupabaseAdmin();
    const migrationResult = await supabase
      .from("bubble_obj_user_migration")
      .select("status,email,last_run_id,bubble_user_id,validation_report")
      .eq("supabase_user_id", userId)
      .maybeSingle();
    if (migrationResult.error) return json({ ok: false, error: migrationResult.error.message }, { status: 500 });
    const migration = migrationResult.data as any;
    if (!migration || String(migration.status ?? "") !== "completed") {
      return json({ ok: false, error: "migration_not_completed" }, { status: 409 });
    }

    const authUser = await supabase.auth.admin.getUserById(userId);
    const email = String(migration.email ?? authUser.data?.user?.email ?? "").trim().toLowerCase();
    if (!email) return json({ ok: false, error: "missing_email" }, { status: 400 });
    const testMode = Boolean(migration.validation_report?.testMode);

    const startedAt = new Date().toISOString();
    await supabase
      .from("bubble_obj_user_migration")
      .update({ validation_status: "running", validated_at: null } as any)
      .eq("supabase_user_id", userId);

    const applied = await applyBubbleCompatForEmail(email);
    const audit = await auditBubbleCompatForEmail(email);
    const billing = testMode
      ? { ok: true, status: "skipped_test_mode" }
      : await reconcileMigrationBilling({ supabase, userId, email });

    const critical = audit.summary?.critical ?? [];
    const divergentTables = audit.summary?.tablesWithDivergence ?? [];
    const applyErrors = Object.entries(applied.execution?.perTable ?? {}).flatMap(([table, result]: [string, any]) =>
      (Array.isArray(result?.errors) ? result.errors : []).map((entry: any) => ({ table, ...entry })),
    );
    let validated = Boolean(applied.ok) && critical.length === 0 && divergentTables.length === 0 && applyErrors.length === 0 && billing.ok;
    let cutover: { ok: boolean; bubbleUserId: string | null; field: string; error?: string } = {
      ok: false,
      bubbleUserId: String(migration.bubble_user_id ?? "").trim() || null,
      field: "migrado",
    };

    if (validated && testMode) {
      cutover = { ...cutover, ok: true, skipped: "test_mode" } as any;
    } else if (validated && !cutover.bubbleUserId) {
      validated = false;
      cutover = { ...cutover, error: "missing_bubble_user_id" };
    } else if (validated && cutover.bubbleUserId) {
      try {
        const creds = await getBubbleObjCredentials();
        await updateBubbleObjThing({
          creds,
          type: "user",
          id: cutover.bubbleUserId,
          fields: { migrado: true },
        });
        cutover = { ...cutover, ok: true };
      } catch (error) {
        validated = false;
        cutover = {
          ...cutover,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }

    const validationStatus = validated ? "validated" : "divergent";
    const validatedAt = new Date().toISOString();
    const report = {
      version: 2,
      runId: String(migration.last_run_id ?? "") || null,
      startedAt,
      validatedAt,
      validationStatus,
      applied: {
        counts: applied.counts,
        perTable: applied.execution?.perTable ?? {},
        errors: applyErrors.slice(0, 100),
      },
      audit,
      billing,
      cutover,
    };

    const saved = await supabase
      .from("bubble_obj_user_migration")
      .update({ validation_status: validationStatus, validation_report: report as any, validated_at: validatedAt } as any)
      .eq("supabase_user_id", userId);
    if (saved.error) return json({ ok: false, error: saved.error.message }, { status: 500 });

    return json({ ok: true, status: validationStatus, report });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return json({ ok: false, error: message }, { status: 500 });
  }
}

