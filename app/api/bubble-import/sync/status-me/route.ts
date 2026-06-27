import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../../lib/supabaseAdmin";
import { getUserIdFromRequest } from "../../../../lib/requestUserId";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return NextResponse.json(data, { ...init, headers });
}

async function ensureBucket(supabase: ReturnType<typeof getSupabaseAdmin>, bucket: string) {
  const got = await supabase.storage.getBucket(bucket);
  if (!got.error) return;
  await supabase.storage.createBucket(bucket, { public: false }).catch(() => {});
}

async function downloadJson(supabase: ReturnType<typeof getSupabaseAdmin>, bucket: string, path: string) {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 60);
  if (error || !data?.signedUrl) throw new Error(error?.message || "failed_to_sign");
  const res = await fetch(data.signedUrl, { cache: "no-store" });
  const text = await res.text();
  if (!res.ok) throw new Error(`failed_to_download_${res.status}`);
  return JSON.parse(text) as any;
}

function buildSummary(state: any) {
  const types: string[] = Array.isArray(state?.types) ? state.types.map((x: any) => String(x ?? "")).filter(Boolean) : [];
  const perType = state?.perType && typeof state.perType === "object" ? (state.perType as Record<string, any>) : {};
  const summary = types.map((t) => {
    const st = perType[t] ?? {};
    return {
      type: t,
      status: String(st?.status ?? ""),
      fetched: typeof st?.fetched === "number" ? st.fetched : 0,
      parts: typeof st?.parts === "number" ? st.parts : 0,
      cursor: typeof st?.cursor === "number" ? st.cursor : 0,
      remaining: typeof st?.remaining === "number" ? st.remaining : null,
      lastError: String(st?.lastError ?? ""),
    };
  });
  return summary;
}

export async function GET(req: NextRequest) {
  try {
    const { userId } = getUserIdFromRequest(req);
    if (!userId) return json({ ok: false, error: "unauthorized" }, { status: 401 });

    let supabase: ReturnType<typeof getSupabaseAdmin>;
    try {
      supabase = getSupabaseAdmin();
    } catch {
      return json({ ok: false, error: "supabase_not_configured" }, { status: 500 });
    }

    const bucket = "bubble-imports";
    await ensureBucket(supabase, bucket);

    const statePath = `user:${userId}/bootstrap/sync-state.json`;
    const state = await downloadJson(supabase, bucket, statePath);
    return json({ ok: true, statePath, phase: String(state?.phase ?? ""), summary: buildSummary(state), lastError: String(state?.lastError ?? ""), state }, { status: 200 });
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
