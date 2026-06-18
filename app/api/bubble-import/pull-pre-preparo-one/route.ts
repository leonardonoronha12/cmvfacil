import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
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

function safeFilePart(input: string) {
  return String(input ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^\w.-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 90);
}

async function ensureBucket(supabase: ReturnType<typeof getSupabaseAdmin>, bucket: string) {
  const got = await supabase.storage.getBucket(bucket);
  if (!got.error) return;
  await supabase.storage.createBucket(bucket, { public: false }).catch(() => {});
}

type BubbleConstraint = { key: string; constraint_type: string; value: unknown };

async function fetchBubbleJson(baseUrl: string, token: string, path: string) {
  const url = `${baseUrl}${path.startsWith("/") ? "" : "/"}${path}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  const text = await res.text();
  let parsed: any = null;
  try {
    parsed = JSON.parse(text);
  } catch {}
  if (!res.ok) {
    const msg = parsed?.body?.message || parsed?.message || text || `bubble_failed_${res.status}`;
    throw new BubbleApiError(String(msg).slice(0, 400), res.status, String(text ?? "").slice(0, 2000));
  }
  return parsed;
}

async function fetchBubblePage(args: {
  baseUrl: string;
  token: string;
  typeName: string;
  cursor: number;
  limit: number;
  constraints?: BubbleConstraint[] | null;
  sortField?: string | null;
  descending?: boolean | null;
}) {
  const { baseUrl, token, typeName, cursor, limit, constraints, sortField, descending } = args;
  const qs = new URLSearchParams();
  qs.set("cursor", String(cursor));
  qs.set("limit", String(limit));
  if (sortField) qs.set("sort_field", String(sortField));
  if (typeof descending === "boolean") qs.set("descending", descending ? "true" : "false");
  if (constraints?.length) qs.set("constraints", JSON.stringify(constraints));
  const raw = await fetchBubbleJson(baseUrl, token, `/api/1.1/obj/${encodeURIComponent(typeName)}?${qs.toString()}`);
  const response = raw?.response ?? raw ?? {};
  const results = Array.isArray(response?.results) ? response.results : Array.isArray(response) ? response : [];
  const remaining = typeof response?.remaining === "number" ? response.remaining : null;
  return { results: results as unknown[], remaining };
}

async function uploadJsonToStorage(supabase: ReturnType<typeof getSupabaseAdmin>, bucket: string, path: string, payload: unknown) {
  const { error } = await supabase.storage.from(bucket).upload(path, JSON.stringify(payload), { contentType: "application/json", upsert: true });
  if (error) throw new Error(error.message);
}

export async function POST(req: NextRequest) {
  try {
    const { userId } = getUserIdFromRequest(req);
    if (!userId) return json({ ok: false, error: "unauthorized" }, { status: 401 });

    const body = (await req.json().catch(() => null)) as any;
    const itemId = String(body?.itemId ?? "").trim();
    const baseUrl = safeBaseUrl(String(body?.baseUrl ?? ""));
    const token = safeToken(String(body?.token ?? ""));
    const importAsUserId = typeof body?.importAsUserId === "string" ? String(body.importAsUserId).trim() : "";

    if (!itemId) return json({ ok: false, error: "missing_itemId" }, { status: 400 });
    if (!baseUrl) return json({ ok: false, error: "missing_base_url" }, { status: 400 });
    if (!token) return json({ ok: false, error: "missing_token" }, { status: 400 });

    let supabase: ReturnType<typeof getSupabaseAdmin>;
    try {
      supabase = getSupabaseAdmin();
    } catch {
      return json({ ok: false, error: "supabase_not_configured" }, { status: 500 });
    }

    const bucket = "bubble-imports";
    await ensureBucket(supabase, bucket);

    const runId = crypto.randomUUID();
    const now = new Date();
    const day = now.toISOString().slice(0, 10);
    const stamp = now.toISOString().replace(/[:.]/g, "-");
    const runPrefix = `user:${userId}/${day}/one-prepreparo/${runId}`;

    const itemRaw = await fetchBubbleJson(baseUrl, token, `/api/1.1/obj/itens/${encodeURIComponent(itemId)}`);
    const itemResponse = itemRaw?.response ?? itemRaw ?? {};
    const item = itemResponse && typeof itemResponse === "object" ? itemResponse : {};

    const itemPath = `${runPrefix}/${stamp}-bubble-api-${safeFilePart("itens")}_part0001.json`;
    await uploadJsonToStorage(supabase, bucket, itemPath, { source: "bubble-data-api", type: "itens", pulledAt: now.toISOString(), cursor: 0, rows: [item], remaining: 0 });

    const ingredientType = "Ingredientes";
    const recipeKeys = ["item_receita_id", "item_receita", "item_pre_preparo_id", "pre_preparo_id", "item_receita"];
    let ingredientesRows: unknown[] = [];
    for (const key of recipeKeys) {
      try {
        const all: unknown[] = [];
        for (let cursor = 0; cursor < 50_000; cursor += 200) {
          const page = await fetchBubblePage({
            baseUrl,
            token,
            typeName: ingredientType,
            cursor,
            limit: 200,
            constraints: [{ key, constraint_type: "equals", value: itemId }],
            sortField: "Created Date",
            descending: false,
          });
          all.push(...page.results);
          if (!(typeof page.remaining === "number") || page.remaining <= 0) break;
          if (page.results.length === 0) break;
        }
        ingredientesRows = all;
        break;
      } catch (err) {
        const status = err instanceof BubbleApiError ? err.bubbleStatus : null;
        if (status === 400) continue;
        if (status === 404) break;
        throw err;
      }
    }

    const ingPath = `${runPrefix}/${stamp}-bubble-api-${safeFilePart("Ingredientes")}_part0001.json`;
    await uploadJsonToStorage(supabase, bucket, ingPath, {
      source: "bubble-data-api",
      type: ingredientType,
      pulledAt: now.toISOString(),
      cursor: 0,
      rows: ingredientesRows,
      remaining: 0,
    });

    const url = new URL("/api/bubble-import/import", req.url);
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: req.headers.get("cookie") ?? "" },
      body: JSON.stringify({
        only: ["pre_preparo"],
        kinds: ["itens", "ingredientes"],
        includeUnknown: true,
        prefix: runPrefix,
        targetUserId: importAsUserId || userId,
      }),
      cache: "no-store",
    });
    const text = await res.text();
    let parsed: any = null;
    try {
      parsed = JSON.parse(text);
    } catch {}
    if (!res.ok || !parsed?.ok) return json({ ok: false, error: String(parsed?.error ?? text ?? `failed_${res.status}`), stage: "import" }, { status: 500 });

    return json({ ok: true, runPrefix, itemId, ingredientesFetched: ingredientesRows.length, import: parsed }, { status: 200 });
  } catch (err) {
    if (err instanceof BubbleApiError) return json({ ok: false, error: err.message, bubbleStatus: err.bubbleStatus, bubbleBody: err.bubbleBody }, { status: 502 });
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

