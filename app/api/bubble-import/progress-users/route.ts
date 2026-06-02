import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin";
import { getUserIdFromRequest } from "../../../lib/requestUserId";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return NextResponse.json(data, { ...init, headers });
}

async function listAllAuthUsers(supabase: ReturnType<typeof getSupabaseAdmin>) {
  const out: { id: string; email: string }[] = [];
  for (let page = 1; page <= 2000; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(error.message);
    const users = (data?.users ?? []) as any[];
    for (const u of users) {
      const id = String(u?.id ?? "").trim();
      const email = String(u?.email ?? "").trim();
      if (!id) continue;
      out.push({ id, email });
    }
    if (users.length < 1000) break;
  }
  out.sort((a, b) => (a.email || a.id).localeCompare(b.email || b.id, "pt-BR", { sensitivity: "base" }));
  return out;
}

async function listIds(supabase: ReturnType<typeof getSupabaseAdmin>, table: string) {
  const ids = new Set<string>();
  for (let offset = 0; offset < 200000; offset += 1000) {
    const { data, error } = await supabase.from(table).select("id").range(offset, offset + 999);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as any[];
    for (const r of rows) {
      const id = String(r?.id ?? "").trim();
      if (id) ids.add(id);
    }
    if (rows.length < 1000) break;
  }
  return ids;
}

export async function GET(req: NextRequest) {
  try {
    const { userId } = getUserIdFromRequest(req);
    if (!userId) return json({ ok: false, error: "unauthorized" }, { status: 401 });

    const supabase = getSupabaseAdmin();
    const limit = Math.max(1, Math.min(500, Number(req.nextUrl.searchParams.get("limit") ?? "200")));

    const [authUsers, insumosIds, fornecedoresIds, prePreparoIds, fichasIds] = await Promise.all([
      listAllAuthUsers(supabase),
      listIds(supabase, "insumos_state"),
      listIds(supabase, "fornecedores_state"),
      listIds(supabase, "pre_preparo_state"),
      listIds(supabase, "fichas_tecnicas_state"),
    ]);

    const users = authUsers.slice(0, limit).map((u) => {
      const stateId = `user:${u.id}`;
      return {
        id: u.id,
        email: u.email,
        has: {
          insumos: insumosIds.has(stateId),
          fornecedores: fornecedoresIds.has(stateId),
          prePreparo: prePreparoIds.has(stateId),
          fichas: fichasIds.has(stateId),
        },
      };
    });

    const done = authUsers.reduce(
      (acc, u) => {
        const stateId = `user:${u.id}`;
        const flags = {
          insumos: insumosIds.has(stateId),
          fornecedores: fornecedoresIds.has(stateId),
          prePreparo: prePreparoIds.has(stateId),
          fichas: fichasIds.has(stateId),
        };
        const all = flags.insumos && flags.fornecedores && flags.prePreparo && flags.fichas;
        if (all) acc.all += 1;
        if (flags.insumos) acc.insumos += 1;
        if (flags.fornecedores) acc.fornecedores += 1;
        if (flags.prePreparo) acc.prePreparo += 1;
        if (flags.fichas) acc.fichas += 1;
        return acc;
      },
      { all: 0, insumos: 0, fornecedores: 0, prePreparo: 0, fichas: 0 },
    );

    return json(
      {
        ok: true,
        totals: {
          users: authUsers.length,
          done,
        },
        users,
        truncated: authUsers.length > limit,
      },
      { status: 200 },
    );
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

