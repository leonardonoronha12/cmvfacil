import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin";
import { getUserIdFromRequest } from "../../../lib/requestUserId";

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  return NextResponse.json(data, { ...init, headers });
}

async function countByPrefix(supabase: ReturnType<typeof getSupabaseAdmin>, table: string, prefix: string) {
  const { count, error } = await supabase.from(table).select("id", { count: "exact", head: true }).like("id", `${prefix}%`);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export async function GET(req: NextRequest) {
  try {
    const { userId } = getUserIdFromRequest(req);
    if (!userId) return json({ ok: true, counts: {} }, { status: 200 });

    let supabase: ReturnType<typeof getSupabaseAdmin>;
    try {
      supabase = getSupabaseAdmin();
    } catch {
      return json({ ok: false, error: "supabase_not_configured" }, { status: 500 });
    }

    const stateId = `user:${userId}`;

    const { data: insState } = await supabase.from("insumos_state").select("payload").eq("id", stateId).maybeSingle();
    const insRows = Array.isArray((insState as any)?.payload?.rows) ? ((insState as any).payload.rows as unknown[]).length : 0;

    const { data: fornState } = await supabase.from("fornecedores_state").select("info,produtos,equivalencias").eq("id", stateId).maybeSingle();
    const fornInfo = (fornState as any)?.info && typeof (fornState as any).info === "object" ? Object.keys((fornState as any).info).length : 0;
    const fornProdutos = (fornState as any)?.produtos && typeof (fornState as any).produtos === "object" ? Object.keys((fornState as any).produtos).length : 0;
    const fornEquiv = (fornState as any)?.equivalencias && typeof (fornState as any).equivalencias === "object" ? Object.keys((fornState as any).equivalencias).length : 0;

    const { data: fichasState } = await supabase.from("fichas_tecnicas_state").select("payload").eq("id", stateId).maybeSingle();
    const fichas = Array.isArray((fichasState as any)?.payload) ? ((fichasState as any).payload as unknown[]).length : 0;

    const { data: preState } = await supabase.from("pre_preparo_state").select("payload").eq("id", stateId).maybeSingle();
    const prePreparo = Array.isArray((preState as any)?.payload) ? ((preState as any).payload as unknown[]).length : 0;

    const { data: preEtiqState } = await supabase.from("pre_preparo_etiquetas_state").select("payload").eq("id", stateId).maybeSingle();
    const preEtiquetas = Array.isArray((preEtiqState as any)?.payload) ? ((preEtiqState as any).payload as unknown[]).length : 0;

    const entradas = await countByPrefix(supabase, "entradas", `${stateId}:entrada:`);
    const desperdicios = await countByPrefix(supabase, "desperdicios", `${stateId}:desperdicio:`);
    const inventario = await countByPrefix(supabase, "inventario", `${stateId}:inventario:`);

    return json(
      {
        ok: true,
        counts: {
          insumos: insRows,
          fornecedores: fornInfo,
          fornecedoresProdutos: fornProdutos,
          fornecedoresEquivalencias: fornEquiv,
          fichasTecnicas: fichas,
          prePreparo,
          etiquetasPrePreparo: preEtiquetas,
          entradas,
          desperdicios,
          inventario,
        },
      },
      { status: 200 },
    );
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

