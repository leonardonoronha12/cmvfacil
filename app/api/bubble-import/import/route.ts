import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin";
import { getUserIdFromRequest } from "../../../lib/requestUserId";
import {
  formatDateLabelDDMMYYYY,
  formatMoneyBRL,
  normalizeKey,
  parseBubbleCsvToObjects,
  parseDateLoose,
  parsePtNumber,
  pickFirst,
  type CsvObjectRow,
} from "../../../lib/bubbleCsv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

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
    for (const f of files) paths.push({ path: `${currentPrefix}/${f.name}`, name: f.name, updated_at: (f as any).updated_at, size: (f as any)?.metadata?.size });
    for (const folder of folders) await walk(`${currentPrefix}/${folder.name}`, depth + 1);
  }

  await walk(prefix, 0);
  const okExt = (name: string) => {
    const n = name.toLowerCase();
    return n.endsWith(".csv") || n.endsWith(".xlsx") || n.endsWith(".xls") || n.endsWith(".json");
  };
  return paths.filter((p) => okExt(p.name)).sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? "") || a.path.localeCompare(b.path));
}

async function downloadText(supabase: ReturnType<typeof getSupabaseAdmin>, bucket: string, path: string) {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 60);
  if (error || !data?.signedUrl) throw new Error(error?.message || "failed_to_sign");
  const res = await fetch(data.signedUrl);
  if (!res.ok) throw new Error(`failed_to_download_${res.status}`);
  return await res.text();
}

async function downloadBytes(supabase: ReturnType<typeof getSupabaseAdmin>, bucket: string, path: string) {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 60);
  if (error || !data?.signedUrl) throw new Error(error?.message || "failed_to_sign");
  const res = await fetch(data.signedUrl);
  if (!res.ok) throw new Error(`failed_to_download_${res.status}`);
  return await res.arrayBuffer();
}

function parseBubbleXlsxToObjects(buf: ArrayBuffer) {
  const wb = XLSX.read(buf, { type: "array" });
  const sheetName = wb.SheetNames?.[0];
  if (!sheetName) return { header: [] as string[], rows: [] as CsvObjectRow[] };
  const sheet = wb.Sheets[sheetName];
  const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" }) as unknown[][];
  const headerRaw = (grid[0] ?? []) as unknown[];
  const headerNorm = headerRaw.map((h) => normalizeKey(String(h ?? "")));
  const header = headerNorm.map((k, i) => k || `col_${i + 1}`);
  const rows: CsvObjectRow[] = [];
  for (let i = 1; i < grid.length; i++) {
    const r = (grid[i] ?? []) as unknown[];
    if (!r.length) continue;
    const obj: CsvObjectRow = {};
    for (let c = 0; c < header.length; c++) obj[header[c]] = String(r[c] ?? "").trim();
    const hasAny = Object.values(obj).some((v) => String(v).trim());
    if (hasAny) rows.push(obj);
  }
  return { header, rows };
}

async function loadRowsForPart(supabase: ReturnType<typeof getSupabaseAdmin>, bucket: string, part: { path: string; name: string }) {
  const lower = part.name.toLowerCase();
  if (lower.endsWith(".csv")) {
    const text = await downloadText(supabase, bucket, part.path);
    return parseBubbleCsvToObjects(text).rows;
  }
  if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) {
    const buf = await downloadBytes(supabase, bucket, part.path);
    return parseBubbleXlsxToObjects(buf).rows;
  }
  if (lower.endsWith(".json")) {
    const text = await downloadText(supabase, bucket, part.path);
    const parsed = JSON.parse(text);
    const toCell = (v: unknown) => {
      if (v == null) return "";
      if (typeof v === "string") return v.trim();
      if (typeof v === "number" || typeof v === "boolean") return String(v);
      try {
        return JSON.stringify(v);
      } catch {
        return String(v);
      }
    };
    if (Array.isArray(parsed)) {
      return parsed
        .filter((x) => x && typeof x === "object" && !Array.isArray(x))
        .map((x) => {
          const obj: CsvObjectRow = {};
          for (const [k, v] of Object.entries(x as Record<string, unknown>)) obj[normalizeKey(k)] = toCell(v);
          return obj;
        });
    }
    if (parsed && typeof parsed === "object") {
      const list = (parsed as any).rows;
      if (Array.isArray(list)) {
        return list
          .filter((x) => x && typeof x === "object" && !Array.isArray(x))
          .map((x) => {
            const obj: CsvObjectRow = {};
            for (const [k, v] of Object.entries(x as Record<string, unknown>)) obj[normalizeKey(k)] = toCell(v);
            return obj;
          });
      }
    }
    return [];
  }
  return [];
}

function groupParts(files: { path: string; name: string }[]) {
  const groups = new Map<string, { base: string; parts: { path: string; name: string; part: number }[] }>();
  for (const f of files) {
    const lower = f.name.toLowerCase();
    const m = lower.match(/^(.*)_part(\d+)\.(csv|json)$/);
    const base = m ? `${m[1]}.${m[3]}` : lower;
    const part = m ? Number.parseInt(m[2] ?? "0", 10) : 0;
    const g = groups.get(base) ?? { base, parts: [] };
    g.parts.push({ path: f.path, name: f.name, part: Number.isFinite(part) ? part : 0 });
    groups.set(base, g);
  }
  return Array.from(groups.values()).map((g) => ({ ...g, parts: g.parts.sort((a, b) => a.part - b.part || a.name.localeCompare(b.name)) }));
}

function classifyFile(name: string) {
  const n = name.toLowerCase();
  if (/(^|[^a-z])user([^a-z]|$)/.test(n) || n.includes("usuarios") || n.includes("usuario")) return "users";
  if (n.includes("empresas") || n.includes("empresa")) return "empresas";
  if (n.includes("categoria")) return "categorias";
  if (n.includes("motivo") && n.includes("desperd")) return "motivos_desperdicios";
  if (n.includes("equival")) return "equivalencias";
  if (n.includes("invent")) return "inventario";
  if (n.includes("pre") && n.includes("preparo")) return "pre_preparo";
  if (n.includes("etiqueta")) return "pre_preparo_etiquetas";
  if (n.includes("ficha") || n.includes("fichas") || (n.includes("receita") && !n.includes("itens"))) return "fichas_tecnicas";
  if ((n.includes("itens") || n.includes("items")) && n.includes("nota")) return "itens_notas";
  if (n.includes("itens-fornecedores") || n.includes("items_fornecedores") || n.includes("itens_fornecedores")) return "itens_fornecedores";
  if (n.includes("fornecedores")) return "fornecedores";
  if (n.includes("notas") || n.includes("nota") || n.includes("fiscais")) return "notas_fiscais";
  if (n.includes("desperd")) return "desperdicios";
  if (n.includes("custo") && n.includes("medio")) return "custo_medio";
  if (n.includes("ingred")) return "ingredientes";
  if (/(^|[^a-z])item([^a-z]|$)/.test(n)) return "itens";
  if (n.includes("items") || /\bitens\b/.test(n)) return "itens";
  return "unknown";
}

function pickBubbleId(row: CsvObjectRow) {
  return pickFirst(row, ["unique_id", "_id", "id", "bubble_id"]);
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

function extractBubbleRefId(input: string) {
  const s = String(input ?? "").trim();
  if (!s) return "";
  const fromJson = extractBubbleIdFromText(s);
  if (fromJson) return fromJson;

  const segmentLooksLikeId = (seg: string) => {
    const v = String(seg ?? "").trim();
    if (!v) return false;
    if (/[A-Za-zÀ-ÿ]/.test(v)) return false;
    const digits = v.replace(/[^\d]/g, "");
    return /^\d{10,}$/.test(digits);
  };

  const parts = s.split("$").map((x) => x.trim()).filter(Boolean);
  if (parts.length >= 2) {
    const head = String(parts[0] ?? "").trim();
    const tail = String(parts[parts.length - 1] ?? "").trim();
    if (segmentLooksLikeId(head)) return head;
    if (tail) return tail;
  }

  const slashParts = s.split("/").map((x) => x.trim()).filter(Boolean);
  if (slashParts.length >= 2) {
    const head = String(slashParts[0] ?? "").trim();
    const tail = String(slashParts[slashParts.length - 1] ?? "").trim();
    if (segmentLooksLikeId(head)) return head;
    if (tail) return tail;
  }
  return s;
}

function looksLikeId(value: string) {
  const s = String(value ?? "").trim();
  if (!s) return false;
  if (/[A-Za-zÀ-ÿ]/.test(s)) return false;
  const cleaned = s.replace(/[^\w]/g, "");
  if (!cleaned) return false;
  if (/^\d{10,}$/.test(cleaned)) return true;
  if (/^[a-z0-9]{20,}$/i.test(cleaned)) return true;
  return false;
}

function pickUserRefFromRow(row: CsvObjectRow) {
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
      "user_email",
      "usuario_email",
      "user",
      "usuario",
    ]) ||
    pickKeyLike(row, ["user", "usuario", "criador", "created", "owner"], { excludeParts: ["url", "name", "nome"] });
  if (!direct) return null;
  return String(direct);
}

async function loadAuthEmailToIdMap(supabase: ReturnType<typeof getSupabaseAdmin>) {
  const map = new Map<string, string>();
  for (let page = 1; page <= 2000; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`auth_list_users:${error.message}`);
    const users = (data?.users ?? []) as any[];
    for (const u of users) {
      const id = String(u?.id ?? "").trim();
      const email = String(u?.email ?? "").trim().toLowerCase();
      if (id && email) map.set(email, id);
    }
    if (users.length < 1000) break;
  }
  return map;
}

function normalizeFornecedorKey(value: string) {
  return String(value ?? "").trim().toUpperCase();
}

