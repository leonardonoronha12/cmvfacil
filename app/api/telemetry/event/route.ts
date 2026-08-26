import { createHash } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getUserIdFromRequest } from "../../../lib/requestUserId";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin";

export const runtime = "nodejs";
const categories = new Set(["session", "navigation", "action", "error", "performance", "system"]);
const clean = (v: unknown, max = 180) => String(v ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max) || null;
function safeMetadata(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, string | number | boolean | null> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>).slice(0, 20)) {
    if (/password|senha|token|secret|cookie|authorization|content|value/i.test(key)) continue;
    if (typeof raw === "number" || typeof raw === "boolean" || raw === null) out[key.slice(0, 60)] = raw;
    else if (typeof raw === "string") out[key.slice(0, 60)] = raw.slice(0, 240);
  }
  return out;
}
function device(ua: string) {
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Outro";
  const os = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Mac OS/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "Outro";
  return { browser, os, device_type: /Mobile|Android|iPhone/.test(ua) ? "Mobile" : /iPad|Tablet/.test(ua) ? "Tablet" : "Desktop" };
}
export async function POST(req: NextRequest) {
  try {
    const { userId } = getUserIdFromRequest(req);
    if (!userId || !/^[0-9a-f-]{36}$/i.test(userId)) return NextResponse.json({ ok: false }, { status: 401 });
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const sessionKey = clean(body.sessionKey, 80);
    const category = clean(body.category, 20);
    const eventName = clean(body.eventName, 80);
    if (!sessionKey || !category || !categories.has(category) || !eventName) return NextResponse.json({ ok: false }, { status: 400 });
    const db = getSupabaseAdmin();
    const { data: member } = await db.from("company_members").select("company_id").eq("user_id", userId).limit(1).maybeSingle();
    const companyId = member?.company_id ?? null;
    const ua = req.headers.get("user-agent") ?? "";
    const info = device(ua);
    const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0]?.trim() ?? "";
    const ipHash = ip ? createHash("sha256").update(`${process.env.TELEMETRY_IP_SALT ?? process.env.ADMIN_SECRET ?? "cmv"}:${ip}`).digest("hex") : null;
    const route = clean(body.route, 240);
    const now = new Date().toISOString();
    const { data: existing } = await db.from("app_sessions").select("page_views,actions_count,errors_count").eq("session_key", sessionKey).maybeSingle();
    const isPage = category === "navigation" && eventName === "page_view";
    const isAction = category === "action";
    const isError = category === "error";
    await db.from("app_sessions").upsert({
      session_key: sessionKey, user_id: userId, company_id: companyId, last_seen_at: now,
      page_views: Number(existing?.page_views ?? 0) + (isPage ? 1 : 0),
      actions_count: Number(existing?.actions_count ?? 0) + (isAction ? 1 : 0),
      errors_count: Number(existing?.errors_count ?? 0) + (isError ? 1 : 0),
      ...info, country: clean(req.headers.get("x-vercel-ip-country"), 8), region: clean(req.headers.get("x-vercel-ip-country-region"), 60),
      city: clean(decodeURIComponent(req.headers.get("x-vercel-ip-city") ?? ""), 100), ip_hash: ipHash,
      entry_route: existing ? undefined : route, current_route: route,
      referrer_host: clean(body.referrerHost, 120), metadata: {},
    }, { onConflict: "session_key" });
    await db.from("app_events").insert({
      session_key: sessionKey, user_id: userId, company_id: companyId, category, event_name: eventName, route,
      target: clean(body.target, 100), success: typeof body.success === "boolean" ? body.success : null,
      duration_ms: Number.isFinite(Number(body.durationMs)) ? Math.max(0, Math.min(3_600_000, Number(body.durationMs))) : null,
      error_code: clean(body.errorCode, 100), metadata: safeMetadata(body.metadata),
    });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false });
  }
}
