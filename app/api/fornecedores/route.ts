import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../lib/supabaseAdmin";

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  return NextResponse.json(data, { ...init, headers });
}

export async function GET() {
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.from("fornecedores_state").select("*").eq("id", "default").maybeSingle();
    if (error) return json({ error: error.message }, { status: 500 });
    return json({ row: data ?? null }, { status: 200 });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as unknown;
    if (!body || typeof body !== "object") return json({ error: "invalid_body" }, { status: 400 });
    const data = body as Record<string, unknown>;
    const supabase = getSupabaseAdmin();
    const payload = {
      id: "default",
      info: (data.info ?? {}) as any,
      produtos: (data.produtos ?? {}) as any,
      equivalencias: (data.equivalencias ?? {}) as any,
    };
    const { error } = await supabase.from("fornecedores_state").upsert(payload as any, { onConflict: "id" });
    if (error) return json({ error: error.message }, { status: 500 });
    return json({ ok: true }, { status: 200 });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

