import { NextRequest, NextResponse } from "next/server";
import { SUPABASE_AT_COOKIE, SUPABASE_RT_COOKIE } from "./app/lib/supabaseAuthCookies";
import { getSupabaseAuthConfig } from "./app/lib/supabaseAuthConfig";
import { getAuthCookieDomain, shouldUseSecureCookies } from "./app/lib/cookieSecurity";

const COOKIE_NAME = "cmv_admin_session";

function base64UrlToBytes(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (value.length % 4)) % 4);
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function utf8Bytes(value: string) {
  return new TextEncoder().encode(value);
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

async function hmacSha256(secret: string, data: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    utf8Bytes(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, utf8Bytes(data));
  return new Uint8Array(sig);
}

async function isAuthenticated(req: NextRequest) {
  const secret = (process.env.ADMIN_SECRET ?? "").trim();
  if (secret) {
    const token = req.cookies.get(COOKIE_NAME)?.value ?? "";
    const parts = token.split(".");
    if (parts.length === 2) {
      const payloadB64 = parts[0] ?? "";
      const sigB64 = parts[1] ?? "";
      if (payloadB64 && sigB64) {
        let payloadJson = "";
        try {
          payloadJson = new TextDecoder().decode(base64UrlToBytes(payloadB64));
        } catch {
          payloadJson = "";
        }
        if (payloadJson) {
          try {
            const payload = JSON.parse(payloadJson) as { exp?: number };
            const exp = typeof payload.exp === "number" ? payload.exp : 0;
            if (exp && Date.now() <= exp) {
              const expected = await hmacSha256(secret, payloadB64);
              const actual = base64UrlToBytes(sigB64);
              if (timingSafeEqual(expected, actual)) return true;
            }
          } catch {
            // ignore
          }
        }
      }
    }
  }

  const accessToken = (req.cookies.get(SUPABASE_AT_COOKIE)?.value ?? "").trim();
  if (accessToken) {
    const expMs = (() => {
      const parts = accessToken.split(".");
      if (parts.length < 2) return null;
      const payloadB64 = parts[1] ?? "";
      if (!payloadB64) return null;
      const padded = payloadB64.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (payloadB64.length % 4)) % 4);
      try {
        const json = atob(padded);
        const payload = JSON.parse(json) as { exp?: number };
        const expSec = typeof payload.exp === "number" ? payload.exp : 0;
        return expSec ? expSec * 1000 : null;
      } catch {
        return null;
      }
    })();
    if (expMs && Date.now() < expMs - 15_000) return true;
  }

  return false;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

