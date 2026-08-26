import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin";
import { requireSystemAdmin } from "../../../lib/systemAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const normalizeEmail = (value: unknown) => String(value || "").trim().toLowerCase();
const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function findAuthUserByEmail(email: string) {
  const db = getSupabaseAdmin();
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const user = data.users.find(candidate => normalizeEmail(candidate.email) === email);
    if (user) return user;
    if (data.users.length < 1000) break;
  }
  return null;
}

export async function GET(req: NextRequest) {
  const auth = await requireSystemAdmin(req);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  const db = getSupabaseAdmin();
  const { data, error } = await db.from("system_admins").select("id,user_id,email,name,active,created_at,updated_at").order("created_at");
  if (error) return NextResponse.json({ ok: false, error: "system_admins_load_failed", detail: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, currentUserId: auth.userId, admins: data ?? [] });
}

export async function POST(req: NextRequest) {
  const auth = await requireSystemAdmin(req);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  try {
    const body = await req.json();
    const email = normalizeEmail(body?.email);
    const name = String(body?.name || "").trim() || null;
    if (!email || !email.includes("@")) return NextResponse.json({ ok: false, error: "invalid_email" }, { status: 400 });
    const user = await findAuthUserByEmail(email);
    if (!user) return NextResponse.json({ ok: false, error: "auth_user_not_found" }, { status: 404 });
    const db = getSupabaseAdmin();
    const { data, error } = await db.from("system_admins").upsert({ user_id: user.id, email, name, active: true, created_by: uuidRe.test(auth.userId) ? auth.userId : null, updated_at: new Date().toISOString() }, { onConflict: "user_id" }).select("id,user_id,email,name,active,created_at,updated_at").single();
    if (error) throw error;
    return NextResponse.json({ ok: true, admin: data });
  } catch (error) {
    return NextResponse.json({ ok: false, error: "system_admin_create_failed", detail: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const auth = await requireSystemAdmin(req);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  try {
    const body = await req.json();
    const id = String(body?.id || "").trim();
    const name = String(body?.name || "").trim() || null;
    const active = body?.active !== false;
    if (!id) return NextResponse.json({ ok: false, error: "id_required" }, { status: 400 });
    const db = getSupabaseAdmin();
    const { data: target } = await db.from("system_admins").select("user_id").eq("id", id).maybeSingle();
    if (!target) return NextResponse.json({ ok: false, error: "admin_not_found" }, { status: 404 });
    if (!active && target.user_id === auth.userId) return NextResponse.json({ ok: false, error: "cannot_disable_self" }, { status: 409 });
    const { data, error } = await db.from("system_admins").update({ name, active, updated_at: new Date().toISOString() }).eq("id", id).select("id,user_id,email,name,active,created_at,updated_at").single();
    if (error) throw error;
    return NextResponse.json({ ok: true, admin: data });
  } catch (error) {
    return NextResponse.json({ ok: false, error: "system_admin_update_failed", detail: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const auth = await requireSystemAdmin(req);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  const id = String(new URL(req.url).searchParams.get("id") || "").trim();
  if (!id) return NextResponse.json({ ok: false, error: "id_required" }, { status: 400 });
  const db = getSupabaseAdmin();
  const { data: target } = await db.from("system_admins").select("user_id").eq("id", id).maybeSingle();
  if (!target) return NextResponse.json({ ok: false, error: "admin_not_found" }, { status: 404 });
  if (target.user_id === auth.userId) return NextResponse.json({ ok: false, error: "cannot_remove_self" }, { status: 409 });
  const { error } = await db.from("system_admins").delete().eq("id", id);
  if (error) return NextResponse.json({ ok: false, error: "system_admin_delete_failed", detail: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
