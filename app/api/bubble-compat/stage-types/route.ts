import { NextResponse, type NextRequest } from "next/server";
import { getUserIdFromRequest } from "../../../lib/requestUserId";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin";
import { getBubbleObjCredentials, fetchBubbleObjPage, fetchBubbleObjPageWithConstraints } from "../../../lib/bubbleObjApi";

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

async function fetchAllByEmpresaId(args: { type: string; companyBubbleId: string }) {
  const creds = await getBubbleObjCredentials();
  const companyBubbleId = String(args.companyBubbleId ?? "").trim();
  const type = String(args.type ?? "").trim();
  const keys = ["empresa_id", "empresa"];
  const pageSize = 100;
  for (const key of keys) {
    const out: any[] = [];
    try {
      for (let cursor = 0; cursor < 200_000; cursor += pageSize) {
        const page = await fetchBubbleObjPageWithConstraints<any>({
          creds,
          type,
          cursor,
          limit: pageSize,
          constraints: [{ key, constraint_type: "equals", value: companyBubbleId }],
          timeoutMs: 20_000,
        });
        for (const r of page.results ?? []) out.push(r);
        if ((page.results ?? []).length < pageSize) break;
      }
      return { ok: true as const, results: out, usedKey: key };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const lower = msg.toLowerCase();
      if (lower.includes("field") || lower.includes("constraint") || lower.includes("key")) continue;
      throw err;
    }
  }
  return { ok: false as const, results: [], usedKey: null as string | null };
}

async function fetchAllUnscoped(type: string) {
  const creds = await getBubbleObjCredentials();
  const out: any[] = [];
  const pageSize = 100;
  for (let cursor = 0; cursor < 200_000; cursor += pageSize) {
    const page = await fetchBubbleObjPage<any>({ creds, type, cursor, limit: pageSize });
    for (const r of page.results ?? []) out.push(r);
    if ((page.results ?? []).length < pageSize) break;
  }
  return out;
}

export async function POST(req: NextRequest) {
  try {
    const { userId } = getUserIdFromRequest(req);
    if (!isAdminUserId(userId)) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

    const body = (await req.json().catch(() => null)) as any;
    const email = normalizeLower(body?.email);
    const companyBubbleId = String(body?.companyBubbleId ?? "").trim();
    const types = Array.isArray(body?.types) ? (body.types as any[]).map((x) => String(x ?? "").trim()).filter(Boolean) : [];
    if (!email || !email.includes("@")) return NextResponse.json({ ok: false, error: "missing_email" }, { status: 400 });
    if (!companyBubbleId) return NextResponse.json({ ok: false, error: "missing_companyBubbleId" }, { status: 400 });
    if (!types.length) return NextResponse.json({ ok: false, error: "missing_types" }, { status: 400 });

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

    const nowIso = new Date().toISOString();
    const perType: Record<
      string,
      {
        fetched: number;
        staged: number;
        usedConstraintKey: string | null;
        mode: "empresa_id" | "unscoped" | "unscoped_filtered";
        errors: string[];
      }
    > = {};

    const itemBubbleIdsForCompany = new Set<string>();
    if (types.some((t) => t.toLowerCase() === "ingredientes")) {
      const itemFetch = await fetchAllByEmpresaId({ type: "item", companyBubbleId });
      for (const r of itemFetch.results ?? []) {
        const id = extractBubbleId(r);
        if (id) itemBubbleIdsForCompany.add(id);
      }
    }

    for (const type of types) {
      const t = type.toLowerCase();
      perType[type] = { fetched: 0, staged: 0, usedConstraintKey: null, mode: "empresa_id", errors: [] };

      let results: any[] = [];
      if (t === "ingredientes") {
        const all = await fetchAllUnscoped("ingredientes");
        const filtered = all.filter((r: any) => {
          const recipeId = extractBubbleId(r?.receita_id) || String(r?.receita_id ?? "").trim();
          const ingredientId = extractBubbleId(r?.item_id) || String(r?.item_id ?? "").trim();
          return (recipeId && itemBubbleIdsForCompany.has(recipeId)) || (ingredientId && itemBubbleIdsForCompany.has(ingredientId));
        });
        results = filtered;
        perType[type].mode = "unscoped_filtered";
        perType[type].usedConstraintKey = null;
      } else {
        const fetched = await fetchAllByEmpresaId({ type, companyBubbleId });
        results = fetched.results ?? [];
        perType[type].usedConstraintKey = fetched.usedKey;
        perType[type].mode = "empresa_id";
        if (!fetched.ok && !results.length) perType[type].errors.push("no_usable_empresa_id_constraint");
      }

      perType[type].fetched = results.length;

      const objectType = `${type}@${companyBubbleId}#${supabaseUserId}`;
      const controlRows = [];
      const stagingRows = [];
      for (const raw of results) {
        const bubbleId = extractBubbleId(raw);
        if (!bubbleId) continue;
        controlRows.push({
          bubble_object_type: objectType,
          bubble_unique_id: bubbleId,
          bubble_user_id: bubbleUserId,
          supabase_user_id: supabaseUserId,
          status: "staged",
          error_message: "",
          imported_at: nowIso,
          raw_payload_json: raw,
          updated_at: nowIso,
        } as any);
        stagingRows.push({
          bubble_object_type: objectType,
          bubble_unique_id: bubbleId,
          bubble_user_id: bubbleUserId,
          supabase_user_id: supabaseUserId,
          run_id: null,
          cursor: 0,
          fetched_at: nowIso,
          status: "staged",
          error_message: "",
          raw_payload_json: raw,
          updated_at: nowIso,
        } as any);
      }

      const chunkSize = 250;
      let staged = 0;
      for (let i = 0; i < controlRows.length; i += chunkSize) {
        const part = controlRows.slice(i, i + chunkSize);
        const { error } = await supabase.from("bubble_obj_import_control").upsert(part, { onConflict: "supabase_user_id,bubble_object_type,bubble_unique_id" });
        if (error) perType[type].errors.push(`control_upsert:${error.message}`);
        else staged += part.length;
      }
      for (let i = 0; i < stagingRows.length; i += chunkSize) {
        const part = stagingRows.slice(i, i + chunkSize);
        const { error } = await supabase.from("bubble_obj_import_staging").upsert(part, { onConflict: "supabase_user_id,bubble_object_type,bubble_unique_id" });
        if (error) perType[type].errors.push(`staging_upsert:${error.message}`);
      }

      perType[type].staged = staged;
    }

    return NextResponse.json({ ok: true, email, companyBubbleId, perType });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "unknown_error" }, { status: 500 });
  }
}

