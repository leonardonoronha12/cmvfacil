import { NextRequest, NextResponse } from "next/server";
import { getUserIdFromRequest } from "../../../lib/requestUserId";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

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

type Body = {
  targetUserId?: string;
  confirm?: string;
};

export async function POST(req: NextRequest) {
  try {
    const { userId } = getUserIdFromRequest(req);
    if (!userId) return json({ ok: false, error: "unauthorized" }, { status: 401 });

    const body = (await req.json().catch(() => null)) as Body | null;
    const targetUserId = String(body?.targetUserId ?? "").trim();
    const confirm = String(body?.confirm ?? "").trim();
    if (!targetUserId || !isUuid(targetUserId)) return json({ ok: false, error: "invalid_target_user_id" }, { status: 400 });
    if (confirm !== `PURGE:${targetUserId}`) return json({ ok: false, error: "invalid_confirm" }, { status: 400 });

    const requesterIsUuid = isUuid(String(userId));
    const selfOk = requesterIsUuid && String(userId).toLowerCase() === targetUserId.toLowerCase();
    const adminOk = !requesterIsUuid && isAdminUserId(String(userId));
    if (!selfOk && !adminOk) return json({ ok: false, error: "forbidden" }, { status: 403 });

    let supabase: ReturnType<typeof getSupabaseAdmin>;
    try {
      supabase = getSupabaseAdmin();
    } catch {
      return json({ ok: false, error: "supabase_not_configured" }, { status: 500 });
    }

    const stateId = `user:${targetUserId}`;
    const prefix = `user:${targetUserId}:`;

    const results: Record<string, { ok: boolean; error?: string | null }> = {};
    const attempt = async (key: string, fn: () => Promise<{ error: any }>) => {
      try {
        const { error } = await fn();
        if (error) {
          results[key] = { ok: false, error: String(error.message ?? error) };
        } else {
          results[key] = { ok: true, error: null };
        }
      } catch (err) {
        results[key] = { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    };

    await attempt("insumos_state", async () => await supabase.from("insumos_state").delete().eq("id", stateId));
    await attempt("fornecedores_state", async () => await supabase.from("fornecedores_state").delete().eq("id", stateId));
    await attempt("fichas_tecnicas_state", async () => await supabase.from("fichas_tecnicas_state").delete().eq("id", stateId));
    await attempt("fichas_tecnicas_etiquetas_state", async () => await supabase.from("fichas_tecnicas_etiquetas_state").delete().eq("id", stateId));
    await attempt("pre_preparo_state", async () => await supabase.from("pre_preparo_state").delete().eq("id", stateId));
    await attempt("pre_preparo_etiquetas_state", async () => await supabase.from("pre_preparo_etiquetas_state").delete().eq("id", stateId));
    await attempt("insumos_templates_state", async () => await supabase.from("insumos_templates_state").delete().eq("id", stateId));

    await attempt("insumos", async () => await supabase.from("insumos").delete().like("id", `${prefix}%`));
    await attempt("entradas", async () => await supabase.from("entradas").delete().like("id", `${prefix}%`));
    await attempt("inventario", async () => await supabase.from("inventario").delete().like("id", `${prefix}%`));
    await attempt("desperdicios", async () => await supabase.from("desperdicios").delete().like("id", `${prefix}%`));
    await attempt("ingredientes", async () => await supabase.from("ingredientes").delete().like("id", `${prefix}%`));

    const ok = Object.values(results).every((r) => r.ok);
    return json({ ok, targetUserId, results }, { status: ok ? 200 : 200 });
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
