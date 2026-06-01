import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../../lib/supabaseAdmin";
import { getUserIdFromRequest } from "../../../../lib/requestUserId";
import { formatDateLabelPT, formatMoneyBRL, normalizeKey, parseDateLoose, parsePtNumber, pickFirst } from "../../../../lib/bubbleCsv";

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

async function downloadJson(supabase: ReturnType<typeof getSupabaseAdmin>, bucket: string, path: string) {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 60);
  if (error || !data?.signedUrl) throw new Error(error?.message || "failed_to_sign");
  const res = await fetch(data.signedUrl, { cache: "no-store" });
  const text = await res.text();
  if (!res.ok) throw new Error(`failed_to_download_${res.status}`);
  return JSON.parse(text) as any;
}

async function uploadJson(supabase: ReturnType<typeof getSupabaseAdmin>, bucket: string, path: string, payload: unknown) {
  const { error } = await supabase.storage.from(bucket).upload(path, JSON.stringify(payload), { contentType: "application/json", upsert: true });
  if (error) throw new Error(error.message);
}

async function listAllPaths(supabase: ReturnType<typeof getSupabaseAdmin>, bucket: string, prefix: string) {
  const paths: { path: string; name: string }[] = [];
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
    for (const f of files) paths.push({ path: `${currentPrefix}/${f.name}`, name: String(f.name ?? "") });
    for (const folder of folders) await walk(`${currentPrefix}/${folder.name}`, depth + 1);
  }
  await walk(prefix, 0);
  return paths;
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

type BubbleConstraint = { key: string; constraint_type: string; value: unknown };

class BubbleApiError extends Error {
  bubbleStatus: number;
  bubbleBody: string;
  constructor(message: string, bubbleStatus: number, bubbleBody: string) {
    super(message);
    this.name = "BubbleApiError";
    this.bubbleStatus = bubbleStatus;
    this.bubbleBody = bubbleBody;
  }
}

