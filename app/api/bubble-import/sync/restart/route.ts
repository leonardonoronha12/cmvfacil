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

async function countByPrefix(supabase: ReturnType<typeof getSupabaseAdmin>, table: string, prefix: string) {
  const { count, error } = await supabase.from(table).select("id", { count: "exact", head: true }).like("id", `${prefix}%`);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

async function deleteByPrefix(supabase: ReturnType<typeof getSupabaseAdmin>, table: string, prefix: string) {
  const { error } = await supabase.from(table).delete().like("id", `${prefix}%`);
  if (error) throw new Error(error.message);
}

async function deleteById(supabase: ReturnType<typeof getSupabaseAdmin>, table: string, id: string) {
  const { error } = await supabase.from(table).delete().eq("id", id);
  if (error) throw new Error(error.message);
}

async function listBootstrapPaths(supabase: ReturnType<typeof getSupabaseAdmin>, bucket: string, bootstrapPrefix: string) {
  const { data: root, error: err1 } = await supabase.storage.from(bucket).list(bootstrapPrefix, { limit: 1000, sortBy: { column: "name", order: "asc" } });
  if (err1) throw new Error(err1.message);
  const out: string[] = [];
  const folders = (root ?? []).filter((it) => (it as any).id == null);
  const files = (root ?? []).filter((it) => (it as any).id != null);
  for (const f of files) out.push(`${bootstrapPrefix}/${f.name}`);
  for (const folder of folders) {
    const p = `${bootstrapPrefix}/${folder.name}`;
    const { data: level2, error: err2 } = await supabase.storage.from(bucket).list(p, { limit: 1000, sortBy: { column: "name", order: "asc" } });
    if (err2) continue;
    for (const f of level2 ?? []) {
      if ((f as any).id == null) continue;
      out.push(`${p}/${f.name}`);
    }
  }
  return out;
}

async function removeStoragePaths(supabase: ReturnType<typeof getSupabaseAdmin>, bucket: string, paths: string[]) {
  const list = Array.from(new Set(paths.map((p) => String(p ?? "").trim()).filter(Boolean)));
  const maxBatch = 100;
  for (let i = 0; i < list.length; i += maxBatch) {
    const batch = list.slice(i, i + maxBatch);
    await supabase.storage.from(bucket).remove(batch).catch(() => {});
  }
}

function buildAutoSyncTypes() {
  return [
    "Users",
    "User",
    "empresas",
    "categorias",
    "custo_medio_items",
    "custo_medio_item",
    "ficha_tecnica",
    "fichas_tecnicas",
    "ficha_tecnicas",
    "Ficha_Tecnica",
    "Fichas_Tecnicas",
    "Ingredientes",
    "ingredientes",
    "itens",
    "item",
    "fornecedores",
    "itens_fornecedores",
    "itens_inventarios",
    "Itens_lista_compras",
    "itens_lista_compras",
    "equivalencias",
    "notas_fiscais",
    "itens_notas",
    "motivos_desperdicios",
    "desperdicios",
    "inventarios",
    "etiquetas",
    "faturamentos",
    "qtd_compra_reals",
    "qtd_compra_real",
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

    const body = (await req.json().catch(() => null)) as any;
    const hard = body?.hard !== false;
    const baseUrl = safeBaseUrl(String(body?.baseUrl ?? ""));
    const token = safeToken(String(body?.token ?? ""));

    let supabase: ReturnType<typeof getSupabaseAdmin>;
    try {
      supabase = getSupabaseAdmin();
    } catch {
      return json({ ok: false, error: "supabase_not_configured" }, { status: 500 });
    }

    const bucket = "bubble-imports";
    await ensureBucket(supabase, bucket);

    let deleted: any = null;
    if (hard) {
      const stateId = `user:${userId}`;
      const prefix = `${stateId}:`;

      const before = {
        entradas: await countByPrefix(supabase, "entradas", `${prefix}entrada:`).catch(() => 0),
        desperdicios: await countByPrefix(supabase, "desperdicios", `${prefix}desperdicio:`).catch(() => 0),
        inventario: await countByPrefix(supabase, "inventario", `${prefix}inventario:`).catch(() => 0),
      };

      await deleteByPrefix(supabase, "entradas", `${prefix}entrada:`).catch(() => {});
      await deleteByPrefix(supabase, "desperdicios", `${prefix}desperdicio:`).catch(() => {});
      await deleteByPrefix(supabase, "inventario", `${prefix}inventario:`).catch(() => {});

      await deleteById(supabase, "insumos_state", stateId).catch(() => {});
      await deleteById(supabase, "fornecedores_state", stateId).catch(() => {});
      await deleteById(supabase, "insumos_templates_state", stateId).catch(() => {});
      await deleteById(supabase, "fichas_tecnicas_state", stateId).catch(() => {});
      await deleteById(supabase, "fichas_tecnicas_etiquetas_state", stateId).catch(() => {});
      await deleteById(supabase, "pre_preparo_state", stateId).catch(() => {});
      await deleteById(supabase, "pre_preparo_etiquetas_state", stateId).catch(() => {});

      const after = {
        entradas: await countByPrefix(supabase, "entradas", `${prefix}entrada:`).catch(() => 0),
        desperdicios: await countByPrefix(supabase, "desperdicios", `${prefix}desperdicio:`).catch(() => 0),
        inventario: await countByPrefix(supabase, "inventario", `${prefix}inventario:`).catch(() => 0),
      };
      deleted = { entradas: before.entradas - after.entradas, desperdicios: before.desperdicios - after.desperdicios, inventario: before.inventario - after.inventario };

      const statePathPrev = `user:${userId}/bootstrap/sync-state.json`;
      const bootstrapPrefix = `user:${userId}/bootstrap`;
      const bootstrapPaths = await listBootstrapPaths(supabase, bucket, bootstrapPrefix).catch(() => []);
      await removeStoragePaths(supabase, bucket, [statePathPrev, ...bootstrapPaths]).catch(() => {});
    }

    const statePath = `user:${userId}/bootstrap/sync-state.json`;
    const runId = crypto.randomUUID();
    const runPrefix = `user:${userId}/bootstrap/${runId}`;
    const state = newSyncState(runId, runPrefix, statePath, buildAutoSyncTypes());
    (state as any).filter = null;
    (state as any).userMap = null;
    (state as any).paused = null;
    if (baseUrl || token) (state as any).credentials = { ...(baseUrl ? { baseUrl } : {}), ...(token ? { token } : {}) };

    const { error } = await supabase.storage.from(bucket).upload(statePath, JSON.stringify(state), { contentType: "application/json", upsert: true });
    if (error) throw new Error(error.message);

    return json({ ok: true, hard, deleted, state }, { status: 200 });
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
