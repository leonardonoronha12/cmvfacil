import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin";
import { getUserIdFromRequest } from "../../../lib/requestUserId";

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  return NextResponse.json(data, { ...init, headers });
}

async function ensureBucket(supabase: ReturnType<typeof getSupabaseAdmin>, bucket: string) {
  const got = await supabase.storage.getBucket(bucket);
  if (!got.error) return;
  await supabase.storage.createBucket(bucket, { public: false }).catch(() => {});
}

async function listAllPaths(supabase: ReturnType<typeof getSupabaseAdmin>, bucket: string, userPrefix: string) {
  const { data: level1, error: err1 } = await supabase.storage.from(bucket).list(userPrefix, { limit: 1000, sortBy: { column: "name", order: "asc" } });
  if (err1) throw new Error(err1.message);
  const paths: { path: string; name: string; created_at?: string; updated_at?: string; size?: number }[] = [];
  const folders = (level1 ?? []).filter((it) => (it as any).id == null);
  const files = (level1 ?? []).filter((it) => (it as any).id != null);

  for (const f of files) {
    paths.push({
      path: `${userPrefix}/${f.name}`,
      name: f.name,
      created_at: (f as any).created_at,
      updated_at: (f as any).updated_at,
      size: (f as any)?.metadata?.size,
    });
  }

  for (const folder of folders) {
    const prefix2 = `${userPrefix}/${folder.name}`;
    const { data: level2, error: err2 } = await supabase.storage.from(bucket).list(prefix2, { limit: 1000, sortBy: { column: "name", order: "asc" } });
    if (err2) continue;
    for (const f of level2 ?? []) {
      if ((f as any).id == null) continue;
      paths.push({
        path: `${prefix2}/${f.name}`,
        name: f.name,
        created_at: (f as any).created_at,
        updated_at: (f as any).updated_at,
        size: (f as any)?.metadata?.size,
      });
    }
  }

  return paths.sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? "") || b.name.localeCompare(a.name));
}

export async function GET(req: NextRequest) {
  const { userId } = getUserIdFromRequest(req);
  if (!userId) return json({ ok: true, paths: [] }, { status: 200 });

  let supabase: ReturnType<typeof getSupabaseAdmin>;
  try {
    supabase = getSupabaseAdmin();
  } catch {
    return json({ ok: false, error: "supabase_not_configured" }, { status: 500 });
  }

  const bucket = "bubble-imports";
  await ensureBucket(supabase, bucket);

  try {
    const userPrefix = `user:${userId}`;
    const paths = await listAllPaths(supabase, bucket, userPrefix);
    return json({ ok: true, paths }, { status: 200 });
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

