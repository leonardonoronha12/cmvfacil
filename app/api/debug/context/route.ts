import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin";
import { getUserIdFromRequest } from "../../../lib/requestUserId";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

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

    const auth = await supabase.auth.admin.getUserById(String(userId));
    const email = auth.error ? null : String((auth.data as any)?.user?.email ?? "").trim().toLowerCase() || null;

    const bucket = "bubble-imports";
    await ensureBucket(supabase, bucket);

    const statePath = `user:${userId}/bootstrap/sync-state.json`;
    const state = await downloadJsonFromStorage(supabase, bucket, statePath);
    const phase = state && typeof state === "object" ? String((state as any).phase ?? "") : "";
    const currentTypeIndex = state && typeof state === "object" ? Number((state as any).currentTypeIndex ?? 0) : 0;
    const types: string[] = state && typeof state === "object" && Array.isArray((state as any).types) ? (state as any).types.map((t: any) => String(t ?? "").trim()).filter(Boolean) : [];
    const currentType = types[currentTypeIndex] ? String(types[currentTypeIndex]) : "";
    const importDomains: string[] =
      state && typeof state === "object" && Array.isArray((state as any)?.import?.domains)
        ? (state as any).import.domains.map((d: any) => String(d ?? "").trim()).filter(Boolean)
        : [];
    const importIndex = state && typeof state === "object" ? Number((state as any)?.import?.index ?? 0) : 0;
    const importDomain = importDomains[importIndex] ? String(importDomains[importIndex]) : "";
    const importStatus = state && typeof state === "object" ? String((state as any)?.import?.status ?? "") : "";
    const importLastError = state && typeof state === "object" ? String((state as any)?.import?.lastError ?? "") : "";
    const filterMode = state && typeof state === "object" ? String((state as any)?.filter?.mode ?? "") : "";
    const filterEmail = state && typeof state === "object" ? String((state as any)?.filter?.email ?? "") : "";
    const filterBubbleUserId = state && typeof state === "object" ? String((state as any)?.filter?.bubbleUserId ?? "") : "";
    const filterCompanyId = state && typeof state === "object" ? String((state as any)?.filter?.companyId ?? "") : "";

    return json(
      {
        ok: true,
        user: { userId: String(userId), email },
        bubbleSync: {
          statePath,
          phase,
          runId: state && typeof state === "object" ? String((state as any)?.runId ?? "") : "",
          runPrefix: state && typeof state === "object" ? String((state as any)?.runPrefix ?? "") : "",
          currentTypeIndex: Number.isFinite(currentTypeIndex) ? currentTypeIndex : 0,
          currentType,
          lastError: state && typeof state === "object" ? String((state as any)?.lastError ?? "") : "",
          import: { domain: importDomain, index: Number.isFinite(importIndex) ? importIndex : 0, status: importStatus, lastError: importLastError },
          filter: { mode: filterMode, email: filterEmail, bubbleUserId: filterBubbleUserId, companyId: filterCompanyId },
        },
      },
      { status: 200 },
    );
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

