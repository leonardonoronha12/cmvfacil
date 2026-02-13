import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseAuthConfig } from "../../../lib/supabaseAuthConfig";

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
  let body: { email?: string } = {};
  try {
    body = (await req.json()) as { email?: string };
  } catch {
    return json({ error: "invalid_json" }, { status: 400 });
  }

  const email = (body.email ?? "").trim();
  if (!email) return json({ error: "email_required" }, { status: 400 });

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
  const redirectTo = siteUrl ? `${siteUrl.replace(/\/+$/, "")}/restaurar-senha` : undefined;

  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo,
  });

  if (error) {
    return json({ error: "reset_failed", details: error.message }, { status: 400 });
  }

  return json({ ok: true }, { status: 200 });
}
