import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../../lib/supabaseAdmin";
import { getUserIdFromRequest } from "../../../../lib/requestUserId";
import { formatDateLabelPT, formatMoneyBRL, normalizeKey, parseDateLoose, parsePtNumber, pickFirst } from "../../../../lib/bubbleCsv";

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  return NextResponse.json(data, { ...init, headers });
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

async function downloadJson(supabase: ReturnType<typeof getSupabaseAdmin>, bucket: string, path: string) {
  const fileName = path.split("/").slice(-1)[0] || "file";

  const parseText = (text: string, contentType: string) => {
    const ct = (contentType ?? "").toLowerCase();
    const trimmed = String(text ?? "").trimStart();
    const looksMarkup = trimmed.startsWith("<") || ct.includes("text/html") || ct.includes("application/xml") || ct.includes("text/xml");
    if (looksMarkup) throw new Error(`invalid_json_from_storage:${fileName}`);
    try {
      return JSON.parse(text) as any;
    } catch {
      throw new Error(`invalid_json_from_storage:${fileName}`);
    }
  };

  for (let attempt = 0; attempt < 4; attempt++) {
    const dl = await supabase.storage.from(bucket).download(path);
    if (!dl.error && dl.data) {
      try {
        const buf = await dl.data.arrayBuffer();
        const text = new TextDecoder().decode(buf);
        return parseText(text, (dl as any)?.data?.type ?? "application/json");
      } catch (err) {
        if (attempt >= 3) throw err;
      }
    }
    const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 60);
    if (error || !data?.signedUrl) throw new Error(error?.message || "failed_to_sign");
    const res = await fetch(data.signedUrl, { cache: "no-store" });
    const text = await res.text();
    if (!res.ok) {
      if (attempt < 3) {
        await sleep(300 * Math.pow(2, attempt));
        continue;
      }
      throw new Error(`failed_to_download_${res.status}`);
    }
    try {
      return parseText(text, res.headers.get("content-type") ?? "");
    } catch (err) {
      if (attempt < 3) {
        await sleep(300 * Math.pow(2, attempt));
        continue;
      }
      throw err;
    }
  }
  throw new Error(`invalid_json_from_storage:${fileName}`);
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
  return paths.sort((a, b) => a.path.localeCompare(b.path));
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

function isMissingTableError(err: any) {
  const msg = String(err?.message ?? "").toLowerCase();
  const code = String(err?.code ?? "").toLowerCase();
  if (code === "42p01") return true;
  if (msg.includes("does not exist")) return true;
  if (msg.includes("relation") && msg.includes("does not exist")) return true;
  return false;
}

function safeIdSegment(input: string) {
  const s = String(input ?? "").trim();
  if (!s) return "";
  return s.replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 90);
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

function normalizeFornecedorKey(value: string) {
  return String(value ?? "").trim().toUpperCase();
}

