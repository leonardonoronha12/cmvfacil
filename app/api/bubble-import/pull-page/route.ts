import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin";
import { getUserIdFromRequest } from "../../../lib/requestUserId";
import { readBubbleGlobalConfigFromDb, readBubbleGlobalConfigFromEnv } from "../../../lib/bubbleGlobalConfig";

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
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
  const stripped = noTrail
    .replace(/\/api\/1\.1\/obj$/i, "")
    .replace(/\/api\/1\.1$/i, "");
  if (!/^https?:\/\//i.test(stripped)) return `https://${stripped}`;
  return stripped;
}

function safeToken(input: string) {
  const t = String(input ?? "").trim();
  return t.toLowerCase().startsWith("bearer ") ? t.slice(7).trim() : t;
}

function safeType(input: string) {
  return String(input ?? "").trim();
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

  const url = `${baseUrl}/api/1.1/obj/${encodeURIComponent(typeName)}?${qs.toString()}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  const text = await res.text();
  let jsonBody: any = null;
  try {
    jsonBody = JSON.parse(text);
  } catch {}
  if (!res.ok) {
    const msg = jsonBody?.body?.message || jsonBody?.message || text || `bubble_failed_${res.status}`;
    throw new BubbleApiError(String(msg).slice(0, 400), res.status, String(text ?? "").slice(0, 2000));
  }
  const response = jsonBody?.response ?? jsonBody ?? {};
  const results = Array.isArray(response?.results) ? response.results : Array.isArray(response) ? response : [];
  const remaining = typeof response?.remaining === "number" ? response.remaining : null;
  return { results: results as unknown[], remaining };
}

export async function POST(req: NextRequest) {
  try {
    const { userId } = getUserIdFromRequest(req);
    if (!userId) return json({ ok: false, error: "unauthorized" }, { status: 401 });

    const body = (await req.json().catch(() => null)) as any;
    const globalDb = await readBubbleGlobalConfigFromDb();
    const globalEnv = readBubbleGlobalConfigFromEnv();
    const global = (globalDb.ok ? globalDb.value : null) ?? globalEnv ?? null;
    const baseUrl = safeBaseUrl(body?.baseUrl ?? global?.baseUrl ?? "");
    const token = safeToken(body?.token ?? global?.token ?? "");
    const typeName = safeType(body?.type ?? "");
    const cursor = typeof body?.cursor === "number" && Number.isFinite(body.cursor) && body.cursor >= 0 ? Math.floor(body.cursor) : 0;
    const limit = typeof body?.limit === "number" && Number.isFinite(body.limit) && body.limit > 0 ? Math.min(200, Math.floor(body.limit)) : 100;
    const runId = typeof body?.runId === "string" ? String(body.runId).trim() : "";
    const part = typeof body?.part === "number" && Number.isFinite(body.part) && body.part > 0 ? Math.floor(body.part) : 1;
    const sortField = typeof body?.sortField === "string" && body.sortField.trim() ? String(body.sortField).trim() : null;
    const descending = typeof body?.descending === "boolean" ? Boolean(body.descending) : null;
    const constraints = Array.isArray(body?.constraints)
      ? (body.constraints as any[])
          .filter((x) => x && typeof x === "object")
          .map((x) => ({ key: String((x as any).key ?? "").trim(), constraint_type: String((x as any).constraint_type ?? "").trim(), value: (x as any).value }))
          .filter((x) => x.key && x.constraint_type)
      : null;

    if (!baseUrl) return json({ ok: false, error: "missing_base_url" }, { status: 400 });
    if (!token) return json({ ok: false, error: "missing_token" }, { status: 400 });
    if (!typeName) return json({ ok: false, error: "missing_type" }, { status: 400 });
    if (!runId) return json({ ok: false, error: "missing_run_id" }, { status: 400 });

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
    const typeSlug = safeFilePart(typeName) || "type";
    const partLabel = String(part).padStart(4, "0");
    const objectPath = `user:${userId}/${day}/${runId}/${stamp}-bubble-api-${typeSlug}_part${partLabel}.json`;
    const runPrefix = `user:${userId}/${day}/${runId}`;

    const { results, remaining } = await fetchBubblePage({ baseUrl, token, typeName, cursor, limit, constraints, sortField, descending });
    const payload = {
      source: "bubble-data-api",
      type: typeName,
      pulledAt: now.toISOString(),
      cursor,
      rows: results,
      remaining,
    };
    const { error } = await supabase.storage.from(bucket).upload(objectPath, JSON.stringify(payload), { contentType: "application/json", upsert: true });
    if (error) throw new Error(error.message);

    const nextCursor = cursor + results.length;
    const stalled = typeof remaining === "number" && remaining > 0 && results.length === 0;
    const done = typeof remaining === "number" ? remaining === 0 : results.length === 0;

    let lastCreatedDate: string | null = null;
    for (let i = results.length - 1; i >= 0; i--) {
      const r: any = results[i];
      const cd =
        r && typeof r === "object"
          ? (r["Created Date"] ?? r["Modified Date"] ?? r.created_date ?? r.created_at ?? r.creation_date ?? r.modified_date ?? r.modified_at)
          : null;
      if (typeof cd === "string" && cd.trim()) {
        lastCreatedDate = cd.trim();
        break;
      }
    }

    return json(
      {
        ok: true,
        type: typeName,
        uploaded: { path: objectPath, rows: results.length, cursor, nextCursor, remaining, part },
        runPrefix,
        lastCreatedDate,
        stalled,
        done,
      },
      { status: 200 },
    );
  } catch (err) {
    if (err instanceof BubbleApiError) {
      return json({ ok: false, error: err.message, bubbleStatus: err.bubbleStatus, bubbleBody: err.bubbleBody }, { status: 502 });
    }
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
