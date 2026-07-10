import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin";
import { getUserIdFromRequest } from "../../../lib/requestUserId";
import { readBubbleGlobalConfigFromDb, readBubbleGlobalConfigFromEnv } from "../../../lib/bubbleGlobalConfig";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return NextResponse.json(data, { ...init, headers });
}

class BubbleApiError extends Error {
  bubbleStatus: number;
  bubbleBody: string;
  constructor(message: string, bubbleStatus: number, bubbleBody: string) {
    super(message);
    this.name = "BubbleApiError";
    this.bubbleStatus = bubbleStatus;
    this.bubbleBody = bubbleBody;
  }
}

function safeBaseUrl(input: string) {
  const raw = String(input ?? "").trim();
  if (!raw) return "";
  const noTrail = raw.replace(/\/+$/, "");
  const stripped = noTrail.replace(/\/api\/1\.1\/obj$/i, "").replace(/\/api\/1\.1$/i, "");
  if (!/^https?:\/\//i.test(stripped)) return `https://${stripped}`;
  return stripped;
}

function safeToken(input: string) {
  const t = String(input ?? "").trim();
  return t.toLowerCase().startsWith("bearer ") ? t.slice(7).trim() : t;
}

async function ensureBucket(supabase: ReturnType<typeof getSupabaseAdmin>, bucket: string) {
  const got = await supabase.storage.getBucket(bucket);
  if (!got.error) return;
  await supabase.storage.createBucket(bucket, { public: false }).catch(() => {});
}

async function downloadJson(supabase: ReturnType<typeof getSupabaseAdmin>, bucket: string, filePath: string) {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(filePath, 60);
  if (error || !data?.signedUrl) throw new Error(error?.message || "failed_to_sign");
  const res = await fetch(data.signedUrl, { cache: "no-store" });
  const text = await res.text();
  if (!res.ok) throw new Error(`failed_to_download_${res.status}`);
  return JSON.parse(text) as any;
}

async function uploadJsonToStorage(supabase: ReturnType<typeof getSupabaseAdmin>, bucket: string, filePath: string, payload: unknown) {
  const { error } = await supabase.storage.from(bucket).upload(filePath, JSON.stringify(payload), { contentType: "application/json", upsert: true });
  if (error) throw new Error(error.message);
}

type BubbleConstraint = { key: string; constraint_type: string; value: unknown };

async function fetchBubblePage(args: { baseUrl: string; token: string; typeName: string; cursor: number; limit: number; constraints?: BubbleConstraint[] | null }) {
  const { baseUrl, token, typeName, cursor, limit, constraints } = args;
  const qs = new URLSearchParams();
  qs.set("cursor", String(cursor));
  qs.set("limit", String(limit));
  qs.set("sort_field", "Created Date");
  qs.set("descending", "false");
  if (constraints?.length) qs.set("constraints", JSON.stringify(constraints));
  const url = `${baseUrl}/api/1.1/obj/${encodeURIComponent(typeName)}?${qs.toString()}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  const text = await res.text();
  let jsonBody: any = null;
  try {
    jsonBody = JSON.parse(text);
  } catch {}
  if (!res.ok) {
    const msgRaw = jsonBody?.body?.message || jsonBody?.message || text || `bubble_failed_${res.status}`;
    throw new BubbleApiError(String(msgRaw).slice(0, 400), res.status, String(text ?? "").slice(0, 2000));
  }
  const response = jsonBody?.response ?? jsonBody ?? {};
  const results = Array.isArray(response?.results) ? response.results : [];
  const remaining = typeof response?.remaining === "number" ? response.remaining : null;
  return { results: results as unknown[], remaining };
}

export async function POST(req: NextRequest) {
  try {
    const { userId } = getUserIdFromRequest(req);
    if (!userId) return json({ ok: false, error: "unauthorized" }, { status: 401 });

    let supabase: ReturnType<typeof getSupabaseAdmin>;
    try {
      supabase = getSupabaseAdmin();
    } catch {
      return json({ ok: false, error: "supabase_not_configured" }, { status: 500 });
    }

    const globalDb = await readBubbleGlobalConfigFromDb();
    const globalEnv = readBubbleGlobalConfigFromEnv();
    const global = (globalDb.ok ? globalDb.value : null) ?? globalEnv ?? null;
    const baseUrl = safeBaseUrl(global?.baseUrl ?? "");
    const token = safeToken(global?.token ?? "");
    if (!baseUrl) return json({ ok: false, error: "missing_base_url" }, { status: 400 });
    if (!token) return json({ ok: false, error: "missing_token" }, { status: 400 });

    const bucket = "bubble-imports";
    await ensureBucket(supabase, bucket);

    const statePath = `user:${userId}/bootstrap/sync-state.json`;
    const syncState = await downloadJson(supabase, bucket, statePath);
    const runPrefix = String(syncState?.runPrefix ?? "").trim();
    const bubbleUserId = String(syncState?.filter?.bubbleUserId ?? "").trim();
    if (!runPrefix) return json({ ok: false, error: "missing_runPrefix_in_sync_state" }, { status: 400 });
    if (!bubbleUserId) return json({ ok: false, error: "missing_bubbleUserId_in_sync_state" }, { status: 400 });

    const now = new Date();
    const stampBase = now.toISOString().replace(/[:.]/g, "-");

    const typeName = "Ingredientes";
    const constraints: BubbleConstraint[] = [{ key: "Created By", constraint_type: "equals", value: bubbleUserId }];

    const uploaded: { path: string; rows: number; cursor: number; remaining: number | null; part: number }[] = [];
    let cursor = 0;
    for (let part = 1; part <= 3000; part++) {
      const { results, remaining } = await fetchBubblePage({ baseUrl, token, typeName, cursor, limit: 200, constraints });
      const partLabel = String(part).padStart(4, "0");
      const filePath = `${runPrefix}/${stampBase}-bubble-api-Ingredientes_part${partLabel}.json`;
      await uploadJsonToStorage(supabase, bucket, filePath, { source: "bubble-data-api", type: typeName, pulledAt: now.toISOString(), cursor, rows: results, remaining });
      uploaded.push({ path: filePath, rows: results.length, cursor, remaining, part });
      cursor += results.length;
      if (typeof remaining === "number" && remaining <= 0) break;
      if (results.length === 0) break;
    }

    const fetched = uploaded.reduce((sum, x) => sum + x.rows, 0);
    return json({ ok: true, runPrefix, fetched, parts: uploaded.length, uploaded }, { status: 200 });
  } catch (err) {
    if (err instanceof BubbleApiError) return json({ ok: false, error: err.message, bubbleStatus: err.bubbleStatus, bubbleBody: err.bubbleBody }, { status: 502 });
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

