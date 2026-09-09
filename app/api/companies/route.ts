import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../lib/supabaseAdmin";
import { getUserIdFromRequest } from "../../lib/requestUserId";

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  return NextResponse.json(data, { ...init, headers });
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function digitsOnly(value: string) {
  return value.replace(/\D/g, "");
}

function normalizeEmail(value: string) {
  const v = value.trim().toLowerCase();
  return v ? v : null;
}

function normalizePhoneBR(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("+")) return trimmed;
  const d = digitsOnly(trimmed);
  if (!d) return null;
  if (d.startsWith("55")) return `+${d}`;
  return `+55${d}`;
}

export async function PATCH(req: NextRequest) {
  const { userId } = getUserIdFromRequest(req);
  const uid = String(userId ?? "").trim();
  if (!uid) return json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null) as { companyId?: unknown; name?: unknown } | null;
  const companyId = String(body?.companyId ?? "").trim();
  const name = String(body?.name ?? "").trim();
  if (!isUuid(companyId) || name.length < 2 || name.length > 120) return json({ error: "invalid_company" }, { status: 400 });
  const db = getSupabaseAdmin();
  const member = await db.from("company_members").select("role,permission_level").eq("company_id", companyId).eq("user_id", uid).maybeSingle();
  if (member.error) return json({ error: member.error.message }, { status: 500 });
  const role = String((member.data as any)?.role ?? "").toLowerCase();
  const level = Number((member.data as any)?.permission_level ?? 0);
  if (!member.data || (!role.includes("owner") && !role.includes("admin") && level < 1)) return json({ error: "company_forbidden" }, { status: 403 });
  const updated = await db.from("companies").update({ fantasy_name: name, legal_name: name }).eq("id", companyId);
  if (updated.error) return json({ error: updated.error.message }, { status: 500 });
  return json({ ok: true, name });
}

