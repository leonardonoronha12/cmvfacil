import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../lib/supabaseAdmin";

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  return NextResponse.json(data, { ...init, headers });
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

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = (await req.json()) as unknown;
  } catch {
    return json({ error: "invalid_json" }, { status: 400 });
  }

  const data = body as Record<string, unknown>;
  const fantasyName = String(data.fantasyName ?? "").trim();
  const legalName = String(data.legalName ?? "").trim();
  const cnpjRaw = String(data.cnpj ?? "").trim();
  const emailRaw = String(data.email ?? "").trim();
  const whatsappRaw = String(data.whatsapp ?? "").trim();
  const industry = String(data.industry ?? "").trim();
  const desiredStore = String(data.desiredStore ?? "").trim();
  const logoUrl = String(data.logoUrl ?? "").trim();

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

  const { data: companyId, error } = await supabase.rpc("upsert_company", {
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

  if (error) {
    return json({ error: "supabase_error", details: error.message }, { status: 500 });
  }

  return json({ ok: true, company_id: companyId }, { status: 200 });
}
