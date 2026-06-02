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
  if (!raw) return false;
  if (raw.includes("@") && process.env.ADMIN_SECRET) return true;
  if (ids.size && ids.has(raw)) return true;
  if (emails.size && emails.has(raw)) return true;
  return false;
}

function normalizeEmail(value: string) {
  return String(value ?? "").trim().toLowerCase();
}

export async function GET(req: NextRequest) {
  try {
    const { userId } = getUserIdFromRequest(req);
    if (!userId) return json({ ok: false, error: "unauthorized" }, { status: 401 });
    if (!isAdminUserId(userId)) return json({ ok: false, error: "forbidden" }, { status: 403 });

    const url = new URL(req.url);
    const email = normalizeEmail(url.searchParams.get("email") ?? "");
    if (!email || !email.includes("@")) return json({ ok: false, error: "invalid_email" }, { status: 400 });

    let supabase: ReturnType<typeof getSupabaseAdmin>;
    try {
      supabase = getSupabaseAdmin();
    } catch {
      return json({ ok: false, error: "supabase_not_configured" }, { status: 500 });
    }

    const redirectTo = `${url.origin}/dashboard`;
    const { data, error } = await supabase.auth.admin.generateLink({ type: "magiclink", email, options: { redirectTo } } as any);
    if (error) return json({ ok: false, error: error.message }, { status: 500 });

    const actionLink = (data as any)?.properties?.action_link ? String((data as any).properties.action_link) : "";
    if (!actionLink) return json({ ok: false, error: "missing_action_link" }, { status: 500 });

    return json({ ok: true, email, redirectTo, actionLink }, { status: 200 });
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

