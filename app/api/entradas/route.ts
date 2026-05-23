import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "../../lib/supabaseAdmin";
import { getUserIdFromRequest } from "../../lib/requestUserId";

export async function GET(req: NextRequest) {
  try {
    const { accessToken, userId } = getUserIdFromRequest(req);
    if (!userId) return NextResponse.json({ rows: [] }, { status: 200 });
    const prefix = `user:${userId}:`;
    const supabase = getSupabaseServerClient(accessToken);
    const { data, error } = await supabase.from("entradas").select("*").like("id", `${prefix}%`).order("created_at", { ascending: false });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ rows: data ?? [] }, { status: 200 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as unknown;
    if (!body || typeof body !== "object") return NextResponse.json({ error: "invalid_body" }, { status: 400 });
    const { accessToken, userId } = getUserIdFromRequest(req);
    if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const prefix = `user:${userId}:`;
    const id = String((body as any).id ?? "").trim();
    if (!id || !id.startsWith(prefix)) return NextResponse.json({ error: "invalid_id_scope" }, { status: 400 });
    const supabase = getSupabaseServerClient(accessToken);
    const { error } = await supabase.from("entradas").upsert(body as any, { onConflict: "id" });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const id = (url.searchParams.get("id") ?? "").trim();
    if (!id) return NextResponse.json({ error: "missing_id" }, { status: 400 });
    const { accessToken, userId } = getUserIdFromRequest(req);
    if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const prefix = `user:${userId}:`;
    if (!id.startsWith(prefix)) return NextResponse.json({ error: "invalid_id_scope" }, { status: 400 });
    const supabase = getSupabaseServerClient(accessToken);
    const { error } = await supabase.from("entradas").delete().eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
