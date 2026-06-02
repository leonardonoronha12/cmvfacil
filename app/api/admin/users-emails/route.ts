import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin";
import { getUserIdFromRequest } from "../../../lib/requestUserId";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return NextResponse.json(data, { ...init, headers });
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function parseCsvEnv(value: string | undefined) {
  return String(value ?? "")
    .split(/[,\n;]/g)
    .map((x) => x.trim())
    .filter(Boolean);
}

function isAdminUserId(userId: string) {
  const ids = new Set(parseCsvEnv(process.env.ADMIN_USER_IDS).map((x) => x.toLowerCase()));
  const emails = new Set(parseCsvEnv(process.env.ADMIN_USER_EMAILS).map((x) => x.toLowerCase()));
  const raw = userId.toLowerCase();
  if (!isUuid(userId) && raw.includes("@") && process.env.ADMIN_SECRET) return true;
  if (ids.size && ids.has(raw)) return true;
  if (emails.size && emails.has(raw)) return true;
  return false;
}

async function listAllAuthUsers(supabase: ReturnType<typeof getSupabaseAdmin>) {
  const out: Array<{ id: string; email: string | null; created_at: string | null; last_sign_in_at: string | null; banned_until: string | null }> = [];
  for (let page = 1; page <= 2000; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`auth_list_users:${error.message}`);
    const users = (data?.users ?? []) as any[];
    for (const u of users) {
      out.push({
        id: String(u?.id ?? "").trim(),
        email: u?.email ? String(u.email).trim() : null,
        created_at: u?.created_at ? String(u.created_at).trim() : null,
        last_sign_in_at: u?.last_sign_in_at ? String(u.last_sign_in_at).trim() : null,
        banned_until: u?.banned_until ? String(u.banned_until).trim() : null,
      });
    }
    if (users.length < 1000) break;
  }
  return out;
}

export async function GET(req: NextRequest) {
  try {
    const { userId } = getUserIdFromRequest(req);
    if (!userId) return json({ ok: false, error: "unauthorized" }, { status: 401 });
    if (!isAdminUserId(userId)) return json({ ok: false, error: "forbidden" }, { status: 403 });

    let supabase: ReturnType<typeof getSupabaseAdmin>;
    try {
      supabase = getSupabaseAdmin();
    } catch {
      return json({ ok: false, error: "supabase_not_configured" }, { status: 500 });
    }

    const users = await listAllAuthUsers(supabase);
    users.sort((a, b) => (a.email ?? "").localeCompare(b.email ?? ""));
    const emails = users.map((u) => u.email).filter((e): e is string => Boolean(e && e.includes("@")));
    return json({ ok: true, count: users.length, emailsCount: emails.length, emails, users }, { status: 200 });
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

