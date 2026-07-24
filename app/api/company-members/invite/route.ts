import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin";
import { getUserIdFromRequest } from "../../../lib/requestUserId";
import { resolveCurrentCompanyForUser } from "../../../lib/billing";
import { sendCompanyInviteEmail } from "../../../lib/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

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
  const v = String(input ?? "").trim().toLowerCase();
  if (!v || !v.includes("@")) return "";
  return v;
}

function requestOrigin(req: NextRequest) {
  const xfProto = String(req.headers.get("x-forwarded-proto") ?? "").trim();
  const proto = xfProto || "https";
  const xfHostRaw = String(req.headers.get("x-forwarded-host") ?? "").trim();
  const hostRaw = xfHostRaw || String(req.headers.get("host") ?? "").trim();
  const host = hostRaw.split(",")[0]?.trim() || "";
  if (!host) return "";
  return `${proto}://${host}`.replace(/\/+$/, "");
}

function parsePermissionLevel(v: unknown) {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const n = Number(String(v ?? "").trim());
  return Number.isFinite(n) ? n : 0;
}

function isCompanyAdminMember(row: any) {
  const roleRaw = String(row?.role ?? "").trim().toLowerCase();
  if (roleRaw.includes("owner") || roleRaw.includes("admin") || roleRaw.includes("administrador") || roleRaw.includes("propriet")) return true;
  const perm = parsePermissionLevel(row?.permission_level);
  return perm >= 3;
}

function randomPassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
  let out = "";
  for (let i = 0; i < 24; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

export async function POST(req: NextRequest) {
  try {
    const { userId } = getUserIdFromRequest(req);
    const uid = String(userId ?? "").trim();
    if (!uid) return json({ ok: false, error: "unauthorized" }, { status: 401 });
    if (!isUuid(uid)) return json({ ok: false, error: "forbidden" }, { status: 403 });

    const body = (await req.json().catch(() => null)) as any;
    const email = safeEmail(body?.email);
    const role = String(body?.role ?? "").trim() === "Administrador" ? "Administrador" : "Colaborador";
    const permissionLevel = role === "Administrador" ? "3" : "1";
    if (!email) return json({ ok: false, error: "missing_email" }, { status: 400 });

    const supabase = getSupabaseAdmin();
    const { companyId } = await resolveCurrentCompanyForUser(supabase, uid);
    if (!companyId) return json({ ok: false, error: "company_not_found" }, { status: 400 });

    const { data: companyDb } = await supabase.from("companies").select("fantasy_name,legal_name").eq("id", companyId).maybeSingle();
    const companyName = String((companyDb as any)?.fantasy_name ?? (companyDb as any)?.legal_name ?? "").trim() || "Minha Empresa";

    const { data: inviterDb } = await supabase
      .from("user_profiles")
      .select("nome_completo,nome,sobrenome,email")
      .eq("user_id", uid)
      .maybeSingle();
    const inviterName =
      String((inviterDb as any)?.nome_completo ?? "").trim() ||
      `${String((inviterDb as any)?.nome ?? "").trim()} ${String((inviterDb as any)?.sobrenome ?? "").trim()}`.replace(/\s+/g, " ").trim() ||
      String((inviterDb as any)?.email ?? "").trim() ||
      "";

    const membership = await supabase
      .from("company_members")
      .select("company_id,role,permission_level")
      .eq("company_id", companyId)
      .eq("user_id", uid)
      .limit(1)
      .maybeSingle();
    if (membership.error) throw new Error(membership.error.message);
    if (!membership.data || !isCompanyAdminMember(membership.data)) return json({ ok: false, error: "forbidden" }, { status: 403 });

    await supabase.auth.admin.createUser({ email, password: randomPassword(), email_confirm: true, user_metadata: { source: "company-invite" } } as any).catch(() => null);

    const origin = requestOrigin(req) || "https://cmvfacil.app";
    const redirectTo = `${origin}/restaurar-senha?invite=1&company=${encodeURIComponent(companyName)}&role=${encodeURIComponent(role)}&email=${encodeURIComponent(
      email,
    )}`;
    const invite = await supabase.auth.admin.generateLink({ type: "invite", email, options: { redirectTo } } as any);
    if (invite.error) return json({ ok: false, error: invite.error.message }, { status: 500 });

    const actionLink = String((invite.data as any)?.properties?.action_link ?? "").trim();
    const createdUserId = String((invite.data as any)?.user?.id ?? "").trim();
    if (!actionLink) return json({ ok: false, error: "missing_action_link" }, { status: 500 });

    if (createdUserId && isUuid(createdUserId)) {
      const up = await supabase.from("company_members").upsert(
        { company_id: companyId, user_id: createdUserId, role, permission_level: permissionLevel } as any,
        { onConflict: "company_id,user_id" },
      );
      if (up.error) throw new Error(up.error.message);
    }

    const emailRes = await sendCompanyInviteEmail({ to: email, companyName, roleLabel: role, inviterName, actionLink });

    return json(
      { ok: true, email, role, actionLink, emailSent: emailRes.ok, ...(emailRes.ok ? {} : { emailError: emailRes.error }) },
      { status: 200 },
    );
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
