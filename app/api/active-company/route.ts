import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../lib/supabaseAdmin";
import { getUserIdFromRequest } from "../../lib/requestUserId";

export async function POST(req: NextRequest) {
  const { userId } = getUserIdFromRequest(req);
  if (!userId) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null) as { companyId?: string } | null;
  const companyId = String(body?.companyId ?? "").trim();
  if (!companyId) return NextResponse.json({ ok: false, error: "missing_company" }, { status: 400 });

  const supabase = getSupabaseAdmin();
  const membership = await supabase
    .from("company_members")
    .select("company_id")
    .eq("company_id", companyId)
    .eq("user_id", userId)
    .maybeSingle();
  if (membership.error || !membership.data?.company_id) {
    return NextResponse.json({ ok: false, error: "company_forbidden" }, { status: 403 });
  }

  const response = NextResponse.json({ ok: true, companyId });
  response.cookies.set("cmv_active_company", companyId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 12,
  });
  return response;
}
