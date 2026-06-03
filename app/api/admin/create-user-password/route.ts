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

function safeEqual(a: string, b: string) {
  const aBuf = Buffer.from(String(a ?? ""), "utf8");
  const bBuf = Buffer.from(String(b ?? ""), "utf8");
  if (aBuf.length !== bBuf.length) return false;
  if (!aBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
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

export async function POST(req: NextRequest) {
  try {
    const { userId } = getUserIdFromRequest(req);
    const oidcExpected = (process.env.VERCEL_OIDC_TOKEN ?? "").trim();
    const oidcGot = (req.headers.get("x-vercel-oidc-token") ?? "").trim();
    const oidcOk = oidcExpected && oidcGot ? safeEqual(oidcExpected, oidcGot) : false;
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
