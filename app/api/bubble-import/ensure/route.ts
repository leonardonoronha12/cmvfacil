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

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function getEnv(name: string) {
  const v = (process.env[name] ?? "").trim();
  return v || null;
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

async function uploadJsonToStorage(supabase: ReturnType<typeof getSupabaseAdmin>, bucket: string, path: string, payload: unknown) {
  const { error } = await supabase.storage.from(bucket).upload(path, JSON.stringify(payload), { contentType: "application/json", upsert: true });
  if (error) throw new Error(error.message);
}

function looksDataLikeFile(name: string) {
  const n = name.toLowerCase();
  return n.endsWith(".csv") || n.endsWith(".xlsx") || n.endsWith(".xls") || n.endsWith(".json");
}

async function listPrefix(supabase: ReturnType<typeof getSupabaseAdmin>, bucket: string, prefix: string) {
  const { data, error } = await supabase.storage.from(bucket).list(prefix, {
    limit: 1000,
    offset: 0,
    sortBy: { column: "name", order: "desc" },
  } as any);
  if (error) throw new Error(error.message);
  return (data ?? []) as any[];
}

async function listAllPaths(supabase: ReturnType<typeof getSupabaseAdmin>, bucket: string, prefix: string) {
  const paths: { path: string; name: string; updated_at?: string }[] = [];

  async function walk(currentPrefix: string, depth: number) {
    if (depth > 6) return;
    const folders: any[] = [];
    const files: any[] = [];
    for (let offset = 0; offset < 200000; offset += 1000) {
      const { data, error } = await supabase.storage
        .from(bucket)
        .list(currentPrefix, { limit: 1000, offset, sortBy: { column: "name", order: "asc" } } as any);
      if (error) throw new Error(error.message);
      const batch = data ?? [];
      for (const it of batch) {
        if ((it as any).id == null) folders.push(it);
        else files.push(it);
      }
      if (batch.length < 1000) break;
    }
    for (const f of files) paths.push({ path: `${currentPrefix}/${f.name}`, name: f.name, updated_at: (f as any).updated_at });
    for (const folder of folders) await walk(`${currentPrefix}/${folder.name}`, depth + 1);
  }

  await walk(prefix, 0);
  return paths.sort((a, b) => String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? "")) || a.path.localeCompare(b.path));
}

async function findLatestDumpPrefix(supabase: ReturnType<typeof getSupabaseAdmin>, bucket: string) {
  let roots: any[] = [];
  try {
    roots = await listPrefix(supabase, bucket, "");
  } catch {
    roots = [];
  }
  const userFolders = roots
    .filter((it) => (it as any)?.id == null)
    .map((it) => String(it?.name ?? "").trim())
    .filter((n) => /^user:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(n));

  let best: { prefix: string; updatedAt: string } | null = null;
  for (const userPrefix of userFolders.slice(0, 60)) {
    const bestPrefix = await findBestImportPrefix(supabase, bucket, userPrefix);
    let root: any[] = [];
    try {
      root = await listPrefix(supabase, bucket, bestPrefix);
    } catch {
      root = [];
    }
    const candidates = root.filter((it) => (it as any)?.id != null && looksDataLikeFile(String(it?.name ?? ""))) as any[];
    const latest = candidates
      .map((it) => String((it as any)?.updated_at ?? "").trim())
      .filter(Boolean)
      .sort((a, b) => b.localeCompare(a))[0];
    if (!latest) continue;
    if (!best || latest > best.updatedAt) best = { prefix: bestPrefix, updatedAt: latest };
  }
  return best?.prefix ?? null;
}

async function clonePrefixToUser(args: { supabase: ReturnType<typeof getSupabaseAdmin>; bucket: string; fromPrefix: string; toPrefix: string }) {
  const { supabase, bucket, fromPrefix, toPrefix } = args;
  const files = await listAllPaths(supabase, bucket, fromPrefix);
  const dataFiles = files.filter((f) => looksDataLikeFile(f.name)).slice(0, 500);
  let copied = 0;
  const errors: string[] = [];
  for (const f of dataFiles) {
    const rel = f.path.startsWith(fromPrefix) ? f.path.slice(fromPrefix.length).replace(/^\/+/, "") : f.name;
    const dest = `${toPrefix}/${rel}`.replace(/\/{2,}/g, "/");
    try {
      const { error } = await supabase.storage.from(bucket).copy(f.path, dest);
      if (error) {
        if (errors.length < 3) errors.push(error.message);
        continue;
      }
      copied += 1;
    } catch (err) {
      if (errors.length < 3) errors.push(err instanceof Error ? err.message : String(err));
    }
  }
  return { attempted: dataFiles.length, copied, errors };
}

