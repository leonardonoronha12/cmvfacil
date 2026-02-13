import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAuthConfig } from "../../../lib/supabaseAuthConfig";
import { SUPABASE_AT_COOKIE, SUPABASE_RT_COOKIE } from "../../../lib/supabaseAuthCookies";

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  return NextResponse.json(data, { ...init, headers });
}

export async function POST(req: NextRequest) {
  const accessToken = (req.cookies.get(SUPABASE_AT_COOKIE)?.value ?? "").trim();
  const refreshToken = (req.cookies.get(SUPABASE_RT_COOKIE)?.value ?? "").trim();

  try {
    const cfg = getSupabaseAuthConfig();
    if (accessToken) {
      await fetch(`${cfg.url.replace(/\/+$/, "")}/auth/v1/logout`, {
        method: "POST",
        headers: { apikey: cfg.anonKey, authorization: `Bearer ${accessToken}` },
      }).catch(() => null);
    } else if (refreshToken) {
      await fetch(`${cfg.url.replace(/\/+$/, "")}/auth/v1/logout`, {
        method: "POST",
        headers: { apikey: cfg.anonKey, authorization: `Bearer ${refreshToken}` },
      }).catch(() => null);
    }
  } catch {
    // ignore
  }

  const res = json({ ok: true });
  res.cookies.set({ name: SUPABASE_AT_COOKIE, value: "", path: "/", maxAge: 0 });
  res.cookies.set({ name: SUPABASE_RT_COOKIE, value: "", path: "/", maxAge: 0 });
  return res;
}