async function fetchBubblePage(args: {
  baseUrl: string;
  token: string;
  typeName: string;
  cursor: number;
  limit: number;
  constraints?: BubbleConstraint[] | null;
  sortField?: string | null;
  descending?: boolean | null;
}) {
  const { baseUrl, token, typeName, cursor, limit, constraints, sortField, descending } = args;
  const qs = new URLSearchParams();
  qs.set("cursor", String(cursor));
  qs.set("limit", String(limit));
  if (sortField) qs.set("sort_field", String(sortField));
  if (typeof descending === "boolean") qs.set("descending", descending ? "true" : "false");
  if (constraints?.length) qs.set("constraints", JSON.stringify(constraints));
  const url = `${baseUrl}/api/1.1/obj/${encodeURIComponent(typeName)}?${qs.toString()}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  const text = await res.text();
  let jsonBody: any = null;
  try {
    jsonBody = JSON.parse(text);
  } catch {}
  if (!res.ok) {
    const rawText = String(text ?? "");
    const looksHtml = /<\s*(html|body|doctype)\b/i.test(rawText);
    const msgRaw = jsonBody?.body?.message || jsonBody?.message || rawText || `bubble_failed_${res.status}`;
    const msg = looksHtml ? `Bubble retornou HTML (status ${res.status}). Verifique URL base e token da Data API.` : String(msgRaw);
    throw new BubbleApiError(String(msg).slice(0, 400), res.status, rawText.slice(0, 2000));
  }
  const response = jsonBody?.response ?? jsonBody ?? {};
  const results = Array.isArray(response?.results) ? response.results : Array.isArray(response) ? response : [];
  const remaining = typeof response?.remaining === "number" ? response.remaining : null;
  return { results: results as unknown[], remaining };
}

function nowIso() {
  return new Date().toISOString();
}

function partLabel(part: number) {
  return String(part).padStart(4, "0");
}

function typeSlug(typeName: string) {
  return String(typeName ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^\w.-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 90);
}

function isTransient(status: number | null) {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504 || status === 520 || status === 521 || status === 522 || status === 523 || status === 524;
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function toCell(v: unknown) {
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function normalizeRowObject(raw: unknown) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) out[normalizeKey(k)] = toCell(v);
  return out;
}

function normalizeItemName(value: string) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function guessItemLabel(row: Record<string, string>) {
  const direct = pickFirst(row, ["item", "item_completo", "nome_item", "nome_do_item", "nome", "produto", "descricao", "ingrediente", "insumo", "titulo", "title", "name"]);
  if (direct) return direct;
  let best = "";
  for (const [k, v] of Object.entries(row)) {
    const kk = k.toLowerCase();
    if (
      kk.includes("id") ||
      kk.includes("unique") ||
      kk.includes("created") ||
      kk.includes("updated") ||
      kk.includes("data") ||
      kk.includes("date") ||
      kk.includes("custo") ||
      kk.includes("preco") ||
      kk.includes("valor") ||
      kk.includes("quant") ||
      kk.includes("qtd") ||
      kk.includes("medida") ||
      kk.includes("unidade") ||
      kk.includes("categoria") ||
      kk.includes("fornecedor") ||
      kk.includes("empresa") ||
      kk.includes("whatsapp") ||
      kk.includes("telefone") ||
      kk.includes("celular")
    ) {
      continue;
    }
    const s = String(v ?? "").trim();
    if (!s) continue;
    if (parsePtNumber(s) !== 0) continue;
    if (!/[A-Za-zÀ-ÿ]/.test(s)) continue;
    if (s.length > best.length) best = s;
  }
  return best;
}

function buildDateLabel(value: string) {
  const d = parseDateLoose(value);
  return d ? formatDateLabelPT(d) : String(value ?? "").trim();
}

export async function POST(req: NextRequest) {
  try {
    const { userId } = getUserIdFromRequest(req);
    if (!userId) return json({ ok: false, error: "unauthorized" }, { status: 401 });

    const body = (await req.json().catch(() => null)) as any;
    const statePath = String(body?.statePath ?? "").trim();
    const baseUrl = safeBaseUrl(body?.baseUrl ?? "");
    const token = safeToken(body?.token ?? "");
    const maxOps = typeof body?.maxOps === "number" && Number.isFinite(body.maxOps) && body.maxOps > 0 ? Math.min(50, Math.floor(body.maxOps)) : 10;
    if (!statePath) return json({ ok: false, error: "missing_statePath" }, { status: 400 });
    if (!statePath.startsWith(`user:${userId}/`)) return json({ ok: false, error: "forbidden" }, { status: 403 });
    if (!baseUrl) return json({ ok: false, error: "missing_base_url" }, { status: 400 });
    if (!token) return json({ ok: false, error: "missing_token" }, { status: 400 });

    let supabase: ReturnType<typeof getSupabaseAdmin>;
    try {
      supabase = getSupabaseAdmin();
    } catch {
      return json({ ok: false, error: "supabase_not_configured" }, { status: 500 });
    }
    const bucket = "bubble-imports";
    await ensureBucket(supabase, bucket);

    const state = await downloadJson(supabase, bucket, statePath);
    if (state?.v !== 1) return json({ ok: false, error: "unsupported_state" }, { status: 400 });

    const startMs = Date.now();
    const hardMs = 22_000;
    let ops = 0;

    const persist = async () => {
      state.updatedAt = nowIso();
      await uploadJson(supabase, bucket, statePath, state);
    };

    const ensureImportPlan = async () => {
      const has = state.import && typeof state.import === "object";
      if (!has) {
        state.import = {
          domains: ["insumos", "fornecedores", "entradas", "desperdicios", "inventario", "pre_preparo", "fichas_tecnicas"],
          index: 0,
          status: "pending",
          lastError: "",
        };
      }
      if (!Array.isArray(state.import.domains) || !state.import.domains.length) {
        state.import.domains = ["insumos", "fornecedores", "entradas", "desperdicios", "inventario", "pre_preparo", "fichas_tecnicas"];
      }
      if (typeof state.import.index !== "number" || !Number.isFinite(state.import.index) || state.import.index < 0) state.import.index = 0;
      if (typeof state.import.status !== "string") state.import.status = "pending";
      if (typeof state.import.lastError !== "string") state.import.lastError = "";
      await persist();
    };

    if (state.phase === "done") {
      if (state.import?.status === "done") return json({ ok: true, state }, { status: 200 });
      await ensureImportPlan();
      state.phase = "importing";
      await persist();
    }

    const doImportDomain = async (domain: string) => {
      const url = new URL("/api/bubble-import/import", req.url);
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: req.headers.get("cookie") ?? "" },
        body: JSON.stringify({ only: [domain], includeUnknown: true, prefix: state.runPrefix }),
        cache: "no-store",
      });
      const text = await res.text();
      let parsed: any = null;
      try {
        parsed = JSON.parse(text);
      } catch {}
      if (!res.ok || !parsed?.ok) throw new Error(parsed?.error || text || `import_failed_${res.status}`);
    };

    while (ops < maxOps && Date.now() - startMs < hardMs) {
      if (state.phase === "pulling") {
        const types: string[] = Array.isArray(state.types) ? state.types : [];
        if (!types.length) {
          state.phase = "error";
          state.updatedAt = nowIso();
          state.lastError = "missing_types";
          break;
        }

        let idx = typeof state.currentTypeIndex === "number" ? state.currentTypeIndex : 0;
        while (idx < types.length) {
          const t = String(types[idx] ?? "").trim();
          const p = state.perType?.[t];
          if (!p || p.status === "done") {
            idx += 1;
            continue;
          }
          state.currentTypeIndex = idx;
          p.status = p.segmentAfter ? "segmentando" : "pulling";

          const retryAt = typeof p.nextRetryAt === "number" ? p.nextRetryAt : 0;
          if (retryAt > Date.now()) {
            const seconds = Math.max(1, Math.ceil((retryAt - Date.now()) / 1000));
            p.status = `aguardando (${seconds}s)`;
            await persist();
            ops += 1;
            break;
          }

          const cursor = typeof p.cursor === "number" && p.cursor >= 0 ? p.cursor : 0;
          const segAfter = typeof p.segmentAfter === "string" && p.segmentAfter.trim() ? p.segmentAfter.trim() : null;
          const constraints = segAfter
            ? [
                {
                  key: "Created Date",
                  constraint_type: "greater than",
                  value: segAfter,
                },
              ]
            : null;

          let results: unknown[] = [];
          let remaining: number | null = null;
          let lastCreatedDate: string | null = null;
          let pausedByTransientError = false;
          for (let attempt = 0; attempt < 10; attempt++) {
            try {
              const page = await fetchBubblePage({ baseUrl, token, typeName: t, cursor, limit: 200, sortField: "Created Date", descending: false, constraints });
              results = page.results;
              remaining = page.remaining;
              break;
            } catch (err) {
              const bubbleStatus = err instanceof BubbleApiError ? err.bubbleStatus : null;
              if (!isTransient(bubbleStatus)) throw err;
              if (attempt >= 9) {
                p.errorCount = (p.errorCount ?? 0) + 1;
                p.lastError = err instanceof Error ? err.message : String(err);
                p.nextRetryAt = Date.now() + 60_000;
                p.status = "aguardando";
                await persist();
                ops += 1;
                pausedByTransientError = true;
                break;
              }
              await sleep(Math.min(12_000, 600 * Math.pow(2, attempt)));
            }
          }
          if (pausedByTransientError) break;

          for (let i = results.length - 1; i >= 0; i--) {
            const r: any = results[i];
            const cd = r && typeof r === "object" ? (r["Created Date"] ?? r["Modified Date"]) : null;
            if (typeof cd === "string" && cd.trim()) {
              lastCreatedDate = cd.trim();
              break;
            }
          }

          p.lastCreated = lastCreatedDate || p.lastCreated || null;
          p.remaining = typeof remaining === "number" ? remaining : null;

          const stalled = typeof remaining === "number" && remaining > 0 && results.length === 0;
          if (stalled) {
            const nextAfter = p.lastCreated;
            if (!nextAfter) {
              p.status = "error";
              p.errorCount = (p.errorCount ?? 0) + 1;
              p.lastError = "pagination_stalled_without_created_date";
              state.phase = "error";
              state.lastError = `${t}:pagination_stalled_without_created_date`;
              await persist();
              break;
            }
            p.segmentAfter = nextAfter;
            p.cursor = 0;
            await persist();
            ops += 1;
            break;
          }

          if (results.length) {
            const partNext = (typeof p.parts === "number" ? p.parts : 0) + 1;
            p.parts = partNext;
            const stamp = new Date().toISOString().replace(/[:.]/g, "-");
            const path = `${state.runPrefix}/${stamp}-bubble-api-${typeSlug(t)}_part${partLabel(partNext)}.json`;
            await uploadJson(supabase, bucket, path, { source: "bubble-data-api", type: t, pulledAt: nowIso(), cursor, rows: results, remaining });
            p.lastPath = path;
            p.fetched = (typeof p.fetched === "number" ? p.fetched : 0) + results.length;
            await persist();
          }

          p.cursor = cursor + results.length;
          const done = typeof remaining === "number" ? remaining === 0 : results.length === 0;
          if (done) {
            p.status = "done";
            p.segmentAfter = null;
            idx += 1;
            state.currentTypeIndex = idx;
            await persist();
          }

          ops += 1;
          break;
        }

        const allDone = types.every((t: string) => state.perType?.[t]?.status === "done");
        if (allDone) {
          state.phase = "importing";
          state.import.status = "pending";
          state.import.index = 0;
          await persist();
        }
      } else if (state.phase === "importing") {
        const domains: string[] = Array.isArray(state.import?.domains) ? state.import.domains : [];
        const idx = typeof state.import?.index === "number" ? state.import.index : 0;
        if (idx >= domains.length) {
          state.phase = "done";
          state.import.status = "done";
          await persist();
          break;
        }
        const domain = String(domains[idx] ?? "").trim();
        if (!domain) {
          state.import.index = idx + 1;
          await persist();
          ops += 1;
          continue;
        }
        if (domain === "insumos" || domain === "inventario") {
          state.import.status = "running";
          state.import.lastError = "";
          state.import.work = state.import.work && typeof state.import.work === "object" ? state.import.work : {};
          const work = (state.import.work[domain] && typeof state.import.work[domain] === "object" ? state.import.work[domain] : {}) as any;
          const filesPath = typeof work.filesPath === "string" ? String(work.filesPath) : `${state.runPrefix}/import-${domain}-files.json`;
          const accPath = typeof work.accPath === "string" ? String(work.accPath) : `${state.runPrefix}/import-${domain}-acc.json`;
          if (!work.filesReady) {
            const all = await listAllPaths(supabase, bucket, state.runPrefix);
            const filtered = all
              .filter((p) => p.name.toLowerCase().endsWith(".json"))
              .filter((p) => {
                const n = p.name.toLowerCase();
                if (domain === "insumos") return n.includes("-bubble-api-categorias_") || n.includes("-bubble-api-custo_medio_item_") || n.includes("-bubble-api-item_") || n.includes("-bubble-api-ingredientes_");
                return n.includes("-bubble-api-inventarios_");
              })
              .map((p) => p.path);
            await uploadJson(supabase, bucket, filesPath, { v: 1, files: filtered });
            await uploadJson(supabase, bucket, accPath, domain === "insumos" ? { v: 1, categoriasById: {}, custoByItemKey: {}, insumosByKey: {} } : { v: 1, contagens: {} });
            work.filesReady = true;
            work.filesPath = filesPath;
            work.accPath = accPath;
            work.cursor = 0;
            work.total = filtered.length;
            state.import.work[domain] = work;
            await persist();
            ops += 1;
            continue;
          }

          const filesDoc = await downloadJson(supabase, bucket, filesPath);
          const files: string[] = Array.isArray(filesDoc?.files) ? (filesDoc.files as any).map((x: any) => String(x ?? "")).filter(Boolean) : [];
          const cursor = typeof work.cursor === "number" && Number.isFinite(work.cursor) && work.cursor >= 0 ? Math.floor(work.cursor) : 0;
          const maxFilesPerTick = domain === "insumos" ? 6 : 6;
          const end = Math.min(files.length, cursor + maxFilesPerTick);
          const acc = await downloadJson(supabase, bucket, accPath);

          if (domain === "insumos") {
            const categoriasById: Record<string, string> = acc?.categoriasById && typeof acc.categoriasById === "object" ? acc.categoriasById : {};
            const custoByItemKey: Record<string, string> = acc?.custoByItemKey && typeof acc.custoByItemKey === "object" ? acc.custoByItemKey : {};
            const insumosByKey: Record<string, any> = acc?.insumosByKey && typeof acc.insumosByKey === "object" ? acc.insumosByKey : {};

            for (let i = cursor; i < end; i++) {
              const partPath = files[i]!;
              const payload = await downloadJson(supabase, bucket, partPath);
              const typeName = String(payload?.type ?? "").trim().toLowerCase();
              const rows = Array.isArray(payload?.rows) ? (payload.rows as any[]) : [];
              if (typeName.includes("categoria")) {
                for (const r of rows) {
                  const row = normalizeRowObject(r);
                  if (!row) continue;
                  const nome = pickFirst(row, ["nome", "titulo", "name"]);
                  if (!nome) continue;
                  const slug = pickFirst(row, ["slug"]);
                  const id = pickFirst(row, ["unique_id", "_id", "id", "bubble_id", "categoria_id", "id_categoria"]);
                  const cleaned = nome.trim();
                  if (id) categoriasById[id.trim()] = cleaned;
                  if (slug) categoriasById[slug.trim()] = cleaned;
                }
              } else if (typeName.includes("custo_medio")) {
                for (const r of rows) {
                  const row = normalizeRowObject(r);
                  if (!row) continue;
                  const item = guessItemLabel(row);
                  const itemKey = normalizeItemName(item);
                  if (!itemKey) continue;
                  const custo = pickFirst(row, ["custo_medio", "custo_medio_label", "custo", "valor", "preco", "preco_unitario", "custo_unitario", "valor_unitario"]);
                  const num = parsePtNumber(custo);
                  if (!num) continue;
                  custoByItemKey[itemKey] = formatMoneyBRL(num);
                }
              } else if (typeName === "item" || typeName.includes("ingred")) {
                for (const r of rows) {
                  const row = normalizeRowObject(r);
                  if (!row) continue;
                  const item = guessItemLabel(row);
                  const itemKey = normalizeItemName(item);
                  if (!itemKey) continue;
                  const bubbleId = pickFirst(row, ["unique_id", "_id", "id", "bubble_id", "item_id"]);
                  const medida = pickFirst(row, ["medida", "unidade", "unidade_medida", "unidade_de_medida", "unidade_de_compra", "unidade_base"]) || "Und";
                  const catId = pickFirst(row, ["categoria_id", "categoria", "categoria_slug"]);
                  const categoria = pickFirst(row, ["categoria", "category", "grupo", "grupo_categoria"]) || (catId ? categoriasById[catId.trim()] ?? "" : "");
                  const especificacao = pickFirst(row, ["especificacao", "especificacao_do_item", "descricao", "observacao", "obs", "detalhe"]);
                  const custo = pickFirst(row, ["custo_medio", "custo_medio_label", "custo", "valor", "preco", "custo_unitario", "preco_unitario", "valor_unitario"]);
                  const custoNum = parsePtNumber(custo);
                  const custoMedio = custoNum ? formatMoneyBRL(custoNum) : custoByItemKey[itemKey] ?? "";
                  const prev = insumosByKey[itemKey] ?? {};
                  insumosByKey[itemKey] = {
                    id: bubbleId || prev.id || String(Object.keys(insumosByKey).length + 1),
                    item: item.trim(),
                    medida: medida.trim() || prev.medida || "Und",
                    custoMedio: custoMedio || prev.custoMedio || undefined,
                    categoria: categoria.trim() || prev.categoria || undefined,
                    especificacao: especificacao.trim() || prev.especificacao || undefined,
                  };
                }
              }
              work.cursor = i + 1;
              work.lastFile = partPath;
              state.import.work[domain] = work;
              await uploadJson(supabase, bucket, accPath, { v: 1, categoriasById, custoByItemKey, insumosByKey });
              await persist();
              ops += 1;
              if (ops >= maxOps || Date.now() - startMs >= hardMs) return json({ ok: true, state, ops }, { status: 200 });
            }

            if (work.cursor >= files.length) {
              const insumosRows = Object.values(insumosByKey).filter((r) => r && typeof r === "object" && String((r as any).item ?? "").trim());
              const categories = Array.from(new Set(insumosRows.map((r: any) => String(r.categoria ?? "").trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, "pt-BR", { sensitivity: "base", numeric: true }));
              const stateId = `user:${userId}`;
              const { error } = await supabase.from("insumos_state").upsert({ id: stateId, payload: { rows: insumosRows, categories } } as any, { onConflict: "id" });
              if (error) throw new Error(`insumos_state:${error.message}`);
              state.import.index = idx + 1;
              state.import.lastError = "";
              await persist();
              ops += 1;
            }
          } else {
            const contagens: Record<string, any> = acc?.contagens && typeof acc.contagens === "object" ? acc.contagens : {};
            const batch: any[] = [];
            for (let i = cursor; i < end; i++) {
              const partPath = files[i]!;
              const payload = await downloadJson(supabase, bucket, partPath);
              const rows = Array.isArray(payload?.rows) ? (payload.rows as any[]) : [];
              for (const r of rows) {
                const row = normalizeRowObject(r);
                if (!row) continue;
                const bubbleId = pickFirst(row, ["unique_id", "_id", "id", "bubble_id", "inventario_id", "inventarios_id"]) || String(Object.keys(contagens).length + 1);
                const dataRaw = pickFirst(row, ["data", "date", "data_inventario"]) || pickFirst(row, ["created_date", "created_at"]);
                const dataLabel = buildDateLabel(dataRaw);
                if (!dataLabel) continue;
                const id = `user:${userId}:inventario:${bubbleId}`;
                if (!contagens[id]) contagens[id] = { id, data: dataLabel, categorias: [] as any[] };
              }
              work.cursor = i + 1;
              work.lastFile = partPath;
              state.import.work[domain] = work;
              await uploadJson(supabase, bucket, accPath, { v: 1, contagens });
              await persist();
              ops += 1;
              if (ops >= maxOps || Date.now() - startMs >= hardMs) return json({ ok: true, state, ops }, { status: 200 });
            }

            const allRows = Object.values(contagens);
            for (let i = 0; i < allRows.length; i += 500) {
              const chunk = allRows.slice(i, i + 500);
              if (!chunk.length) continue;
              batch.push(...chunk);
              const { error } = await supabase.from("inventario").upsert(chunk as any, { onConflict: "id" });
              if (error) throw new Error(`inventario:${error.message}`);
              ops += 1;
              if (ops >= maxOps || Date.now() - startMs >= hardMs) {
                await uploadJson(supabase, bucket, accPath, { v: 1, contagens });
                await persist();
                return json({ ok: true, state, ops }, { status: 200 });
              }
            }
            if (work.cursor >= files.length) {
              state.import.index = idx + 1;
              state.import.lastError = "";
              await persist();
              ops += 1;
            }
          }
        } else {
          state.import.status = "running";
          await persist();
          try {
            await doImportDomain(domain);
            state.import.index = idx + 1;
            state.import.lastError = "";
            await persist();
          } catch (err) {
            state.import.status = "error";
            state.import.lastError = err instanceof Error ? err.message : String(err);
            state.phase = "error";
            state.lastError = state.import.lastError;
            await persist();
          }
          ops += 1;
        }
      } else {
        break;
      }
    }

    await persist();
    return json({ ok: true, state, ops }, { status: 200 });
  } catch (err) {
    if (err instanceof BubbleApiError) {
      return json({ ok: false, error: err.message, bubbleStatus: err.bubbleStatus, bubbleBody: err.bubbleBody }, { status: 502 });
    }
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
