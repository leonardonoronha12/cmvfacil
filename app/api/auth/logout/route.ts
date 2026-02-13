import { NextResponse } from "next/server";
import { getSupabaseAuthConfig } from "../../../lib/supabaseAuthConfig";
import { SUPABASE_AT_COOKIE, SUPABASE_RT_COOKIE } from "../../../lib/supabaseAuthCookies";

const COOKIE_NAME = "cmv_admin_session";

export async function POST(req: Request) {
  const cookieHeader = req.headers.get("cookie") ?? "";
  const accessToken = (cookieHeader.match(new RegExp(`${SUPABASE_AT_COOKIE}=([^;]+)`))?.[1] ?? "").trim();
  const refreshToken = (cookieHeader.match(new RegExp(`${SUPABASE_RT_COOKIE}=([^;]+)`))?.[1] ?? "").trim();

  try {
    const cfg = getSupabaseAuthConfig();
    const token = accessToken || refreshToken;
    if (token) {
      await fetch(`${cfg.url.replace(/\/+$/, "")}/auth/v1/logout`, {
        method: "POST",
        headers: { apikey: cfg.anonKey, authorization: `Bearer ${token}` },
      }).catch(() => null);
    }
  } catch {
    // ignore
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set({
    name: COOKIE_NAME,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  res.cookies.set({ name: SUPABASE_AT_COOKIE, value: "", path: "/", maxAge: 0 });
  res.cookies.set({ name: SUPABASE_RT_COOKIE, value: "", path: "/", maxAge: 0 });
  return res;
}
