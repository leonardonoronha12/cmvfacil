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

function getUserScopedId(req: NextRequest) {
  const accessToken = (req.cookies.get(SUPABASE_AT_COOKIE)?.value ?? "").trim();
  const userId = accessToken ? parseJwtSub(accessToken) : null;
  if (!userId) return { accessToken, id: null as string | null };
  return { accessToken, id: `user:${userId}` };
}

export async function GET(req: NextRequest) {
  try {
    const { accessToken, id } = getUserScopedId(req);
    if (!id) return json({ rows: [] }, { status: 200 });
    const supabase = getSupabaseServerClient(accessToken);
    const { data, error } = await supabase.from("pre_preparo_etiquetas_state").select("*").eq("id", id).maybeSingle();
    if (error) return json({ error: error.message }, { status: 500 });
    const payload = (data as any)?.payload;
    return json({ rows: Array.isArray(payload) ? payload : [] }, { status: 200 });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as unknown;
    if (!body || typeof body !== "object") return json({ error: "invalid_body" }, { status: 400 });
    const rows = Array.isArray((body as any).rows) ? ((body as any).rows as unknown[]) : null;
    if (!rows) return json({ error: "missing_rows" }, { status: 400 });
    const { accessToken, id } = getUserScopedId(req);
    if (!id) return json({ error: "unauthorized" }, { status: 401 });
    const supabase = getSupabaseServerClient(accessToken);
    const { error } = await supabase.from("pre_preparo_etiquetas_state").upsert({ id, payload: rows } as any, { onConflict: "id" });
    if (error) return json({ error: error.message }, { status: 500 });
    return json({ ok: true }, { status: 200 });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