export async function DELETE(req: NextRequest) {
  const { userId } = getUserIdFromRequest(req);
  const uid = String(userId ?? "").trim();
  if (!uid) return json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null) as { companyId?: unknown } | null;
  const companyId = String(body?.companyId ?? "").trim();
  if (!isUuid(companyId)) return json({ error: "invalid_company" }, { status: 400 });
  const db = getSupabaseAdmin();
  const memberships = await db.from("company_members").select("company_id").eq("user_id", uid).limit(50);
  if (memberships.error) return json({ error: memberships.error.message }, { status: 500 });
  const companyIds = (memberships.data || []).map((row: any) => String(row.company_id));
  if (!companyIds.includes(companyId)) return json({ error: "company_forbidden" }, { status: 403 });
  if (companyIds.length <= 1) return json({ error: "last_company_cannot_be_removed" }, { status: 409 });
  const removed = await db.from("company_members").delete().eq("company_id", companyId).eq("user_id", uid);
  if (removed.error) return json({ error: removed.error.message }, { status: 500 });
  const nextCompanyId = companyIds.find(id => id !== companyId) || "";
  const response = json({ ok: true, nextCompanyId });
  response.cookies.set("cmv_active_company", nextCompanyId, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 365 });
  return response;
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = (await req.json()) as unknown;
  } catch {
    return json({ error: "invalid_json" }, { status: 400 });
  }

  const { userId } = getUserIdFromRequest(req);
  const uid = String(userId ?? "").trim();
  if (!uid) return json({ error: "unauthorized" }, { status: 401 });

  const data = body as Record<string, unknown>;
  const fantasyName = String(data.fantasyName ?? "").trim();
  const legalName = String(data.legalName ?? "").trim();
  const cnpjRaw = String(data.cnpj ?? "").trim();
  const emailRaw = String(data.email ?? "").trim();
  const whatsappRaw = String(data.whatsapp ?? "").trim();
  const industry = String(data.industry ?? "").trim();
  const desiredStore = String(data.desiredStore ?? "").trim();
  const logoUrl = String(data.logoUrl ?? "").trim();
  const companyIdOverride = String((data as any).company_id ?? (data as any).companyId ?? "").trim();
  const additionalProfile = (data as any).additionalProfile === true;

  if (!fantasyName) return json({ error: "fantasy_name_required" }, { status: 400 });
  if (!legalName) return json({ error: "legal_name_required" }, { status: 400 });

  const cnpjDigits = digitsOnly(cnpjRaw);
  const cnpj = cnpjDigits ? cnpjDigits : null;
  if (cnpj && cnpj.length !== 14) return json({ error: "cnpj_invalid" }, { status: 400 });

  const email = emailRaw ? normalizeEmail(emailRaw) : null;
  const phoneE164 = whatsappRaw ? normalizePhoneBR(whatsappRaw) : null;

  let supabase;
  try {
    supabase = getSupabaseAdmin();
  } catch {
    return json({ error: "server_not_configured" }, { status: 500 });
  }

  if (companyIdOverride && isUuid(companyIdOverride)) {
    const membership = await supabase
      .from("company_members")
      .select("company_id")
      .eq("company_id", companyIdOverride)
      .eq("user_id", uid)
      .limit(1)
      .maybeSingle();
    if (membership.error) return json({ error: "supabase_error", details: membership.error.message }, { status: 500 });
    if (!membership.data?.company_id) return json({ error: "company_forbidden" }, { status: 403 });

    const { error: updateErr } = await (supabase.from("companies") as any)
      .update({
        fantasy_name: fantasyName,
        legal_name: legalName,
        cnpj,
        email,
        phone_e164: phoneE164,
        industry: industry || null,
        logo_url: logoUrl || null,
        desired_store: desiredStore || null,
        raw: { source: "cadastro-empresa" },
      })
      .eq("id", companyIdOverride);
    if (updateErr) return json({ error: "supabase_error", details: updateErr.message }, { status: 500 });

    const up = await supabase.from("company_members").upsert(
      {
        company_id: companyIdOverride,
        user_id: uid,
        role: "owner",
        permission_level: "3",
      } as any,
      { onConflict: "company_id,user_id" },
    );
    if (up.error) {
      return json({ error: "company_member_failed", details: up.error.message }, { status: 500 });
    }

    return json({ ok: true, company_id: companyIdOverride }, { status: 200 });
  }

  // Um perfil adicional precisa ter ciclo de cobrança próprio. Não usamos o
  // upsert por e-mail/CNPJ aqui, pois isso poderia anexá-lo a uma assinatura
  // já existente em vez de criar a empresa com seu próprio trial.
  const created = additionalProfile
    ? await (supabase.from("companies") as any)
        .insert({
          fantasy_name: fantasyName,
          legal_name: legalName,
          cnpj,
          email,
          phone_e164: phoneE164,
          industry: industry || null,
          logo_url: logoUrl || null,
          desired_store: desiredStore || null,
          raw: { source: "cadastro-perfil-adicional" },
        })
        .select("id,trial_started_at,trial_ends_at,subscription_status")
        .single()
    : null;

  const rpcResult = additionalProfile
    ? null
    : await supabase.rpc("upsert_company", {
        p_fantasy_name: fantasyName,
        p_legal_name: legalName,
        p_cnpj: cnpj,
        p_email: email,
        p_phone_e164: phoneE164,
        p_industry: industry || null,
        p_logo_url: logoUrl || null,
        p_desired_store: desiredStore || null,
        p_raw: { source: "cadastro-empresa" },
      });

  const companyId = additionalProfile ? String(created?.data?.id ?? "") : rpcResult?.data;
  const error = additionalProfile ? created?.error : rpcResult?.error;

  if (error) {
    return json({ error: "supabase_error", details: error.message }, { status: 500 });
  }

  const up = await supabase.from("company_members").upsert(
    {
      company_id: companyId,
      user_id: uid,
      role: "owner",
      permission_level: "3",
    } as any,
    { onConflict: "company_id,user_id" },
  );
  if (up.error) {
    return json({ error: "company_member_failed", details: up.error.message }, { status: 500 });
  }

  return json({
    ok: true,
    company_id: companyId,
    billing_required: additionalProfile,
    trial_ends_at: additionalProfile ? created?.data?.trial_ends_at ?? null : null,
  }, { status: 200 });
}
