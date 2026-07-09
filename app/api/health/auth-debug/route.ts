import { NextRequest, NextResponse } from "next/server";
import { shouldUseSecureCookies } from "../../../lib/cookieSecurity";
import { getSupabaseAuthConfig } from "../../../lib/supabaseAuthConfig";
import { SUPABASE_AT_COOKIE, SUPABASE_RT_COOKIE } from "../../../lib/supabaseAuthCookies";
import { getUserIdFromRequest } from "../../../lib/requestUserId";

export const dynamic = "force-dynamic";

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store, no-cache, must-revalidate, max-age=0");
  return NextResponse.json(data, { ...init, headers });
}

function extractSupabaseProjectRef(url: string) {
  try {
    const u = new URL(url);
    const host = String(u.hostname ?? "").trim().toLowerCase();
    const m = host.match(/^([a-z0-9-]+)\.supabase\.co$/i);
    return m?.[1] ? String(m[1]).trim() : null;
  } catch {
    return null;
  }
}

function parseJwtMeta(jwt: string) {
  const parts = jwt.split(".");
  if (parts.length < 2) return { sub: null, expMs: null };
  const payloadB64 = parts[1] ?? "";
  if (!payloadB64) return { sub: null, expMs: null };
  const padded = payloadB64.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (payloadB64.length % 4)) % 4);
  try {
    const jsonStr = atob(padded);
    const payload = JSON.parse(jsonStr) as { sub?: string; exp?: number };
    const sub = String(payload.sub ?? "").trim() || null;
    const expSec = typeof payload.exp === "number" ? payload.exp : 0;
    const expMs = expSec ? expSec * 1000 : null;
    return { sub, expMs };
  } catch {
    return { sub: null, expMs: null };
  }
}

export async function GET(req: NextRequest) {
  const host = String(req.headers.get("host") ?? "").trim();
  const xfProto = String(req.headers.get("x-forwarded-proto") ?? "").trim();
  const xfHost = String(req.headers.get("x-forwarded-host") ?? "").trim();
  const xfFor = String(req.headers.get("x-forwarded-for") ?? "").trim();

  const secureCookies = shouldUseSecureCookies(req);
  const at = String(req.cookies.get(SUPABASE_AT_COOKIE)?.value ?? "").trim();
  const rt = String(req.cookies.get(SUPABASE_RT_COOKIE)?.value ?? "").trim();
  const admin = String(req.cookies.get("cmv_admin_session")?.value ?? "").trim();

  let cfg: { url: string; anonKey: string } | null = null;
  let cfgError = "";
  try {
    cfg = getSupabaseAuthConfig();
  } catch (err) {
    cfg = null;
    cfgError = err instanceof Error ? err.message : String(err);
  }

  let authProbe: any = null;
  if (cfg) {
    try {
      const endpoint = `${cfg.url.replace(/\/+$/, "")}/auth/v1/health`;
      const res = await fetch(endpoint, { headers: { apikey: cfg.anonKey }, cache: "no-store" });
      const text = await res.text().catch(() => "");
      authProbe = { status: res.status, bodyStart: text.slice(0, 200) };
    } catch (err) {
      authProbe = { status: 0, bodyStart: String(err instanceof Error ? err.message : err).slice(0, 200) };
    }
  }

  const jwtMeta = at ? parseJwtMeta(at) : { sub: null, expMs: null };
  const { userId } = getUserIdFromRequest(req);

  return json(
    {
      ok: true,
      request: { host, xfProto, xfHost, xfFor, url: req.url },
      cookies: {
        secureCookies,
        present: { cmv_at: Boolean(at), cmv_rt: Boolean(rt), cmv_admin_session: Boolean(admin) },
        accessToken: at ? { sub: jwtMeta.sub, expMs: jwtMeta.expMs } : null,
      },
      auth: { userId },
      supabase: cfg
        ? { configured: true, projectRef: extractSupabaseProjectRef(cfg.url), urlLooksOk: Boolean(cfg.url), anonKeyLooksOk: Boolean(cfg.anonKey), authProbe }
        : { configured: false, error: cfgError },
    },
    { status: 200 },
  );
}

