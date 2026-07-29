import "server-only";

import crypto from "crypto";
import { NextRequest } from "next/server";
import { getSupabaseAdmin } from "./supabaseAdmin";

function hashShort(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 24);
}

function getClientIp(req: NextRequest) {
  const xf = String(req.headers.get("x-forwarded-for") ?? "").trim();
  if (xf) return xf.split(",")[0]?.trim() || "";
  return String(req.headers.get("x-real-ip") ?? "").trim();
}

export async function checkAuthRateLimit(args: { req: NextRequest; action: "password_reset"; email: string }) {
  const ip = getClientIp(args.req);
  const ipKey = ip ? hashShort(ip) : "noip";
  const emailKey = args.email ? hashShort(String(args.email).trim().toLowerCase()) : "noemail";
  const key = `${args.action}:${ipKey}:${emailKey}`;

  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.rpc("auth_check_rate_limit", {
      p_key: key,
      p_window_seconds: 900,
      p_max: 5,
    } as any);
    if (error) return { ok: true as const };
    const allowed = Boolean((data as any)?.allowed);
    return allowed ? { ok: true as const } : { ok: false as const, error: "rate_limited" as const };
  } catch {
    return { ok: true as const };
  }
}