async function findBestImportPrefix(supabase: ReturnType<typeof getSupabaseAdmin>, bucket: string, userPrefix: string) {
  const hasFilesAt = async (p: string) => {
    const items = await listPrefix(supabase, bucket, p);
    return items.some((it) => (it as any)?.id != null && looksDataLikeFile(String(it?.name ?? "")));
  };

  try {
    if (await hasFilesAt(userPrefix)) return userPrefix;
  } catch {
    // ignore
  }

  let days: string[] = [];
  try {
    const items = await listPrefix(supabase, bucket, userPrefix);
    days = items.filter((it) => (it as any)?.id == null).map((it) => String(it?.name ?? "").trim()).filter(Boolean);
  } catch {
    days = [];
  }
  days.sort((a, b) => b.localeCompare(a));

  for (const day of days.slice(0, 20)) {
    const dayPrefix = `${userPrefix}/${day}`;
    try {
      if (await hasFilesAt(dayPrefix)) return dayPrefix;
    } catch {
      // ignore
    }

    let runs: string[] = [];
    try {
      const items = await listPrefix(supabase, bucket, dayPrefix);
      runs = items.filter((it) => (it as any)?.id == null).map((it) => String(it?.name ?? "").trim()).filter(Boolean);
    } catch {
      runs = [];
    }
    runs.sort((a, b) => b.localeCompare(a));
    for (const run of runs.slice(0, 20)) {
      const runPrefix = `${dayPrefix}/${run}`;
      try {
        if (await hasFilesAt(runPrefix)) return runPrefix;
      } catch {
        // ignore
      }
    }
  }

  return userPrefix;
}

async function userHasAnyData(supabase: ReturnType<typeof getSupabaseAdmin>, userId: string) {
  const stateId = `user:${userId}`;
  const prefix = `user:${userId}:`;

  const hasState = async (table: string) => {
    const { data } = await supabase.from(table).select("id").eq("id", stateId).maybeSingle();
    return Boolean((data as any)?.id);
  };

  const hasRowsLike = async (table: string, likePrefix: string) => {
    const { data } = await supabase.from(table).select("id").like("id", `${likePrefix}%`).limit(1);
    return Array.isArray(data) && data.length > 0;
  };

  if (await hasState("insumos_state")) return true;
  if (await hasState("fornecedores_state")) return true;
  if (await hasState("pre_preparo_state")) return true;
  if (await hasState("fichas_tecnicas_state")) return true;

  if (await hasRowsLike("entradas", `${prefix}entrada:`)) return true;
  if (await hasRowsLike("inventario", `${prefix}inventario:`)) return true;
  if (await hasRowsLike("desperdicios", `${prefix}desperdicio:`)) return true;

  return false;
}

function prioritizeTypes(types: string[]) {
  const priority = ["User", "empresas"];
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (t: string) => {
    const v = String(t ?? "").trim();
    if (!v) return;
    const k = v.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    out.push(v);
  };
  for (const p of priority) {
    const exact = types.find((t) => t === p) ?? types.find((t) => String(t).toLowerCase() === p.toLowerCase()) ?? "";
    if (exact) push(exact);
  }
  for (const t of types) push(t);
  return out;
}

