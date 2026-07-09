import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseAuthConfig } from "../../../lib/supabaseAuthConfig";
import { SUPABASE_AT_COOKIE, SUPABASE_RT_COOKIE, parseJwtExpMs } from "../../../lib/supabaseAuthCookies";
import { shouldUseSecureCookies } from "../../../lib/cookieSecurity";

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  return NextResponse.json(data, { ...init, headers });
}

export async function POST(req: NextRequest) {
  let body: { email?: string; password?: string; remember?: boolean } = {};
  try {
    body = (await req.json()) as { email?: string; password?: string; remember?: boolean };
  } catch {
    return json({ error: "invalid_json" }, { status: 400 });
  }

  const email = (body.email ?? "").trim();
  const password = (body.password ?? "").trim();
  const remember = Boolean(body.remember);

  if (!email || !password) return json({ error: "missing_credentials" }, { status: 400 });

  let cfg;
  try {
    cfg = getSupabaseAuthConfig();
  } catch {
    return json({ error: "server_not_configured" }, { status: 500 });
  }

  const supabase = createClient(cfg.url, cfg.anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.session) {
    return json({ error: error?.message ?? "invalid_credentials" }, { status: 401 });
  }

  const accessToken = data.session.access_token;
  const refreshToken = data.session.refresh_token;
  const expMs = parseJwtExpMs(accessToken);

  const res = json({ ok: true });
  const secure = shouldUseSecureCookies(req);
  const cookieBase = { httpOnly: true, sameSite: "lax" as const, secure, path: "/" };

  res.cookies.set({
    name: SUPABASE_AT_COOKIE,
    value: accessToken,
    ...cookieBase,
    ...(remember && expMs ? { maxAge: Math.max(60, Math.floor((expMs - Date.now()) / 1000)) } : {}),
  });

  if (refreshToken) {
    res.cookies.set({
      name: SUPABASE_RT_COOKIE,
      value: refreshToken,
      ...cookieBase,
      ...(remember ? { maxAge: 60 * 60 * 24 * 30 } : {}),
    });
  }

  return res;
}
