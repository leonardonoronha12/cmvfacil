import type { NextRequest } from "next/server";
import crypto from "crypto";
import { SUPABASE_AT_COOKIE } from "./supabaseAuthCookies";

const ADMIN_COOKIE_NAME = "cmv_admin_session";

function base64UrlDecodeToString(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (value.length % 4)) % 4);
  return Buffer.from(padded, "base64").toString("utf8");
}

function parseSupabaseJwtSub(jwt: string) {
  const parts = jwt.split(".");
  if (parts.length < 2) return null;
  const payloadB64 = parts[1] ?? "";
  if (!payloadB64) return null;
  try {
    const jsonStr = base64UrlDecodeToString(payloadB64);
    const obj = JSON.parse(jsonStr) as { sub?: string };
    const sub = String(obj.sub ?? "").trim();
    return sub || null;
  } catch {
    return null;
  }
}

function base64UrlEncode(buf: Buffer) {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function parseAdminSessionEmail(req: NextRequest) {
  const secret = (process.env.ADMIN_SECRET ?? "").trim();
  if (!secret) return null;
  const token = (req.cookies.get(ADMIN_COOKIE_NAME)?.value ?? "").trim();
  if (!token) return null;
  const [payloadB64, sigB64] = token.split(".", 2);
  if (!payloadB64 || !sigB64) return null;
  try {
    const expected = crypto.createHmac("sha256", secret).update(payloadB64).digest();
    const actual = Buffer.from(sigB64.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (sigB64.length % 4)) % 4), "base64");
    if (expected.length !== actual.length) return null;
    if (!crypto.timingSafeEqual(expected, actual)) return null;
    const payloadJson = base64UrlDecodeToString(payloadB64);
    const payload = JSON.parse(payloadJson) as { email?: string; exp?: number };
    const email = String(payload.email ?? "").trim().toLowerCase();
    const exp = typeof payload.exp === "number" ? payload.exp : 0;
    if (!email || !exp || Date.now() > exp) return null;
    return email;
  } catch {
    return null;
  }
}

export function getUserIdFromRequest(req: NextRequest) {
  const auth = (req.headers.get("authorization") ?? "").trim();
  if (auth.toLowerCase().startsWith("bearer ")) {
    const bearer = auth.slice(7).trim();
    const bearerSub = bearer ? parseSupabaseJwtSub(bearer) : null;
    if (bearerSub) return { accessToken: bearer, userId: bearerSub };
  }
  const accessToken = (req.cookies.get(SUPABASE_AT_COOKIE)?.value ?? "").trim();
  const supabaseUserId = accessToken ? parseSupabaseJwtSub(accessToken) : null;
  if (supabaseUserId) return { accessToken, userId: supabaseUserId };
  const adminEmail = parseAdminSessionEmail(req);
  if (adminEmail) return { accessToken, userId: adminEmail };
  return { accessToken, userId: null as string | null };
}