function buildAutoSyncTypes() {
  return prioritizeTypes([
    "User",
    "empresas",
    "categorias",
    "custo_medio_item",
    "desperdicio",
    "etiquetas",
    "faturamentos",
    "fornecedores",
    "Ingredientes",
    "inventarios",
    "itens_fornecedores",
    "itens_inventarios",
    "Itens_lista_compras",
    "itens_notas",
    "item",
    "motivos_desperdicios",
    "notas_fiscais",
    "qtd_compra_real",
  ]);
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

    const already = await userHasAnyData(supabase, userId);
    if (already) return json({ ok: true, status: "ready" }, { status: 200 });

    const userPrefix = `user:${userId}`;
    const bestPrefix = await findBestImportPrefix(supabase, bucket, userPrefix);

    let hasAnyFile = false;
    try {
      const root = await listPrefix(supabase, bucket, bestPrefix);
      hasAnyFile = root.some((it) => (it as any)?.id != null && looksDataLikeFile(String(it?.name ?? "")));
    } catch {
      hasAnyFile = false;
    }
    if (!hasAnyFile) {
      const baseUrl = getEnv("BUBBLE_BASE_URL");
      const token = getEnv("BUBBLE_API_TOKEN");
      if (!baseUrl || !token) {
        const sourcePrefix = await findLatestDumpPrefix(supabase, bucket);
        if (sourcePrefix) {
          const cloneRunId = crypto.randomUUID();
          const toPrefix = `${userPrefix}/bootstrap-seed/${cloneRunId}`;
          const copied = await clonePrefixToUser({ supabase, bucket, fromPrefix: sourcePrefix, toPrefix });
          if (copied.copied > 0) {
            const runId = crypto.randomUUID();
            const runPrefix = `${userPrefix}/bootstrap`;
            const statePath = `${runPrefix}/ensure-state.json`;
            const mappingPath = `${runPrefix}/ensure-mapping.json`;

            const existing = await downloadJsonFromStorage(supabase, bucket, statePath);
            if (existing && typeof existing === "object" && (existing as any)?.phase && (existing as any)?.phase !== "done") {
              return json({ ok: true, status: "running", mode: "rebuild", state: existing }, { status: 200 });
            }

            const now = new Date().toISOString();
            const stepsBase: Array<{ key: string; label: string; kinds: string[] }> = [
              { key: "users", label: "Users", kinds: ["users"] },
              { key: "empresas", label: "Empresas", kinds: ["empresas"] },
              { key: "categorias", label: "Categorias", kinds: ["categorias"] },
              { key: "insumos_custo_medio", label: "Insumos (Custo Médio)", kinds: ["custo_medio"] },
              { key: "insumos_ingredientes", label: "Insumos (Ingredientes)", kinds: ["ingredientes"] },
              { key: "insumos_itens", label: "Insumos (Itens)", kinds: ["itens"] },
              { key: "fornecedores_info", label: "Fornecedores (Info)", kinds: ["fornecedores"] },
              { key: "fornecedores_itens", label: "Fornecedores (Itens)", kinds: ["itens_fornecedores"] },
              { key: "fornecedores_equivalencias", label: "Fornecedores (Equivalências)", kinds: ["equivalencias"] },
              { key: "entradas_notas", label: "Entradas (Notas)", kinds: ["notas_fiscais"] },
              { key: "entradas_itens", label: "Entradas (Itens)", kinds: ["itens_notas"] },
              { key: "inventario", label: "Inventário", kinds: ["inventario"] },
              { key: "desperdicios_motivos", label: "Desperdícios (Motivos)", kinds: ["motivos_desperdicios"] },
              { key: "desperdicios", label: "Desperdícios", kinds: ["desperdicios"] },
              { key: "pre_preparo", label: "Pré-preparo", kinds: ["pre_preparo", "pre_preparo_etiquetas"] },
              { key: "fichas_tecnicas", label: "Fichas Técnicas", kinds: ["fichas_tecnicas"] },
              { key: "unknown", label: "Desconhecidos", kinds: ["unknown"] },
            ];

            const state = {
              v: 1,
              runId,
              runPrefix,
              statePath,
              mappingPath,
              startedAt: now,
              updatedAt: now,
              phase: "importing",
              storageOwnerUserId: userId,
              prefix: toPrefix,
              includeUnknown: true,
              only: null as string[] | null,
              steps: stepsBase.map((s) => ({ ...s, status: "pending", lastError: "", startedAt: null, finishedAt: null, lastResult: null })),
            };

            await uploadJsonToStorage(supabase, bucket, statePath, state);
            return json({ ok: true, status: "started", mode: "rebuild", state }, { status: 200 });
          }
          return json(
            {
              ok: true,
              status: "needs_setup",
              prefix: bestPrefix,
              reason: "seed_copy_failed",
              sourcePrefix,
              toPrefix,
              attempted: copied.attempted,
              copied: copied.copied,
              errors: copied.errors,
            },
            { status: 200 },
          );
        }
        return json({ ok: true, status: "needs_setup", prefix: bestPrefix, reason: "no_files_and_bubble_not_configured" }, { status: 200 });
      }

      const runId = crypto.randomUUID();
      const runPrefix = `${userPrefix}/bootstrap/${runId}`;
      const statePath = `${userPrefix}/bootstrap/sync-state.json`;

      const existing = await downloadJsonFromStorage(supabase, bucket, statePath);
      if (existing && typeof existing === "object" && (existing as any)?.phase && (existing as any)?.phase !== "done") {
        return json({ ok: true, status: "running", mode: "sync", state: existing }, { status: 200 });
      }

      const types = buildAutoSyncTypes();
      const state = newSyncState(runId, runPrefix, statePath, types);
      await uploadJsonToStorage(supabase, bucket, statePath, state);
      return json({ ok: true, status: "started", mode: "sync", state }, { status: 200 });
    }

    const runId = crypto.randomUUID();
    const runPrefix = `${userPrefix}/bootstrap`;
    const statePath = `${runPrefix}/ensure-state.json`;
    const mappingPath = `${runPrefix}/ensure-mapping.json`;

    const existing = await downloadJsonFromStorage(supabase, bucket, statePath);
    if (existing && typeof existing === "object" && (existing as any)?.phase && (existing as any)?.phase !== "done") {
      return json({ ok: true, status: "running", mode: "rebuild", state: existing }, { status: 200 });
    }

    const now = new Date().toISOString();
    const stepsBase: Array<{ key: string; label: string; kinds: string[] }> = [
      { key: "users", label: "Users", kinds: ["users"] },
      { key: "empresas", label: "Empresas", kinds: ["empresas"] },
      { key: "categorias", label: "Categorias", kinds: ["categorias"] },
      { key: "insumos_custo_medio", label: "Insumos (Custo Médio)", kinds: ["custo_medio"] },
      { key: "insumos_ingredientes", label: "Insumos (Ingredientes)", kinds: ["ingredientes"] },
      { key: "insumos_itens", label: "Insumos (Itens)", kinds: ["itens"] },
      { key: "fornecedores_info", label: "Fornecedores (Info)", kinds: ["fornecedores"] },
      { key: "fornecedores_itens", label: "Fornecedores (Itens)", kinds: ["itens_fornecedores"] },
      { key: "fornecedores_equivalencias", label: "Fornecedores (Equivalências)", kinds: ["equivalencias"] },
      { key: "entradas_notas", label: "Entradas (Notas)", kinds: ["notas_fiscais"] },
      { key: "entradas_itens", label: "Entradas (Itens)", kinds: ["itens_notas"] },
      { key: "inventario", label: "Inventário", kinds: ["inventario"] },
      { key: "desperdicios_motivos", label: "Desperdícios (Motivos)", kinds: ["motivos_desperdicios"] },
      { key: "desperdicios", label: "Desperdícios", kinds: ["desperdicios"] },
      { key: "pre_preparo", label: "Pré-preparo", kinds: ["pre_preparo", "pre_preparo_etiquetas"] },
      { key: "fichas_tecnicas", label: "Fichas Técnicas", kinds: ["fichas_tecnicas"] },
      { key: "unknown", label: "Desconhecidos", kinds: ["unknown"] },
    ];

    const state = {
      v: 1,
      runId,
      runPrefix,
      statePath,
      mappingPath,
      startedAt: now,
      updatedAt: now,
      phase: "importing",
      storageOwnerUserId: userId,
      prefix: bestPrefix,
      includeUnknown: true,
      only: null as string[] | null,
      steps: stepsBase.map((s) => ({ ...s, status: "pending", lastError: "", startedAt: null, finishedAt: null, lastResult: null })),
    };

    await uploadJsonToStorage(supabase, bucket, statePath, state);
    return json({ ok: true, status: "started", mode: "rebuild", state }, { status: 200 });
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
