import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin";
import { getUserIdFromRequest } from "../../../lib/requestUserId";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  return NextResponse.json(data, { ...init, headers });
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function countByPrefix(supabase: ReturnType<typeof getSupabaseAdmin>, table: string, prefix: string) {
  const { count, error } = await supabase.from(table).select("id", { count: "exact", head: true }).like("id", `${prefix}%`);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

async function deleteByPrefix(supabase: ReturnType<typeof getSupabaseAdmin>, table: string, prefix: string) {
  const { error } = await supabase.from(table).delete().like("id", `${prefix}%`);
  if (error) throw new Error(error.message);
}

export async function POST(req: NextRequest) {
  try {
    const { userId } = getUserIdFromRequest(req);
    if (!userId) return json({ ok: false, error: "unauthorized" }, { status: 401 });
    if (!isUuid(userId)) return json({ ok: false, error: "user_not_supabase_uuid" }, { status: 400 });

    const body = (await req.json().catch(() => null)) as any;
    const confirm = String(body?.confirm ?? "").trim();
    if (confirm !== "DELETE_ALL") return json({ ok: false, error: "confirm_required" }, { status: 400 });

    let supabase: ReturnType<typeof getSupabaseAdmin>;
    try {
      supabase = getSupabaseAdmin();
    } catch {
      return json({ ok: false, error: "supabase_not_configured" }, { status: 500 });
    }

    const stateId = `user:${userId}`;
    const prefix = `${stateId}:`;

    const before = {
      entradas: await countByPrefix(supabase, "entradas", `${prefix}entrada:`),
      desperdicios: await countByPrefix(supabase, "desperdicios", `${prefix}desperdicio:`),
      inventario: await countByPrefix(supabase, "inventario", `${prefix}inventario:`),
    };

    await deleteByPrefix(supabase, "entradas", `${prefix}entrada:`);
    await deleteByPrefix(supabase, "desperdicios", `${prefix}desperdicio:`);
    await deleteByPrefix(supabase, "inventario", `${prefix}inventario:`);

    await supabase.from("insumos_state").delete().eq("id", stateId);
    await supabase.from("fornecedores_state").delete().eq("id", stateId);
    await supabase.from("fichas_tecnicas_state").delete().eq("id", stateId);
    await supabase.from("fichas_tecnicas_etiquetas_state").delete().eq("id", stateId);
    await supabase.from("pre_preparo_state").delete().eq("id", stateId);
    await supabase.from("pre_preparo_etiquetas_state").delete().eq("id", stateId);

    const after = {
      entradas: await countByPrefix(supabase, "entradas", `${prefix}entrada:`),
      desperdicios: await countByPrefix(supabase, "desperdicios", `${prefix}desperdicio:`),
      inventario: await countByPrefix(supabase, "inventario", `${prefix}inventario:`),
    };

    return json({ ok: true, deleted: { entradas: before.entradas - after.entradas, desperdicios: before.desperdicios - after.desperdicios, inventario: before.inventario - after.inventario } }, { status: 200 });
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