function pickKeyLike(row: Record<string, string>, parts: string[], opts?: { excludeParts?: string[] }) {
  const exclude = opts?.excludeParts ?? [];
  for (const k of Object.keys(row)) {
    const kk = k.toLowerCase();
    if (exclude.some((p) => kk.includes(p))) continue;
    if (!parts.some((p) => kk.includes(p))) continue;
    const v = String(row[k] ?? "").trim();
    if (v) return v;
  }
  return "";
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

function isImportTransientErrorMessage(msg: string) {
  const m = String(msg ?? "").toLowerCase();
  if (!m) return false;
  if (m.startsWith("invalid_json_from_storage:")) return true;
  if (m.startsWith("failed_to_download_")) return true;
  if (m === "failed_to_sign" || m === "failed_to_download") return true;
  if (m === "fetch failed") return true;
  if (m.includes("failed_502") || m.includes("failed_503") || m.includes("failed_504")) return true;
  if (m.includes(" 502") || m.includes(" 503") || m.includes(" 504")) return true;
  if (m.includes("timeout") || m.includes("timed out") || m.includes("etimedout")) return true;
  return false;
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function extractUuidFromText(input: string) {
  const s = String(input ?? "").trim();
  if (!s) return null;
  const m = s.match(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);
  return m ? String(m[0]).toLowerCase() : null;
}

function extractEmailFromText(input: string) {
  const s = String(input ?? "").trim();
  if (!s) return null;
  const m = s.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
  return m ? String(m[0]).trim().toLowerCase() : null;
}

function extractBubbleIdFromText(input: string) {
  const s = String(input ?? "").trim();
  if (!s) return null;
  const m = s.match(/"(?:unique_id|_id|id|bubble_id|user_id)"\s*:\s*"([^"]+)"/i);
  return m ? String(m[1] ?? "").trim() : null;
}

function pickUserRefFromRow(row: Record<string, string>) {
  const direct =
    pickFirst(row, [
      "user_id",
      "usuario_id",
      "id_usuario",
      "created_by",
      "createdby",
      "created_by_id",
      "createdby_id",
      "created_by_email",
      "createdby_email",
      "creator",
      "creator_id",
      "creator_email",
      "criador",
      "criador_id",
      "criador_email",
      "owner",
      "owner_id",
      "owner_email",
      "dono",
      "dono_id",
      "responsavel_id",
      "responsavel_email",
      "supabase_user_id",
      "supabase_uid",
      "auth_uid",
      "user",
      "usuario",
      "user_email",
      "usuario_email",
    ]) ||
    pickFirst(row, ["created by", "Created By", "Created by", "Criado por", "criado por"]) ||
    pickFirst(row, ["_user", "user (id)"]);
  if (!direct) return null;
  return String(direct);
}

async function loadAuthEmailToIdMap(supabase: ReturnType<typeof getSupabaseAdmin>) {
  const emailToId: Record<string, string> = {};
  for (let page = 1; page <= 2000; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`auth_list_users:${error.message}`);
    const users = (data?.users ?? []) as any[];
    for (const u of users) {
      const id = String(u?.id ?? "").trim();
      const email = String(u?.email ?? "").trim().toLowerCase();
      if (id && email) emailToId[email] = id;
    }
    if (users.length < 1000) break;
  }
  return emailToId;
}

