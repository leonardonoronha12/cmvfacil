import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseAuthConfig } from "../../../lib/supabaseAuthConfig";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin";

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  return NextResponse.json(data, { ...init, headers });
}

function requestOrigin(req: NextRequest) {
  const origin = (req.headers.get("origin") ?? "").trim();
  if (origin) return origin;
  const proto = (req.headers.get("x-forwarded-proto") ?? "").trim();
  const host = (req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "").trim();
  if (proto && host) return `${proto}://${host}`;
  return "";
}

export async function POST(req: NextRequest) {
  let body: {
    email?: string;
    password?: string;
    first_name?: string;
    last_name?: string;
    cpf?: string;
    whatsapp?: string;
  } = {};

  try {
    body = (await req.json()) as typeof body;
  } catch {
    return json({ error: "invalid_json" }, { status: 400 });
  }

  const email = (body.email ?? "").trim();
  const password = (body.password ?? "").trim();
  if (!email || !password) return json({ error: "missing_fields" }, { status: 400 });

  try {
    const admin = getSupabaseAdmin();
    const created = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        first_name: (body.first_name ?? "").trim() || null,
        last_name: (body.last_name ?? "").trim() || null,
        cpf: (body.cpf ?? "").trim() || null,
        whatsapp: (body.whatsapp ?? "").trim() || null,
      },
    } as any);
    if (created.error) {
      return json({ error: "signup_failed", details: created.error.message }, { status: 400 });
    }
    return json({ ok: true, emailConfirmationRequired: false }, { status: 200 });
  } catch {
    // fall back to anon signup
  }

  let cfg;
  try {
    cfg = getSupabaseAuthConfig();
  } catch {
    return json({ error: "server_not_configured" }, { status: 500 });
  }

  const supabase = createClient(cfg.url, cfg.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, flowType: "implicit" },
  });

  const baseSiteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? "").trim();
  const siteUrl = requestOrigin(req) || baseSiteUrl;
  const emailRedirectTo = siteUrl ? `${siteUrl.replace(/\/+$/, "")}/login` : undefined;

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo,
      data: {
        first_name: (body.first_name ?? "").trim() || null,
        last_name: (body.last_name ?? "").trim() || null,
        cpf: (body.cpf ?? "").trim() || null,
        whatsapp: (body.whatsapp ?? "").trim() || null,
      },
    },
  });

  if (error) {
    return json({ error: "signup_failed", details: error.message }, { status: 400 });
  }

  const emailConfirmationRequired = !data.session;
  return json({ ok: true, emailConfirmationRequired }, { status: 200 });
}
