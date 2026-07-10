import { NextResponse, type NextRequest } from "next/server";
import { getUserIdFromRequest } from "../../../lib/requestUserId";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin";
import { getBubbleObjCredentials, fetchBubbleObjPageWithConstraints } from "../../../lib/bubbleObjApi";

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

function normalizeLower(v: unknown) {
  return String(v ?? "").trim().toLowerCase();
}

function extractBubbleId(obj: any) {
  const direct = String(obj?.unique_id ?? obj?._id ?? obj?.id ?? "").trim();
  if (direct) return direct;
  try {
    const s = JSON.stringify(obj);
    const m = s.match(/\d{8,}x\d{6,}/);
    return m ? String(m[0]).trim() : "";
  } catch {
    return "";
  }
}

async function fetchEmpresaById(bubbleCompanyId: string) {
  const creds = await getBubbleObjCredentials();
  const id = String(bubbleCompanyId ?? "").trim();
  const keys = ["_id", "id", "unique_id"];
  for (const key of keys) {
    let page: { results: any[] } | null = null;
    try {
      page = await fetchBubbleObjPageWithConstraints<any>({
        creds,
        type: "empresas",
        cursor: 0,
        limit: 10,
        constraints: [{ key, constraint_type: "equals", value: id }],
        timeoutMs: 15_000,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const lower = msg.toLowerCase();
      if (lower.includes("field not found") || lower.includes("constraint") || lower.includes("constraints") || lower.includes("key")) continue;
      throw err;
    }
    const results = page?.results ?? [];
    for (const r of results) {
      const rid = extractBubbleId(r);
      if (rid === id) return r;
    }
    if (results.length) return results[0]!;
  }
  return null;
}

export async function POST(req: NextRequest) {
  try {
    const { userId } = getUserIdFromRequest(req);
    if (!isAdminUserId(userId)) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

    const body = (await req.json().catch(() => null)) as any;
    const email = normalizeLower(body?.email);
    const bubbleCompanyId = String(body?.bubbleCompanyId ?? "").trim();
    if (!email || !email.includes("@")) return NextResponse.json({ ok: false, error: "missing_email" }, { status: 400 });
    if (!bubbleCompanyId) return NextResponse.json({ ok: false, error: "missing_bubbleCompanyId" }, { status: 400 });

    const supabase = getSupabaseAdmin();
    const { data: mapRow, error: mapErr } = await supabase
      .from("bubble_obj_user_map")
      .select("bubble_user_id,supabase_user_id,email")
      .eq("email", email)
      .limit(1)
      .maybeSingle();
    if (mapErr) return NextResponse.json({ ok: false, error: mapErr.message }, { status: 500 });
    const bubbleUserId = String((mapRow as any)?.bubble_user_id ?? "").trim();
    const supabaseUserId = String((mapRow as any)?.supabase_user_id ?? "").trim();
    if (!bubbleUserId || !supabaseUserId) return NextResponse.json({ ok: false, error: "missing_user_mapping" }, { status: 400 });

    const empresa = await fetchEmpresaById(bubbleCompanyId);
    if (!empresa) return NextResponse.json({ ok: false, error: "empresa_not_found_in_bubble" }, { status: 404 });

    const objectType = `empresas#${supabaseUserId}`;
    const nowIso = new Date().toISOString();

    const controlRow: any = {
      bubble_object_type: objectType,
      bubble_unique_id: bubbleCompanyId,
      bubble_user_id: bubbleUserId,
      supabase_user_id: supabaseUserId,
      status: "staged",
      error_message: "",
      imported_at: nowIso,
      raw_payload_json: empresa,
      updated_at: nowIso,
    };

    const stagingRow: any = {
      bubble_object_type: objectType,
      bubble_unique_id: bubbleCompanyId,
      bubble_user_id: bubbleUserId,
      supabase_user_id: supabaseUserId,
      run_id: null,
      cursor: 0,
      fetched_at: nowIso,
      status: "staged",
      error_message: "",
      raw_payload_json: empresa,
      updated_at: nowIso,
    };

    const { error: upsertControlErr } = await supabase
      .from("bubble_obj_import_control")
      .upsert(controlRow, { onConflict: "supabase_user_id,bubble_object_type,bubble_unique_id" });
    if (upsertControlErr) return NextResponse.json({ ok: false, error: upsertControlErr.message }, { status: 500 });

    const { error: upsertStagingErr } = await supabase
      .from("bubble_obj_import_staging")
      .upsert(stagingRow, { onConflict: "supabase_user_id,bubble_object_type,bubble_unique_id" });
    if (upsertStagingErr) return NextResponse.json({ ok: false, error: upsertStagingErr.message }, { status: 500 });

    return NextResponse.json({ ok: true, staged: { bubbleCompanyId, bubbleUserId, supabaseUserId, objectType } });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "unknown_error" }, { status: 500 });
  }
}
