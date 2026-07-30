import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAuthConfig } from "../../../lib/supabaseAuthConfig";
import { SUPABASE_AT_COOKIE, SUPABASE_RT_COOKIE, parseJwtExpMs } from "../../../lib/supabaseAuthCookies";
import { getAuthCookieDomain, shouldUseSecureCookies } from "../../../lib/cookieSecurity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const tokenHash = String(req.nextUrl.searchParams.get("token_hash") ?? "").trim();
  if (!tokenHash) return NextResponse.redirect(new URL("/login?migration=invalid", req.url));

  try {
    const config = getSupabaseAuthConfig();
    const supabase = createClient(config.url, config.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const verified = await supabase.auth.verifyOtp({ type: "magiclink", token_hash: tokenHash });
    const session = verified.data.session;
    if (verified.error || !session) return NextResponse.redirect(new URL("/login?migration=expired", req.url));

    const response = NextResponse.redirect(new URL("/atualizacao", req.url));
    const secure = shouldUseSecureCookies(req);
    const domain = getAuthCookieDomain(req);
    const cookieBase = {
      httpOnly: true,
      sameSite: "lax" as const,
      secure,
      path: "/",
      ...(domain ? { domain } : {}),
    };
    const expMs = parseJwtExpMs(session.access_token);
    response.cookies.set({
      name: SUPABASE_AT_COOKIE,
      value: session.access_token,
      ...cookieBase,
      ...(expMs ? { maxAge: Math.max(60, Math.floor((expMs - Date.now()) / 1000)) } : {}),
    });
    if (session.refresh_token) {
      response.cookies.set({
        name: SUPABASE_RT_COOKIE,
        value: session.refresh_token,
        ...cookieBase,
        maxAge: 60 * 60 * 24 * 30,
      });
    }
    return response;
  } catch {
    return NextResponse.redirect(new URL("/login?migration=error", req.url));
  }
}

