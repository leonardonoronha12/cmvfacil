import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../lib/supabaseAdmin";

export async function GET() {
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.from("desperdicios").select("*").order("created_at", { ascending: false });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ rows: data ?? [] }, { status: 200 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as unknown;
    if (!body || typeof body !== "object") return NextResponse.json({ error: "invalid_body" }, { status: 400 });
    const supabase = getSupabaseAdmin();
    const { error } = await supabase.from("desperdicios").upsert(body as any, { onConflict: "id" });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const url = new URL(req.url);
    const id = (url.searchParams.get("id") ?? "").trim();
    if (!id) return NextResponse.json({ error: "missing_id" }, { status: 400 });
    const supabase = getSupabaseAdmin();
    const { error } = await supabase.from("desperdicios").delete().eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