function normalizeItemName(value: string) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function pickKeyLike(row: CsvObjectRow, parts: string[], opts?: { excludeParts?: string[] }) {
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

function pickTextValue(row: CsvObjectRow) {
  let best = "";
  for (const k of Object.keys(row)) {
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
    const v = String(row[k] ?? "").trim();
    if (!v) continue;
    if (parsePtNumber(v) !== 0) continue;
    const hasLetters = /[A-Za-zÀ-ÿ]/.test(v);
    if (!hasLetters) continue;
    if (v.length > best.length) best = v;
  }
  return best;
}

function guessItemLabel(row: CsvObjectRow) {
  const direct = pickFirst(row, ["item", "item_completo", "nome_item", "nome_do_item", "nome", "produto", "descricao", "ingrediente", "insumo", "titulo", "title", "name"]);
  if (direct) return direct;
  const like = pickKeyLike(row, ["item", "ingred", "insumo", "produto", "nome"], { excludeParts: ["fornecedor", "empresa"] });
  if (like) return like;
  return pickTextValue(row);
}

function buildDateLabel(value: string) {
  const d = parseDateLoose(value);
  return d ? formatDateLabelDDMMYYYY(d) : String(value ?? "").trim();
}

async function upsertInBatches<T extends Record<string, unknown>>(supabase: ReturnType<typeof getSupabaseAdmin>, table: string, rows: T[], batchSize = 500) {
  let inserted = 0;
  for (let i = 0; i < rows.length; i += batchSize) {
    const chunk = rows.slice(i, i + batchSize);
    const dedup = new Map<string, T>();
    for (const r of chunk) {
      const rawId = String((r as any)?.id ?? "").trim();
      const k = rawId ? rawId : `__noid__:${dedup.size}`;
      dedup.set(k, r);
    }
    const uniqueChunk = Array.from(dedup.values());
    const { error } = await supabase.from(table).upsert(uniqueChunk as any, { onConflict: "id" });
    if (error) throw new Error(error.message);
    inserted += uniqueChunk.length;
  }
  return inserted;
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

export async function POST(req: NextRequest) {
  let stage = "init";
  try {
    const body = (await req.json().catch(() => null)) as unknown;
    const only = Array.isArray((body as any)?.only) ? ((body as any).only as unknown[]).map((x) => String(x ?? "").trim()).filter(Boolean) : null;
    const includeUnknown = typeof (body as any)?.includeUnknown === "boolean" ? Boolean((body as any).includeUnknown) : true;
    const kinds = Array.isArray((body as any)?.kinds) ? ((body as any).kinds as unknown[]).map((x) => String(x ?? "").trim().toLowerCase()).filter(Boolean) : null;
    const requestedPrefix = typeof (body as any)?.prefix === "string" ? String((body as any).prefix).trim().replace(/^\/+|\/+$/g, "") : "";
    const targetUserIdRaw = typeof (body as any)?.targetUserId === "string" ? String((body as any).targetUserId).trim() : "";
    const mappingPath = typeof (body as any)?.mappingPath === "string" ? String((body as any).mappingPath).trim() : "";

    const enabled = (k: string) => !only || only.includes(k);
    let enableInsumos = enabled("insumos");
    let enableFornecedores = enabled("fornecedores");
    let enableDesperdicios = enabled("desperdicios");
    let enableEntradas = enabled("entradas");
    let enablePrePreparo = enabled("pre_preparo");
    let enableFichas = enabled("fichas_tecnicas");
    let enableInventario = enabled("inventario");

    const { userId } = getUserIdFromRequest(req);
    if (!userId) return json({ ok: false, error: "unauthorized" }, { status: 401 });
    if (!isUuid(userId)) return json({ ok: false, error: "user_not_supabase_uuid" }, { status: 400 });
    const overrideTargetUserId = targetUserIdRaw && isUuid(targetUserIdRaw) ? targetUserIdRaw : "";

    let supabase: ReturnType<typeof getSupabaseAdmin>;
    try {
      supabase = getSupabaseAdmin();
    } catch {
      return json({ ok: false, error: "supabase_not_configured" }, { status: 500 });
    }

    const bubbleUserIdToEmail = new Map<string, string>();
    const bubbleCompanyIdToUserId = new Map<string, string>();
    const mappingFromStorage = mappingPath ? await downloadJsonFromStorage(supabase, "bubble-imports", mappingPath) : null;
    if (mappingFromStorage && typeof mappingFromStorage === "object") {
      const companyToUser = (mappingFromStorage as any)?.companyToUser;
      if (companyToUser && typeof companyToUser === "object") {
        for (const [k, v] of Object.entries(companyToUser as Record<string, unknown>)) {
          const companyId = String(k ?? "").trim();
          const uid = String(v ?? "").trim();
          if (companyId && uid) bubbleCompanyIdToUserId.set(companyId, uid);
        }
      }
    }

    stage = "load_auth_users";
    const emailToId = !overrideTargetUserId ? await loadAuthEmailToIdMap(supabase) : new Map<string, string>();
    const resolveTargetUserId = (row: CsvObjectRow) => {
      if (overrideTargetUserId) return overrideTargetUserId;
      const ref = pickUserRefFromRow(row);
      const uuid = ref ? extractUuidFromText(ref) : null;
      if (uuid) return uuid;
      const email = ref ? extractEmailFromText(ref) : null;
      const bubbleIdCandidate = !email && ref ? extractBubbleIdFromText(ref) || String(ref).trim() : null;
      const byBubbleId = bubbleIdCandidate ? bubbleUserIdToEmail.get(bubbleIdCandidate) ?? null : null;
      const byEmail = (email || byBubbleId) ? emailToId.get(String(email || byBubbleId)) ?? null : null;
      if (byEmail) return byEmail;
      const companyRef =
        pickFirst(row, ["empresa_id", "empresa", "empresaid", "company_id", "company", "restaurante_id", "restaurante"]) ||
        pickKeyLike(row, ["empresa", "company", "restaurante"], { excludeParts: ["nome", "name", "fantasy", "legal", "cnpj"] });
      const companyIdCandidate = companyRef ? extractBubbleIdFromText(String(companyRef)) || String(companyRef).trim() : null;
      const byCompany = companyIdCandidate ? bubbleCompanyIdToUserId.get(companyIdCandidate) ?? null : null;
      return byCompany || userId;
    };

    stage = "list_files";
    const bucket = "bubble-imports";
    await ensureBucket(supabase, bucket);
    const userPrefix = `user:${userId}`;

    const prefixToUse = requestedPrefix && requestedPrefix.startsWith(`${userPrefix}/`) ? requestedPrefix : userPrefix;
    const files = await listAllPaths(supabase, bucket, prefixToUse);
    const hasImportFile = files.some((f) => {
      const n = String(f?.name ?? "").toLowerCase();
      if (n.endsWith(".csv") || n.endsWith(".xlsx") || n.endsWith(".xls")) return true;
      if (n.endsWith(".json") && !n.endsWith("state.json") && !n.endsWith("mapping.json")) return true;
      return false;
    });
    if (!hasImportFile) return json({ ok: false, error: "no_import_files" }, { status: 400 });
    const groups = groupParts(files);
    const byKind = new Map<string, { base: string; parts: { path: string; name: string; part: number }[] }[]>();
    for (const g of groups) {
      const kind = classifyFile(g.base);
      const list = byKind.get(kind) ?? [];
      list.push(g);
      byKind.set(kind, list);
    }

    const fornecedorNameById = new Map<string, string>();
    let fornecedorNameByIdReady = false;
    const ensureFornecedorNameById = async () => {
      if (fornecedorNameByIdReady) return;
      fornecedorNameByIdReady = true;
      const fornecedorGroups: { base: string; parts: { path: string; name: string; part: number }[] }[] = [];
      fornecedorGroups.push(...(byKind.get("fornecedores") ?? []));
      for (const g of byKind.get("unknown") ?? []) {
        const b = String(g.base ?? "").toLowerCase();
        if (b.includes("fornecedor") || b.includes("supplier")) fornecedorGroups.push(g);
      }
      for (const g of fornecedorGroups) {
        for (const part of g.parts) {
          const rows = await loadRowsForPart(supabase, bucket, part);
          for (const row of rows) {
            const idRaw = pickBubbleId(row) || pickFirst(row, ["fornecedor_id", "id_fornecedor", "id"]);
            const id = idRaw ? extractBubbleRefId(String(idRaw)) : "";
            const nome =
              pickFirst(row, ["fornecedor", "fornecedor_nome", "nome_fornecedor", "razao_social", "nome"]) ||
              pickKeyLike(row, ["fornecedor", "nome"], { excludeParts: ["empresa", "restaurante", "company"] });
            if (id && nome && !fornecedorNameById.has(id)) fornecedorNameById.set(id, nome.trim());
          }
        }
      }
    };

    const empresaNameById = new Map<string, string>();
    let empresaNameByIdReady = false;
    const ensureEmpresaNameById = async () => {
      if (empresaNameByIdReady) return;
      empresaNameByIdReady = true;
      const empresaGroups = byKind.get("empresas") ?? [];
      for (const g of empresaGroups) {
        for (const part of g.parts) {
          const rows = await loadRowsForPart(supabase, bucket, part);
          for (const row of rows) {
            const idRaw = pickBubbleId(row) || pickFirst(row, ["empresa_id", "id_empresa", "company_id", "restaurante_id", "id"]);
            const id = idRaw ? extractBubbleRefId(String(idRaw)) : "";
            const nome =
              pickFirst(row, ["nome_fantasia", "nome", "empresa_nome", "restaurante_nome", "razao_social", "fantasia"]) ||
              pickKeyLike(row, ["nome", "fantas", "razao", "empresa", "restaurante"]);
            if (id && nome && !empresaNameById.has(id)) empresaNameById.set(id, nome.trim());
          }
        }
      }
    };

    const fileCountsByKind: Record<string, { groups: number; parts: number; examples: string[] }> = {};
    for (const [kind, list] of byKind.entries()) {
      const parts = list.reduce((acc, g) => acc + g.parts.length, 0);
      const examples = list
        .map((g) => g.base)
        .slice(0, 6)
        .sort((a, b) => a.localeCompare(b));
      fileCountsByKind[kind] = { groups: list.length, parts, examples };
    }

    const enabledKinds = new Set<string>();
    if (enableInsumos) ["custo_medio", "ingredientes", "itens"].forEach((k) => enabledKinds.add(k));
    if (enableFornecedores) ["fornecedores", "itens_fornecedores", "equivalencias"].forEach((k) => enabledKinds.add(k));
    if (enableDesperdicios) ["desperdicios", "motivos_desperdicios"].forEach((k) => enabledKinds.add(k));
    if (enableEntradas) ["itens_notas", "notas_fiscais"].forEach((k) => enabledKinds.add(k));
    if (enablePrePreparo) ["pre_preparo", "pre_preparo_etiquetas", "categorias", "itens"].forEach((k) => enabledKinds.add(k));
    if (enableFichas) enabledKinds.add("fichas_tecnicas");
    if (enableInventario) enabledKinds.add("inventario");
    enabledKinds.add("users");
    enabledKinds.add("empresas");
    if (includeUnknown) enabledKinds.add("unknown");

    if (kinds && kinds.length) {
      enabledKinds.clear();
      for (const k of kinds) enabledKinds.add(k);
      enabledKinds.add("users");
      const onlyUsers = kinds.length === 1 && String(kinds[0] ?? "").toLowerCase() === "users";
      if (!onlyUsers) enabledKinds.add("empresas");
      if (includeUnknown && enabledKinds.has("unknown")) enabledKinds.add("unknown");
      if (!includeUnknown) enabledKinds.delete("unknown");

      enableInsumos = enabledKinds.has("custo_medio") || enabledKinds.has("ingredientes") || enabledKinds.has("itens");
      enableFornecedores = enabledKinds.has("fornecedores") || enabledKinds.has("itens_fornecedores") || enabledKinds.has("equivalencias");
      enableDesperdicios = enabledKinds.has("desperdicios") || enabledKinds.has("motivos_desperdicios");
      enableEntradas = enabledKinds.has("itens_notas") || enabledKinds.has("notas_fiscais");
      enablePrePreparo = enabledKinds.has("pre_preparo") || enabledKinds.has("pre_preparo_etiquetas") || enabledKinds.has("categorias");
      enableFichas = enabledKinds.has("fichas_tecnicas");
      enableInventario = enabledKinds.has("inventario");
    }

    const categoriasById = new Map<string, string>();
    const itemById = new Map<string, { nome: string; unidade: string; categoria: string }>();
    const motivoNameById = new Map<string, string>();
    const inventarioDateById = new Map<string, string>();

    const insumosByUser = new Map<string, Map<string, any>>();
    const custoByUser = new Map<string, Map<string, string>>();
    const fornecedoresByUser = new Map<
      string,
      { infoMap: Record<string, any>; produtosMap: Record<string, string[]>; equivalenciasMap: Record<string, any[]>; fornecedorNameById: Map<string, string> }
    >();

    const prefixForRow = (row: CsvObjectRow) => `user:${resolveTargetUserId(row)}:`;

    const getInsumosMap = (uid: string) => {
      const got = insumosByUser.get(uid);
      if (got) return got;
      const created = new Map<string, any>();
      insumosByUser.set(uid, created);
      return created;
    };

    const getCustoMap = (uid: string) => {
      const got = custoByUser.get(uid);
      if (got) return got;
      const created = new Map<string, string>();
      custoByUser.set(uid, created);
      return created;
    };

    const getFornecedoresState = (uid: string) => {
      const got = fornecedoresByUser.get(uid);
      if (got) return got;
      const created = { infoMap: {} as Record<string, any>, produtosMap: {} as Record<string, string[]>, equivalenciasMap: {} as Record<string, any[]>, fornecedorNameById: new Map<string, string>() };
      fornecedoresByUser.set(uid, created);
      return created;
    };

    if (enableFornecedores) {
      getFornecedoresState(overrideTargetUserId || userId);
    }

    function handleUserRow(row: CsvObjectRow) {
      const bubbleId = pickBubbleId(row) || pickFirst(row, ["user_id", "usuario_id", "id_usuario"]);
      if (!bubbleId) return;
      const emailRaw = pickFirst(row, ["email", "user_email", "usuario_email", "e_mail", "mail", "login", "username"]);
      const email = emailRaw ? extractEmailFromText(emailRaw) : null;
      if (email) bubbleUserIdToEmail.set(String(bubbleId).trim(), email);
    }

    function handleEmpresaRow(row: CsvObjectRow) {
      const companyId = pickBubbleId(row) || pickFirst(row, ["empresa_id", "id", "_id", "unique_id", "bubble_id"]);
      if (!companyId) return;
      const ownerRef =
        pickFirst(row, ["user_id", "usuario_id", "id_usuario", "owner", "owner_id", "created_by", "createdby", "criador", "criador_id", "responsavel_id"]) ||
        pickKeyLike(row, ["user", "usuario", "owner", "created", "criador", "responsavel"], { excludeParts: ["email", "nome", "name"] });
      if (!ownerRef) return;
      const ownerText = String(ownerRef).trim();
      const ownerUuid = extractUuidFromText(ownerText);
      if (ownerUuid) {
        bubbleCompanyIdToUserId.set(String(companyId).trim(), ownerUuid);
        return;
      }
      const ownerEmail = extractEmailFromText(ownerText);
      if (ownerEmail) {
        const mapped = emailToId.get(ownerEmail) ?? null;
        if (mapped) bubbleCompanyIdToUserId.set(String(companyId).trim(), mapped);
        return;
      }
      const ownerBubbleId = extractBubbleIdFromText(ownerText) || ownerText;
      const emailFromUser = bubbleUserIdToEmail.get(String(ownerBubbleId).trim()) ?? null;
      if (!emailFromUser) return;
      const mapped = emailToId.get(emailFromUser) ?? null;
      if (mapped) bubbleCompanyIdToUserId.set(String(companyId).trim(), mapped);
    }

    function catNameLooksLikePrePreparo(name: string) {
      const s = String(name ?? "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase();
      return s.includes("pre") && s.includes("preparo");
    }

    function handleCategoria(row: CsvObjectRow) {
      const nome = pickFirst(row, ["nome", "titulo", "name"]) || pickKeyLike(row, ["nome", "titulo", "name"]) || "";
      if (!nome) return;
      const slug = pickFirst(row, ["slug"]) || pickKeyLike(row, ["slug"]);
      const id = pickBubbleId(row) || pickFirst(row, ["categoria_id", "id_categoria"]) || "";

      const cleanedName = nome.trim();
      if (id) categoriasById.set(id.trim(), cleanedName);
      if (slug) categoriasById.set(slug.trim(), cleanedName);
    }

    function handleCustoMedio(row: CsvObjectRow) {
      if (!enableInsumos) return;
      const uid = resolveTargetUserId(row);
      const item = guessItemLabel(row);
      const itemKey = normalizeItemName(item);
      if (!itemKey) return;
      const custo =
        pickFirst(row, ["custo_medio", "custo_medio_label", "custo", "valor", "preco", "preco_unitario", "custo_unitario", "valor_unitario"]) ||
        pickKeyLike(row, ["custo", "preco", "valor"]);
      const num = parsePtNumber(custo);
      if (!num) return;
      getCustoMap(uid).set(itemKey, formatMoneyBRL(num));
    }

    function handleInsumo(row: CsvObjectRow) {
      if (!enableInsumos) return;
      const uid = resolveTargetUserId(row);
      const insumosByKey = getInsumosMap(uid);
      const custoByItemKey = getCustoMap(uid);
      const item = guessItemLabel(row);
      const itemKey = normalizeItemName(item);
      if (!itemKey) return;
      const bubbleId = pickBubbleId(row) || pickFirst(row, ["item_id"]) || pickKeyLike(row, ["item_id"]);
      const medida =
        pickFirst(row, ["medida", "unidade", "unidade_medida", "unidade_de_medida", "unidade_de_compra", "unidade_base"]) ||
        pickKeyLike(row, ["medida", "unidade"]) ||
        "Und";
      const catId = pickFirst(row, ["categoria_id", "categoria", "categoria_slug"]) || pickKeyLike(row, ["categoria_id", "categoria", "slug"]);
      const categoria =
        pickFirst(row, ["categoria", "category", "grupo", "grupo_categoria"]) ||
        (catId && categoriasById.get(catId.trim())) ||
        pickKeyLike(row, ["categoria", "grupo"]);
      const especificacao = pickFirst(row, ["especificacao", "especificacao_do_item", "descricao", "observacao", "obs", "detalhe"]) || pickKeyLike(row, ["especific", "descr", "obs"]);
      const ocultarRaw = pickFirst(row, ["ocultar", "hidden", "removido", "apagado"]);
      const ocultar = ocultarRaw ? ocultarRaw.toLowerCase() === "sim" || ocultarRaw.toLowerCase() === "true" || ocultarRaw === "1" : undefined;
      const custo =
        pickFirst(row, ["custo_medio", "custo_medio_label", "custo", "valor", "preco", "custo_unitario", "preco_unitario", "valor_unitario"]) ||
        pickKeyLike(row, ["custo", "preco", "valor"]);
      const custoNum = parsePtNumber(custo);
      const custoMedio = custoNum ? formatMoneyBRL(custoNum) : custoByItemKey.get(itemKey) ?? "";
      const prev = insumosByKey.get(itemKey) ?? {};
      insumosByKey.set(itemKey, {
        id: bubbleId || prev.id || String(insumosByKey.size + 1),
        item: item.trim(),
        medida: medida.trim() || prev.medida || "Und",
        custoMedio: custoMedio || prev.custoMedio || undefined,
        categoria: categoria.trim() || prev.categoria || undefined,
        especificacao: especificacao.trim() || prev.especificacao || undefined,
        ocultar: typeof ocultar === "boolean" ? ocultar : prev.ocultar,
      });

      if (bubbleId) {
        const prevItem = itemById.get(bubbleId) ?? null;
        itemById.set(bubbleId, {
          nome: item.trim() || prevItem?.nome || "",
          unidade: medida.trim() || prevItem?.unidade || "Und",
          categoria: categoria.trim() || prevItem?.categoria || "",
        });
      }
    }

    function handleFornecedorInfo(row: CsvObjectRow) {
      if (!enableFornecedores) return;
      const uid = resolveTargetUserId(row);
      const st = getFornecedoresState(uid);
    const fornecedor =
        pickFirst(row, ["fornecedor", "fornecedor_nome", "nome_fornecedor", "razao_social", "nome"]) ||
        pickKeyLike(row, ["fornecedor"], { excludeParts: ["empresa", "restaurante", "company"] });
      const key = normalizeFornecedorKey(fornecedor);
      if (!key) return;
      const fornId = pickBubbleId(row) || pickFirst(row, ["fornecedor_id"]) || pickKeyLike(row, ["fornecedor_id"]);
      const fornIdResolved = fornId ? extractBubbleRefId(String(fornId)) : "";
      if (fornIdResolved) st.fornecedorNameById.set(fornIdResolved, fornecedor.trim());
      const info = {
        fornecedor: fornecedor.trim() || fornecedor,
        vendedor: pickFirst(row, ["vendedor", "contato", "nome_vendedor", "responsavel"]) || pickKeyLike(row, ["vendedor", "contato", "responsavel"]),
        whatsapp: pickFirst(row, ["whatsapp", "telefone", "celular", "fone"]) || pickKeyLike(row, ["whatsapp", "telefone", "celular"]),
        endereco: pickFirst(row, ["endereco", "endereco_completo", "rua", "address"]) || pickKeyLike(row, ["endereco", "rua", "address"]),
      };
      st.infoMap[key] = info;
      if (fornIdResolved) {
        const idKey = fornIdResolved.trim().toUpperCase();
        if (!st.infoMap[idKey]) st.infoMap[idKey] = info;
      }
    }

    function handleFornecedorProduto(row: CsvObjectRow) {
      if (!enableFornecedores) return;
      const uid = resolveTargetUserId(row);
      const st = getFornecedoresState(uid);
      const fornecedorId = pickFirst(row, ["fornecedor_id"]) || pickKeyLike(row, ["fornecedor_id"]);
      const fornecedor =
        pickFirst(row, ["fornecedor", "fornecedor_nome", "nome_fornecedor", "razao_social", "nome"]) ||
        (fornecedorId ? st.fornecedorNameById.get(fornecedorId.trim()) ?? "" : "") ||
        pickKeyLike(row, ["fornecedor"], { excludeParts: ["empresa", "restaurante", "company"] });

      const itemId = pickFirst(row, ["item_id"]) || pickKeyLike(row, ["item_id"]);
      const itemName =
        pickFirst(row, ["produto", "item", "nome_item", "nome_do_item", "nome", "descricao", "ingrediente", "insumo"]) ||
        (itemId ? itemById.get(itemId.trim())?.nome ?? "" : "") ||
        pickKeyLike(row, ["produto", "item", "nome"], { excludeParts: ["fornecedor", "empresa"] }) ||
        guessItemLabel(row);

      const key = normalizeFornecedorKey(fornecedor);
      if (!key || !String(itemName ?? "").trim()) return;
      const list = st.produtosMap[key] ?? [];
      list.push(String(itemName).trim());
      st.produtosMap[key] = list;
    }

    function handleEquivalencia(row: CsvObjectRow) {
      if (!enableFornecedores) return;
      const uid = resolveTargetUserId(row);
      const st = getFornecedoresState(uid);
      const fornecedor =
        pickFirst(row, ["fornecedor", "fornecedor_nome", "nome_fornecedor", "razao_social", "nome"]) ||
        pickKeyLike(row, ["fornecedor"], { excludeParts: ["empresa", "restaurante", "company"] });
      const key = normalizeFornecedorKey(fornecedor);
      if (!key) return;
      const nomeNaNota =
        pickFirst(row, ["nome_na_nota", "nomeNaNota", "nome", "item", "produto"]) || pickKeyLike(row, ["nome", "item", "produto"], { excludeParts: ["fornecedor", "empresa"] });
      const insumoEquivalente = pickFirst(row, ["insumo_equivalente", "insumoEquivalente", "equivalente", "insumo"]) || pickKeyLike(row, ["insumo", "equival"]);
      if (!nomeNaNota || !insumoEquivalente) return;
      const unidadeNaNota = pickFirst(row, ["unidade_na_nota", "unidadeNaNota", "unidade", "medida"]) || pickKeyLike(row, ["unidade", "medida"]) || "Und";
      const equivalenteQuantidade = pickFirst(row, ["equivalente_quantidade", "equivalenteQuantidade", "quantidade", "qtd"]) || pickKeyLike(row, ["quantidade", "qtd"]);
      const equivalenteUnidade = pickFirst(row, ["equivalente_unidade", "equivalenteUnidade", "unidade_equivalente", "unidade"]) || "";
      const bubbleId = pickBubbleId(row) || String(Date.now());
      const list = st.equivalenciasMap[key] ?? [];
      list.push({
        id: bubbleId,
        nomeNaNota: nomeNaNota.trim(),
        unidadeNaNota: unidadeNaNota.trim() || "Und",
        insumoEquivalente: insumoEquivalente.trim(),
        equivalenteQuantidade: equivalenteQuantidade.trim(),
        equivalenteUnidade: equivalenteUnidade.trim(),
      });
      st.equivalenciasMap[key] = list;
    }

    const notaItemsByNotaKey = new Map<string, any[]>();
    const notaItemSeenByNotaKey = new Map<string, Set<string>>();
    function handleNotaItem(row: CsvObjectRow) {
      if (!enableEntradas) return;
      const prefix = prefixForRow(row);
      const notaId =
        pickFirst(row, [
          "nota_id",
          "nota_fiscal_id",
          "nota_fiscal",
          "nota",
          "notas_fiscais_id",
          "notas_fiscais",
          "notas_fiscais_ref",
          "entrada_id",
          "entrada",
        ]) || pickKeyLike(row, ["nota", "entrada"]);
      if (!notaId) return;
      const notaKey = extractBubbleRefId(String(notaId)).trim() || String(notaId).trim();
      const itemIdRaw =
        pickFirst(row, ["item_id", "id_item", "produto_id", "item", "produto"]) || pickKeyLike(row, ["item_id", "id_item", "produto_id"]);
      const itemId = itemIdRaw ? extractBubbleIdFromText(String(itemIdRaw)) || String(itemIdRaw).trim() : "";
      const nomePicked = pickFirst(row, ["nome", "item", "produto", "descricao", "nome_item", "cadastro_item"]);
      const nomeFromPicked = typeof nomePicked === "string" ? nomePicked.trim() : "";
      const nomeFromItem = itemId ? String(itemById.get(itemId.trim())?.nome ?? "").trim() : "";
      const nomeFromGuess = String(guessItemLabel(row) ?? "").trim();
      const nome = nomeFromPicked || nomeFromItem || nomeFromGuess;
      if (!nome) return;
      const seen = notaItemSeenByNotaKey.get(notaKey) ?? new Set<string>();
      const qtd = pickFirst(row, ["quantidade_label", "quantidade", "qtd", "qtde"]) || pickKeyLike(row, ["quantidade", "qtd"]);
      const subtotal = pickFirst(row, ["subtotal_label", "subtotal", "total", "valor"]) || pickKeyLike(row, ["subtotal", "total", "valor"]);
      const unit =
        pickFirst(row, ["custo_unitario_label", "custo_unitario", "preco_unitario", "valor_unitario"]) || pickKeyLike(row, ["custo", "preco", "valor"]);

      const list = notaItemsByNotaKey.get(notaKey) ?? [];
      const bubbleId = String(pickBubbleId(row) ?? "").trim();
      const fallbackKey = `${notaKey}:${bubbleId || itemId || nome}:${String(qtd ?? "").trim()}:${String(subtotal ?? "").trim()}:${String(unit ?? "").trim()}:${list.length}`;
      const bubbleKey = bubbleId || fallbackKey;
      if (seen.has(bubbleKey)) return;
      seen.add(bubbleKey);
      notaItemSeenByNotaKey.set(notaKey, seen);
      list.push({
        id: `${prefix}nota_item:${bubbleKey}`,
        itemId: itemId || undefined,
        nome,
        quantidadeLabel: qtd.trim(),
        subtotalLabel: subtotal ? (parsePtNumber(subtotal) ? formatMoneyBRL(parsePtNumber(subtotal)) : subtotal.trim()) : "",
        custoUnitarioLabel: unit ? (parsePtNumber(unit) ? formatMoneyBRL(parsePtNumber(unit)) : unit.trim()) : "",
      });
      notaItemsByNotaKey.set(notaKey, list);
    }

    const entradasRows: any[] = [];
    function handleNotaFiscal(row: CsvObjectRow) {
      if (!enableEntradas) return;
    const uid = resolveTargetUserId(row);
    const prefix = `user:${uid}:`;
    const fornState = getFornecedoresState(uid);
    const fornecedorIdRaw =
      pickFirst(row, ["fornecedor_id", "id_fornecedor", "fornecedor_ref"]) ||
      pickKeyLike(row, ["fornecedor_id", "id_fornecedor"]);
    const fornecedorId = fornecedorIdRaw ? extractBubbleRefId(String(fornecedorIdRaw)) : "";
    let fornecedor =
      pickFirst(row, ["fornecedor", "fornecedor_nome", "nome_fornecedor", "razao_social"]) ||
      pickKeyLike(row, ["fornecedor"], { excludeParts: ["empresa", "restaurante", "company"] });
    if (fornecedor && looksLikeId(fornecedor)) {
      const mapped = fornState.fornecedorNameById.get(extractBubbleRefId(fornecedor.trim())) ?? "";
      fornecedor = mapped || fornecedor;
    }
    if ((!fornecedor || looksLikeId(fornecedor)) && fornecedorId) {
      const mapped = fornState.fornecedorNameById.get(fornecedorId.trim()) ?? fornecedorNameById.get(fornecedorId.trim()) ?? "";
      if (mapped) fornecedor = mapped;
    }
    const fornecedorSanitized = String(fornecedor ?? "").replace(/[\u200B-\u200D\uFEFF\u00A0]/g, " ").trim();
    const fornecedorFinal = fornecedorSanitized || (fornecedorId ? fornecedorId : "-");
    const numero =
      pickFirst(row, ["numero", "numero_nf", "numero_nota", "nota_numero", "n_nf", "nf", "num", "num_nf"]) || pickKeyLike(row, ["numero", "nf"]);
    const dataLanc = buildDateLabel(pickFirst(row, ["data_lancamento", "data_nota", "data_recebimento", "data", "date", "created_at", "created_date"]) || pickKeyLike(row, ["data", "date"]));
    const bubbleId = pickBubbleId(row) || `${numero || "nf"}_${entradasRows.length + 1}`;
    const numeroFinal = numero.trim() || `NF-${String(bubbleId).slice(0, 8)}`;
    const valor = pickFirst(row, ["valor_nota", "valor_total", "valor", "total", "subtotal"]) || pickKeyLike(row, ["valor", "total", "subtotal"]);
    const valorNum = parsePtNumber(valor);
    const responsavel = pickFirst(row, ["responsavel", "usuario", "user", "nome_usuario", "criado_por"]) || pickKeyLike(row, ["responsavel", "usuario"]) || "-";
    const dataCriacao = buildDateLabel(pickFirst(row, ["data_criacao", "created_date", "created_at", "created"]) || "");
    const notaKey = extractBubbleRefId(String(bubbleId)).trim() || String(bubbleId).trim();
    const itensList = notaItemsByNotaKey.get(notaKey) ?? notaItemsByNotaKey.get(numero) ?? notaItemsByNotaKey.get(numeroFinal) ?? [];
    const itensCount = itensList.length;
    entradasRows.push({
      id: `${prefix}entrada:${bubbleId}`,
      user_id: uid,
      numero: numeroFinal,
      data_lancamento: dataLanc || "-",
      fornecedor: fornecedorFinal,
      valor_nota: valorNum ? formatMoneyBRL(valorNum) : String(valor ?? "").trim() || "R$0,00",
      itens: `${itensCount || parsePtNumber(pickFirst(row, ["itens", "qtd_itens", "quantidade_itens"]) || pickKeyLike(row, ["itens", "qtd"])) || 0} Itens`,
      responsavel: responsavel.trim(),
      data_criacao: dataCriacao || dataLanc || "-",
      itens_nota: itensList.length ? itensList : null,
    });
  }

    const desperdiciosRows: any[] = [];
    function handleMotivoDesperdicio(row: CsvObjectRow) {
      const bubbleId = pickBubbleId(row) || pickFirst(row, ["motivo_id"]) || pickKeyLike(row, ["motivo_id"]);
      const titulo = pickFirst(row, ["titulo", "motivo", "nome", "name"]) || pickKeyLike(row, ["titulo", "motivo", "nome", "name"]);
      if (!bubbleId || !titulo) return;
      motivoNameById.set(String(bubbleId).trim(), String(titulo).trim());
    }

    function handleDesperdicio(row: CsvObjectRow) {
      if (!enableDesperdicios) return;
    const prefix = prefixForRow(row);
    const itemId = pickFirst(row, ["item_id"]) || pickKeyLike(row, ["item_id"]);
    const item = guessItemLabel(row) || (itemId ? itemById.get(itemId.trim())?.nome ?? "" : "");
    if (!item) return;
    const bubbleId = pickBubbleId(row) || String(desperdiciosRows.length + 1);
    const data = buildDateLabel(pickFirst(row, ["data", "date", "data_desperdicio", "created_date", "created_at"]) || pickKeyLike(row, ["data", "date"]));
    const quantidade = pickFirst(row, ["quantidade", "qtd", "qtde", "quantidade_label"]) || pickKeyLike(row, ["quantidade", "qtd"]);
    const custo = pickFirst(row, ["custo", "valor", "total", "subtotal"]) || pickKeyLike(row, ["custo", "valor", "total", "subtotal"]);
    const motivoId = pickFirst(row, ["motivo_id", "etiqueta_id"]) || pickKeyLike(row, ["motivo_id", "etiqueta_id"]);
    const motivo =
      pickFirst(row, ["motivo", "reason", "descricao", "obs", "observacao"]) ||
      (motivoId ? motivoNameById.get(motivoId.trim()) ?? "" : "") ||
      pickKeyLike(row, ["motivo", "reason", "obs", "descr"]);
    const custoNum = parsePtNumber(custo);
    desperdiciosRows.push({
      id: `${prefix}desperdicio:${bubbleId}`,
      data: data || "-",
      item: item.trim(),
      quantidade: quantidade.trim(),
      custo: custoNum ? formatMoneyBRL(custoNum) : String(custo ?? "").trim(),
      motivo: motivo.trim(),
    });
  }

    const prePreparoRowsByUser = new Map<string, any[]>();
    const prePreparoEtiquetasRowsByUser = new Map<string, any[]>();
    const fichasRowsByUser = new Map<string, any[]>();
    const prePreparoIdsByUser = new Map<string, Set<string>>();

    const getPrePreparoRows = (uid: string) => {
      const got = prePreparoRowsByUser.get(uid);
      if (got) return got;
      const created: any[] = [];
      prePreparoRowsByUser.set(uid, created);
      return created;
    };

    const getPrePreparoEtiquetasRows = (uid: string) => {
      const got = prePreparoEtiquetasRowsByUser.get(uid);
      if (got) return got;
      const created: any[] = [];
      prePreparoEtiquetasRowsByUser.set(uid, created);
      return created;
    };

    const getFichasRows = (uid: string) => {
      const got = fichasRowsByUser.get(uid);
      if (got) return got;
      const created: any[] = [];
      fichasRowsByUser.set(uid, created);
      return created;
    };

    const getPrePreparoIds = (uid: string) => {
      const got = prePreparoIdsByUser.get(uid);
      if (got) return got;
      const created = new Set<string>();
      prePreparoIdsByUser.set(uid, created);
      return created;
    };

    function handlePrePreparo(row: CsvObjectRow) {
      if (!enablePrePreparo) return;
    const uid = resolveTargetUserId(row);
    const prePreparoRows = getPrePreparoRows(uid);
    const prePreparoIds = getPrePreparoIds(uid);
    const receita =
      pickFirst(row, ["receita", "pre_preparo", "prepreparo", "nome", "recipe"]) ||
      pickKeyLike(row, ["receita", "pre", "preparo", "nome"], { excludeParts: ["fornecedor", "empresa"] }) ||
      pickTextValue(row);
    if (!receita) return;
    const bubbleId = pickBubbleId(row) || String(prePreparoRows.length + 1);
    const categoria = pickFirst(row, ["categoria", "category", "grupo"]) || pickKeyLike(row, ["categoria", "grupo"]) || "-";
    const custoTotal = pickFirst(row, ["custo_total", "custoTotal", "custo", "total", "valor"]) || pickKeyLike(row, ["custo", "total", "valor"]) || "-";
    const rendimento = pickFirst(row, ["rendimento", "yield"]) || pickKeyLike(row, ["rendimento", "yield"]) || "-";
    const custoUnitario = pickFirst(row, ["custo_unitario", "custoUnitario", "unitario"]) || pickKeyLike(row, ["unitario", "custo"]) || "-";
    const validade = pickFirst(row, ["validade_dias", "validadeDias", "validade"]) || pickKeyLike(row, ["validade"]);
    const validadeDiasNum = validade ? Math.max(0, Math.floor(parsePtNumber(validade))) : undefined;
    const ingredientesRaw = pickFirst(row, ["ingredientes", "ingredientes_json", "ingredientRows", "ingredient_rows", "itens", "items"]) || pickKeyLike(row, ["ingred", "ingredient", "itens"]);
    let ingredientes: any[] | undefined;
    if (ingredientesRaw && (ingredientesRaw.trim().startsWith("[") || ingredientesRaw.trim().startsWith("{"))) {
      try {
        const parsed = JSON.parse(ingredientesRaw);
        ingredientes = Array.isArray(parsed) ? parsed : undefined;
      } catch {}
    }
    const modoPreparo = pickFirst(row, ["modo_preparo", "modoPreparo", "preparo", "modo"]) || pickKeyLike(row, ["modo", "preparo"]) || "";
    prePreparoRows.push({
      id: bubbleId,
      categoria: categoria.trim() || "-",
      receita: receita.trim(),
      custoTotal: custoTotal.trim() || "-",
      rendimento: rendimento.trim() || "-",
      custoUnitario: custoUnitario.trim() || "-",
      validadeDias: typeof validadeDiasNum === "number" ? validadeDiasNum : undefined,
      ingredientes: ingredientes && ingredientes.length ? ingredientes : undefined,
      modoPreparo: modoPreparo.trim() || undefined,
    });
    prePreparoIds.add(String(bubbleId));
  }

    function handlePrePreparoEtiqueta(row: CsvObjectRow) {
      if (!enablePrePreparo) return;
      const uid = resolveTargetUserId(row);
      const prefix = `user:${uid}:`;
      const prePreparoEtiquetasRows = getPrePreparoEtiquetasRows(uid);
      const prePreparoIds = getPrePreparoIds(uid);
      const codigo = pickFirst(row, ["codigo", "code"]) || pickKeyLike(row, ["codigo", "code"]);
      const bubbleId = pickBubbleId(row) || codigo || String(prePreparoEtiquetasRows.length + 1);
      const prodRaw = pickFirst(row, ["data_producao", "dataProducao", "producao"]) || pickKeyLike(row, ["data_producao", "producao"]);
      const valRaw = pickFirst(row, ["data_validade", "dataValidade", "validade"]) || pickKeyLike(row, ["data_validade", "validade"]);
      const prod = parseDateLoose(prodRaw);
      const val = parseDateLoose(valRaw);
      const dataProducao = prod ? formatDateLabelDDMMYYYY(prod) : String(prodRaw ?? "").trim();
      const dataValidade = val ? formatDateLabelDDMMYYYY(val) : String(valRaw ?? "").trim();
      const desperdicadoRaw = pickFirst(row, ["boolean_desperdicado", "desperdicado"]) || pickKeyLike(row, ["desperdic"]);
      const desperdicado = desperdicadoRaw ? desperdicadoRaw.toLowerCase() === "true" || desperdicadoRaw.toLowerCase() === "sim" || desperdicadoRaw === "1" : false;
      prePreparoEtiquetasRows.push({
        id: `${prefix}etiqueta:${bubbleId}`,
        recipeId: "unknown",
        receita: codigo ? `Etiqueta ${codigo}` : "Etiqueta",
        responsavel: "-",
        quantidade: "1",
        unidade: "Und",
        custo: "R$0,00",
        dataProducao: dataProducao || "-",
        dataValidade: dataValidade || "-",
        wasteStatus: desperdicado ? ("launched" as const) : ("pending" as const),
      });
      prePreparoIds.add(String(bubbleId));
    }

    function handlePrePreparoFromItemRow(row: CsvObjectRow) {
      if (!enablePrePreparo) return;
      const uid = resolveTargetUserId(row);
      const prePreparoRows = getPrePreparoRows(uid);
      const prePreparoIds = getPrePreparoIds(uid);
      const catIdRaw = pickFirst(row, ["categoria_id", "categoria", "categoria_slug"]) || pickKeyLike(row, ["categoria_id", "categoria", "slug"]);
      const catId = catIdRaw ? extractBubbleRefId(String(catIdRaw)) || extractBubbleIdFromText(String(catIdRaw)) || String(catIdRaw).trim() : "";
      const catName = catId
        ? categoriasById.get(catId.trim()) ?? categoriasById.get(String(catIdRaw ?? "").trim()) ?? ""
        : categoriasById.get(String(catIdRaw ?? "").trim()) ?? "";
      const catLabel = catName || String(catIdRaw ?? "").trim();
      const catMatches = catNameLooksLikePrePreparo(catLabel);
      const recipeSignals =
        pickFirst(row, [
          "custo_total_receita",
          "custoTotalReceita",
          "rendimento",
          "yield",
          "rendimento_receita",
          "qtde_rendimento",
          "porcao",
          "porcoes",
          "dias_validade",
          "validade_dias",
          "validadeDias",
          "validade",
          "recipe_yield",
          "recipeYield",
        ]) || pickKeyLike(row, ["custo_total_receita", "custo", "rendimento", "yield", "porcao", "validade"]);
      if (!catMatches && !String(recipeSignals ?? "").trim()) return;

      const receita = guessItemLabel(row);
      if (!receita) return;
      const bubbleId = pickBubbleId(row) || pickFirst(row, ["item_id"]) || String(prePreparoRows.length + 1);
      const id = String(bubbleId);
      if (prePreparoIds.has(id)) return;

      const custoTotalRaw =
        pickFirst(row, ["custo_total_receita", "custoTotalReceita", "custo_total", "custoTotal", "total", "valor"]) || pickKeyLike(row, ["custo_total", "total", "valor", "custo"]);
      const totalNum = parsePtNumber(custoTotalRaw);
      const custoTotal = totalNum ? formatMoneyBRL(totalNum) : String(custoTotalRaw ?? "").trim() || "-";

      const yieldRaw = pickFirst(row, ["rendimento", "yield", "rendimento_receita", "porcao", "porcoes", "qtde_rendimento"]) || pickKeyLike(row, ["rendimento", "yield", "porcao"]);
      const yieldUnit =
        pickFirst(row, ["unidade_rendimento", "unidade", "medida", "item_medida", "unidade_medida"]) || pickKeyLike(row, ["unidade", "medida"]) || "Und";
      const yieldNum = parsePtNumber(yieldRaw);
      const rendimento = yieldNum ? `${yieldNum.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 3 })}${yieldUnit ? yieldUnit : ""}` : `${String(yieldRaw ?? "").trim() || "1"}${yieldUnit ? yieldUnit : ""}`;

      const unitCost = yieldNum > 0 && totalNum > 0 ? totalNum / yieldNum : 0;
      const custoUnitario = unitCost > 0 ? `${formatMoneyBRL(unitCost)} / ${yieldUnit}` : "-";

      const validade = pickFirst(row, ["dias_validade", "validade_dias", "validadeDias", "validade"]) || pickKeyLike(row, ["validade"]);
      const validadeDiasNum = validade ? Math.max(0, Math.floor(parsePtNumber(validade))) : undefined;

      prePreparoRows.push({
        id,
        categoria: catLabel.trim() || "-",
        receita: receita.trim(),
        custoTotal,
        rendimento,
        custoUnitario,
        validadeDias: typeof validadeDiasNum === "number" ? validadeDiasNum : undefined,
      });
      prePreparoIds.add(id);
    }

    function handleFicha(row: CsvObjectRow) {
      if (!enableFichas) return;
    const uid = resolveTargetUserId(row);
    const fichasRows = getFichasRows(uid);
    const receita =
      pickFirst(row, ["receita", "nome", "recipe"]) ||
      pickKeyLike(row, ["receita", "recipe", "nome"], { excludeParts: ["fornecedor", "empresa"] }) ||
      pickTextValue(row);
    if (!receita) return;
    const bubbleId = pickBubbleId(row) || String(fichasRows.length + 1);
    const precoVenda = pickFirst(row, ["preco_venda", "precoVenda", "preco", "valor_venda"]) || pickKeyLike(row, ["preco", "venda", "valor"]);
    const custoUnitario = pickFirst(row, ["custo_unitario", "custoUnitario", "custo"]) || pickKeyLike(row, ["custo", "unitario"]);
    const cmvMeta = pickFirst(row, ["cmv_meta", "cmvMeta", "meta_cmv"]) || pickKeyLike(row, ["cmv", "meta"]);
    const cmvAtual = pickFirst(row, ["cmv_atual", "cmvAtual"]) || pickKeyLike(row, ["cmv", "atual"]);
    const cmvDelta = pickFirst(row, ["cmv_delta", "cmvDelta"]) || pickKeyLike(row, ["cmv", "delta"]);
    const bcgRaw = pickFirst(row, ["bcg", "matriz_bcg", "matriz"]) || pickKeyLike(row, ["bcg", "matriz"]) || "quebra-cabeca";
    const bcg = bcgRaw === "estrela" || bcgRaw === "cavalo" || bcgRaw === "quebra-cabeca" || bcgRaw === "abacaxi" ? bcgRaw : "quebra-cabeca";
    const thumbRaw = pickFirst(row, ["thumb", "tipo", "burger"]) || pickKeyLike(row, ["thumb", "tipo"]) || "burger";
    const thumb = thumbRaw === "burger" || thumbRaw === "duplo" || thumbRaw === "triplo" ? thumbRaw : "burger";
    const recipeImage = pickFirst(row, ["recipe_image", "recipeImage", "imagem", "image"]) || pickKeyLike(row, ["image", "imagem"]);
    const popularidadeRaw = pickFirst(row, ["popularidade"]) || pickKeyLike(row, ["popular"]);
    const pop = String(popularidadeRaw ?? "").trim().toLowerCase();
    const popularidade = pop === "alta" || pop === "baixa" ? pop : undefined;
    const ingredientsTotal = pickFirst(row, ["ingredients_total", "ingredientsTotal"]) || pickKeyLike(row, ["ingredients", "ingredientes", "total"]);
    const recipeYield = pickFirst(row, ["recipe_yield", "recipeYield", "rendimento"]) || pickKeyLike(row, ["yield", "rendimento"]);
    const ingredientRowsRaw = pickFirst(row, ["ingredient_rows", "ingredientRows", "ingredientes"]) || pickKeyLike(row, ["ingredient", "ingredientes"]);
    let ingredientRows: any[] | undefined;
    if (ingredientRowsRaw && (ingredientRowsRaw.trim().startsWith("[") || ingredientRowsRaw.trim().startsWith("{"))) {
      try {
        const parsed = JSON.parse(ingredientRowsRaw);
        ingredientRows = Array.isArray(parsed) ? parsed : undefined;
      } catch {}
    }
    const modoPreparo = pickFirst(row, ["modo_preparo", "modoPreparo"]) || pickKeyLike(row, ["modo", "preparo"]) || "";
    fichasRows.push({
      id: bubbleId,
      receita: receita.trim(),
      precoVenda: String(precoVenda ?? "").trim(),
      custoUnitario: String(custoUnitario ?? "").trim(),
      cmvMeta: String(cmvMeta ?? "").trim(),
      cmvAtual: String(cmvAtual ?? "").trim(),
      cmvDelta: String(cmvDelta ?? "").trim(),
      bcg,
      thumb,
      recipeImage: recipeImage ? String(recipeImage).trim() || undefined : undefined,
      popularidade,
      ingredientsTotal: ingredientsTotal ? Math.max(0, Math.floor(parsePtNumber(ingredientsTotal))) : undefined,
      recipeYield: recipeYield ? Math.max(0, parsePtNumber(recipeYield)) : undefined,
      ingredientRows: ingredientRows && ingredientRows.length ? ingredientRows : undefined,
      modoPreparo: modoPreparo.trim() || undefined,
    });
  }

    type InvItem = { id: string; item: string; unidade: string; estoqueFinal: string; removido?: boolean };
    type InvCat = { id: string; nome: string; status: "pendente" | "concluida"; itens: InvItem[] };
    const inventarioMap = new Map<string, { id: string; data: string; cats: Map<string, { id: string; nome: string; itens: Map<string, InvItem> }> }>();

    function handleInventarioFlat(row: CsvObjectRow) {
      if (!enableInventario) return;
    const prefix = prefixForRow(row);
    const dateRaw = pickFirst(row, ["data", "date", "data_inventario", "data_contagem"]) || pickKeyLike(row, ["data", "date"]);
    const d = parseDateLoose(dateRaw);
    if (!d) return;
    const iso = d.toISOString().slice(0, 10);
    const dataLabel = formatDateLabelDDMMYYYY(d);
    const tipo = pickFirst(row, ["tipo", "tipo_inventario", "inventario_tipo"]) || pickKeyLike(row, ["tipo"]);
    const invId = `${prefix}inventario:${iso}${tipo ? `:${String(tipo).trim().toLowerCase()}` : ""}`;
    const invKey = invId;

    const categoria =
      pickFirst(row, ["categoria", "category", "grupo"]) || pickKeyLike(row, ["categoria", "grupo"]) || "Importado";
    const catName = String(categoria).trim() || "Importado";
    const catKey = normalizeItemName(catName);

    const item = guessItemLabel(row);
    if (!item) return;
    const itemName = item.trim();
    const unidade = pickFirst(row, ["unidade", "medida", "unidade_medida"]) || pickKeyLike(row, ["unidade", "medida"]) || "Und";
    const estoqueFinal =
      pickFirst(row, ["estoque_final", "estoqueFinal", "quantidade", "qtd", "qtde", "estoque"]) || pickKeyLike(row, ["estoque", "quantidade", "qtd"]);
    const bubbleId = pickBubbleId(row) || `${iso}:${catKey}:${normalizeItemName(itemName)}`;
    const itemId = `${invId}:${bubbleId}`;

    const inv = inventarioMap.get(invKey) ?? { id: invId, data: dataLabel, cats: new Map() };
    const cat = inv.cats.get(catKey) ?? { id: `${invId}:${catKey}`, nome: catName, itens: new Map() };
    cat.itens.set(itemId, { id: itemId, item: itemName, unidade: String(unidade).trim() || "Und", estoqueFinal: String(estoqueFinal ?? "").trim() });
    inv.cats.set(catKey, cat);
    inventarioMap.set(invKey, inv);
  }

    function handleInventarioApiHeader(row: CsvObjectRow) {
      if (!enableInventario) return;
      const invId = pickBubbleId(row);
      if (!invId) return;
      const dateRaw =
        pickFirst(row, ["data", "date", "data_inventario", "data_contagem", "data_criacao", "created_date", "created_at", "creation_date"]) ||
        pickKeyLike(row, ["data", "date", "criacao", "created"]);
      const d = parseDateLoose(dateRaw);
      const label = d ? formatDateLabelDDMMYYYY(d) : String(dateRaw ?? "").trim();
      if (label) inventarioDateById.set(invId.trim(), label);
    }

    function handleInventarioApiItem(row: CsvObjectRow) {
      if (!enableInventario) return false;
      const invRef = pickFirst(row, ["inventario_id", "inventarios_id", "inventario"]) || pickKeyLike(row, ["inventario_id", "inventario"]);
      const itemRef = pickFirst(row, ["item_id"]) || pickKeyLike(row, ["item_id"]);
      if (!invRef || !itemRef) return false;
      const dataLabel = inventarioDateById.get(invRef.trim()) ?? "";
      const item = itemById.get(itemRef.trim())?.nome ?? "";
      const unidade = itemById.get(itemRef.trim())?.unidade ?? "";
      const categoria = itemById.get(itemRef.trim())?.categoria ?? "";
      const estoqueFinal =
        pickFirst(row, ["estoque_final", "estoqueFinal", "quantidade", "qtd", "qtde", "estoque", "inventario_final"]) ||
        pickKeyLike(row, ["estoque", "quantidade", "qtd", "final"]);

      const fake: CsvObjectRow = {
        user_id: resolveTargetUserId(row),
        data: dataLabel || pickFirst(row, ["data", "date"]) || "",
        categoria: categoria || "Importado",
        item: item || "",
        unidade: unidade || "Und",
        estoque_final: String(estoqueFinal ?? "").trim(),
        id: `${invRef}:${itemRef}`,
      };
      if (!fake.data || !fake.item) return false;
      handleInventarioFlat(fake);
      return true;
    }

    function detectUnknownKind(row: CsvObjectRow) {
    const keys = Object.keys(row).map((k) => k.toLowerCase());
    const has = (p: string) => keys.some((k) => k.includes(p));
    if (has("email") && (has("user") || has("usuario") || has("created_by") || has("owner"))) return "users";
    if ((has("empresa") || has("company") || has("restaurante")) && (has("cnpj") || has("fantasy") || has("razao") || has("legal") || has("ramo"))) return "empresas";
    if (has("valor_nota") || (has("fornecedor") && (has("numero") || has("nf")) && has("data"))) return "notas_fiscais";
    if ((has("nota") || has("entrada")) && has("quantidade") && (has("subtotal") || has("total") || has("valor"))) return "itens_notas";
    if ((has("fornecedor") || has("empresa")) && (has("whatsapp") || has("telefone") || has("endereco") || has("vendedor"))) return "fornecedores";
    if ((has("fornecedor") || has("empresa")) && (has("produto") || has("item")) && !has("numero")) return "itens_fornecedores";
    if (has("equival") && (has("insumo") || has("item"))) return "equivalencias";
    if (has("motivo") && (has("quantidade") || has("qtd"))) return "desperdicios";
      if (has("codigo") && has("data_validade") && (has("data_producao") || has("dias_validade"))) return "pre_preparo_etiquetas";
      if ((has("pre") && has("preparo")) || (has("validade") && (has("rendimento") || has("yield")))) return "pre_preparo";
    if (has("cmv") || has("bcg") || (has("preco") && has("venda") && has("custo"))) return "fichas_tecnicas";
    if (has("categorias") || (has("estoque") && (has("categoria") || has("grupo")))) return "inventario_flat";
    if (has("custo_medio") || (has("custo") && (has("medida") || has("unidade")))) return "itens";
    return "unknown";
  }

    stage = "process_users";
    await processCsvGroups("users", (row) => handleUserRow(row));

    stage = "process_empresas";
    await processCsvGroups("empresas", (row) => handleEmpresaRow(row));

    if (mappingPath) {
      stage = "save_mapping";
      await ensureBucket(supabase, "bubble-imports");
      const companyToUser: Record<string, string> = {};
      for (const [k, v] of bubbleCompanyIdToUserId.entries()) companyToUser[k] = v;
      await uploadJsonToStorage(supabase, "bubble-imports", mappingPath, { companyToUser, updatedAt: new Date().toISOString() });
    }

    stage = "process_unknown";
    if (includeUnknown && enabledKinds.has("unknown")) {
      const unknownGroups = byKind.get("unknown") ?? [];
      for (const g of unknownGroups) {
        for (const part of g.parts) {
          const rows = await loadRowsForPart(supabase, bucket, part);
          const sample = rows[0];
          const kind = sample ? detectUnknownKind(sample) : "unknown";
          for (const r of rows) {
            if (kind === "notas_fiscais" && enableEntradas) handleNotaFiscal(r);
            else if (kind === "itens_notas" && enableEntradas) handleNotaItem(r);
            else if (kind === "fornecedores" && enableFornecedores) handleFornecedorInfo(r);
            else if (kind === "itens_fornecedores" && enableFornecedores) handleFornecedorProduto(r);
            else if (kind === "equivalencias" && enableFornecedores) handleEquivalencia(r);
            else if (kind === "desperdicios" && enableDesperdicios) handleDesperdicio(r);
            else if (kind === "users") handleUserRow(r);
            else if (kind === "pre_preparo" && enablePrePreparo) handlePrePreparo(r);
            else if (kind === "pre_preparo_etiquetas" && enablePrePreparo) handlePrePreparoEtiqueta(r);
            else if (kind === "fichas_tecnicas" && enableFichas) handleFicha(r);
            else if (kind === "inventario_flat" && enableInventario) handleInventarioFlat(r);
            else if (kind === "itens" && enableInsumos) handleInsumo(r);
          }
        }
      }
    }

    async function processCsvGroups(kind: string, onRow: (row: CsvObjectRow, fileName: string) => void) {
      if (!enabledKinds.has(kind)) return;
      const list = byKind.get(kind) ?? [];
      for (const g of list) {
        for (const part of g.parts) {
          const rows = await loadRowsForPart(supabase, bucket, part);
          for (const r of rows) onRow(r, part.name);
        }
      }
    }

    stage = "process_files";
    if (enableEntradas || enableFornecedores) {
      await ensureFornecedorNameById();
      await ensureEmpresaNameById();
    }
    await processCsvGroups("empresas", (row) => handleEmpresaRow(row));
    await processCsvGroups("categorias", (row) => handleCategoria(row));
    await processCsvGroups("custo_medio", (row) => handleCustoMedio(row));
    await processCsvGroups("ingredientes", (row) => handleInsumo(row));
    await processCsvGroups("itens", (row) => handleInsumo(row));
    await processCsvGroups("fornecedores", (row) => handleFornecedorInfo(row));
    await processCsvGroups("itens_fornecedores", (row) => handleFornecedorProduto(row));
    await processCsvGroups("equivalencias", (row) => handleEquivalencia(row));
    await processCsvGroups("pre_preparo", (row) => handlePrePreparo(row));
    await processCsvGroups("pre_preparo_etiquetas", (row) => handlePrePreparoEtiqueta(row));
    await processCsvGroups("fichas_tecnicas", (row) => handleFicha(row));

    if (enablePrePreparo) {
      await processCsvGroups("itens", (row) => handlePrePreparoFromItemRow(row));
    }

    for (const st of fornecedoresByUser.values()) {
      for (const k of Object.keys(st.produtosMap)) {
        st.produtosMap[k] = Array.from(new Set((st.produtosMap[k] ?? []).filter(Boolean))).sort((a, b) =>
          a.localeCompare(b, "pt-BR", { sensitivity: "base", numeric: true }),
        );
      }
    }

    stage = "save_supabase";

    if (enableInsumos) {
      for (const [uid, map] of insumosByUser.entries()) {
        const rows = Array.from(map.values()).filter((r) => r && r.item);
        const categories = Array.from(new Set(rows.map((r) => String(r.categoria ?? "").trim()).filter(Boolean)));
        const stateId = `user:${uid}`;
        const { error } = await supabase
          .from("insumos_state")
          .upsert({ id: stateId, payload: { rows, categories } } as any, { onConflict: "id" });
        if (error) return json({ ok: false, error: `insumos_state:${error.message}`, stage }, { status: 500 });
      }
    }

    if (enableFornecedores) {
      for (const [uid, st] of fornecedoresByUser.entries()) {
        const stateId = `user:${uid}`;
        const { error } = await supabase
          .from("fornecedores_state")
          .upsert({ id: stateId, info: st.infoMap, produtos: st.produtosMap, equivalencias: st.equivalenciasMap } as any, { onConflict: "id" });
        if (error) return json({ ok: false, error: `fornecedores_state:${error.message}`, stage }, { status: 500 });
      }
    }

    if (enablePrePreparo) {
      for (const [uid, rows] of prePreparoRowsByUser.entries()) {
        if (!rows.length) continue;
        const stateId = `user:${uid}`;
        const { error } = await supabase.from("pre_preparo_state").upsert({ id: stateId, payload: rows } as any, { onConflict: "id" });
        if (error) return json({ ok: false, error: `pre_preparo_state:${error.message}`, stage }, { status: 500 });
      }
      for (const [uid, rows] of prePreparoEtiquetasRowsByUser.entries()) {
        if (!rows.length) continue;
        const stateId = `user:${uid}`;
        const { error } = await supabase
          .from("pre_preparo_etiquetas_state")
          .upsert({ id: stateId, payload: rows } as any, { onConflict: "id" });
        if (error) return json({ ok: false, error: `pre_preparo_etiquetas_state:${error.message}`, stage }, { status: 500 });
      }
    }

    if (enableFichas) {
      for (const [uid, rows] of fichasRowsByUser.entries()) {
        if (!rows.length) continue;
        const stateId = `user:${uid}`;
        const { error } = await supabase.from("fichas_tecnicas_state").upsert({ id: stateId, payload: rows } as any, { onConflict: "id" });
        if (error) return json({ ok: false, error: `fichas_tecnicas_state:${error.message}`, stage }, { status: 500 });
      }
    }

    const inventarioRows: any[] = [];
    if (enableInventario) {
      const pendingInvItems: CsvObjectRow[] = [];
      await processCsvGroups("inventario", (row) => {
        const hasInvItemsList = Boolean(pickFirst(row, ["lista_itens_inventarios", "itens_inventarios"]) || pickKeyLike(row, ["itens_inventarios", "lista_itens"]));
        const looksHeader = hasInvItemsList && !pickFirst(row, ["inventario_id", "inventarios_id"]) && !pickKeyLike(row, ["inventario_id"]);
        if (looksHeader) {
          handleInventarioApiHeader(row);
          return;
        }

        const lookedApiItem = Boolean(pickFirst(row, ["inventario_id", "inventarios_id"]) || pickKeyLike(row, ["inventario_id"])) && Boolean(pickFirst(row, ["item_id"]) || pickKeyLike(row, ["item_id"]));
        if (lookedApiItem) {
          const ok = handleInventarioApiItem(row);
          if (!ok) pendingInvItems.push(row);
          return;
        }

        const dataLabel = buildDateLabel(pickFirst(row, ["data", "date", "data_inventario"]));
        const bubbleId = pickBubbleId(row) || String(inventarioRows.length + 1);
        const categoriasRaw = pickFirst(row, ["categorias", "categories", "payload"]);
        let categorias: any[] = [];
        if (categoriasRaw && (categoriasRaw.trim().startsWith("[") || categoriasRaw.trim().startsWith("{"))) {
          try {
            const parsed = JSON.parse(categoriasRaw);
            categorias = Array.isArray(parsed) ? parsed : [];
          } catch {}
        }
        if (dataLabel && categorias.length) {
          const prefix = prefixForRow(row);
          inventarioRows.push({ id: `${prefix}inventario:${bubbleId}`, data: dataLabel, categorias });
          return;
        }
        handleInventarioFlat(row);
      });
      for (const row of pendingInvItems) handleInventarioApiItem(row);
    }

    const inventarioRowsFromFlat = enableInventario
      ? Array.from(inventarioMap.values()).map((inv) => {
          const categorias: any[] = Array.from(inv.cats.values()).map((c) => ({
            id: c.id,
            nome: c.nome,
            status: "concluida",
            itens: Array.from(c.itens.values()),
          }));
          return { id: inv.id, data: inv.data, categorias };
        })
      : [];

    const inventarioInserted =
      enableInventario && (inventarioRows.length || inventarioRowsFromFlat.length)
        ? await upsertInBatches(supabase, "inventario", [...inventarioRows, ...inventarioRowsFromFlat], 100)
        : 0;

    await processCsvGroups("motivos_desperdicios", (row) => handleMotivoDesperdicio(row));
    await processCsvGroups("desperdicios", (row) => handleDesperdicio(row));
    const desperdiciosInserted = enableDesperdicios && desperdiciosRows.length ? await upsertInBatches(supabase, "desperdicios", desperdiciosRows, 500) : 0;

    await processCsvGroups("itens_notas", (row) => handleNotaItem(row));
    await processCsvGroups("notas_fiscais", (row) => handleNotaFiscal(row));
    const entradasInserted = enableEntradas && entradasRows.length ? await upsertInBatches(supabase, "entradas", entradasRows, 300) : 0;

    return json(
      {
        ok: true,
        ran: {
          insumos: enableInsumos,
          fornecedores: enableFornecedores,
          desperdicios: enableDesperdicios,
          entradas: enableEntradas,
          prePreparo: enablePrePreparo,
          fichasTecnicas: enableFichas,
          inventario: enableInventario,
          includeUnknown,
        },
        filesByKind: fileCountsByKind,
        summary: {
          files: files.length,
          insumos: enableInsumos ? Array.from(insumosByUser.values()).reduce((sum, m) => sum + m.size, 0) : null,
          fornecedores: enableFornecedores ? Array.from(fornecedoresByUser.values()).reduce((sum, st) => sum + Object.keys(st.infoMap).length, 0) : null,
          fornecedoresProdutos: enableFornecedores ? Array.from(fornecedoresByUser.values()).reduce((sum, st) => sum + Object.keys(st.produtosMap).length, 0) : null,
          fichasTecnicas: enableFichas ? Array.from(fichasRowsByUser.values()).reduce((sum, rows) => sum + rows.length, 0) : null,
          prePreparo: enablePrePreparo ? Array.from(prePreparoRowsByUser.values()).reduce((sum, rows) => sum + rows.length, 0) : null,
          etiquetasPrePreparo: enablePrePreparo ? Array.from(prePreparoEtiquetasRowsByUser.values()).reduce((sum, rows) => sum + rows.length, 0) : null,
          inventario: enableInventario ? inventarioInserted : null,
          desperdicios: enableDesperdicios ? desperdiciosInserted : null,
          entradas: enableEntradas ? entradasInserted : null,
        },
        usersTouched: {
          insumos_state: enableInsumos ? insumosByUser.size : null,
          fornecedores_state: enableFornecedores ? fornecedoresByUser.size : null,
          pre_preparo_state: enablePrePreparo ? prePreparoRowsByUser.size : null,
          fichas_tecnicas_state: enableFichas ? fichasRowsByUser.size : null,
          userMap_bubbleUsers: bubbleUserIdToEmail.size,
          userMap_empresas: bubbleCompanyIdToUserId.size,
        },
      },
      { status: 200 },
    );
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err), stage }, { status: 500 });
  }
}
