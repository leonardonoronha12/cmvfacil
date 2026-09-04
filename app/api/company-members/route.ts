import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../lib/supabaseAdmin";
import { getUserIdFromRequest } from "../../lib/requestUserId";
import { resolveCurrentCompanyForUser } from "../../lib/billing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return NextResponse.json(data, { ...init, headers });
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function safeEmail(input: unknown) {
  const value = String(input ?? "").trim().toLowerCase();
  return value && value.includes("@") ? value : "";
}

function permissionLevel(input: unknown) {
  const value = Number(String(input ?? "").trim());
  return Number.isFinite(value) ? value : 0;
}

function isAdminMember(row: any) {
  const role = String(row?.role ?? "").trim().toLowerCase();
  return role.includes("owner") || role.includes("admin") || role.includes("administrador") || role.includes("propriet") || permissionLevel(row?.permission_level) >= 3;
}

function isOwnerMember(row: any) {
  const role = String(row?.role ?? "").trim().toLowerCase();
  return role.includes("owner") || role.includes("propriet");
}

async function findAuthUserByEmail(supabase: ReturnType<typeof getSupabaseAdmin>, email: string) {
  for (let page = 1; page <= 10; page++) {
    const listed = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (listed.error) throw new Error(listed.error.message);
    const users = listed.data?.users ?? [];
    const match = users.find((user) => safeEmail(user.email) === email);
    if (match) return match;
    if (users.length < 1000) break;
  }
  return null;
}

export async function DELETE(req: NextRequest) {
  try {
    const { userId } = getUserIdFromRequest(req);
    const requesterId = String(userId ?? "").trim();
    if (!isUuid(requesterId)) return json({ ok: false, error: "unauthorized" }, { status: 401 });

    const body = (await req.json().catch(() => null)) as any;
    const email = safeEmail(body?.email);
    if (!email) return json({ ok: false, error: "missing_email" }, { status: 400 });

    const supabase = getSupabaseAdmin();
    const { companyId } = await resolveCurrentCompanyForUser(supabase, requesterId);
    if (!companyId) return json({ ok: false, error: "company_not_found" }, { status: 400 });

    const requesterMembership = await supabase
      .from("company_members")
      .select("role,permission_level")
      .eq("company_id", companyId)
      .eq("user_id", requesterId)
      .maybeSingle();
    if (requesterMembership.error) throw new Error(requesterMembership.error.message);
    if (!requesterMembership.data || !isAdminMember(requesterMembership.data)) {
      return json({ ok: false, error: "forbidden" }, { status: 403 });
    }

    const targetUser = await findAuthUserByEmail(supabase, email);
    const targetUserId = String(targetUser?.id ?? "").trim();
    if (!isUuid(targetUserId)) return json({ ok: false, error: "member_not_found" }, { status: 404 });
    if (targetUserId === requesterId) return json({ ok: false, error: "cannot_remove_self" }, { status: 400 });

    const targetMembership = await supabase
      .from("company_members")
      .select("role,permission_level")
      .eq("company_id", companyId)
      .eq("user_id", targetUserId)
      .maybeSingle();
    if (targetMembership.error) throw new Error(targetMembership.error.message);
    if (!targetMembership.data) return json({ ok: false, error: "member_not_found" }, { status: 404 });
    if (isAdminMember(targetMembership.data)) return json({ ok: false, error: "cannot_remove_admin" }, { status: 400 });

    const removed = await supabase.from("company_members").delete().eq("company_id", companyId).eq("user_id", targetUserId);
    if (removed.error) throw new Error(removed.error.message);

    return json({ ok: true, removedEmail: email });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const { userId } = getUserIdFromRequest(req);
    const requesterId = String(userId ?? "").trim();
    if (!isUuid(requesterId)) return json({ ok: false, error: "unauthorized" }, { status: 401 });

    const body = (await req.json().catch(() => null)) as any;
    const email = safeEmail(body?.email);
    const roleLabel = String(body?.role ?? "").trim() === "Administrador" ? "Administrador" : "Colaborador";
    if (!email) return json({ ok: false, error: "missing_email" }, { status: 400 });

    const supabase = getSupabaseAdmin();
    const { companyId } = await resolveCurrentCompanyForUser(supabase, requesterId);
    if (!companyId) return json({ ok: false, error: "company_not_found" }, { status: 400 });

    const requesterMembership = await supabase
      .from("company_members")
      .select("role,permission_level")
      .eq("company_id", companyId)
      .eq("user_id", requesterId)
      .maybeSingle();
    if (requesterMembership.error) throw new Error(requesterMembership.error.message);
    if (!requesterMembership.data || !isAdminMember(requesterMembership.data)) {
      return json({ ok: false, error: "forbidden" }, { status: 403 });
    }

    const targetUser = await findAuthUserByEmail(supabase, email);
    const targetUserId = String(targetUser?.id ?? "").trim();
    if (!isUuid(targetUserId)) return json({ ok: false, error: "member_not_found" }, { status: 404 });
    if (targetUserId === requesterId) return json({ ok: false, error: "cannot_change_self" }, { status: 400 });

    const targetMembership = await supabase
      .from("company_members")
      .select("role,permission_level")
      .eq("company_id", companyId)
      .eq("user_id", targetUserId)
      .maybeSingle();
    if (targetMembership.error) throw new Error(targetMembership.error.message);
    if (!targetMembership.data) return json({ ok: false, error: "member_not_found" }, { status: 404 });
    if (isOwnerMember(targetMembership.data)) return json({ ok: false, error: "cannot_change_owner" }, { status: 400 });

    const updated = await supabase
      .from("company_members")
      .update({ role: roleLabel === "Administrador" ? "admin" : "member", permission_level: roleLabel === "Administrador" ? "3" : "1" } as any)
      .eq("company_id", companyId)
      .eq("user_id", targetUserId);
    if (updated.error) throw new Error(updated.error.message);

    return json({ ok: true, email, role: roleLabel });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
