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
  if (n.endsWith(".csv") || n.endsWith(".xlsx") || n.endsWith(".xls")) return true;
  if (n.endsWith(".json") && !n.endsWith("state.json") && !n.endsWith("mapping.json")) return true;
  return false;
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
  const paths: { path: string; name: string; updated_at?: string; size?: number }[] = [];

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
    for (const f of files)
      paths.push({ path: `${currentPrefix}/${f.name}`, name: f.name, updated_at: (f as any).updated_at, size: (f as any)?.metadata?.size });
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

function contentTypeFromName(name: string) {
  const n = String(name ?? "").toLowerCase();
  if (n.endsWith(".csv")) return "text/csv";
  if (n.endsWith(".xlsx")) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (n.endsWith(".xls")) return "application/vnd.ms-excel";
  if (n.endsWith(".json")) return "application/json";
  return "application/octet-stream";
}

async function clonePrefixToUser(args: { supabase: ReturnType<typeof getSupabaseAdmin>; bucket: string; fromPrefix: string; toPrefix: string }) {
  const { supabase, bucket, fromPrefix, toPrefix } = args;
  const files = await listAllPaths(supabase, bucket, fromPrefix);
  const dataFiles = files.filter((f) => looksDataLikeFile(f.name)).slice(0, 500);
  let copied = 0;
  const errors: string[] = [];
  for (const f of dataFiles) {
    const dest = `${toPrefix}/${f.name}`.replace(/\/{2,}/g, "/");
    if (typeof f.size === "number" && f.size > 25_000_000) {
      if (errors.length < 3) errors.push(`file_too_large:${f.name}`);
      continue;
    }
    try {
      const { error } = await supabase.storage.from(bucket).copy(f.path, dest);
      if (!error) {
        const { error: verifyError } = await supabase.storage.from(bucket).createSignedUrl(dest, 60);
        if (!verifyError) {
          copied += 1;
          continue;
        }
      }
    } catch (err) {
      if (errors.length < 3) errors.push(err instanceof Error ? err.message : String(err));
    }

    try {
      const dl = await supabase.storage.from(bucket).download(f.path);
      if (dl.error || !dl.data) {
        if (errors.length < 3) errors.push(dl.error?.message || "failed_to_download");
        continue;
      }
      const blob = dl.data as any;
      const blobSize = typeof blob?.size === "number" ? blob.size : null;
      if (blobSize != null && blobSize > 25_000_000) {
        if (errors.length < 3) errors.push(`file_too_large:${f.name}`);
        continue;
      }
      const buf = await dl.data.arrayBuffer();
      if (buf.byteLength > 25_000_000) {
        if (errors.length < 3) errors.push(`file_too_large:${f.name}`);
        continue;
      }
      const { error: upErr } = await supabase.storage
        .from(bucket)
        .upload(dest, buf, { upsert: true, contentType: contentTypeFromName(f.name) } as any);
      if (upErr) {
        if (errors.length < 3) errors.push(upErr.message);
        continue;
      }
      const { error: verifyErr2 } = await supabase.storage.from(bucket).createSignedUrl(dest, 60);
      if (verifyErr2) {
        if (errors.length < 3) errors.push(verifyErr2.message);
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

  const hasNonEmptyState = async (table: string) => {
    if (table === "insumos_state") {
      const { data } = await supabase.from(table).select("payload").eq("id", stateId).maybeSingle();
      const payload = (data as any)?.payload;
      const rows = Array.isArray(payload?.rows) ? payload.rows : [];
      for (const r of rows) {
        if (!r || typeof r !== "object") continue;
        const obj = r as any;
        const id = String(obj.id ?? "").trim();
        const item = String(obj.item ?? "").trim();
        if (id && item) return true;
      }
      return false;
    }
    if (table === "fornecedores_state") {
      const { data } = await supabase.from(table).select("info,produtos,equivalencias").eq("id", stateId).maybeSingle();
      const info = (data as any)?.info;
      const produtos = (data as any)?.produtos;
      const equivalencias = (data as any)?.equivalencias;
      const hasInfo = info && typeof info === "object" && Object.keys(info).length > 0;
      const hasProdutos = produtos && typeof produtos === "object" && Object.keys(produtos).length > 0;
      const hasEq = equivalencias && typeof equivalencias === "object" && Object.keys(equivalencias).length > 0;
      return Boolean(hasInfo || hasProdutos || hasEq);
    }
    if (table === "pre_preparo_state" || table === "pre_preparo_etiquetas_state" || table === "fichas_tecnicas_state" || table === "fichas_tecnicas_etiquetas_state") {
      const { data } = await supabase.from(table).select("payload").eq("id", stateId).maybeSingle();
      const payload = (data as any)?.payload;
      return Array.isArray(payload) ? payload.length > 0 : payload && typeof payload === "object" ? Object.keys(payload).length > 0 : false;
    }
    const { data } = await supabase.from(table).select("id").eq("id", stateId).maybeSingle();
    return Boolean((data as any)?.id);
  };

  const hasRowsLike = async (table: string, likePrefix: string) => {
    const { data } = await supabase.from(table).select("id").like("id", `${likePrefix}%`).limit(1);
    return Array.isArray(data) && data.length > 0;
  };

  if (await hasNonEmptyState("insumos_state")) return true;
  if (await hasNonEmptyState("fornecedores_state")) return true;
  if (await hasNonEmptyState("pre_preparo_state")) return true;
  if (await hasNonEmptyState("fichas_tecnicas_state")) return true;

  try {
    const { data } = await supabase.from("insumos").select("id").like("id", `${prefix}%`).limit(1);
    if (Array.isArray(data) && data.length > 0) return true;
  } catch {
    // ignore
  }

  if (await hasRowsLike("entradas", `${prefix}entrada:`)) return true;
  if (await hasRowsLike("inventario", `${prefix}inventario:`)) return true;
  if (await hasRowsLike("desperdicios", `${prefix}desperdicio:`)) return true;

  return false;
}

function extractUuidFromScopedId(input: string) {
  const s = String(input ?? "").trim();
  const m = s.match(/^user:([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})(?=[:/]|$)/i);
  return m ? String(m[1]).toLowerCase() : null;
}

function replaceUserScopeInString(value: string, fromUserId: string, toUserId: string) {
  if (!value) return value;
  const from = `user:${fromUserId}`;
  if (!value.includes(from)) return value;
  return value.split(from).join(`user:${toUserId}`);
}

function replaceUserScopeDeep(value: unknown, fromUserId: string, toUserId: string): unknown {
  if (value == null) return value;
  if (typeof value === "string") return replaceUserScopeInString(value, fromUserId, toUserId);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map((v) => replaceUserScopeDeep(v, fromUserId, toUserId));
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) out[k] = replaceUserScopeDeep(v, fromUserId, toUserId);
    return out;
  }
  return value;
}

async function findSourceUserIdFromDb(supabase: ReturnType<typeof getSupabaseAdmin>) {
  try {
    const { data } = await supabase.from("insumos_state").select("id,payload,updated_at").order("updated_at", { ascending: false }).limit(50);
    for (const row of (data ?? []) as any[]) {
      const uid = extractUuidFromScopedId(String(row?.id ?? ""));
      const payload = row?.payload;
      const rows = payload && typeof payload === "object" ? (payload as any).rows : null;
      if (uid && Array.isArray(rows) && rows.length > 0) return uid;
    }
  } catch {
    // ignore
  }
  try {
    const { data } = await supabase.from("inventario").select("id,created_at").order("created_at", { ascending: false }).limit(50);
    for (const row of (data ?? []) as any[]) {
      const id = String(row?.id ?? "");
      const m = id.match(/^user:([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}):/i);
      if (m) return String(m[1]).toLowerCase();
    }
  } catch {
    // ignore
  }
  return null;
}

async function upsertInBatches<T extends Record<string, unknown>>(supabase: ReturnType<typeof getSupabaseAdmin>, table: string, rows: T[], batchSize = 500) {
  let inserted = 0;
  for (let i = 0; i < rows.length; i += batchSize) {
    const chunk = rows.slice(i, i + batchSize);
    const { error } = await supabase.from(table).upsert(chunk as any, { onConflict: "id" });
    if (error) throw new Error(error.message);
    inserted += chunk.length;
  }
  return inserted;
}

function pickColumns(row: Record<string, unknown>, keys: string[]) {
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    if (k in row) out[k] = row[k];
  }
  return out;
}

