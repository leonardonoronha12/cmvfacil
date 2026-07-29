import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseAuthConfig } from "../../../lib/supabaseAuthConfig";
import { getPublicAppUrl } from "../../../lib/publicAppUrl";

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  return NextResponse.json(data, { ...init, headers });
}

function safeEmail(value: unknown) {
  const v = String(value ?? "").trim().toLowerCase();
  if (!v || !v.includes("@")) return "";
  return v;
}

export async function POST(req: NextRequest) {
  let body: { email?: string } = {};
  try {
    body = (await req.json()) as { email?: string };
  } catch {
    return json({ error: "invalid_json" }, { status: 400 });
  }

  const email = safeEmail(body.email);
  if (!email) return json({ ok: false, error: "email_required" }, { status: 400 });

  let cfg;
  try {
    cfg = getSupabaseAuthConfig();
  } catch {
    return json({ error: "server_not_configured" }, { status: 500 });
  }

  const supabase = createClient(cfg.url, cfg.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, flowType: "implicit" },
  });

  const appUrl = getPublicAppUrl().replace(/\/+$/, "");
  const emailRedirectTo = `${appUrl}/login`;

  const { error } = await supabase.auth.resend({
    type: "signup",
    email,
    options: { emailRedirectTo },
  });

  if (error) {
    console.error("signup_resend_failed", { code: String(error.message ?? "").slice(0, 120) });
  }

  return json({ ok: true }, { status: 200 });
}
