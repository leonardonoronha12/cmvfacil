import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { fetchBubbleObjPageWithConstraints, getBubbleObjCredentials } from "../../../../lib/bubbleObjApi";
import { getSupabaseAdmin } from "../../../../lib/supabaseAdmin";
import { getAppUrl } from "../../../../lib/stripeServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return NextResponse.json(data, { ...init, headers });
}

function authorized(req: NextRequest) {
  const expected = String(process.env.BUBBLE_MIGRATION_HANDOFF_SECRET ?? "").trim();
  const received = String(req.headers.get("authorization") ?? "")
    .replace(/^Bearer\s+/i, "")
    .trim();
  if (!expected || !received) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function findAuthUserByEmail(supabase: ReturnType<typeof getSupabaseAdmin>, email: string) {
  for (let page = 1; page <= 100; page += 1) {
    const result = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (result.error) throw new Error(result.error.message);
    const user = result.data.users.find((candidate) => String(candidate.email ?? "").trim().toLowerCase() === email);
    if (user) return user;
    if (result.data.users.length < 1000) break;
  }
  return null;
}

export async function POST(req: NextRequest) {
  try {
    if (!authorized(req)) return json({ ok: false, error: "unauthorized" }, { status: 401 });
    const body = (await req.json().catch(() => null)) as any;
    const email = String(body?.email ?? "").trim().toLowerCase();
    const targetEmail = String(body?.targetEmail ?? body?.target_email ?? email)
      .trim()
      .toLowerCase();
    const bubbleUserId = String(body?.bubbleUserId ?? body?.bubble_user_id ?? "").trim();
    if (!email || !email.includes("@") || !targetEmail || !targetEmail.includes("@") || !bubbleUserId) {
      return json({ ok: false, error: "missing_identity" }, { status: 400 });
    }
    const testMode = targetEmail !== email;

    const creds = await getBubbleObjCredentials();
    const bubblePage = await fetchBubbleObjPageWithConstraints<any>({
      creds,
      type: "user",
      cursor: 0,
      limit: 2,
      constraints: [{ key: "email", constraint_type: "equals", value: email }],
      timeoutMs: 12_000,
    });
    const bubbleUser = bubblePage.results.find((row: any) => {
      const id = String(row?._id ?? row?.unique_id ?? row?.id ?? "").trim();
      return id === bubbleUserId;
    });
    if (!bubbleUser) return json({ ok: false, error: "bubble_identity_mismatch" }, { status: 403 });

    const supabase = getSupabaseAdmin();
    let authUser = await findAuthUserByEmail(supabase, targetEmail);
    if (!authUser) {
      const created = await supabase.auth.admin.createUser({
        email: targetEmail,
        email_confirm: true,
        password: crypto.randomBytes(36).toString("base64url"),
        user_metadata: { bubble_user_id: bubbleUserId, migration_source: "bubble", migration_test_mode: testMode },
      });
      if (created.error || !created.data.user) throw new Error(created.error?.message ?? "user_creation_failed");
      authUser = created.data.user;
    }

    const mapResult = await supabase.from("bubble_obj_user_map").upsert(
      {
        bubble_user_id: bubbleUserId,
        email,
        nome: String(bubbleUser?.nome_completo ?? bubbleUser?.nome ?? "").trim(),
        supabase_user_id: authUser.id,
      } as any,
      { onConflict: "bubble_user_id" },
    );
    if (mapResult.error) throw new Error(mapResult.error.message);

    const migrationResult = await supabase.from("bubble_obj_user_migration").upsert(
      {
        supabase_user_id: authUser.id,
        email,
        bubble_user_id: bubbleUserId,
        status: "not_started",
        validation_status: "not_started",
        validation_report: {
          testMode,
          sourceEmail: email,
          targetEmail,
        },
      } as any,
      { onConflict: "supabase_user_id" },
    );
    if (migrationResult.error) throw new Error(migrationResult.error.message);

    const generated = await supabase.auth.admin.generateLink({
      type: "magiclink",
      email: targetEmail,
    });
    if (generated.error) throw new Error(generated.error.message);
    const tokenHash = String((generated.data as any)?.properties?.hashed_token ?? "").trim();
    if (!tokenHash) throw new Error("handoff_token_missing");

    const redirectUrl = new URL("/api/auth/migration-handoff", getAppUrl());
    redirectUrl.searchParams.set("token_hash", tokenHash);
    if (testMode) redirectUrl.searchParams.set("test_mode", "1");
    return json({ ok: true, redirectUrl: redirectUrl.toString() });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

