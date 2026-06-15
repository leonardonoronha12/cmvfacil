import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { getSupabaseAdmin } from "../../../../lib/supabaseAdmin";
import { getUserIdFromRequest } from "../../../../lib/requestUserId";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

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

function buildAutoSyncTypes() {
  return [
    "User",
    "empresas",
    "categorias",
    "custo_medio_item",
    "ingredientes",
    "item",
    "fornecedores",
    "itens_fornecedores",
    "equivalencias",
    "notas_fiscais",
    "itens_notas",
    "motivos_desperdicios",
    "desperdicios",
    "inventarios",
    "inventario_contagens",
    "pre_preparo",
    "pre_preparo_etiquetas",
    "fichas_tecnicas",
  ];
}

function newSyncState(runId: string, runPrefix: string, statePath: string, types: string[]) {
  const now = new Date().toISOString();
  const perType: Record<string, any> = {};
  for (const t of types) {
    perType[t] = {
      status: "pending",
      fetched: 0,
      parts: 0,
      cursor: 0,
      remaining: null,
      segmentAfter: null,
      lastCreated: null,
      lastPath: "",
      errorCount: 0,
      lastError: "",
    };
  }
  return {
    v: 1,
    runId,
    runPrefix,
    statePath,
    startedAt: now,
    updatedAt: now,
    phase: "pulling",
    types,
    currentTypeIndex: 0,
    perType,
    import: { domains: ["insumos", "fornecedores", "entradas", "desperdicios", "inventario", "pre_preparo", "fichas_tecnicas"], index: 0, status: "pending", lastError: "" },
  };
}

export async function POST(req: NextRequest) {
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

    const bucket = "bubble-imports";
    await ensureBucket(supabase, bucket);

    const statePath = `user:${userId}/bootstrap/sync-state.json`;
    const runId = crypto.randomUUID();
    const runPrefix = `user:${userId}/bootstrap/${runId}`;
    const state = newSyncState(runId, runPrefix, statePath, buildAutoSyncTypes());
    (state as any).filter = null;
    (state as any).userMap = null;
    (state as any).paused = null;

    const { error } = await supabase.storage.from(bucket).upload(statePath, JSON.stringify(state), { contentType: "application/json", upsert: true });
    if (error) throw new Error(error.message);

    return json({ ok: true, state }, { status: 200 });
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

