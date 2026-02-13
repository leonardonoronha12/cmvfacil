import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAuthConfig } from "../../../lib/supabaseAuthConfig";
import { SUPABASE_AT_COOKIE, SUPABASE_RT_COOKIE, parseJwtExpMs } from "../../../lib/supabaseAuthCookies";

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  return NextResponse.json(data, { ...init, headers });
}

export async function POST(req: NextRequest) {
  let body: { access_token?: string; refresh_token?: string } = {};
  try {
    body = (await req.json()) as { access_token?: string; refresh_token?: string };
  } catch {
    return json({ error: "invalid_json" }, { status: 400 });
  }

  const accessToken = (body.access_token ?? "").trim();
  const refreshToken = (body.refresh_token ?? "").trim();
  if (!accessToken) return json({ error: "missing_access_token" }, { status: 400 });

  let cfg;
  try {
    cfg = getSupabaseAuthConfig();
  } catch {
    return json({ error: "server_not_configured" }, { status: 500 });
  }

  const userRes = await fetch(`${cfg.url.replace(/\/+$/, "")}/auth/v1/user`, {
    method: "GET",
    headers: { apikey: cfg.anonKey, authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (!userRes.ok) return json({ error: "invalid_session" }, { status: 401 });

  const expMs = parseJwtExpMs(accessToken);
  const res = json({ ok: true });
  const secure = process.env.NODE_ENV === "production";
  const cookieBase = { httpOnly: true, sameSite: "lax" as const, secure, path: "/" };

  res.cookies.set({
    name: SUPABASE_AT_COOKIE,
    value: accessToken,
    ...cookieBase,
    ...(expMs ? { maxAge: Math.max(60, Math.floor((expMs - Date.now()) / 1000)) } : {}),
  });
  if (refreshToken) {
    res.cookies.set({ name: SUPABASE_RT_COOKIE, value: refreshToken, ...cookieBase, maxAge: 60 * 60 * 24 * 30 });
  }

  return res;
}

