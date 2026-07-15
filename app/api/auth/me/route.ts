import { NextRequest, NextResponse } from "next/server";
import { getUserIdFromRequest } from "../../../lib/requestUserId";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin";

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  return NextResponse.json(data, { ...init, headers });
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function safeEmail(input: unknown) {
  const v = String(input ?? "").trim().toLowerCase();
  if (!v || !v.includes("@")) return "";
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

export async function GET(req: NextRequest) {
  const { userId } = getUserIdFromRequest(req);
  if (!userId) return json({ userId: null }, { status: 200 });

  const raw = String(userId ?? "").trim();
  if (isUuid(raw)) return json({ userId: raw }, { status: 200 });

  const email = safeEmail(raw);
  if (!email) return json({ userId: null }, { status: 200 });

  let supabase: ReturnType<typeof getSupabaseAdmin> | null = null;
  try {
    supabase = getSupabaseAdmin();
  } catch {
    supabase = null;
  }
  if (!supabase) return json({ userId: null }, { status: 200 });

  const { data: profileDb } = await supabase.from("user_profiles").select("user_id").eq("email", email).maybeSingle();
  const fromProfile = String((profileDb as any)?.user_id ?? "").trim();
  if (fromProfile && isUuid(fromProfile)) return json({ userId: fromProfile }, { status: 200 });

  const fromAuth = await findAuthUserIdByEmail(supabase, email);
  if (fromAuth && isUuid(fromAuth)) return json({ userId: fromAuth }, { status: 200 });

  return json({ userId: null }, { status: 200 });
}
