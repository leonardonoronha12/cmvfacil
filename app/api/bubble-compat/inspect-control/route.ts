import { NextResponse, type NextRequest } from "next/server";
import { getUserIdFromRequest } from "../../../lib/requestUserId";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseCsvEnv(name: string) {
  const raw = String(process.env[name] ?? "").trim();
  if (!raw) return [];
  return raw
    .split(/[,\n;]/g)
    .map((x) => x.trim())
    .filter(Boolean);
}

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(v ?? "").trim());
}

function isAdminUserId(userId: string | null) {
  const v = String(userId ?? "").trim();
  if (!v) return false;
  const admins = parseCsvEnv("ADMIN_USER_IDS");
  const emails = parseCsvEnv("ADMIN_EMAILS");
  if (v.includes("@")) return emails.map((e) => e.toLowerCase()).includes(v.toLowerCase());
  if (isUuid(v)) return admins.includes(v);
  return false;
}

export async function POST(req: NextRequest) {
  try {
    const { userId } = getUserIdFromRequest(req);
    if (!isAdminUserId(userId)) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

    const body = (await req.json().catch(() => null)) as any;
    const email = String(body?.email ?? "").trim().toLowerCase();
    const bubbleUniqueId = String(body?.bubbleUniqueId ?? "").trim();
    if (!email || !email.includes("@")) return NextResponse.json({ ok: false, error: "missing_email" }, { status: 400 });
    if (!bubbleUniqueId) return NextResponse.json({ ok: false, error: "missing_bubbleUniqueId" }, { status: 400 });

    const supabase = getSupabaseAdmin();
    const { data: mapRow, error: mapErr } = await supabase
      .from("bubble_obj_user_map")
      .select("bubble_user_id,supabase_user_id")
      .eq("email", email)
      .maybeSingle();
    if (mapErr) return NextResponse.json({ ok: false, error: mapErr.message }, { status: 500 });
    const bubbleUserId = String((mapRow as any)?.bubble_user_id ?? "").trim();
    const supabaseUserId = String((mapRow as any)?.supabase_user_id ?? "").trim();
    if (!bubbleUserId || !supabaseUserId) return NextResponse.json({ ok: false, error: "missing_user_mapping" }, { status: 400 });

    const { data, error } = await supabase
      .from("bubble_obj_import_control")
      .select("bubble_object_type,bubble_unique_id,raw_payload_json")
      .eq("bubble_user_id", bubbleUserId)
      .eq("supabase_user_id", supabaseUserId)
      .eq("bubble_unique_id", bubbleUniqueId)
      .limit(1);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    const row = (data ?? [])[0] as any;
    if (!row) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
    const raw = row.raw_payload_json ?? {};

    return NextResponse.json({
      ok: true,
      bubble_object_type: row.bubble_object_type,
      bubble_unique_id: row.bubble_unique_id,
      keys: Object.keys(raw ?? {}),
      raw,
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "unknown_error" }, { status: 500 });
  }
}

