import { NextRequest, NextResponse } from "next/server";
import { SUPABASE_AT_COOKIE } from "../../../lib/supabaseAuthCookies";

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  return NextResponse.json(data, { ...init, headers });
}

function parseJwtSub(jwt: string) {
  const parts = jwt.split(".");
  if (parts.length < 2) return null;
  const payloadB64 = parts[1] ?? "";
  if (!payloadB64) return null;
  const padded = payloadB64.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (payloadB64.length % 4)) % 4);
  try {
    const jsonStr = Buffer.from(padded, "base64").toString("utf8");
    const obj = JSON.parse(jsonStr) as { sub?: string };
    const sub = String(obj.sub ?? "").trim();
    return sub || null;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const accessToken = (req.cookies.get(SUPABASE_AT_COOKIE)?.value ?? "").trim();
  const userId = accessToken ? parseJwtSub(accessToken) : null;
  return json({ userId }, { status: 200 });
}

