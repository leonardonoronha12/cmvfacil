import { NextRequest, NextResponse } from "next/server";
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

function randomPassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
  let out = "";
  for (let i = 0; i < 24; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function safeEmail(input: unknown) {
  const v = String(input ?? "").trim().toLowerCase();
  if (!v || !v.includes("@")) return "";
  return v;
}

export async function POST(req: NextRequest) {
  try {
    const { userId } = getUserIdFromRequest(req);
    if (!userId) return json({ ok: false, error: "unauthorized" }, { status: 401 });
    if (isUuid(String(userId))) return json({ ok: false, error: "forbidden" }, { status: 403 });

    const body = (await req.json().catch(() => null)) as any;
    const email = safeEmail(body?.email);
    const redirectToRaw = String(body?.redirectTo ?? "").trim();
    const url = new URL(req.url);
    const redirectTo = redirectToRaw || `${url.origin}/restaurar-senha`;
    if (!email) return json({ ok: false, error: "missing_email" }, { status: 400 });

    let supabase: ReturnType<typeof getSupabaseAdmin>;
    try {
      supabase = getSupabaseAdmin();
    } catch {
      return json({ ok: false, error: "supabase_not_configured" }, { status: 500 });
    }

    await supabase.auth.admin
      .createUser({ email, password: randomPassword(), email_confirm: true, user_metadata: { source: "admin-create" } } as any)
      .catch(() => null);

    const invite = await supabase.auth.admin.generateLink({ type: "invite", email, options: { redirectTo } } as any);
    if (invite.error) return json({ ok: false, error: invite.error.message }, { status: 500 });

    const actionLink = String((invite.data as any)?.properties?.action_link ?? "").trim();
    const createdUserId = String((invite.data as any)?.user?.id ?? "").trim();
    if (!actionLink) return json({ ok: false, error: "missing_action_link" }, { status: 500 });

    return json({ ok: true, email, userId: createdUserId || null, redirectTo, actionLink }, { status: 200 });
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