function safeNextPath(value: string) {
  const raw = String(value ?? "").trim();
  if (!raw || raw === "/") return "/dashboard";
  if (!raw.startsWith("/")) return "/dashboard";
  if (raw.startsWith("//")) return "/dashboard";
  if (raw.includes("://")) return "/dashboard";
  return raw;
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isPublicFile = /\.[^/]+$/.test(pathname);
  const host = String(req.headers.get("host") ?? "").toLowerCase();
  const isLocalhost = host.includes("localhost") || host.includes("127.0.0.1");
  const vercelEnv = String(process.env.VERCEL_ENV ?? "").trim().toLowerCase();

  if (vercelEnv === "production" && host.endsWith(".vercel.app") && host !== "cmvfacil.app") {
    const url = req.nextUrl.clone();
    url.host = "cmvfacil.app";
    url.protocol = "https:";
    return NextResponse.redirect(url, 308);
  }

  if (
    isLocalhost &&
    (pathname === "/ajustes/vercel-cli" ||
      pathname.startsWith("/ajustes/vercel-cli/") ||
      pathname === "/ajustes/vercel-alias" ||
      pathname.startsWith("/ajustes/vercel-alias/") ||
      pathname.startsWith("/api/vercel-cli/") ||
      pathname === "/api/vercel/alias" ||
      pathname === "/debug-supabase" ||
      pathname.startsWith("/debug-supabase/") ||
      pathname.startsWith("/api/debug/") ||
      pathname === "/admin/importacao-manual" ||
      pathname.startsWith("/admin/importacao-manual/") ||
      pathname.startsWith("/api/admin/importacao-manual/"))
  ) {
    return NextResponse.next();
  }

  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname === "/login" ||
    pathname.startsWith("/login/") ||
    pathname === "/cadastro-usuario" ||
    pathname.startsWith("/cadastro-usuario/") ||
    pathname === "/billing/return" ||
    pathname.startsWith("/billing/return/") ||
    pathname === "/resetar-senha" ||
    pathname.startsWith("/resetar-senha/") ||
    pathname === "/restaurar-senha" ||
    pathname.startsWith("/restaurar-senha/") ||
    pathname === "/termos-de-uso" ||
    pathname.startsWith("/termos-de-uso/") ||
    pathname === "/robots.txt" ||
    pathname === "/sitemap.xml" ||
    isPublicFile ||
    pathname.startsWith("/api/auth/") ||
    pathname.startsWith("/api/onboarding/") ||
    pathname === "/api/admin/create-user-password" ||
    pathname === "/api/version" ||
    pathname === "/api/health/supabase-config" ||
    pathname === "/api/health/auth-debug" ||
    pathname === "/api/health/bubble-config" ||
    pathname === "/api/health/bubble-ping" ||
    pathname.startsWith("/api/bubble-compat/") ||
    pathname.startsWith("/api/billing/") ||
    pathname.startsWith("/api/cron/") ||
    pathname === "/api/admin/terms-v1-communication" ||
    pathname === "/api/webhooks/resend" ||
    pathname === "/api/webhooks/twilio/support" ||
    pathname.startsWith("/api/support/attachment-link/") ||
    pathname === "/api/stripe/webhook"
  ) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/companies")) {
    return NextResponse.next();
  }

  if (await isAuthenticated(req)) {
    if (pathname === "/") {
      const url = req.nextUrl.clone();
      url.pathname = "/dashboard";
      url.search = "";
      return NextResponse.redirect(url);
    }
    if (
      pathname === "/ajustes" ||
      pathname.startsWith("/ajustes/") ||
      pathname === "/cadastro-empresa" ||
      pathname.startsWith("/cadastro-empresa/") ||
      pathname === "/api/me" ||
      pathname.startsWith("/api/billing/") ||
      pathname === "/api/stripe/webhook"
    ) {
      return NextResponse.next();
    }

    try {
      const checkUrl = req.nextUrl.clone();
      checkUrl.pathname = "/api/billing/access";
      checkUrl.search = "";
      const cookie = req.headers.get("cookie") ?? "";
      const authorization = req.headers.get("authorization") ?? "";
      const res = await fetchWithTimeout(
        checkUrl.toString(),
        { method: "GET", headers: { ...(cookie ? { cookie } : {}), ...(authorization ? { authorization } : {}), "x-cmv-middleware": "1" } },
        8000,
      );
      const data = (await res.json().catch(() => null)) as { access?: { allowed?: boolean } } | null;
      const allowed = Boolean(data?.access?.allowed);
      if (allowed) return NextResponse.next();

      if (pathname.startsWith("/api/")) {
        return NextResponse.json({ error: "subscription_required", access: data?.access ?? null }, { status: 402 });
      }

      const url = req.nextUrl.clone();
      url.pathname = "/ajustes";
      url.searchParams.set("tab", "planos");
      url.searchParams.set("blocked", "1");
      url.searchParams.set("from", pathname);
      return NextResponse.redirect(url);
    } catch {
      if (pathname.startsWith("/api/")) {
        return NextResponse.json({ error: "billing_check_failed" }, { status: 503 });
      }
      const url = req.nextUrl.clone();
      url.pathname = "/ajustes";
      url.searchParams.set("tab", "planos");
      url.searchParams.set("blocked", "1");
      url.searchParams.set("reason", "billing_check_failed");
      url.searchParams.set("from", pathname);
      return NextResponse.redirect(url);
    }
  }

  const refreshToken = (req.cookies.get(SUPABASE_RT_COOKIE)?.value ?? "").trim();
  if (refreshToken) {
    try {
      const cfg = getSupabaseAuthConfig();
      const url = `${cfg.url.replace(/\/+$/, "")}/auth/v1/token?grant_type=refresh_token`;
      const res = await fetchWithTimeout(
        url,
        {
          method: "POST",
          headers: { apikey: cfg.anonKey, "content-type": "application/json" },
          body: JSON.stringify({ refresh_token: refreshToken }),
        },
        2500,
      );
      const data = (await res.json().catch(() => null)) as
        | { access_token?: string; refresh_token?: string; expires_in?: number }
        | null;
      if (res.ok && data?.access_token) {
        const out = NextResponse.next();
        const secure = shouldUseSecureCookies(req);
        const domain = getAuthCookieDomain(req);
        out.cookies.set({
          name: SUPABASE_AT_COOKIE,
          value: data.access_token,
          httpOnly: true,
          sameSite: "lax",
          secure,
          path: "/",
          ...(domain ? { domain } : {}),
        });
        if (data.refresh_token) {
          out.cookies.set({
            name: SUPABASE_RT_COOKIE,
            value: data.refresh_token,
            httpOnly: true,
            sameSite: "lax",
            secure,
            path: "/",
            maxAge: 60 * 60 * 24 * 30,
            ...(domain ? { domain } : {}),
          });
        }
        return out;
      }
    } catch {
      // ignore
    }
  }

  if (pathname === "/api/bubble-obj/stage/start") {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  url.searchParams.set("next", safeNextPath(`${pathname}${req.nextUrl.search}`));
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
