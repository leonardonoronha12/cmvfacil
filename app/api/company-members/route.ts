import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../lib/supabaseAdmin";
import { getUserIdFromRequest } from "../../lib/requestUserId";

const clean = (value: unknown) => String(value ?? "").trim();
const isAdmin = (row: any) => /owner|admin|administrador|propriet/i.test(clean(row?.role)) || Number(row?.permission_level ?? 0) >= 3;

export async function PATCH(req: NextRequest) {
  const { userId } = getUserIdFromRequest(req);
  if (!userId) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({})) as { companyId?: string; targetUserId?: string; role?: string };
  const companyId = clean(body.companyId || req.cookies.get("cmv_active_company")?.value);
  const targetUserId = clean(body.targetUserId);
  const desiredAdmin = clean(body.role) === "Administrador";
  if (!companyId || !targetUserId) return NextResponse.json({ ok: false, error: "missing_member" }, { status: 400 });

  const db = getSupabaseAdmin();
  const actor = await db.from("company_members").select("user_id,role,permission_level").eq("company_id", companyId).eq("user_id", userId).maybeSingle();
  if (actor.error || !actor.data || !isAdmin(actor.data)) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const target = await db.from("company_members").select("user_id,role,permission_level").eq("company_id", companyId).eq("user_id", targetUserId).maybeSingle();
  if (target.error || !target.data) return NextResponse.json({ ok: false, error: "member_not_found" }, { status: 404 });

  if (desiredAdmin) {
    const all = await db.from("company_members").select("user_id,role,permission_level").eq("company_id", companyId);
    if (all.error) return NextResponse.json({ ok: false, error: all.error.message }, { status: 500 });
    if ((all.data ?? []).some((row: any) => row.user_id !== targetUserId && isAdmin(row))) {
      return NextResponse.json({ ok: false, error: "company_already_has_admin" }, { status: 409 });
    }
  } else if (isAdmin(target.data)) {
    return NextResponse.json({ ok: false, error: "company_must_have_one_admin" }, { status: 409 });
  }

  const updated = await db.from("company_members").update({ role: desiredAdmin ? "admin" : "member", permission_level: desiredAdmin ? "3" : "1" }).eq("company_id", companyId).eq("user_id", targetUserId);
  if (updated.error) return NextResponse.json({ ok: false, error: updated.error.message }, { status: 500 });
  return NextResponse.json({ ok: true, role: desiredAdmin ? "Administrador" : "Colaborador" });
}