async function cloneUserDataFromDb(args: { supabase: ReturnType<typeof getSupabaseAdmin>; fromUserId: string; toUserId: string }) {
  const { supabase, fromUserId, toUserId } = args;
  const fromStateId = `user:${fromUserId}`;
  const toStateId = `user:${toUserId}`;
  const fromPrefix = `user:${fromUserId}:`;
  const toPrefix = `user:${toUserId}:`;

  const result = {
    sourceUserId: fromUserId,
    targetUserId: toUserId,
    states: { insumos_state: false, fornecedores_state: false, pre_preparo_state: false, pre_preparo_etiquetas_state: false, fichas_tecnicas_state: false },
    lists: { inventario: 0, entradas: 0, desperdicios: 0 },
  };

  const copyState = async (table: string, cols: string[]) => {
    const { data, error } = await supabase.from(table).select(cols.join(",")).eq("id", fromStateId).maybeSingle();
    if (error || !data) return false;
    const raw = data as any as Record<string, unknown>;
    const picked = pickColumns(raw, cols);
    picked.id = toStateId;
    const replaced = replaceUserScopeDeep(picked, fromUserId, toUserId) as Record<string, unknown>;
    const { error: upErr } = await supabase.from(table).upsert(replaced as any, { onConflict: "id" });
    if (upErr) throw new Error(`${table}:${upErr.message}`);
    return true;
  };

  try {
    result.states.insumos_state = await copyState("insumos_state", ["id", "payload"]);
  } catch {
    result.states.insumos_state = false;
  }
  try {
    result.states.fornecedores_state = await copyState("fornecedores_state", ["id", "info", "produtos", "equivalencias"]);
  } catch {
    result.states.fornecedores_state = false;
  }
  try {
    result.states.pre_preparo_state = await copyState("pre_preparo_state", ["id", "payload"]);
  } catch {
    result.states.pre_preparo_state = false;
  }
  try {
    result.states.pre_preparo_etiquetas_state = await copyState("pre_preparo_etiquetas_state", ["id", "payload"]);
  } catch {
    result.states.pre_preparo_etiquetas_state = false;
  }
  try {
    result.states.fichas_tecnicas_state = await copyState("fichas_tecnicas_state", ["id", "payload"]);
  } catch {
    result.states.fichas_tecnicas_state = false;
  }

  const copyList = async (table: string, likeIdPrefix: string, cols: string[], batchSize: number) => {
    const { data, error } = await supabase.from(table).select(cols.join(",")).like("id", `${likeIdPrefix}%`).limit(2000);
    if (error || !Array.isArray(data) || !data.length) return 0;
    const rows = (data as any[]).map((r) => {
      const raw = r as Record<string, unknown>;
      const picked = pickColumns(raw, cols);
      const id = String(picked.id ?? "");
      if (id && id.startsWith(fromPrefix)) picked.id = `${toPrefix}${id.slice(fromPrefix.length)}`;
      return replaceUserScopeDeep(picked, fromUserId, toUserId) as Record<string, unknown>;
    });
    return await upsertInBatches(supabase, table, rows, batchSize);
  };

  try {
    result.lists.inventario = await copyList("inventario", `${fromPrefix}inventario:`, ["id", "data", "categorias"], 100);
  } catch {
    result.lists.inventario = 0;
  }
  try {
    result.lists.entradas = await copyList(
      "entradas",
      `${fromPrefix}entrada:`,
      ["id", "numero", "dataLancamento", "fornecedor", "valorNota", "itens", "responsavel", "dataCriacao", "itensNota"],
      300,
    );
  } catch {
    result.lists.entradas = 0;
  }
  try {
    result.lists.desperdicios = await copyList("desperdicios", `${fromPrefix}desperdicio:`, ["id", "data", "item", "quantidade", "custo", "motivo"], 500);
  } catch {
    result.lists.desperdicios = 0;
  }

  return result;
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

    const body = (await req.json().catch(() => null)) as any;
    const baseUrl = safeBaseUrl(String(body?.baseUrl ?? getEnv("BUBBLE_BASE_URL") ?? ""));
    const token = safeToken(String(body?.token ?? getEnv("BUBBLE_API_TOKEN") ?? ""));

    let supabase: ReturnType<typeof getSupabaseAdmin>;
    try {
      supabase = getSupabaseAdmin();
    } catch {
      return json({ ok: false, error: "supabase_not_configured" }, { status: 500 });
    }

    const bucket = "bubble-imports";
    await ensureBucket(supabase, bucket);

    const already = await userHasAnyData(supabase, userId);
    if (already) return json({ ok: true, status: "ready", userId }, { status: 200 });

    if (!baseUrl || !token) {
      return json({ ok: true, status: "needs_setup", reason: "missing_bubble_credentials", userId }, { status: 200 });
    }

    const runId = crypto.randomUUID();
    const runPrefix = `user:${userId}/bootstrap/${runId}`;
    const statePath = `user:${userId}/bootstrap/sync-state.json`;

    const existing = await downloadJsonFromStorage(supabase, bucket, statePath);
    const existingSyncPhase = existing && typeof existing === "object" ? String((existing as any)?.phase ?? "").trim().toLowerCase() : "";
    if (existingSyncPhase === "done") {
      if (!baseUrl || !token) {
        return json({ ok: true, status: "needs_setup", reason: "missing_bubble_credentials", userId, state: existing }, { status: 200 });
      }
      return json({ ok: true, status: "needs_setup", reason: "import_done_but_empty", userId, state: existing }, { status: 200 });
    }
    if (existingSyncPhase && existingSyncPhase !== "done" && existingSyncPhase !== "error") {
      return json({ ok: true, status: "running", mode: "sync", state: existing, userId }, { status: 200 });
    }

    const types = buildAutoSyncTypes();
    const state = newSyncState(runId, runPrefix, statePath, types);
    await uploadJsonToStorage(supabase, bucket, statePath, state);
    return json({ ok: true, status: "started", mode: "sync", state, userId }, { status: 200 });
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
