import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin";
import { getUserIdFromRequest } from "../../../lib/requestUserId";

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return NextResponse.json(data, { ...init, headers });
}

async function countByPrefix(supabase: ReturnType<typeof getSupabaseAdmin>, table: string, prefix: string) {
  const { count, error } = await supabase.from(table).select("id", { count: "exact", head: true }).like("id", `${prefix}%`);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

async function countAll(supabase: ReturnType<typeof getSupabaseAdmin>, table: string) {
  const { count, error } = await supabase.from(table).select("id", { count: "exact", head: true });
  if (error) throw new Error(error.message);
  return count ?? 0;
}

async function countAuthUsers(supabase: ReturnType<typeof getSupabaseAdmin>) {
  let total = 0;
  for (let page = 1; page <= 2000; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(error.message);
    const users = (data?.users ?? []) as any[];
    total += users.length;
    if (users.length < 1000) break;
  }
  return total;
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

    const scope = String(req.nextUrl.searchParams.get("scope") ?? "").trim().toLowerCase();
    if (scope === "all") {
      const authUsers = await countAuthUsers(supabase).catch(() => null);
      const insumosStateUsers = await countAll(supabase, "insumos_state").catch(() => null);
      const fornecedoresStateUsers = await countAll(supabase, "fornecedores_state").catch(() => null);
      const prePreparoUsers = await countAll(supabase, "pre_preparo_state").catch(() => null);
      const fichasUsers = await countAll(supabase, "fichas_tecnicas_state").catch(() => null);
      const entradas = await countByPrefix(supabase, "entradas", "user:").catch(() => null);
      const desperdicios = await countByPrefix(supabase, "desperdicios", "user:").catch(() => null);
      const inventario = await countByPrefix(supabase, "inventario", "user:").catch(() => null);
      return json(
        {
          ok: true,
          scope: "all",
          totals: {
            authUsers,
            usersWith: {
              insumos_state: insumosStateUsers,
              fornecedores_state: fornecedoresStateUsers,
              pre_preparo_state: prePreparoUsers,
              fichas_tecnicas_state: fichasUsers,
            },
            rows: { entradas, desperdicios, inventario },
          },
        },
        { status: 200 },
      );
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
        scope: "me",
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