export async function POST(req: NextRequest) {
  try {
    const { userId } = getUserIdFromRequest(req);
    if (!userId) return json({ ok: false, error: "unauthorized" }, { status: 401 });

    const body = (await req.json().catch(() => null)) as any;
    const statePath = String(body?.statePath ?? "").trim();
    const baseUrl = safeBaseUrl(body?.baseUrl ?? getEnv("BUBBLE_BASE_URL") ?? "");
    const token = safeToken(body?.token ?? getEnv("BUBBLE_API_TOKEN") ?? "");
    const resume = Boolean(body?.resume);
    const importAsUserIdRaw = typeof body?.importAsUserId === "string" ? String(body.importAsUserId).trim() : "";
    const overrideImportUserId = importAsUserIdRaw && isUuid(importAsUserIdRaw) ? importAsUserIdRaw : "";
    const maxOps = typeof body?.maxOps === "number" && Number.isFinite(body.maxOps) && body.maxOps > 0 ? Math.min(50, Math.floor(body.maxOps)) : 10;
    if (!statePath) return json({ ok: false, error: "missing_statePath" }, { status: 400 });
    if (!statePath.startsWith(`user:${userId}/`)) return json({ ok: false, error: "forbidden" }, { status: 403 });

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

    const ensureUserMap = async () => {
      if (overrideImportUserId) return;
      const existing = state.userMap && typeof state.userMap === "object" ? state.userMap : null;
      const emailToIdExisting = existing && existing.emailToId && typeof existing.emailToId === "object" ? existing.emailToId : null;
      const bubbleIdToEmailExisting = existing && existing.bubbleIdToEmail && typeof existing.bubbleIdToEmail === "object" ? existing.bubbleIdToEmail : null;
      const hasEmailToId = Boolean(existing?.v === 1 && emailToIdExisting && Object.keys(emailToIdExisting).length);
      const hasBubbleIdToEmail = Boolean(existing?.v === 1 && bubbleIdToEmailExisting && Object.keys(bubbleIdToEmailExisting).length);
      if (hasEmailToId && hasBubbleIdToEmail) return;
      try {
        const next: any = existing && typeof existing === "object" ? { ...existing } : {};
        if (!hasEmailToId) next.emailToId = await loadAuthEmailToIdMap(supabase);
        if (!hasBubbleIdToEmail && typeof state.runPrefix === "string" && state.runPrefix) {
          const all = await listAllPaths(supabase, bucket, state.runPrefix);
          const userFiles = all
            .filter((p) => {
              const n = String(p.name ?? "").toLowerCase();
              return n.includes("-bubble-api-user_") || n.includes("-bubble-api-users_") || n.includes("-bubble-api-usuario_") || n.includes("-bubble-api-usuarios_");
            })
            .slice(-500);
          const bubbleIdToEmail: Record<string, string> = {};
          for (const f of userFiles) {
            const payload = await downloadJson(supabase, bucket, f.path);
            const rows = Array.isArray(payload?.rows) ? (payload.rows as any[]) : [];
            for (const r of rows) {
              const row = normalizeRowObject(r);
              if (!row) continue;
              const bubbleId = pickFirst(row, ["unique_id", "_id", "id", "bubble_id", "user_id", "usuario_id", "id_usuario"]);
              if (!bubbleId) continue;
              const emailRaw = pickFirst(row, ["email", "user_email", "usuario_email", "e_mail", "mail", "login", "username"]);
              const email = emailRaw ? extractEmailFromText(emailRaw) : null;
              if (email) bubbleIdToEmail[String(bubbleId).trim()] = email;
            }
          }
          next.bubbleIdToEmail = bubbleIdToEmail;
        }
        next.v = 1;
        next.updatedAt = nowIso();
        state.userMap = next;
        await persist();
      } catch {}
    };

    const resolveImportUserId = (row: Record<string, string>) => {
      if (overrideImportUserId) return overrideImportUserId;
      const ref = pickUserRefFromRow(row);
      const uuid = ref ? extractUuidFromText(ref) : null;
      if (uuid) return uuid;
      const email = ref ? extractEmailFromText(ref) : null;
      const emailToId = state.userMap && typeof state.userMap === "object" && state.userMap.emailToId && typeof state.userMap.emailToId === "object" ? state.userMap.emailToId : {};
      const bubbleIdToEmail =
        state.userMap && typeof state.userMap === "object" && state.userMap.bubbleIdToEmail && typeof state.userMap.bubbleIdToEmail === "object" ? state.userMap.bubbleIdToEmail : {};
      const bubbleIdCandidate = !email && ref ? extractBubbleIdFromText(ref) || String(ref).trim() : null;
      const fromBubbleId = bubbleIdCandidate ? extractEmailFromText(String((bubbleIdToEmail as any)[bubbleIdCandidate] ?? "")) : null;
      const mapped = (email || fromBubbleId) ? String((emailToId as any)[String(email || fromBubbleId)] ?? "").trim() : "";
      return mapped && isUuid(mapped) ? mapped : userId;
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

    if (state.phase === "error") {
      if (!resume) return json({ ok: true, state }, { status: 200 });
      await ensureImportPlan();
      state.lastError = "";
      if (state.import) {
        state.import.status = "pending";
        state.import.lastError = "";
      }
      state.phase = "importing";
      await persist();
    }

    if (state.phase === "pulling") {
      if (!baseUrl) return json({ ok: false, error: "missing_base_url" }, { status: 400 });
      if (!token) return json({ ok: false, error: "missing_token" }, { status: 400 });
    }

    const doImportDomain = async (domain: string) => {
      const url = new URL("/api/bubble-import/import", req.url);
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: req.headers.get("cookie") ?? "" },
        body: JSON.stringify({ only: [domain], includeUnknown: true, prefix: state.runPrefix, targetUserId: overrideImportUserId || undefined }),
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
        await ensureUserMap();
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
        if (domain === "insumos" || domain === "inventario" || domain === "fornecedores") {
          let work: any = null;
          try {
            state.import.status = "running";
            state.import.lastError = "";
            state.import.work = state.import.work && typeof state.import.work === "object" ? state.import.work : {};
            work = (state.import.work[domain] && typeof state.import.work[domain] === "object" ? state.import.work[domain] : {}) as any;
            const filesPath = typeof work.filesPath === "string" ? String(work.filesPath) : `${state.runPrefix}/import-${domain}-files.json`;
            const accPath = typeof work.accPath === "string" ? String(work.accPath) : `${state.runPrefix}/import-${domain}-acc.json`;

            const retryAt = typeof work.nextRetryAt === "number" ? work.nextRetryAt : 0;
            if (retryAt > Date.now()) {
              const seconds = Math.max(1, Math.ceil((retryAt - Date.now()) / 1000));
              state.import.status = `aguardando (${seconds}s)`;
              state.import.work[domain] = work;
              await persist();
              ops += 1;
              continue;
            }

            if (!work.filesReady) {
              const all = await listAllPaths(supabase, bucket, state.runPrefix);
              const filtered = all
                .filter((p) => p.name.toLowerCase().endsWith(".json"))
                .filter((p) => {
                  const n = p.name.toLowerCase();
                  if (domain === "insumos") return n.includes("-bubble-api-categorias_") || n.includes("-bubble-api-custo_medio_item_") || n.includes("-bubble-api-item_") || n.includes("-bubble-api-ingredientes_");
                  if (domain === "fornecedores") return n.includes("-bubble-api-fornecedores_") || n.includes("-bubble-api-itens_fornecedores_") || n.includes("-bubble-api-equivalencias_");
                  return n.includes("-bubble-api-inventarios_");
                })
                .map((p) => p.path);
              await uploadJson(supabase, bucket, filesPath, { v: 1, files: filtered });
              await uploadJson(
                supabase,
                bucket,
                accPath,
                domain === "insumos"
                  ? { v: 1, categoriasById: {}, users: {} }
                  : domain === "fornecedores"
                    ? { v: 1, users: {} }
                    : { v: 1, contagens: {} },
              );
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
            const maxFilesPerTick = 24;
            const persistEvery = 6;
            const end = Math.min(files.length, cursor + maxFilesPerTick);
            const acc = await downloadJson(supabase, bucket, accPath);

            if (domain === "insumos") {
              const categoriasById: Record<string, string> = acc?.categoriasById && typeof acc.categoriasById === "object" ? acc.categoriasById : {};
              const users: Record<string, any> =
                acc?.users && typeof acc.users === "object"
                  ? acc.users
                  : {
                      [userId]: {
                        custoByItemKey: acc?.custoByItemKey && typeof acc.custoByItemKey === "object" ? acc.custoByItemKey : {},
                        insumosByKey: acc?.insumosByKey && typeof acc.insumosByKey === "object" ? acc.insumosByKey : {},
                      },
                    };

              const getUserAcc = (uid: string) => {
                const got = users[uid];
                if (got && typeof got === "object") return got;
                const created = { custoByItemKey: {}, insumosByKey: {} } as any;
                users[uid] = created;
                return created;
              };

              let sincePersist = 0;
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
                    const uid = resolveImportUserId(row);
                    const uacc = getUserAcc(uid);
                    const item = guessItemLabel(row);
                    const itemKey = normalizeItemName(item);
                    if (!itemKey) continue;
                    const custo = pickFirst(row, ["custo_medio", "custo_medio_label", "custo", "valor", "preco", "preco_unitario", "custo_unitario", "valor_unitario"]);
                    const num = parsePtNumber(custo);
                    if (!num) continue;
                    uacc.custoByItemKey[itemKey] = formatMoneyBRL(num);
                  }
                } else if (typeName === "item" || typeName.includes("ingred")) {
                  for (const r of rows) {
                    const row = normalizeRowObject(r);
                    if (!row) continue;
                    const uid = resolveImportUserId(row);
                    const uacc = getUserAcc(uid);
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
                    const custoMedio = custoNum ? formatMoneyBRL(custoNum) : uacc.custoByItemKey[itemKey] ?? "";
                    const prev = uacc.insumosByKey[itemKey] ?? {};
                    uacc.insumosByKey[itemKey] = {
                      id: bubbleId || prev.id || String(Object.keys(uacc.insumosByKey).length + 1),
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
                work.total = files.length;
                state.import.work[domain] = work;
                sincePersist += 1;

                if (sincePersist >= persistEvery || Date.now() - startMs >= hardMs) {
                  await uploadJson(supabase, bucket, accPath, { v: 1, categoriasById, users });
                  await persist();
                  ops += 1;
                  sincePersist = 0;
                  if (ops >= maxOps || Date.now() - startMs >= hardMs) return json({ ok: true, state, ops }, { status: 200 });
                }
              }

              if (sincePersist > 0) {
                await uploadJson(supabase, bucket, accPath, { v: 1, categoriasById, users });
                await persist();
                ops += 1;
              }

              if (work.cursor >= files.length) {
                for (const [uid, uacc] of Object.entries(users)) {
                  if (!isUuid(uid)) continue;
                  const insumosRows = Object.values(uacc?.insumosByKey ?? {}).filter((r) => r && typeof r === "object" && String((r as any).item ?? "").trim());
                  const categories = Array.from(new Set(insumosRows.map((r: any) => String(r.categoria ?? "").trim()).filter(Boolean))).sort((a, b) =>
                    a.localeCompare(b, "pt-BR", { sensitivity: "base", numeric: true }),
                  );
                  const stateId = `user:${uid}`;
                  const { error } = await supabase.from("insumos_state").upsert({ id: stateId, payload: { rows: insumosRows, categories } } as any, { onConflict: "id" });
                  if (error) {
                    if (!isMissingTableError(error)) throw new Error(`insumos_state:${error.message}`);
                    const prefix = `user:${uid}:`;
                    const desired = insumosRows.map((r: any) => {
                      const raw = String(r?.id ?? "").trim();
                      const seg = safeIdSegment(raw) || crypto.randomUUID();
                      return {
                        id: `${prefix}insumo:${seg}`,
                        item: String(r?.item ?? "").trim(),
                        medida: String(r?.medida ?? "").trim() || "Und",
                        custo_medio: String(r?.custoMedio ?? "").trim(),
                        categoria: String(r?.categoria ?? "").trim(),
                        especificacao: String(r?.especificacao ?? "").trim(),
                        ocultar: Boolean(r?.ocultar),
                      };
                    });
                    const { data: existing, error: listErr } = await supabase.from("insumos").select("id").like("id", `${prefix}%`).limit(8000);
                    if (listErr) throw new Error(`insumos_list:${listErr.message}`);
                    const keep = new Set(desired.map((d) => d.id));
                    const toDelete = (existing ?? []).map((x: any) => String(x?.id ?? "").trim()).filter((x: string) => x && !keep.has(x));
                    if (toDelete.length) {
                      const { error: delErr } = await supabase.from("insumos").delete().in("id", toDelete);
                      if (delErr) throw new Error(`insumos_delete:${delErr.message}`);
                    }
                    if (desired.length) {
                      const { error: upErr } = await supabase.from("insumos").upsert(desired as any, { onConflict: "id" });
                      if (upErr) throw new Error(`insumos_upsert:${upErr.message}`);
                    }
                  }
                }
                state.import.index = idx + 1;
                state.import.lastError = "";
                await persist();
                ops += 1;
              }
            } else if (domain === "fornecedores") {
              const users: Record<string, any> =
                acc?.users && typeof acc.users === "object"
                  ? acc.users
                  : {
                      [userId]: {
                        infoMap: acc?.infoMap && typeof acc.infoMap === "object" ? acc.infoMap : {},
                        produtosMap: acc?.produtosMap && typeof acc.produtosMap === "object" ? acc.produtosMap : {},
                        equivalenciasMap: acc?.equivalenciasMap && typeof acc.equivalenciasMap === "object" ? acc.equivalenciasMap : {},
                        fornecedorNameById: acc?.fornecedorNameById && typeof acc.fornecedorNameById === "object" ? acc.fornecedorNameById : {},
                      },
                    };

              const getUserAcc = (uid: string) => {
                const got = users[uid];
                if (got && typeof got === "object") return got;
                const created = { infoMap: {}, produtosMap: {}, equivalenciasMap: {}, fornecedorNameById: {} } as any;
                users[uid] = created;
                return created;
              };

              const handleFornecedorInfo = (row: Record<string, string>) => {
                const uid = resolveImportUserId(row);
                const uacc = getUserAcc(uid);
                const fornecedor =
                  pickFirst(row, ["fornecedor", "fornecedor_nome", "nome_fornecedor", "empresa", "empresa_nome", "razao_social", "nome"]) ||
                  pickKeyLike(row, ["fornecedor", "empresa"]);
                const key = normalizeFornecedorKey(fornecedor);
                if (!key) return;
                const fornId = pickFirst(row, ["unique_id", "_id", "id", "bubble_id", "fornecedor_id"]);
                if (fornId) uacc.fornecedorNameById[fornId.trim()] = fornecedor.trim();
                uacc.infoMap[key] = {
                  fornecedor: fornecedor.trim() || fornecedor,
                  vendedor: pickFirst(row, ["vendedor", "contato", "nome_vendedor", "responsavel"]) || pickKeyLike(row, ["vendedor", "contato", "responsavel"]),
                  whatsapp: pickFirst(row, ["whatsapp", "telefone", "celular", "fone"]) || pickKeyLike(row, ["whatsapp", "telefone", "celular"]),
                  endereco: pickFirst(row, ["endereco", "endereco_completo", "rua", "address"]) || pickKeyLike(row, ["endereco", "rua", "address"]),
                };
              };

              const handleFornecedorProduto = (row: Record<string, string>) => {
                const uid = resolveImportUserId(row);
                const uacc = getUserAcc(uid);
                const fornecedorId = pickFirst(row, ["fornecedor_id"]) || pickKeyLike(row, ["fornecedor_id"]);
                const fornecedor =
                  pickFirst(row, ["fornecedor", "fornecedor_nome", "empresa", "empresa_nome", "nome_fornecedor"]) ||
                  (fornecedorId ? uacc.fornecedorNameById[fornecedorId.trim()] ?? "" : "") ||
                  pickKeyLike(row, ["fornecedor", "empresa"]);
                const itemName =
                  pickFirst(row, ["produto", "item", "nome_item", "nome_do_item", "nome", "descricao", "ingrediente", "insumo"]) ||
                  pickKeyLike(row, ["produto", "item", "nome"], { excludeParts: ["fornecedor", "empresa"] }) ||
                  guessItemLabel(row);
                const key = normalizeFornecedorKey(fornecedor);
                if (!key || !String(itemName ?? "").trim()) return;
                const list = uacc.produtosMap[key] ?? [];
                list.push(String(itemName).trim());
                uacc.produtosMap[key] = list;
              };

              const handleEquivalencia = (row: Record<string, string>) => {
                const uid = resolveImportUserId(row);
                const uacc = getUserAcc(uid);
                const fornecedor = pickFirst(row, ["fornecedor", "fornecedor_nome", "empresa", "empresa_nome"]) || pickKeyLike(row, ["fornecedor", "empresa"]);
                const key = normalizeFornecedorKey(fornecedor);
                if (!key) return;
                const nomeNaNota =
                  pickFirst(row, ["nome_na_nota", "nomenanota", "nome", "item", "produto"]) ||
                  pickKeyLike(row, ["nome", "item", "produto"], { excludeParts: ["fornecedor", "empresa"] });
                const insumoEquivalente = pickFirst(row, ["insumo_equivalente", "insumoequivalente", "equivalente", "insumo"]) || pickKeyLike(row, ["insumo", "equival"]);
                if (!nomeNaNota || !insumoEquivalente) return;
                const unidadeNaNota = pickFirst(row, ["unidade_na_nota", "unidadenanota", "unidade", "medida"]) || pickKeyLike(row, ["unidade", "medida"]) || "Und";
                const equivalenteQuantidade = pickFirst(row, ["equivalente_quantidade", "equivalentequantidade", "quantidade", "qtd"]) || pickKeyLike(row, ["quantidade", "qtd"]);
                const equivalenteUnidade = pickFirst(row, ["equivalente_unidade", "equivalenteunidade", "unidade_equivalente", "unidade"]) || "";
                const bubbleId = pickFirst(row, ["unique_id", "_id", "id", "bubble_id"]) || String(Date.now());
                const list = uacc.equivalenciasMap[key] ?? [];
                list.push({
                  id: bubbleId,
                  nomeNaNota: nomeNaNota.trim(),
                  unidadeNaNota: unidadeNaNota.trim() || "Und",
                  insumoEquivalente: insumoEquivalente.trim(),
                  equivalenteQuantidade: equivalenteQuantidade.trim(),
                  equivalenteUnidade: equivalenteUnidade.trim(),
                });
                uacc.equivalenciasMap[key] = list;
              };

              let sincePersist = 0;
              for (let i = cursor; i < end; i++) {
                const partPath = files[i]!;
                const payload = await downloadJson(supabase, bucket, partPath);
                const typeName = String(payload?.type ?? "").trim().toLowerCase();
                const rows = Array.isArray(payload?.rows) ? (payload.rows as any[]) : [];
                for (const r of rows) {
                  const row = normalizeRowObject(r);
                  if (!row) continue;
                  if (typeName.includes("itens_fornecedores") || typeName.includes("itens-fornecedores")) handleFornecedorProduto(row);
                  else if (typeName.includes("equival")) handleEquivalencia(row);
                  else if (typeName.includes("fornecedor")) handleFornecedorInfo(row);
                }
                work.cursor = i + 1;
                work.lastFile = partPath;
                work.total = files.length;
                state.import.work[domain] = work;
                sincePersist += 1;
                if (sincePersist >= persistEvery || Date.now() - startMs >= hardMs) {
                  await uploadJson(supabase, bucket, accPath, { v: 1, users });
                  await persist();
                  ops += 1;
                  sincePersist = 0;
                  if (ops >= maxOps || Date.now() - startMs >= hardMs) return json({ ok: true, state, ops }, { status: 200 });
                }
              }

              if (sincePersist > 0) {
                await uploadJson(supabase, bucket, accPath, { v: 1, users });
                await persist();
                ops += 1;
              }

              if (work.cursor >= files.length) {
                for (const [uid, uacc] of Object.entries(users)) {
                  if (!isUuid(uid)) continue;
                  for (const k of Object.keys(uacc.produtosMap ?? {})) {
                    uacc.produtosMap[k] = Array.from(new Set((uacc.produtosMap[k] ?? []).filter(Boolean))).sort((a, b) =>
                      String(a).localeCompare(String(b), "pt-BR", { sensitivity: "base", numeric: true }),
                    );
                  }
                  const stateId = `user:${uid}`;
                  const { error } = await supabase
                    .from("fornecedores_state")
                    .upsert({ id: stateId, info: uacc.infoMap ?? {}, produtos: uacc.produtosMap ?? {}, equivalencias: uacc.equivalenciasMap ?? {} } as any, { onConflict: "id" });
                  if (error) throw new Error(`fornecedores_state:${error.message}`);
                }
                state.import.index = idx + 1;
                state.import.lastError = "";
                await persist();
                ops += 1;
              }
            } else {
              const contagens: Record<string, any> = acc?.contagens && typeof acc.contagens === "object" ? acc.contagens : {};
              let sincePersist = 0;
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
                  const uid = resolveImportUserId(row);
                  const id = `user:${uid}:inventario:${bubbleId}`;
                  if (!contagens[id]) contagens[id] = { id, data: dataLabel, categorias: [] as any[] };
                }
                work.cursor = i + 1;
                work.lastFile = partPath;
                work.total = files.length;
                state.import.work[domain] = work;
                sincePersist += 1;
                if (sincePersist >= persistEvery || Date.now() - startMs >= hardMs) {
                  await uploadJson(supabase, bucket, accPath, { v: 1, contagens });
                  await persist();
                  ops += 1;
                  sincePersist = 0;
                  if (ops >= maxOps || Date.now() - startMs >= hardMs) return json({ ok: true, state, ops }, { status: 200 });
                }
              }

              if (sincePersist > 0) {
                await uploadJson(supabase, bucket, accPath, { v: 1, contagens });
                await persist();
                ops += 1;
              }

              const allRows = Object.values(contagens);
              for (let i = 0; i < allRows.length; i += 500) {
                const chunk = allRows.slice(i, i + 500);
                if (!chunk.length) continue;
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
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (isImportTransientErrorMessage(msg)) {
              const next = Date.now() + 3000;
              if (!work) {
                state.import.work = state.import.work && typeof state.import.work === "object" ? state.import.work : {};
                work = (state.import.work[domain] && typeof state.import.work[domain] === "object" ? state.import.work[domain] : {}) as any;
              }
              work.nextRetryAt = next;
              work.lastError = msg;
              state.import.status = "aguardando";
              state.import.lastError = msg;
              state.import.work[domain] = work;
              await persist();
              ops += 1;
              continue;
            }
            state.import.status = "error";
            state.import.lastError = msg;
            state.phase = "error";
            state.lastError = msg;
            await persist();
            ops += 1;
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
            const msg = err instanceof Error ? err.message : String(err);
            if (isImportTransientErrorMessage(msg)) {
              state.import.status = "aguardando";
              state.import.lastError = msg;
              state.import.work = state.import.work && typeof state.import.work === "object" ? state.import.work : {};
              const w = (state.import.work[domain] && typeof state.import.work[domain] === "object" ? state.import.work[domain] : {}) as any;
              w.nextRetryAt = Date.now() + 3000;
              w.lastError = msg;
              state.import.work[domain] = w;
              await persist();
            } else {
              state.import.status = "error";
              state.import.lastError = msg;
              state.phase = "error";
              state.lastError = msg;
              await persist();
            }
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
