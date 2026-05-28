import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin";
import { getUserIdFromRequest } from "../../../lib/requestUserId";

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  return NextResponse.json(data, { ...init, headers });
}

function safeFilename(input: string) {
  const base = String(input ?? "").split(/[\\/]/).pop() ?? "";
  const trimmed = base.trim();
  const cleaned = trimmed.replace(/[^\w.\-()\s]/g, "_").replace(/\s+/g, " ").trim();
  return cleaned.slice(0, 160) || "arquivo";
}

async function ensureBucket(supabase: ReturnType<typeof getSupabaseAdmin>, bucket: string) {
  const got = await supabase.storage.getBucket(bucket);
  if (!got.error) return;
  await supabase.storage.createBucket(bucket, { public: false }).catch(() => {});
}

export async function POST(req: NextRequest) {
  let body: { filename?: string; contentType?: string; size?: number } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return json({ error: "invalid_json" }, { status: 400 });
  }

  const filename = safeFilename(body.filename ?? "");
  const contentType = String(body.contentType ?? "").trim() || "application/octet-stream";
  const size = typeof body.size === "number" ? body.size : 0;
  if (!filename) return json({ error: "filename_required" }, { status: 400 });
  if (!Number.isFinite(size) || size <= 0) return json({ error: "invalid_size" }, { status: 400 });

  const { userId } = getUserIdFromRequest(req);
  if (!userId) return json({ error: "unauthorized" }, { status: 401 });

  let supabase;
  try {
    supabase = getSupabaseAdmin();
  } catch {
    return json({ error: "server_not_configured" }, { status: 500 });
  }

  const bucket = "bubble-imports";
  await ensureBucket(supabase, bucket);

  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const objectPath = `user:${userId}/${day}/${stamp}-${crypto.randomUUID()}-${filename}`;

  const { data, error } = await supabase.storage.from(bucket).createSignedUploadUrl(objectPath);
  if (error || !data?.signedUrl || !data?.token) {
    return json({ error: error?.message || "failed_to_create_signed_upload" }, { status: 500 });
  }

  return json({ ok: true, path: objectPath, signedUrl: data.signedUrl, token: data.token, contentType }, { status: 200 });
}

