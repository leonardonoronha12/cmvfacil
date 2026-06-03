import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin";
import { getUserIdFromRequest } from "../../../lib/requestUserId";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return NextResponse.json(data, { ...init, headers });
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function b64urlToBuf(input: string) {
  const s = String(input ?? "").replace(/-/g, "+").replace(/_/g, "/");
  const pad = s.length % 4 ? "=".repeat(4 - (s.length % 4)) : "";
  return Buffer.from(s + pad, "base64");
}

function safeEmail(input: unknown) {
  const v = String(input ?? "").trim().toLowerCase();
  if (!v || !v.includes("@")) return "";
  return v;
}

function safePassword(input: unknown) {
  const v = String(input ?? "").trim();
  if (v.length < 8) return "";
  return v;
}

async function findAuthUserIdByEmail(supabase: ReturnType<typeof getSupabaseAdmin>, email: string) {
  const target = email.trim().toLowerCase();
  for (let page = 1; page <= 2000; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(error.message);
    const users = (data?.users ?? []) as any[];
    for (const u of users) {
      const id = String(u?.id ?? "").trim();
      const em = String(u?.email ?? "").trim().toLowerCase();
      if (id && em === target) return id;
    }
    if (users.length < 1000) break;
  }
  return null;
}

const jwksCache = new Map<string, { fetchedAt: number; keys: any[] }>();

async function verifyVercelOidcToken(token: string) {
  const raw = String(token ?? "").trim();
  const parts = raw.split(".");
  if (parts.length !== 3) return null;
  const [h, p, s] = parts;

  let header: any = null;
  let payload: any = null;
  try {
    header = JSON.parse(b64urlToBuf(h).toString("utf8"));
    payload = JSON.parse(b64urlToBuf(p).toString("utf8"));
  } catch {
    return null;
  }

  if (String(header?.alg ?? "") !== "RS256") return null;
  const kid = String(header?.kid ?? "").trim();
  const iss = String(payload?.iss ?? "").trim();
  if (!kid || !iss) return null;

  const now = Math.floor(Date.now() / 1000);
  const exp = typeof payload?.exp === "number" ? payload.exp : 0;
  const nbf = typeof payload?.nbf === "number" ? payload.nbf : 0;
  if (!exp || exp <= now) return null;
  if (nbf && nbf > now) return null;

  const project = String(payload?.project ?? "").trim();
  if (project !== "cmvfacil_repo") return null;

  const cacheKey = iss;
  const cached = jwksCache.get(cacheKey);
  const fresh = cached && Date.now() - cached.fetchedAt < 10 * 60_000;
  let keys: any[] = fresh ? cached!.keys : [];
  if (!fresh) {
    const jwksUrl = new URL("/.well-known/jwks", iss).toString();
    const res = await fetch(jwksUrl, { cache: "no-store" });
    if (!res.ok) return null;
    const json = (await res.json().catch(() => null)) as any;
    keys = Array.isArray(json?.keys) ? json.keys : [];
    jwksCache.set(cacheKey, { fetchedAt: Date.now(), keys });
  }

  const jwk = keys.find((k) => String(k?.kid ?? "") === kid) ?? null;
  if (!jwk) return null;

  const subtle = crypto.webcrypto?.subtle;
  if (!subtle) return null;

  let key: CryptoKey;
  try {
    key = await subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  } catch {
    return null;
  }

  const data = Buffer.from(`${h}.${p}`, "utf8");
  const sig = b64urlToBuf(s);
  const ok = await subtle.verify("RSASSA-PKCS1-v1_5", key, sig, data);
  if (!ok) return null;

  return payload;
}

export async function POST(req: NextRequest) {
  try {
    const { userId } = getUserIdFromRequest(req);
    const oidcGot = (req.headers.get("x-vercel-oidc-token") ?? "").trim();
    const oidcOk = oidcGot ? Boolean(await verifyVercelOidcToken(oidcGot)) : false;
    const adminOk = Boolean(userId && !isUuid(String(userId)));
    if (!adminOk && !oidcOk) return json({ ok: false, error: "unauthorized" }, { status: 401 });
    if (userId && isUuid(String(userId))) return json({ ok: false, error: "forbidden" }, { status: 403 });

    const body = (await req.json().catch(() => null)) as any;
    const email = safeEmail(body?.email);
    const password = safePassword(body?.password);
    if (!email) return json({ ok: false, error: "missing_email" }, { status: 400 });
    if (!password) return json({ ok: false, error: "weak_password" }, { status: 400 });

    let supabase: ReturnType<typeof getSupabaseAdmin>;
    try {
      supabase = getSupabaseAdmin();
    } catch {
      return json({ ok: false, error: "supabase_not_configured" }, { status: 500 });
    }

    const existingUserId = await findAuthUserIdByEmail(supabase, email);
    if (existingUserId) {
      const upd = await supabase.auth.admin.updateUserById(existingUserId, { password, email_confirm: true } as any);
      if (upd.error) return json({ ok: false, error: upd.error.message }, { status: 500 });
      return json({ ok: true, email, userId: existingUserId, mode: "updated" }, { status: 200 });
    }

    const created = await supabase.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { source: "admin-create-password" } } as any);
    if (created.error) return json({ ok: false, error: created.error.message }, { status: 500 });
    const newId = String((created.data as any)?.user?.id ?? "").trim();
    return json({ ok: true, email, userId: newId || null, mode: "created" }, { status: 200 });
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
