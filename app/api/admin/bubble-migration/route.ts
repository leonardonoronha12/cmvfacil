import { NextRequest, NextResponse } from "next/server";
import { requireSystemAdmin } from "../../../lib/systemAdmin";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin";
import { fetchBubbleObjPageWithConstraints, getBubbleObjCredentials } from "../../../lib/bubbleObjApi";
import { mapBubbleUsuario } from "../../../lib/bubbleObjMappers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const cleanEmail = (value: unknown) => String(value ?? "").trim().toLowerCase();
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });

function emailFromBubbleRow(raw: any) {
  const mapped = cleanEmail(mapBubbleUsuario(raw).normalized?.email);
  if (mapped.includes("@")) return mapped;
  for (const [key, value] of Object.entries(raw ?? {})) {
    const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!normalizedKey.includes("email") && !normalizedKey.includes("login") && !normalizedKey.includes("username")) continue;
    const match = String(value ?? "").match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
    if (match) return cleanEmail(match[0]);
  }
  const fallback = JSON.stringify(raw ?? {}).match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
  return fallback ? cleanEmail(fallback[0]) : "";
}

async function authUsersByEmail() {
  const db = getSupabaseAdmin();
  const result = new Map<string, { id: string; createdAt: string }>();
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(error.message);
    for (const user of data.users) {
      const email = cleanEmail(user.email);
      if (email) result.set(email, { id: user.id, createdAt: user.created_at });
    }
    if (data.users.length < 1000) break;
  }
  return result;
}

export async function GET(req: NextRequest) {
  const admin = await requireSystemAdmin(req);
  if (!admin.ok) return json({ ok: false, error: admin.error }, admin.status);
  try {
    const url = new URL(req.url);
    const cursor = Math.max(0, Number(url.searchParams.get("cursor") ?? 0) || 0);
    const limit = Math.min(200, Math.max(10, Number(url.searchParams.get("limit") ?? 100) || 100));
    const creds = await getBubbleObjCredentials();
    let page: Awaited<ReturnType<typeof fetchBubbleObjPageWithConstraints<any>>> | null = null;
    let sourceType = "user";
    for (const type of ["user", "User", "users", "Users"]) {
      try {
        page = await fetchBubbleObjPageWithConstraints<any>({ creds, type, cursor, limit, constraints: [], timeoutMs: 15000 });
        sourceType = type;
        break;
      } catch {}
    }
    if (!page) throw new Error("Não foi possível consultar os usuários do Bubble.");

    const db = getSupabaseAdmin();
    const auth = await authUsersByEmail();
    const emails = page.results.map(emailFromBubbleRow).filter(Boolean);
    const ids = emails.map(email => auth.get(email)?.id).filter(Boolean) as string[];
    const { data: migrations, error } = ids.length
      ? await db.from("bubble_obj_user_migration").select("supabase_user_id,status,validation_status,last_attempt_at,last_error,total_received,total_processed").in("supabase_user_id", ids)
      : { data: [], error: null };
    if (error) throw new Error(error.message);
    const migrationByUser = new Map((migrations ?? []).map((row: any) => [String(row.supabase_user_id), row]));

    const rows = page.results.map(raw => {
      const mapped = mapBubbleUsuario(raw).normalized as any;
      const email = emailFromBubbleRow(raw);
      const target = auth.get(email);
      const migration: any = target ? migrationByUser.get(target.id) : null;
      const bubbleUserId = String(mapped?.bubble_user_id ?? raw?.unique_id ?? raw?._id ?? raw?.id ?? "");
      return {
        email,
        name: String(mapped?.nome ?? "").trim(),
        bubbleUserId,
        supabaseUserId: target?.id ?? null,
        newAccountCreatedAt: target?.createdAt ?? null,
        migrationStatus: migration?.status ?? (target ? "not_started" : "missing_account"),
        validationStatus: migration?.validation_status ?? "not_started",
        lastAttemptAt: migration?.last_attempt_at ?? null,
        lastError: migration?.last_error ?? "",
        received: Number(migration?.total_received ?? 0),
        processed: Number(migration?.total_processed ?? 0),
      };
    }).filter(row => row.email);
    const remaining = Number(page.remaining ?? 0);
    return json({ ok: true, rows, cursor, nextCursor: remaining > 0 ? cursor + page.results.length : null, remaining, sourceType, received: page.results.length, omittedWithoutEmail: page.results.length - rows.length });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
  }
}

export async function POST(req: NextRequest) {
  const admin = await requireSystemAdmin(req);
  if (!admin.ok) return json({ ok: false, error: admin.error }, admin.status);
  try {
    const body = await req.json();
    const email = cleanEmail(body?.email);
    const bubbleUserId = String(body?.bubbleUserId ?? "").trim();
    if (!email || !bubbleUserId) return json({ ok: false, error: "email_and_bubble_user_required" }, 400);
    const auth = await authUsersByEmail();
    const target = auth.get(email);
    if (!target) return json({ ok: false, error: "A conta ainda não existe no sistema novo. Crie ou convide o usuário antes da migração." }, 409);
    const db = getSupabaseAdmin();
    const { error: mapError } = await db.from("bubble_obj_user_map").upsert({ bubble_user_id: bubbleUserId, email, supabase_user_id: target.id }, { onConflict: "bubble_user_id" });
    if (mapError) throw new Error(mapError.message);
    const { error } = await db.from("bubble_obj_user_migration").upsert({ supabase_user_id: target.id, email, bubble_user_id: bubbleUserId, status: "not_started", last_error: "" }, { onConflict: "supabase_user_id", ignoreDuplicates: true });
    if (error) throw new Error(error.message);
    return json({ ok: true, userId: target.id, email, status: "prepared" });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
  }
}
