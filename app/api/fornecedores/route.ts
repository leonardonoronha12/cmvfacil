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
    if (!id) return json({ row: null }, { status: 200 });
    const supabase = getSupabaseServerClient(accessToken);
    const { data, error } = await supabase.from("fornecedores_state").select("*").eq("id", id).maybeSingle();
    if (error) return json({ error: error.message }, { status: 500 });
    return json({ row: data ?? null }, { status: 200 });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as unknown;
    if (!body || typeof body !== "object") return json({ error: "invalid_body" }, { status: 400 });
    const data = body as Record<string, unknown>;
    const { accessToken, id } = getUserScopedId(req);
    if (!id) return json({ error: "unauthorized" }, { status: 401 });
    const supabase = getSupabaseServerClient(accessToken);
    const payload = {
      id,
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
