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

async function createInvite(args: { req: NextRequest; email: string; redirectTo: string }) {
  const { req, email, redirectTo } = args;

  let supabase: ReturnType<typeof getSupabaseAdmin>;
  try {
    supabase = getSupabaseAdmin();
  } catch {
    return { ok: false as const, status: 500, error: "supabase_not_configured" };
  }

  await supabase.auth.admin
    .createUser({ email, password: randomPassword(), email_confirm: true, user_metadata: { source: "admin-create" } } as any)
    .catch(() => null);

  const invite = await supabase.auth.admin.generateLink({ type: "invite", email, options: { redirectTo } } as any);
  if (invite.error) return { ok: false as const, status: 500, error: invite.error.message };

  const actionLink = String((invite.data as any)?.properties?.action_link ?? "").trim();
  const createdUserId = String((invite.data as any)?.user?.id ?? "").trim();
  if (!actionLink) return { ok: false as const, status: 500, error: "missing_action_link" };

  return { ok: true as const, status: 200, email, userId: createdUserId || null, redirectTo, actionLink };
}

export async function GET(req: NextRequest) {
  try {
    const { userId } = getUserIdFromRequest(req);
    if (!userId) return json({ ok: false, error: "unauthorized" }, { status: 401 });
    if (isUuid(String(userId))) return json({ ok: false, error: "forbidden" }, { status: 403 });

    const url = new URL(req.url);
    const email = safeEmail(url.searchParams.get("email") ?? "");
    const redirectToRaw = String(url.searchParams.get("redirectTo") ?? "").trim();
    const redirectTo = redirectToRaw || `${url.origin}/restaurar-senha`;
    if (!email) return json({ ok: false, error: "missing_email" }, { status: 400 });

    const result = await createInvite({ req, email, redirectTo });
    return json(result.ok ? { ok: true, email: result.email, userId: result.userId, redirectTo: result.redirectTo, actionLink: result.actionLink } : { ok: false, error: result.error }, {
      status: result.status,
    });
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
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
    const result = await createInvite({ req, email, redirectTo });
    if (!result.ok) return json({ ok: false, error: result.error }, { status: result.status });
    return json({ ok: true, email: result.email, userId: result.userId, redirectTo: result.redirectTo, actionLink: result.actionLink }, { status: 200 });
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
