import { NextRequest, NextResponse } from "next/server";
import { SUPABASE_AT_COOKIE } from "../../lib/supabaseAuthCookies";
import { getSupabaseServerClient } from "../../lib/supabaseAdmin";

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  return NextResponse.json(data, { ...init, headers });
}

function parseJwtSub(jwt: string) {
  const parts = jwt.split(".");
  if (parts.length < 2) return null;
  const payloadB64 = parts[1] ?? "";
  if (!payloadB64) return null;
  const padded = payloadB64.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (payloadB64.length % 4)) % 4);
  try {
    const jsonStr = Buffer.from(padded, "base64").toString("utf8");
    const obj = JSON.parse(jsonStr) as { sub?: string };
    const sub = String(obj.sub ?? "").trim();
    return sub || null;
  } catch {
    return null;
  }
}

function getUserScope(req: NextRequest) {
  const accessToken = (req.cookies.get(SUPABASE_AT_COOKIE)?.value ?? "").trim();
  const userId = accessToken ? parseJwtSub(accessToken) : null;
  return { accessToken, prefix: userId ? `user:${userId}:` : null };
}

export async function GET(req: NextRequest) {
  try {
    const { accessToken, prefix } = getUserScope(req);
    if (!prefix) return json({ rows: [] }, { status: 200 });
    const supabase = getSupabaseServerClient(accessToken);
    const { data, error } = await supabase.from("desperdicios").select("*").like("id", `${prefix}%`).order("created_at", { ascending: false });
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
    const { accessToken, prefix } = getUserScope(req);
    if (!prefix) return json({ error: "unauthorized" }, { status: 401 });
    const id = String((body as any).id ?? "").trim();
    if (!id || !id.startsWith(prefix)) return json({ error: "invalid_id_scope" }, { status: 400 });
    const supabase = getSupabaseServerClient(accessToken);
    const { error } = await supabase.from("desperdicios").upsert(body as any, { onConflict: "id" });
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
    const { accessToken, prefix } = getUserScope(req);
    if (!prefix) return json({ error: "unauthorized" }, { status: 401 });
    if (!id.startsWith(prefix)) return json({ error: "invalid_id_scope" }, { status: 400 });
    const supabase = getSupabaseServerClient(accessToken);
    const { error } = await supabase.from("desperdicios").delete().eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
