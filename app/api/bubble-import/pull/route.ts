import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin";
import { getUserIdFromRequest } from "../../../lib/requestUserId";
import { readBubbleGlobalConfigFromDb, readBubbleGlobalConfigFromEnv } from "../../../lib/bubbleGlobalConfig";

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  return NextResponse.json(data, { ...init, headers });
}

function getEnv(name: string) {
  const v = (process.env[name] ?? "").trim();
  return v || null;
}

function safeToken(input: string) {
  const t = String(input ?? "").trim();
  return t.toLowerCase().startsWith("bearer ") ? t.slice(7).trim() : t;
}

function safeBaseUrl(input: string) {
  const raw = String(input ?? "").trim();
  if (!raw) return "";
  const noTrail = raw.replace(/\/+$/, "");
  const stripped = noTrail
    .replace(/\/api\/1\.1\/obj$/i, "")
    .replace(/\/api\/1\.1$/i, "");
  if (!/^https?:\/\//i.test(stripped)) return `https://${stripped}`;
  return stripped;
}

function safeName(input: string) {
  const base = String(input ?? "").trim().replace(/[^\w.\-()/\s]/g, "_");
  return base.replace(/\s+/g, "_").slice(0, 90) || "type";
}

async function ensureBucket(supabase: ReturnType<typeof getSupabaseAdmin>, bucket: string) {
  const got = await supabase.storage.getBucket(bucket);
  if (!got.error) return;
  await supabase.storage.createBucket(bucket, { public: false }).catch(() => {});
}

async function fetchBubblePage(baseUrl: string, token: string, typeName: string, cursor: number, limit: number) {
  const url = `${baseUrl}/api/1.1/obj/${encodeURIComponent(typeName)}?cursor=${cursor}&limit=${limit}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  const text = await res.text();
  let jsonBody: any = null;
  try {
    jsonBody = JSON.parse(text);
  } catch {}
  if (!res.ok) {
    const msg = jsonBody?.body?.message || jsonBody?.message || text || `bubble_failed_${res.status}`;
    throw new Error(msg);
  }
  const response = jsonBody?.response ?? jsonBody ?? {};
  const results = Array.isArray(response?.results) ? response.results : Array.isArray(response) ? response : [];
  const remaining = typeof response?.remaining === "number" ? response.remaining : null;
  return { results: results as unknown[], remaining };
}

async function fetchAllBubble(baseUrl: string, token: string, typeName: string, limit = 100) {
  const out: unknown[] = [];
  let cursor = 0;
  for (let page = 0; page < 10000; page++) {
    const { results, remaining } = await fetchBubblePage(baseUrl, token, typeName, cursor, limit);
    if (!results.length) break;
    out.push(...results);
    cursor += results.length;
    if (remaining === 0) break;
  }
  return out;
}

export async function POST(req: NextRequest) {
  try {
    const { userId } = getUserIdFromRequest(req);
    if (!userId) return json({ ok: false, error: "unauthorized" }, { status: 401 });

    const body = (await req.json().catch(() => null)) as any;
    const globalDb = await readBubbleGlobalConfigFromDb();
    const globalEnv = readBubbleGlobalConfigFromEnv();
    const global = (globalDb.ok ? globalDb.value : null) ?? globalEnv ?? null;
    const baseUrl = safeBaseUrl(body?.baseUrl ?? global?.baseUrl ?? getEnv("BUBBLE_BASE_URL") ?? "");
    const token = safeToken(body?.token ?? global?.token ?? getEnv("BUBBLE_API_TOKEN") ?? "");
    const typesRaw = Array.isArray(body?.types) ? (body.types as unknown[]) : [];
    const types = typesRaw.map((t) => safeName(String(t ?? ""))).filter(Boolean);
    const limit = typeof body?.limit === "number" && Number.isFinite(body.limit) && body.limit > 0 ? Math.min(200, Math.floor(body.limit)) : 100;

    if (!baseUrl) return json({ ok: false, error: "missing_base_url" }, { status: 400 });
    if (!token) return json({ ok: false, error: "missing_token" }, { status: 400 });
    if (!types.length) return json({ ok: false, error: "missing_types" }, { status: 400 });

    let supabase: ReturnType<typeof getSupabaseAdmin>;
    try {
      supabase = getSupabaseAdmin();
    } catch {
      return json({ ok: false, error: "supabase_not_configured" }, { status: 500 });
    }

    const bucket = "bubble-imports";
    await ensureBucket(supabase, bucket);

    const now = new Date();
    const day = now.toISOString().slice(0, 10);
    const stamp = now.toISOString().replace(/[:.]/g, "-");

    const uploaded: { type: string; rows: number; path: string }[] = [];
    for (const typeName of types) {
      const rows = await fetchAllBubble(baseUrl, token, typeName, limit);
      const safeType = safeName(typeName).toLowerCase();
      const objectPath = `user:${userId}/${day}/${stamp}-bubble-api-${safeType}.json`;
      const bodyJson = JSON.stringify({ source: "bubble-data-api", type: typeName, pulledAt: now.toISOString(), rows }, null, 0);
      const { error } = await supabase.storage.from(bucket).upload(objectPath, bodyJson, { contentType: "application/json", upsert: true });
      if (error) throw new Error(error.message);
      uploaded.push({ type: typeName, rows: rows.length, path: objectPath });
    }

    return json({ ok: true, uploaded }, { status: 200 });
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
