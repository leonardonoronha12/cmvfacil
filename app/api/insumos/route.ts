import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "../../lib/supabaseAdmin";
import { getUserIdFromRequest } from "../../lib/requestUserId";

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  return NextResponse.json(data, { ...init, headers });
}

function getUserScopedId(req: NextRequest) {
  const { accessToken, userId } = getUserIdFromRequest(req);
  if (!userId) return { accessToken, id: null as string | null };
  return { accessToken, id: `user:${userId}` };
}

function isMissingTableError(err: any) {
  const msg = String(err?.message ?? "").toLowerCase();
  const code = String(err?.code ?? "").toLowerCase();
  if (code === "42p01") return true;
  if (msg.includes("does not exist")) return true;
  if (msg.includes("relation") && msg.includes("does not exist")) return true;
  return false;
}

function safeSegment(input: string) {
  const s = String(input ?? "").trim();
  if (!s) return "";
  return s.replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 90);
}

export async function GET(req: NextRequest) {
  try {
    const { accessToken, id } = getUserScopedId(req);
    if (!id) return json({ rows: [], categories: [] }, { status: 200 });
    const supabase = getSupabaseServerClient(accessToken);
    const { data, error } = await supabase.from("insumos_state").select("*").eq("id", id).maybeSingle();
    if (!error) {
      const payload = (data as any)?.payload;
      const rows = Array.isArray(payload?.rows) ? (payload.rows as unknown[]) : [];
      const categories = Array.isArray(payload?.categories) ? (payload.categories as unknown[]) : [];
      return json({ rows, categories }, { status: 200 });
    }
    if (!isMissingTableError(error)) return json({ error: error.message }, { status: 500 });

    const userId = id.slice("user:".length);
    const prefix = `user:${userId}:`;
    const { data: rowsDb, error: rowsErr } = await supabase
      .from("insumos")
      .select("id,item,medida,custo_medio,categoria,especificacao,ocultar")
      .like("id", `${prefix}%`)
      .order("item", { ascending: true });
    if (rowsErr) return json({ error: rowsErr.message }, { status: 500 });
    const rows = (rowsDb ?? []).map((r: any) => ({
      id: String(r.id ?? "").trim(),
      item: String(r.item ?? "").trim(),
      medida: String(r.medida ?? "").trim() || "Und",
      custoMedio: String(r.custo_medio ?? "").trim() || undefined,
      categoria: String(r.categoria ?? "").trim() || undefined,
      especificacao: String(r.especificacao ?? "").trim() || undefined,
      ocultar: typeof r.ocultar === "boolean" ? Boolean(r.ocultar) : undefined,
    }));
    const categories = Array.from(new Set(rows.map((r) => String(r.categoria ?? "").trim()).filter(Boolean))).sort((a, b) =>
      a.localeCompare(b, "pt-BR", { sensitivity: "base", numeric: true }),
    );
    return json({ rows, categories }, { status: 200 });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as unknown;
    if (!body || typeof body !== "object") return json({ error: "invalid_body" }, { status: 400 });
    const { accessToken, id } = getUserScopedId(req);
    if (!id) return json({ error: "unauthorized" }, { status: 401 });
    const supabase = getSupabaseServerClient(accessToken);

    const rows = Array.isArray((body as any).rows) ? ((body as any).rows as unknown[]) : null;
    if (!rows) return json({ error: "missing_rows" }, { status: 400 });
    const categoriesProvided = (body as any).categories;
    let categories: unknown[] = Array.isArray(categoriesProvided) ? (categoriesProvided as unknown[]) : [];
    if (typeof categoriesProvided === "undefined") {
      const { data, error } = await supabase.from("insumos_state").select("*").eq("id", id).maybeSingle();
      if (!error) {
        const prevPayload = (data as any)?.payload;
        categories = Array.isArray(prevPayload?.categories) ? (prevPayload.categories as unknown[]) : [];
      }
    }

    const payload = { rows, categories };
    const { error } = await supabase.from("insumos_state").upsert({ id, payload } as any, { onConflict: "id" });
    if (!error) return json({ ok: true }, { status: 200 });
    if (!isMissingTableError(error)) return json({ error: error.message }, { status: 500 });

    const userId = id.slice("user:".length);
    const prefix = `user:${userId}:`;
    const desired = (rows as any[]).map((r) => {
      const rawId = String(r?.id ?? "").trim();
      const idPart = safeSegment(rawId) || crypto.randomUUID();
      const dbId = rawId.startsWith(prefix) ? rawId : `${prefix}insumo:${idPart}`;
      return {
        id: dbId,
        item: String(r?.item ?? "").trim(),
        medida: String(r?.medida ?? "").trim() || "Und",
        custo_medio: String(r?.custoMedio ?? "").trim(),
        categoria: String(r?.categoria ?? "").trim(),
        especificacao: String(r?.especificacao ?? "").trim(),
        ocultar: typeof r?.ocultar === "boolean" ? Boolean(r.ocultar) : false,
      };
    });

    const { data: existing, error: listErr } = await supabase.from("insumos").select("id").like("id", `${prefix}%`).limit(5000);
    if (listErr) return json({ error: listErr.message }, { status: 500 });
    const keep = new Set(desired.map((r) => r.id));
    const toDelete = (existing ?? []).map((x: any) => String(x?.id ?? "").trim()).filter((x: string) => x && !keep.has(x));
    if (toDelete.length) {
      const { error: delErr } = await supabase.from("insumos").delete().in("id", toDelete);
      if (delErr) return json({ error: delErr.message }, { status: 500 });
    }
    if (desired.length) {
      const { error: upErr } = await supabase.from("insumos").upsert(desired as any, { onConflict: "id" });
      if (upErr) return json({ error: upErr.message }, { status: 500 });
    }
    return json({ ok: true }, { status: 200 });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
