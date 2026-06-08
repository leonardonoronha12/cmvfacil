import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin";
import { getUserIdFromRequest } from "../../../lib/requestUserId";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return NextResponse.json(data, { ...init, headers });
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function downloadJsonFromStorage(supabase: ReturnType<typeof getSupabaseAdmin>, bucket: string, path: string) {
  const dl = await supabase.storage.from(bucket).download(path);
  if (dl.error || !dl.data) return null;
  try {
    const buf = await dl.data.arrayBuffer();
    const text = new TextDecoder().decode(buf);
    return JSON.parse(text) as any;
  } catch {
    return null;
  }
}

function summarizeSyncState(state: any) {
  if (!state || typeof state !== "object") return null;
  const perType = state.perType && typeof state.perType === "object" && !Array.isArray(state.perType) ? (state.perType as Record<string, any>) : null;
  const types = Array.isArray(state.types) ? (state.types as any[]).map((t) => String(t ?? "").trim()).filter(Boolean) : perType ? Object.keys(perType) : [];
  const phase = String(state.phase ?? "").trim();

  let fetchedTotal = 0;
  let partsTotal = 0;
  let errorTypes = 0;
  for (const t of types) {
    const st = perType?.[t];
    if (!st || typeof st !== "object") continue;
    const fetched = typeof st.fetched === "number" && Number.isFinite(st.fetched) ? Math.max(0, st.fetched) : 0;
    const parts = typeof st.parts === "number" && Number.isFinite(st.parts) ? Math.max(0, st.parts) : 0;
    fetchedTotal += fetched;
    partsTotal += parts;
    const lastError = String(st.lastError ?? "").trim();
    if (lastError) errorTypes += 1;
  }

  const importStatus = state.import && typeof state.import === "object" ? String(state.import.status ?? "").trim() : "";
  const importLastError =
    state.import && typeof state.import === "object" ? String(state.import.lastError ?? "").trim() : "";

  return {
    phase,
    updatedAt: String(state.updatedAt ?? "").trim() || null,
    startedAt: String(state.startedAt ?? "").trim() || null,
    typesTotal: types.length,
    fetchedTotal,
    partsTotal,
    errorTypes,
    importStatus,
    importLastError,
  };
}

export async function GET(req: NextRequest) {
  try {
    const { userId } = getUserIdFromRequest(req);
    if (!userId) return json({ ok: false, error: "unauthorized" }, { status: 401 });

    let supabase: ReturnType<typeof getSupabaseAdmin> | null = null;
    try {
      supabase = getSupabaseAdmin();
    } catch {
      supabase = null;
    }

    const bucket = "bubble-imports";
    const statePath = `user:${userId}/bootstrap/sync-state.json`;
    const bucketExists = supabase ? !(await supabase.storage.getBucket(bucket)).error : false;
    const state = supabase ? await downloadJsonFromStorage(supabase, bucket, statePath) : null;

    const summary = summarizeSyncState(state);

    return json(
      {
        ok: true,
        userId,
        userIdIsUuid: isUuid(userId),
        supabaseAdminConfigured: Boolean(supabase),
        bucketExists,
        statePath,
        summary,
        state: state && typeof state === "object" ? state : null,
      },
      { status: 200 },
    );
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

