import { NextResponse } from "next/server";

const COOKIE_NAME = "cmv_admin_session";

function base64UrlEncode(bytes: Uint8Array) {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  const b64 = btoa(bin);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function utf8Bytes(value: string) {
  return new TextEncoder().encode(value);
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

export async function POST(req: Request) {
  const secret = (process.env.ADMIN_SECRET ?? "").trim();
  const password = (process.env.ADMIN_LOGIN_PASSWORD ?? "").trim();
  const emailAllow = (process.env.ADMIN_LOGIN_EMAIL ?? "").trim().toLowerCase();

  if (!secret) return NextResponse.json({ error: "server_not_configured" }, { status: 500 });
  if (!password) return NextResponse.json({ error: "server_not_configured" }, { status: 500 });

  let body: { email?: string; password?: string; remember?: boolean } = {};
  try {
    body = (await req.json()) as { email?: string; password?: string; remember?: boolean };
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const email = (body.email ?? "").trim().toLowerCase();
  const pass = (body.password ?? "").trim();
  const remember = Boolean(body.remember);

  if (!email || !pass) return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
  if (emailAllow && emailAllow !== email) return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
  if (pass !== password) return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });

  const exp = Date.now() + (remember ? 30 * 24 * 60 * 60 * 1000 : 8 * 60 * 60 * 1000);
  const payload = { email, exp };
  const payloadB64 = base64UrlEncode(utf8Bytes(JSON.stringify(payload)));
  const sig = await hmacSha256(secret, payloadB64);
  const token = `${payloadB64}.${base64UrlEncode(sig)}`;

  const res = NextResponse.json({ ok: true });
  res.cookies.set({
    name: COOKIE_NAME,
    value: token,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    ...(remember ? { maxAge: 30 * 24 * 60 * 60 } : {}),
  });
  return res;
}

