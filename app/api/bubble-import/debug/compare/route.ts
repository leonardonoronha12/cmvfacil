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

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
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

function safeListStrings(input: unknown, limit = 60) {
  const arr = Array.isArray(input) ? input : [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of arr) {
    const s = String(x ?? "").trim();
    if (!s) continue;
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
    if (out.length >= limit) break;
  }
  return out;
}

export async function GET(req: NextRequest) {
  try {
    const { userId } = getUserIdFromRequest(req);
    if (!userId) return json({ ok: false, error: "unauthorized" }, { status: 401 });
    if (!isUuid(userId)) return json({ ok: false, error: "user_not_supabase_uuid" }, { status: 400 });

    let supabase: ReturnType<typeof getSupabaseAdmin>;
    try {
      supabase = getSupabaseAdmin();
    } catch {
      return json({ ok: false, error: "supabase_not_configured" }, { status: 500 });
    }

    const stateId = `user:${userId}`;
    const { data: insState } = await supabase.from("insumos_state").select("payload").eq("id", stateId).maybeSingle();
    const insRows = Array.isArray((insState as any)?.payload?.rows) ? ((insState as any).payload.rows as any[]) : [];
    const insNames = safeListStrings(insRows.map((r: any) => String(r?.item ?? "").trim()), 80);

    const { data: preState } = await supabase.from("pre_preparo_state").select("payload").eq("id", stateId).maybeSingle();
    const preRows = Array.isArray((preState as any)?.payload) ? ((preState as any).payload as any[]) : [];
    const preNames = safeListStrings(preRows.map((r: any) => String(r?.receita ?? r?.item ?? "").trim()), 80);

    const bucket = "bubble-imports";
    await ensureBucket(supabase, bucket);
    const statePath = `user:${userId}/bootstrap/sync-state.json`;
    const syncState = await downloadJson(supabase, bucket, statePath).catch(() => null);
    const perType = syncState?.perType && typeof syncState.perType === "object" ? (syncState.perType as Record<string, any>) : {};
    const tItem = perType["item"] ?? null;
    const tItens = perType["itens"] ?? null;

    return json(
      {
        ok: true,
        userId,
        sync: {
          phase: String(syncState?.phase ?? ""),
          item: tItem ? { status: String(tItem.status ?? ""), fetched: tItem.fetched ?? 0, lastError: String(tItem.lastError ?? ""), parts: tItem.parts ?? 0 } : null,
          itens: tItens ? { status: String(tItens.status ?? ""), fetched: tItens.fetched ?? 0, lastError: String(tItens.lastError ?? ""), parts: tItens.parts ?? 0 } : null,
        },
        imported: {
          insumosCount: insRows.length,
          prePreparoCount: preRows.length,
          insumosSample: insNames,
          prePreparoSample: preNames,
        },
      },
      { status: 200 },
    );
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
