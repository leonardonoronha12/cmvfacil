import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { getSupabaseAdmin } from "../../lib/supabaseAdmin";
import { getUserIdFromRequest } from "../../lib/requestUserId";
import { normalizeKey as normalizeKeyFromLib, parseBubbleCsvToObjects, type CsvObjectRow } from "../../lib/bubbleCsv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return NextResponse.json(data, { ...init, headers });
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function safeEmail(input: unknown) {
  const v = String(input ?? "").trim().toLowerCase();
  if (!v || !v.includes("@")) return "";
  return v;
}

async function findAuthUserIdByEmail(supabase: ReturnType<typeof getSupabaseAdmin>, email: string) {
  const target = email.trim().toLowerCase();
  for (let page = 1; page <= 2000; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(error.message);
    const users = (data?.users ?? []) as any[];
    for (const u of users) {
      const id = String(u?.id ?? "").trim();
      const em = String(u?.email ?? "").trim().toLowerCase();
      if (id && em === target) return id;
    }
    if (users.length < 1000) break;
  }
  return null;
}

async function resolveSupabaseUser(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  userId: string,
): Promise<{ uid: string | null; email: string | null; error: string | null }> {
  const raw = String(userId ?? "").trim();
  if (isUuid(raw)) {
    const authUser = await supabase.auth.admin.getUserById(raw);
    if (authUser.error) return { uid: null, email: null, error: `auth_get_user:${authUser.error.message}` };
    const email = String(authUser.data?.user?.email ?? "").trim().toLowerCase();
    if (!email) return { uid: null, email: null, error: "missing_supabase_email" };
    return { uid: raw, email, error: null };
  }

  const email = safeEmail(raw);
  if (!email) return { uid: null, email: null, error: "user_not_supabase_uuid" };

  const { data: profileDb } = await supabase.from("user_profiles").select("user_id").ilike("email", email).maybeSingle();
  const uid = String((profileDb as any)?.user_id ?? "").trim();
  if (uid && isUuid(uid)) return { uid, email, error: null };

  const fromAuth = await findAuthUserIdByEmail(supabase, email);
  if (fromAuth && isUuid(fromAuth)) return { uid: fromAuth, email, error: null };

  return { uid: null, email, error: "user_not_found" };
}

function digitsOnly(value: string) {
  return value.replace(/\D/g, "");
}

function normalizePhoneBR(value: string) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("+")) return trimmed;
  const d = digitsOnly(trimmed);
  if (!d) return null;
  if (d.startsWith("55")) return `+${d}`;
  return `+55${d}`;
}

function parsePermissionLevel(v: unknown) {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const n = Number(String(v ?? "").trim());
  return Number.isFinite(n) ? n : 0;
}

function isAdminMemberRow(row: any) {
  const roleRaw = String(row?.role ?? "").trim().toLowerCase();
  if (roleRaw.includes("owner") || roleRaw.includes("admin") || roleRaw.includes("administrador") || roleRaw.includes("propriet")) return true;
  const permRaw = String(row?.permission_level ?? "").trim().toLowerCase();
  if (permRaw.includes("owner") || permRaw.includes("admin") || permRaw.includes("administrador")) return true;
  const permNum = parsePermissionLevel(row?.permission_level);
  return Number.isFinite(permNum) && permNum >= 1;
}

function scoreRole(role: unknown) {
  const r = String(role ?? "").trim().toLowerCase();
  if (!r) return 0;
  if (r.includes("owner") || r.includes("propriet")) return 30;
  if (r.includes("admin")) return 20;
  if (r.includes("manager") || r.includes("gerente")) return 10;
  return 0;
}

function pickBestCompanyId(memberRows: unknown[]) {
  let bestCompanyId = "";
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const row of memberRows ?? []) {
    const r = row as any;
    const companyId = String(r?.company_id ?? "").trim();
    if (!companyId) continue;
    const perm = parsePermissionLevel(r?.permission_level);
    const score = perm * 100 + scoreRole(r?.role);
    if (score > bestScore) {
      bestScore = score;
      bestCompanyId = companyId;
    }
  }
  return bestCompanyId;
}

function normalizeKey(input: string) {
  return normalizeKeyFromLib(input);
}

function extractEmail(value: string) {
  const s = String(value ?? "").trim();
  if (!s) return null;
  const m = s.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
  return m ? String(m[0]).trim().toLowerCase() : null;
}

function pickFirst(row: CsvObjectRow, keys: string[]) {
  for (const k of keys) {
    const v = String((row as any)[k] ?? "").trim();
    if (v) return v;
  }
  return "";
}

function pickKeyLike(row: CsvObjectRow, includeParts: string[], excludeParts: string[] = []) {
  const keys = Object.keys(row);
  for (const k of keys) {
    const kk = k.toLowerCase();
    if (excludeParts.some((p) => kk.includes(p))) continue;
    if (includeParts.some((p) => kk.includes(p))) {
      const v = String((row as any)[k] ?? "").trim();
      if (v) return v;
    }
  }
  return "";
}

function pickBubbleId(row: CsvObjectRow) {
  return pickFirst(row, ["unique_id", "_id", "id", "bubble_id"]);
}

function normalizeRowKeys(row: CsvObjectRow) {
  const out: CsvObjectRow = {};
  for (const [k, v] of Object.entries(row)) (out as any)[normalizeKey(k)] = String(v ?? "").trim();
  return out;
}

async function ensureBucket(supabase: ReturnType<typeof getSupabaseAdmin>, bucket: string) {
  const got = await supabase.storage.getBucket(bucket);
  if (!got.error) return;
  await supabase.storage.createBucket(bucket, { public: false }).catch(() => {});
}

type StoredPath = { path: string; name: string; created_at?: string; updated_at?: string; size?: number };

async function listAllPathsDeep(supabase: ReturnType<typeof getSupabaseAdmin>, bucket: string, rootPrefix: string, maxDepth = 8, maxItems = 8000) {
  const out: StoredPath[] = [];
  const seen = new Set<string>();
  const queue: Array<{ prefix: string; depth: number }> = [{ prefix: rootPrefix, depth: 0 }];

  while (queue.length && out.length < maxItems) {
    const cur = queue.shift()!;
    if (seen.has(cur.prefix)) continue;
    seen.add(cur.prefix);

    const { data, error } = await supabase.storage.from(bucket).list(cur.prefix, { limit: 1000, sortBy: { column: "name", order: "asc" } });
    if (error) continue;

    for (const it of data ?? []) {
      const name = String((it as any)?.name ?? "").trim();
      if (!name) continue;
      const fullPath = `${cur.prefix}/${name}`;
      if ((it as any).id == null) {
        if (cur.depth < maxDepth) queue.push({ prefix: fullPath, depth: cur.depth + 1 });
        continue;
      }
      out.push({
        path: fullPath,
        name,
        created_at: (it as any).created_at,
        updated_at: (it as any).updated_at,
        size: (it as any)?.metadata?.size,
      });
      if (out.length >= maxItems) break;
    }
  }

  return out.sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? "") || b.name.localeCompare(a.name));
}

async function downloadText(supabase: ReturnType<typeof getSupabaseAdmin>, bucket: string, path: string) {
  const dl = await supabase.storage.from(bucket).download(path);
  if (dl.error || !dl.data) throw new Error(dl.error?.message || "download_failed");
  const buf = await dl.data.arrayBuffer();
  return new TextDecoder().decode(buf);
}

async function downloadBytes(supabase: ReturnType<typeof getSupabaseAdmin>, bucket: string, path: string) {
  const dl = await supabase.storage.from(bucket).download(path);
  if (dl.error || !dl.data) throw new Error(dl.error?.message || "download_failed");
  return await dl.data.arrayBuffer();
}

async function uploadJson(supabase: ReturnType<typeof getSupabaseAdmin>, bucket: string, path: string, obj: unknown) {
  const raw = JSON.stringify(obj);
  const bytes = new TextEncoder().encode(raw);
  const up = await supabase.storage.from(bucket).upload(path, bytes, { upsert: true, contentType: "application/json" } as any);
  if (up.error) throw new Error(up.error.message || "upload_failed");
}

function parseBubbleXlsxToObjects(buf: ArrayBuffer) {
  const wb = XLSX.read(buf, { type: "array" });
  const sheetName = wb.SheetNames?.[0];
  if (!sheetName) return { header: [] as string[], rows: [] as CsvObjectRow[] };
  const sheet = wb.Sheets[sheetName];
  const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" }) as unknown[][];
  const headerRaw = (grid[0] ?? []) as unknown[];
  const header = headerRaw.map((h, i) => normalizeKey(String(h ?? "")) || `col_${i + 1}`);
  const rows: CsvObjectRow[] = [];
  for (let i = 1; i < grid.length; i++) {
    const r = (grid[i] ?? []) as unknown[];
    if (!r.length) continue;
    const obj: CsvObjectRow = {};
    for (let c = 0; c < header.length; c++) (obj as any)[header[c]] = String(r[c] ?? "").trim();
    const hasAny = Object.values(obj).some((v) => String(v).trim());
    if (hasAny) rows.push(obj);
  }
  return { header, rows };
}

async function loadRowsForPath(supabase: ReturnType<typeof getSupabaseAdmin>, bucket: string, path: string, name: string) {
  const lower = name.toLowerCase();
  if (lower.endsWith(".csv")) {
    const text = await downloadText(supabase, bucket, path);
    return parseBubbleCsvToObjects(text).rows;
  }
  if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) {
    const buf = await downloadBytes(supabase, bucket, path);
    return parseBubbleXlsxToObjects(buf).rows;
  }
  if (lower.endsWith(".json")) {
    const text = await downloadText(supabase, bucket, path);
    const raw = JSON.parse(text) as any;
    const arr: any[] = Array.isArray(raw)
      ? raw
      : Array.isArray(raw?.rows)
        ? raw.rows
        : Array.isArray(raw?.results)
          ? raw.results
          : Array.isArray(raw?.response?.results)
            ? raw.response.results
            : Array.isArray(raw?.data)
              ? raw.data
              : Array.isArray(raw?.items)
                ? raw.items
                : [];
    return arr.filter((x) => x && typeof x === "object").map((x) => x as CsvObjectRow);
  }
  return [];
}

function scoreFile(path: StoredPath, kind: "users" | "empresas") {
  const name = path.name.toLowerCase();
  const p = path.path.toLowerCase();
  let s = 0;
  const isBubbleApi = name.includes("bubble-api-") || p.includes("/bootstrap/") || p.includes("/sync-");
  const isImportArtifact =
    name.startsWith("import-") ||
    name.includes("import_") ||
    p.includes("/import-") ||
    p.includes("/import_") ||
    name.endsWith("-acc.json") ||
    name.endsWith("_acc.json");
  const isExport = name.includes("export_") || name.includes("export-") || name.includes("exportall") || name.includes("export_all") || name.includes("export");
  const isCsv = name.endsWith(".csv");
  const isXlsx = name.endsWith(".xlsx") || name.endsWith(".xls");
  if (kind === "users") {
    if (name.includes("user") || name.includes("usu")) s += 50;
    if (p.includes("/users") || p.includes("/usuarios") || p.includes("/usuario")) s += 50;
    if (name === "users.csv" || name === "usuarios.csv") s += 50;
    if (isExport) s += 40;
    if (isCsv || isXlsx) s += 20;
    if (isBubbleApi) s -= 120;
  } else {
    if (isImportArtifact) s -= 250;
    if (name.includes("fornecedor") || name.includes("fornecedores") || p.includes("/fornecedor") || p.includes("/fornecedores")) s -= 200;
    if (name.includes("insumo") || name.includes("insumos") || p.includes("/insumo") || p.includes("/insumos")) s -= 200;
    if (name.includes("entrada") || name.includes("entradas") || p.includes("/entrada") || p.includes("/entradas")) s -= 200;
    if (name.includes("inventario") || name.includes("inventários") || p.includes("/inventario") || p.includes("/inventario")) s -= 200;
    if (name.includes("desperdicio") || name.includes("desperdícios") || p.includes("/desperdicio") || p.includes("/desperdicio")) s -= 200;
    if (name.includes("pre_preparo") || name.includes("pre-preparo") || p.includes("/pre-preparo") || p.includes("/pre_preparo")) s -= 200;
    if (name.includes("ficha") || name.includes("fichas") || p.includes("/fichas")) s -= 120;
    if (name.includes("nota") || name.includes("notas") || p.includes("/notas")) s -= 120;
    if (name.includes("categoria") || name.includes("categorias") || p.includes("/categorias")) s -= 80;
    if (name.includes("etiqueta") || name.includes("etiquetas") || p.includes("/etiquetas")) s -= 80;
    if (name.includes("custo_medio") || name.includes("custo-medio") || p.includes("/custo")) s -= 80;
    if (name.includes("motivo") || name.includes("motivos") || p.includes("/motivos")) s -= 80;
    if (name.includes("empresa") || name.includes("company") || name.includes("restaurante")) s += 50;
    if (p.includes("/empresas") || p.includes("/empresa") || p.includes("/companies") || p.includes("/company") || p.includes("/restaurante")) s += 50;
    if (name === "empresas.csv" || name === "companies.csv") s += 50;
    if (isExport) s += 20;
    if (isCsv || isXlsx) s += 10;
    const bubbleCompanyLike = isBubbleApi && (name.includes("empresa") || name.includes("company") || p.includes("/empresas") || p.includes("/companies"));
    if (isBubbleApi && !bubbleCompanyLike) s -= 120;
    else if (isBubbleApi) s += 10;
  }
  return s;
}

function guessCompanyName(rowNorm: CsvObjectRow) {
  const direct =
    pickFirst(rowNorm, ["nome_fantasia", "fantasy_name", "fantasy", "nome", "name", "empresa_nome", "empresa", "restaurante", "restaurante_nome"]) ||
    pickKeyLike(rowNorm, ["nome", "name", "fantasy", "empresa", "company", "restaurante"], ["id", "uuid", "created", "updated", "email", "telefone", "whatsapp", "cnpj"]);
  const v = String(direct ?? "").trim();
  return v || "—";
}

function guessCompanyLogo(rowNorm: CsvObjectRow) {
  const raw =
    pickFirst(rowNorm, ["logo", "logotipo", "logo_url", "logo_empresa", "logo_da_empresa", "company_logo", "company_logo_url", "empresa_logo", "imagem_logo"]) ||
    pickKeyLike(rowNorm, ["logo", "logotipo"], ["id", "uuid", "email", "telefone", "whatsapp", "cnpj", "nome", "name"]);
  const v = String(raw ?? "").trim();
  if (!v) return "";
  const direct = extractUrlFromText(v);
  if (direct) return direct;
  if (v.startsWith("{") || v.startsWith("[")) {
    try {
      const parsed = JSON.parse(v) as any;
      const scan = (x: any): string => {
        if (!x) return "";
        if (typeof x === "string") return extractUrlFromText(x);
        if (Array.isArray(x)) {
          for (const it of x) {
            const got = scan(it);
            if (got) return got;
          }
          return "";
        }
        if (typeof x === "object") {
          const direct = scan(x.url) || scan(x.image) || scan(x.photo) || scan(x.src) || scan(x.href);
          if (direct) return direct;
          for (const vv of Object.values(x)) {
            const got = scan(vv);
            if (got) return got;
          }
        }
        return "";
      };
      const candidate = scan(parsed);
      if (candidate) return candidate;
    } catch {}
  }
  for (const [k, vv] of Object.entries(rowNorm)) {
    const kk = String(k ?? "").toLowerCase();
    if (!kk) continue;
    if (!kk.includes("logo") && !kk.includes("logotipo")) continue;
    const cand = extractUrlFromText(String(vv ?? ""));
    if (cand) return cand;
  }
  return "";
}

function extractUrlFromText(value: string) {
  const s = String(value ?? "").trim();
  if (!s) return "";
  const url = s.match(/(https?:\/\/[^\s"'`)\]>]+|\/\/[^\s"'`)\]>]+)/i);
  const rawMatch = url ? String(url[0] ?? "").trim() : "";
  const raw =
    rawMatch ||
    String(
      (s.match(/(cdn\.bubble\.io\/[^\s"'`)\]>]+|s3\.amazonaws\.com\/[^\s"'`)\]>]+|storage\.googleapis\.com\/[^\s"'`)\]>]+|appforest_uf\/[^\s"'`)\]>]+)/i)?.[0] ??
        ""),
    ).trim();
  let cleaned = raw;
  cleaned = cleaned.replace(/^[`"'(<\[]+/, "").replace(/[`"')>\],.]+$/, "");
  if (!cleaned) return "";
  if (cleaned.startsWith("//")) return `https:${cleaned}`;
  if (cleaned.startsWith("www.")) return `https://${cleaned}`;
  if (!cleaned.startsWith("http") && cleaned.startsWith("appforest_uf/")) return `https://s3.amazonaws.com/${cleaned}`;
  if (!cleaned.startsWith("http") && (cleaned.startsWith("cdn.bubble.io/") || cleaned.startsWith("s3.amazonaws.com/") || cleaned.startsWith("storage.googleapis.com/")))
    return `https://${cleaned}`;
  return cleaned;
}

function resolveOwnerEmailFromCompanyRow(row: CsvObjectRow, bubbleIdToEmail?: Map<string, string>) {
  const ownerRef =
    pickFirst(row, [
      "user_id",
      "usuario_id",
      "id_usuario",
      "owner",
      "owner_id",
      "created_by",
      "createdby",
      "created_by_user",
      "created_by_id",
      "criador",
      "criador_id",
      "responsavel",
      "responsavel_id",
      "account",
      "account_id",
      "user",
      "usuario",
    ]) || pickKeyLike(row, ["user", "usuario", "owner", "created", "criador", "responsavel", "account"], ["nome", "name", "empresa", "company", "restaurante"]);
  const direct = extractEmail(ownerRef);
  if (direct) return direct;
  if (bubbleIdToEmail && ownerRef) {
    const raw = String(ownerRef ?? "").trim();
    const bubbleId = extractBubbleIdFromText(raw) || raw;
    const mapped = String(bubbleIdToEmail.get(bubbleId) ?? "").trim().toLowerCase();
    if (mapped) return mapped;
  }
  if (bubbleIdToEmail) {
    for (const v of Object.values(row)) {
      const raw = String(v ?? "").trim();
      if (!raw) continue;
      const bubbleId = extractBubbleIdFromText(raw);
      if (!bubbleId) continue;
      const mapped = String(bubbleIdToEmail.get(bubbleId) ?? "").trim().toLowerCase();
      if (mapped) return mapped;
    }
  }
  for (const v of Object.values(row)) {
    const em = extractEmail(String(v ?? ""));
    if (em) return em;
  }
  return null;
}

function rowMentionsUser(rowNorm: CsvObjectRow, userEmail: string, userBubbleId: string) {
  const email = String(userEmail ?? "").trim().toLowerCase();
  const bubbleId = String(userBubbleId ?? "").trim();
  for (const v of Object.values(rowNorm)) {
    const raw = String(v ?? "").trim();
    if (!raw) continue;
    if (email) {
      const em = extractEmail(raw);
      if (em && em === email) return true;
    }
    if (bubbleId) {
      if (raw === bubbleId) return true;
      const extracted = extractBubbleIdFromText(raw);
      if (extracted && extracted === bubbleId) return true;
    }
  }
  return false;
}

function normalizePhone(value: string) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const digits = raw.replace(/[^\d]/g, "");
  if (!digits) return raw;
  if (digits.length === 11) return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  if (digits.length === 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return raw;
}

function guessUserAvatar(rowNorm: CsvObjectRow) {
  const raw =
    pickFirst(rowNorm, ["avatar", "foto", "foto_url", "imagem", "imagem_url", "photo", "photo_url", "image", "image_url", "profile_photo", "profile_image"]) ||
    pickKeyLike(rowNorm, ["avatar", "foto", "imagem", "photo", "image"], ["id", "uuid"]);
  const v = String(raw ?? "").trim();
  if (!v) return "";
  const url = extractUrlFromText(v);
  if (url) return url;
  if (v.startsWith("{") || v.startsWith("[")) {
    try {
      const parsed = JSON.parse(v) as any;
      const scan = (x: any): string => {
        if (!x) return "";
        if (typeof x === "string") return extractUrlFromText(x);
        if (Array.isArray(x)) {
          for (const it of x) {
            const got = scan(it);
            if (got) return got;
          }
          return "";
        }
        if (typeof x === "object") {
          const direct = scan(x.url) || scan(x.image) || scan(x.photo) || scan(x.src) || scan(x.href);
          if (direct) return direct;
          for (const vv of Object.values(x)) {
            const got = scan(vv);
            if (got) return got;
          }
        }
        return "";
      };
      const candidate = scan(parsed);
      if (candidate) return candidate;
    } catch {}
  }
  for (const [k, vv] of Object.entries(rowNorm)) {
    const kk = String(k ?? "").toLowerCase();
    if (!kk) continue;
    if (kk.includes("logo") || kk.includes("logotipo") || kk.includes("banner") || kk.includes("capa") || kk.includes("background")) continue;
    const looksImageKey = kk.includes("avatar") || kk.includes("foto") || kk.includes("imagem") || kk.includes("photo") || kk.includes("image") || kk.includes("perfil");
    if (!looksImageKey) continue;
    const cand = extractUrlFromText(String(vv ?? ""));
    if (cand) return cand;
    const s = String(vv ?? "").trim();
    if (s && (s.startsWith("{") || s.startsWith("["))) {
      try {
        const parsed = JSON.parse(s) as any;
        const scan = (x: any): string => {
          if (!x) return "";
          if (typeof x === "string") return extractUrlFromText(x);
          if (Array.isArray(x)) {
            for (const it of x) {
              const got = scan(it);
              if (got) return got;
            }
            return "";
          }
          if (typeof x === "object") {
            const direct = scan(x.url) || scan(x.image) || scan(x.photo) || scan(x.src) || scan(x.href);
            if (direct) return direct;
            for (const vv of Object.values(x)) {
              const got = scan(vv);
              if (got) return got;
            }
          }
          return "";
        };
        const candidate = scan(parsed);
        if (candidate) return candidate;
      } catch {}
    }
  }
  return "";
}

function guessUserNameParts(rowNorm: CsvObjectRow) {
  const first =
    pickFirst(rowNorm, ["nome", "first_name", "firstname", "nome_usuario", "usuario_nome"]) ||
    pickKeyLike(rowNorm, ["nome", "first", "user"], ["sobrenome", "last", "empresa", "company", "email", "whatsapp", "telefone"]);
  const last = pickFirst(rowNorm, ["sobrenome", "last_name", "lastname"]);
  const full = pickFirst(rowNorm, ["nome_completo", "full_name", "name"]);
  const f = String(first ?? "").trim();
  const l = String(last ?? "").trim();
  if (f && l) return { first: f, last: l, full: `${f} ${l}`.trim() };
  const base = f || String(full ?? "").trim();
  if (!base) return { first: "", last: "", full: "" };
  const parts = base.split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { first: base, last: "", full: base };
  return { first: parts[0] ?? base, last: parts.slice(1).join(" "), full: parts.join(" ") };
}

function extractBubbleIdFromText(raw: string) {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  const bubbleIdInJson = s.match(/"(?:unique_id|_id|id|bubble_id|company_id|empresa_id|restaurante_id|restaurant_id|account_id)"\s*:\s*"([^"]+)"/i);
  if (bubbleIdInJson) {
    const extracted = String(bubbleIdInJson[1] ?? "").trim();
    if (extracted) return extracted;
  }
  const loose = s.match(/\b\d{6,}x\d+\b/);
  if (loose) return String(loose[0] ?? "").trim();
  return "";
}

function formatDateTimePt(input: string) {
  const raw = String(input ?? "").trim();
  if (!raw) return "";
  const ts = Date.parse(raw);
  if (!Number.isFinite(ts)) return raw;
  const d = new Date(ts);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = String(d.getFullYear()).slice(-2);
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${yy} às ${hh}:${mi}h`;
}

function guessJoinedAt(rowNorm: CsvObjectRow) {
  const raw =
    pickFirst(rowNorm, ["data_admissao", "admissao", "created_at", "created_date", "created", "signup_at", "data_criacao", "data"]) ||
    pickKeyLike(rowNorm, ["admiss", "created", "signup", "data"], ["updated", "delete", "id", "uuid", "email", "whatsapp", "telefone"]);
  return formatDateTimePt(raw);
}

function guessRole(rowNorm: CsvObjectRow) {
  const raw =
    pickFirst(rowNorm, ["permissao", "permission", "role", "nivel", "type", "user_type", "tipo"]) ||
    pickKeyLike(rowNorm, ["permiss", "role", "admin", "owner", "nivel", "tipo"], ["email", "nome", "name", "company", "empresa"]);
  const s = String(raw ?? "").trim().toLowerCase();
  if (!s) return "";
  if (s.includes("admin") || s.includes("administrador") || s.includes("owner") || s.includes("propriet")) return "Administrador";
  if (s.includes("colab")) return "Colaborador";
  if (s === "true" || s === "1" || s === "sim") return "Administrador";
  return "";
}

function guessPlanFromCompanyRow(rowNorm: CsvObjectRow) {
  const planRaw =
    pickFirst(rowNorm, ["plano", "plan", "plan_name", "plano_nome", "plano_atual", "assinatura_plano", "subscription_plan", "subscription_plan_name", "tipo_plano"]) ||
    pickKeyLike(rowNorm, ["plano", "plan", "assinatura", "subscription"], ["id", "uuid", "email", "telefone", "whatsapp"]);
  const statusRaw =
    pickFirst(rowNorm, ["status", "assinatura_status", "subscription_status", "plano_status", "plan_status", "subscription_state"]) ||
    pickKeyLike(rowNorm, ["status", "ativo", "assinatura", "subscription"], ["id", "uuid", "email", "telefone", "whatsapp", "plano", "plan"]);
  const cardRaw =
    pickFirst(rowNorm, ["card_last4", "last4", "cartao_final", "final_cartao", "card", "cartao", "cartao_ultimos_4"]) ||
    pickKeyLike(rowNorm, ["last4", "cartao", "card"], ["id", "uuid", "email"]);

  const type = String(planRaw ?? "").trim();
  const status = String(statusRaw ?? "").trim();
  const digits = String(cardRaw ?? "").replace(/[^\d]/g, "");
  const cardLast4 = digits.length >= 4 ? digits.slice(-4) : "";
  return { type, status, cardLast4 };
}

function guessCurrentCompanyId(rowNorm: CsvObjectRow) {
  const raw =
    pickFirst(rowNorm, ["empresa_atual", "empresa_selecionada", "company_current", "current_company", "selected_company", "restaurante_atual", "account", "account_id"]) ||
    pickKeyLike(rowNorm, ["empresa", "company", "restaurante", "restaurant", "account"], ["nome", "name", "email", "whatsapp", "telefone"]);
  return raw ? extractBubbleIdFromText(raw) || String(raw).trim() : "";
}

function isDataFile(name: string) {
  const n = name.toLowerCase();
  if (n.endsWith("sync-state.json") || n.endsWith("state.json") || n.endsWith("mapping.json")) return false;
  return n.endsWith(".csv") || n.endsWith(".xlsx") || n.endsWith(".xls") || n.endsWith(".json");
}

function scoreLinkFile(path: StoredPath) {
  const name = path.name.toLowerCase();
  const p = path.path.toLowerCase();
  let s = 0;
  if (name.includes("member") || name.includes("membro") || name.includes("membros")) s += 40;
  if (name.includes("team") || name.includes("equipe")) s += 30;
  if (name.includes("user") && (name.includes("company") || name.includes("empresa") || name.includes("account"))) s += 50;
  if (p.includes("/members") || p.includes("/membros") || p.includes("/team") || p.includes("/equipe")) s += 40;
  if (p.includes("users") && (p.includes("companies") || p.includes("empresas") || p.includes("account"))) s += 40;
  return s;
}

function guessCompanyIdFromRow(rowNorm: CsvObjectRow, knownCompanyIds: Set<string>) {
  const candidates: string[] = [];
  for (const k of Object.keys(rowNorm)) {
    const kk = k.toLowerCase();
    if (kk.includes("empresa") || kk.includes("company") || kk.includes("restaurante") || kk.includes("restaurant") || kk.includes("account")) {
      candidates.push(String((rowNorm as any)[k] ?? ""));
    }
  }
  for (const v of Object.values(rowNorm)) candidates.push(String(v ?? ""));

  for (const raw of candidates) {
    const s = String(raw ?? "").trim();
    if (!s || s.includes("@")) continue;
    if (knownCompanyIds.has(s)) return s;
    const extracted = extractBubbleIdFromText(s);
    if (extracted && knownCompanyIds.has(extracted)) return extracted;
  }
  return "";
}

function guessMemberEmailFromRow(rowNorm: CsvObjectRow, bubbleUserIdToEmail: Map<string, string>) {
  const candidates: string[] = [];
  for (const k of Object.keys(rowNorm)) {
    const kk = k.toLowerCase();
    if (kk.includes("email") || kk.includes("mail") || kk.includes("login") || kk.includes("username")) candidates.push(String((rowNorm as any)[k] ?? ""));
    if (kk.includes("user") || kk.includes("usuario") || kk.includes("owner") || kk.includes("membro") || kk.includes("member") || kk.includes("responsavel"))
      candidates.push(String((rowNorm as any)[k] ?? ""));
  }
  for (const v of Object.values(rowNorm)) candidates.push(String(v ?? ""));

  for (const raw of candidates) {
    const em = extractEmail(raw);
    if (em) return em;
    const id = extractBubbleIdFromText(raw) || String(raw ?? "").trim();
    if (id && bubbleUserIdToEmail.has(id)) return bubbleUserIdToEmail.get(id) ?? null;
  }
  return null;
}

type LoadedContext = {
  prefix: string;
  paths: StoredPath[];
  usersFile: StoredPath | null;
  empresasFile: StoredPath | null;
  usersAllRows: CsvObjectRow[];
  bubbleRow: CsvObjectRow | null;
  bubbleRowNorm: CsvObjectRow | null;
  usersEmailRowsCount: number;
};

async function loadContextForPrefix(args: {
  supabase: ReturnType<typeof getSupabaseAdmin>;
  bucket: string;
  prefix: string;
  email: string;
  bubbleUserIdHint?: string;
}) {
  const { supabase, bucket, prefix, email, bubbleUserIdHint } = args;
  const paths = await listAllPathsDeep(supabase, bucket, prefix);
  const fileCandidates = paths.filter((p) => isDataFile(p.name)).slice().sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? "") || b.name.localeCompare(a.name));
  const pickBest = (kind: "users" | "empresas") => {
    const best =
      fileCandidates.slice().sort((a, b) => scoreFile(b, kind) - scoreFile(a, kind) || (b.updated_at ?? "").localeCompare(a.updated_at ?? "") || b.name.localeCompare(a.name))[0] ??
      null;
    if (!best) return null;
    const minScore = kind === "empresas" ? 40 : -999;
    if (scoreFile(best, kind) < minScore) return null;
    return best;
  };
  const usersFile = pickBest("users");
  const empresasFile = pickBest("empresas");

  let usersAllRows: CsvObjectRow[] = [];
  let bubbleRow: CsvObjectRow | null = null;
  let bubbleRowNorm: CsvObjectRow | null = null;
  let usersEmailRowsCount = 0;

  if (usersFile) {
    usersAllRows = await loadRowsForPath(supabase, bucket, usersFile.path, usersFile.name);
    for (const rr of usersAllRows) {
      const row = normalizeRowKeys(rr);
      if (Object.values(row).some((v) => extractEmail(String(v ?? "")))) usersEmailRowsCount++;
      const emailRaw =
        pickFirst(row, ["email", "user_email", "usuario_email", "e_mail", "mail", "login", "username"]) ||
        pickKeyLike(row, ["email", "mail", "login", "username"], ["id", "uuid"]);
      let found = emailRaw ? extractEmail(emailRaw) : null;
      if (!found) {
        for (const v of Object.values(row)) {
          found = extractEmail(String(v ?? ""));
          if (found) break;
        }
      }
      const bubbleId = pickBubbleId(row) || pickFirst(row, ["user_id", "usuario_id", "id_usuario"]);
      const id = String(bubbleId ?? "").trim();
      const hint = String(bubbleUserIdHint ?? "").trim();
      const matchesHint = Boolean(hint && id && id === hint);
      if ((found && found === email) || matchesHint) {
        bubbleRow = rr;
        bubbleRowNorm = row;
        break;
      }
    }
  }

  return { prefix, paths, usersFile, empresasFile, usersAllRows, bubbleRow, bubbleRowNorm, usersEmailRowsCount } satisfies LoadedContext;
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

    const resolved = await resolveSupabaseUser(supabase, String(userId ?? ""));
    if (!resolved.uid) return json({ ok: false, error: resolved.error ?? "user_not_found" }, { status: 400 });
    const uid = resolved.uid;
    const email = String(resolved.email ?? "").trim().toLowerCase();
    if (!email) return json({ ok: false, error: "missing_supabase_email" }, { status: 400 });

    const { data: profileDb } = await supabase
      .from("user_profiles")
      .select("user_id,bubble_user_id,email,nome,sobrenome,nome_completo,whatsapp")
      .eq("user_id", uid)
      .maybeSingle();

    const bubbleUserId = String((profileDb as any)?.bubble_user_id ?? "").trim();
    let { data: memberRows } = await supabase.from("company_members").select("company_id,role,permission_level").eq("user_id", uid).limit(50);
    if ((!memberRows || !memberRows.length) && bubbleUserId) {
      const fallback = await supabase.from("company_members").select("company_id,role,permission_level").eq("bubble_user_id", bubbleUserId).limit(50);
      memberRows = fallback.data ?? [];
    }
    const companyId = pickBestCompanyId((memberRows ?? []) as any[]);
    const membershipForCompany = (memberRows ?? []).find((r: any) => String(r?.company_id ?? "").trim() === companyId) as any;

    if (profileDb?.user_id || companyId) {
      const { data: companyDb } = companyId
        ? await supabase
            .from("companies")
            .select("id,fantasy_name,legal_name,cnpj,email,phone_e164,industry,logo_url")
            .eq("id", companyId)
            .maybeSingle()
        : { data: null as any };

      const permissionRole = isAdminMemberRow(membershipForCompany) ? "Administrador" : "Colaborador";

      const { data: companyMembers } = companyId
        ? await supabase.from("company_members").select("user_id,role,permission_level").eq("company_id", companyId).limit(500)
        : { data: [] as any[] };
      const userIds = Array.from(new Set((companyMembers ?? []).map((r: any) => String(r?.user_id ?? "").trim()).filter(Boolean)));
      const { data: memberProfiles } = userIds.length
        ? await supabase.from("user_profiles").select("user_id,email,nome,nome_completo").in("user_id", userIds)
        : { data: [] as any[] };
      const profileById = new Map<string, any>((memberProfiles ?? []).map((r: any) => [String(r?.user_id ?? ""), r]));
      const members = (companyMembers ?? []).map((m: any) => {
        const mid = String(m?.user_id ?? "").trim();
        const p = profileById.get(mid) ?? {};
        const role = isAdminMemberRow(m) ? "Administrador" : "Colaborador";
        const nomeCompleto = String(p?.nome_completo ?? p?.nomeCompleto ?? "").trim() || String(p?.nome ?? "").trim() || String(p?.email ?? "").trim() || "—";
        return { name: nomeCompleto, email: String(p?.email ?? "").trim() || "—", role, joinedAt: "", avatarUrl: "" };
      });

      return json(
        {
          ok: true,
          userId: uid,
          email: String((profileDb as any)?.email ?? email ?? "").trim(),
          nome: String((profileDb as any)?.nome ?? "").trim(),
          sobrenome: String((profileDb as any)?.sobrenome ?? "").trim(),
          nomeCompleto: String((profileDb as any)?.nome_completo ?? "").trim(),
          whatsapp: String((profileDb as any)?.whatsapp ?? "").trim(),
          avatarUrl: "",
          companyName: String(companyDb?.fantasy_name ?? companyDb?.legal_name ?? "").trim(),
          companyLogoUrl: String(companyDb?.logo_url ?? "").trim(),
          companyCnpj: String(companyDb?.cnpj ?? "").trim(),
          companyEmail: String(companyDb?.email ?? "").trim(),
          companyWhatsapp: String(companyDb?.phone_e164 ?? "").trim(),
          companyIndustry: String(companyDb?.industry ?? "").trim(),
          role: permissionRole,
          plan: null,
          members,
          source: { db: true, companyId: companyId || null },
        },
        { status: 200 },
      );
    }

    const bucket = "bubble-imports";
    await ensureBucket(supabase, bucket);
    let bubbleUserIdHint = "";
    try {
      const stateText = await downloadText(supabase, bucket, `user:${uid}/bootstrap/sync-state.json`);
      const state = JSON.parse(stateText) as any;
      const hint = String(state?.filter?.bubbleUserId ?? "").trim();
      if (hint) bubbleUserIdHint = hint;
    } catch {}
    const candidatePrefixes = Array.from(new Set([`user:${uid}`, `user:${email}`]));
    let ctx: LoadedContext | null = null;
    for (const prefix of candidatePrefixes) {
      const loaded = await loadContextForPrefix({ supabase, bucket, prefix, email, bubbleUserIdHint });
      if (loaded.bubbleRowNorm) {
        ctx = loaded;
        break;
      }
      if (!ctx) ctx = loaded;
      else if (loaded.usersEmailRowsCount > ctx.usersEmailRowsCount) ctx = loaded;
    }
    if (!ctx) return json({ ok: false, error: "no_context" }, { status: 500 });

    const paths = ctx.paths;
    const fileCandidates = paths.filter((p) => isDataFile(p.name)).slice().sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? "") || b.name.localeCompare(a.name));
    const usersFile = ctx.usersFile;
    const empresasFile = ctx.empresasFile;
    const bubbleRow = ctx.bubbleRow;
    const bubbleRowNorm = ctx.bubbleRowNorm;
    const usersAllRows = ctx.usersAllRows;

    const nameParts = bubbleRowNorm ? guessUserNameParts(bubbleRowNorm) : { first: "", last: "", full: "" };
    const whatsappRaw = bubbleRowNorm
      ? pickFirst(bubbleRowNorm, ["whatsapp", "telefone", "celular", "fone", "phone", "phone_number"]) || pickKeyLike(bubbleRowNorm, ["whatsapp", "telefone", "celular", "phone"], ["id", "uuid"])
      : "";
    const whatsapp = whatsappRaw ? normalizePhone(whatsappRaw) : "";
    const avatarUrl = bubbleRowNorm ? guessUserAvatar(bubbleRowNorm) : "";

    const bubbleUserIdToEmail = new Map<string, string>();
    const bubbleEmailToUserId = new Map<string, string>();
    for (const rr of usersAllRows) {
      const row = normalizeRowKeys(rr);
      const bubbleId = pickBubbleId(row) || pickFirst(row, ["user_id", "usuario_id", "id_usuario"]);
      const emailRaw =
        pickFirst(row, ["email", "user_email", "usuario_email", "e_mail", "mail", "login", "username"]) ||
        pickKeyLike(row, ["email", "mail", "login", "username"], ["id", "uuid"]);
      const em = emailRaw ? extractEmail(emailRaw) : null;
      const id = String(bubbleId ?? "").trim();
      if (id && em) bubbleUserIdToEmail.set(id, em);
      if (em && id) bubbleEmailToUserId.set(em, id);
    }

    const userBubbleIdRaw = bubbleRowNorm ? (pickBubbleId(bubbleRowNorm) || pickFirst(bubbleRowNorm, ["user_id", "usuario_id", "id_usuario"])) : "";
    const userBubbleId = String(userBubbleIdRaw ?? "").trim();

    const companyIdToName = new Map<string, string>();
    const companyOwnerEmailsById = new Map<string, Set<string>>();
    const companyRowNormById = new Map<string, CsvObjectRow>();
    const myCompanyIds = new Set<string>();

    if (empresasFile) {
      const rawRows = await loadRowsForPath(supabase, bucket, empresasFile.path, empresasFile.name);
      let idx = 0;
      for (const rr of rawRows) {
        idx++;
        const row = normalizeRowKeys(rr);
        const companyIdRaw = pickBubbleId(row) || pickFirst(row, ["empresa_id", "company_id", "restaurante_id", "restaurant_id", "id", "_id", "unique_id", "bubble_id"]);
        const name = guessCompanyName(row);
        const companyId = String(companyIdRaw || "").trim() || (name && name !== "—" ? `${empresasFile.path}:${idx}` : "");
        if (companyId && name && name !== "—") {
          if (!companyIdToName.has(companyId)) companyIdToName.set(companyId, name);
          if (!companyRowNormById.has(companyId)) companyRowNormById.set(companyId, row);
        }
        const ownerEmail = resolveOwnerEmailFromCompanyRow(row, bubbleUserIdToEmail);
        if (companyId && ownerEmail) {
          const set = companyOwnerEmailsById.get(companyId) ?? new Set<string>();
          set.add(ownerEmail);
          companyOwnerEmailsById.set(companyId, set);
        }
        if (companyId && ownerEmail && ownerEmail === email) myCompanyIds.add(companyId);
        if (companyId && !myCompanyIds.has(companyId) && rowMentionsUser(row, email, userBubbleId)) {
          myCompanyIds.add(companyId);
        }
      }
    }

    if (bubbleRowNorm && companyIdToName.size) {
      const knownIds = new Set(Array.from(companyIdToName.keys()).map((x) => String(x ?? "").trim()).filter(Boolean));
      const candidates: string[] = [];
      for (const k of Object.keys(bubbleRowNorm)) {
        const kk = k.toLowerCase();
        if (kk.includes("empresa") || kk.includes("company") || kk.includes("restaurante") || kk.includes("restaurant") || kk.includes("account")) {
          candidates.push(String((bubbleRowNorm as any)[k] ?? ""));
        }
      }
      for (const v of Object.values(bubbleRowNorm)) candidates.push(String(v ?? ""));
      for (const raw of candidates) {
        const s = String(raw ?? "").trim();
        if (!s || s.includes("@")) continue;
        const direct = knownIds.has(s) ? s : "";
        const extracted = direct || extractBubbleIdFromText(s);
        if (extracted && knownIds.has(extracted)) myCompanyIds.add(extracted);
      }
    }

    const knownCompanyIds = new Set(Array.from(companyIdToName.keys()).map((x) => String(x ?? "").trim()).filter(Boolean));
    const membershipEmailsByCompanyId = new Map<string, Set<string>>();
    const planByCompanyId = new Map<string, { type: string; status: string; cardLast4: string }>();
    for (const [id, row] of companyRowNormById.entries()) planByCompanyId.set(id, guessPlanFromCompanyRow(row));

    const linkCandidates = fileCandidates
      .filter((p) => isDataFile(p.name))
      .filter((p) => p.path !== usersFile?.path && p.path !== empresasFile?.path)
      .slice()
      .sort((a, b) => scoreLinkFile(b) - scoreLinkFile(a) || (b.updated_at ?? "").localeCompare(a.updated_at ?? "") || b.name.localeCompare(a.name))
      .slice(0, 30);

    for (const file of linkCandidates) {
      let rawRows: CsvObjectRow[] = [];
      try {
        rawRows = await loadRowsForPath(supabase, bucket, file.path, file.name);
      } catch {
        rawRows = [];
      }
      if (!rawRows.length) continue;
      const rows = rawRows.slice(0, 4000);
      let linked = 0;
      for (const rr of rows) {
        const rowNorm = normalizeRowKeys(rr);
        const companyId = knownCompanyIds.size ? guessCompanyIdFromRow(rowNorm, knownCompanyIds) : "";
        if (!companyId) continue;
        const em = guessMemberEmailFromRow(rowNorm, bubbleUserIdToEmail);
        if (em) {
          const set = membershipEmailsByCompanyId.get(companyId) ?? new Set<string>();
          set.add(em);
          membershipEmailsByCompanyId.set(companyId, set);
          if (em === email) myCompanyIds.add(companyId);
          linked++;
        }
        const planGuess = guessPlanFromCompanyRow(rowNorm);
        const prev = planByCompanyId.get(companyId) ?? { type: "", status: "", cardLast4: "" };
        planByCompanyId.set(companyId, {
          type: prev.type || planGuess.type,
          status: prev.status || planGuess.status,
          cardLast4: prev.cardLast4 || planGuess.cardLast4,
        });
        if (linked >= 40) break;
      }
    }

    const companies = Array.from(myCompanyIds)
      .map((id) => ({ id, name: String(companyIdToName.get(id) ?? "").trim() || "—" }))
      .filter((c) => c.name && c.name !== "—")
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" }));

    const currentCompanyId = bubbleRowNorm && knownCompanyIds.size ? guessCurrentCompanyId(bubbleRowNorm) : "";
    const primaryCompanyId = currentCompanyId && knownCompanyIds.has(currentCompanyId) ? currentCompanyId : companies[0]?.id ?? "";
    const companyName = primaryCompanyId ? String(companyIdToName.get(primaryCompanyId) ?? "").trim() : companies[0]?.name ?? "";
    const companyRowNorm = primaryCompanyId ? companyRowNormById.get(primaryCompanyId) ?? null : null;
    let companyLogoUrl = primaryCompanyId ? guessCompanyLogo(companyRowNormById.get(primaryCompanyId) ?? {}) : "";
    const companyWhatsappRaw = companyRowNorm
      ? pickFirst(companyRowNorm, ["whatsapp", "telefone", "celular", "fone", "phone_e164", "phone", "phone_number"]) ||
        pickKeyLike(companyRowNorm, ["whatsapp", "telefone", "celular", "phone"], ["id", "uuid", "cnpj", "email", "nome", "name"])
      : "";
    const companyIndustryRaw = companyRowNorm
      ? pickFirst(companyRowNorm, ["ramo", "industry", "segmento", "tipo", "categoria"]) ||
        pickKeyLike(companyRowNorm, ["ramo", "industry", "segmento"], ["id", "uuid", "cnpj", "email", "nome", "name"])
      : "";
    const companyCnpjRaw = companyRowNorm
      ? pickFirst(companyRowNorm, ["cnpj", "cpf_cnpj", "cnpj_cpf"]) || pickKeyLike(companyRowNorm, ["cnpj"], ["id", "uuid", "email", "nome", "name"])
      : "";

    let companyWhatsapp = companyWhatsappRaw ? normalizePhone(companyWhatsappRaw) : "";
    let companyIndustry = String(companyIndustryRaw ?? "").trim();
    let companyCnpj = digitsOnly(String(companyCnpjRaw ?? "").trim());
    if (companyCnpj && companyCnpj.length !== 14) companyCnpj = "";

    let role: "Administrador" | "Colaborador" = "Administrador";
    const ownerEmails = primaryCompanyId ? companyOwnerEmailsById.get(primaryCompanyId) ?? new Set<string>() : new Set<string>();
    if (email && ownerEmails.size) role = ownerEmails.has(email) ? "Administrador" : "Colaborador";

    let companyOverrides: any = null;
    try {
      const overridesRaw = await downloadText(supabase, bucket, `user:${uid}/profile/overrides.json`);
      companyOverrides = JSON.parse(overridesRaw) as any;
    } catch {}
    if (companyOverrides && typeof companyOverrides === "object") {
      if (Object.prototype.hasOwnProperty.call(companyOverrides, "companyWhatsapp")) companyWhatsapp = String(companyOverrides.companyWhatsapp ?? "");
      if (Object.prototype.hasOwnProperty.call(companyOverrides, "companyIndustry")) companyIndustry = String(companyOverrides.companyIndustry ?? "");
      if (Object.prototype.hasOwnProperty.call(companyOverrides, "companyCnpj")) companyCnpj = digitsOnly(String(companyOverrides.companyCnpj ?? ""));
      if (Object.prototype.hasOwnProperty.call(companyOverrides, "companyLogoUrl")) companyLogoUrl = String(companyOverrides.companyLogoUrl ?? "");
      if (Object.prototype.hasOwnProperty.call(companyOverrides, "role")) role = String(companyOverrides.role ?? "") === "Administrador" ? "Administrador" : role;
    }
    const plan = primaryCompanyId ? planByCompanyId.get(primaryCompanyId) ?? { type: "", status: "", cardLast4: "" } : { type: "", status: "", cardLast4: "" };

    const members: Array<{ name: string; email: string; role: "Administrador" | "Colaborador"; joinedAt: string; avatarUrl: string }> = [];
    if (usersAllRows.length) {
      const memberEmails =
        primaryCompanyId && membershipEmailsByCompanyId.get(primaryCompanyId) ? Array.from(membershipEmailsByCompanyId.get(primaryCompanyId) ?? []) : [];
      const memberEmailSet = new Set(memberEmails.map((x) => String(x ?? "").trim().toLowerCase()).filter(Boolean));
      for (const e of ownerEmails) memberEmailSet.add(String(e ?? "").trim().toLowerCase());
      if (!memberEmailSet.size && email) memberEmailSet.add(email);

      const knownIds = new Set(companies.map((c) => String(c.id ?? "").trim()).filter(Boolean));
      for (const rr of usersAllRows) {
        const rowNorm = normalizeRowKeys(rr);
        const emailRaw =
          pickFirst(rowNorm, ["email", "user_email", "usuario_email", "e_mail", "mail", "login", "username"]) ||
          pickKeyLike(rowNorm, ["email", "mail", "login", "username"], ["id", "uuid"]);
        let memberEmail = emailRaw ? extractEmail(emailRaw) : null;
        if (!memberEmail) {
          for (const v of Object.values(rowNorm)) {
            memberEmail = extractEmail(String(v ?? ""));
            if (memberEmail) break;
          }
        }
        if (!memberEmail) continue;

        let inCompany = false;
        if (memberEmailSet.size) {
          inCompany = memberEmailSet.has(memberEmail);
        } else if (knownIds.size) {
          const candidates: string[] = [];
          for (const k of Object.keys(rowNorm)) {
            const kk = k.toLowerCase();
            if (kk.includes("empresa") || kk.includes("company") || kk.includes("restaurante") || kk.includes("restaurant") || kk.includes("account")) {
              candidates.push(String((rowNorm as any)[k] ?? ""));
            }
          }
          for (const v of Object.values(rowNorm)) candidates.push(String(v ?? ""));
          for (const raw of candidates) {
            const s = String(raw ?? "").trim();
            if (!s || s.includes("@")) continue;
            const direct = knownIds.has(s) ? s : "";
            const extracted = direct || extractBubbleIdFromText(s);
            if (extracted && knownIds.has(extracted)) {
              inCompany = true;
              break;
            }
          }
        } else {
          inCompany = memberEmail === email;
        }
        if (!inCompany) continue;

        const parts = guessUserNameParts(rowNorm);
        const roleFromRow = guessRole(rowNorm);
        const role = ownerEmails.has(memberEmail) || roleFromRow === "Administrador" ? "Administrador" : "Colaborador";
        const joinedAt = guessJoinedAt(rowNorm);
        const avatar = guessUserAvatar(rowNorm);
        const displayName = String(parts.full ?? "").trim() || memberEmail;
        members.push({
          name: ownerEmails.has(memberEmail) ? `${displayName} (Proprietário)` : displayName,
          email: memberEmail,
          role,
          joinedAt,
          avatarUrl: avatar,
        });
      }
    }

    if (!members.length) {
      const displayName = String(nameParts.full ?? "").trim() || email;
      members.push({ name: displayName, email, role: "Administrador", joinedAt: "", avatarUrl });
    }

    return json({
      ok: true,
      userId: uid,
      email,
      nome: nameParts.first || "",
      sobrenome: nameParts.last || "",
      nomeCompleto: nameParts.full || "",
      whatsapp: whatsapp || "",
      avatarUrl: avatarUrl || "",
      companyName,
      companyLogoUrl,
      companyCnpj,
      companyWhatsapp,
      companyIndustry,
      role,
      companies,
      plan,
      members,
      source: {
        selectedPrefix: ctx.prefix,
        candidatePrefixes,
        usersFile: usersFile ? { path: usersFile.path, name: usersFile.name } : null,
        empresasFile: empresasFile ? { path: empresasFile.path, name: empresasFile.name } : null,
        hasBubbleMatch: Boolean(bubbleRowNorm),
        primaryCompanyId: primaryCompanyId || null,
        usersEmailRowsCount: ctx.usersEmailRowsCount,
        userBubbleId: userBubbleId || null,
      },
    });
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = (await req.json()) as unknown;
  } catch {
    return json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  try {
    const { userId } = getUserIdFromRequest(req);
    if (!userId) return json({ ok: false, error: "unauthorized" }, { status: 401 });

    let supabase: ReturnType<typeof getSupabaseAdmin>;
    try {
      supabase = getSupabaseAdmin();
    } catch {
      return json({ ok: false, error: "supabase_not_configured" }, { status: 500 });
    }

    const resolved = await resolveSupabaseUser(supabase, String(userId ?? ""));
    if (!resolved.uid) return json({ ok: false, error: resolved.error ?? "user_not_found" }, { status: 400 });
    const uid = resolved.uid;
    const emailFromAuth = String(resolved.email ?? "").trim().toLowerCase();

    const input = (body ?? {}) as any;
    const nome = typeof input.nome === "string" ? input.nome.trim() : null;
    const sobrenome = typeof input.sobrenome === "string" ? input.sobrenome.trim() : null;
    const nomeCompleto = typeof input.nomeCompleto === "string" ? input.nomeCompleto.trim() : null;
    const whatsapp = typeof input.whatsapp === "string" ? input.whatsapp.trim() : null;
    const permissao = typeof input.permissao === "string" ? input.permissao.trim() : null;

    const companyName = typeof input.companyName === "string" ? input.companyName.trim() : null;
    const companyEmail = typeof input.companyEmail === "string" ? input.companyEmail.trim() : null;
    const companyWhatsRaw = typeof input.companyWhatsapp === "string" ? input.companyWhatsapp.trim() : null;
    const companyIndustry = typeof input.companyIndustry === "string" ? input.companyIndustry.trim() : null;
    const companyCnpjRaw = typeof input.companyCnpj === "string" ? input.companyCnpj.trim() : null;
    const companyLogoUrlRaw = typeof input.companyLogoUrl === "string" ? input.companyLogoUrl.trim() : null;

    if (nome != null || sobrenome != null || nomeCompleto != null || whatsapp != null || emailFromAuth) {
      const patch: any = {};
      if (emailFromAuth) patch.email = emailFromAuth;
      if (nome != null) patch.nome = nome || null;
      if (sobrenome != null) patch.sobrenome = sobrenome || null;
      if (nomeCompleto != null) patch.nome_completo = nomeCompleto || null;
      if (whatsapp != null) patch.whatsapp = whatsapp || null;
      const up = await supabase.from("user_profiles").upsert({ user_id: uid, ...patch } as any, { onConflict: "user_id" });
      if (up.error) return json({ ok: false, error: up.error.message }, { status: 500 });
    }

    const { data: profileDb } = await supabase.from("user_profiles").select("bubble_user_id").eq("user_id", uid).maybeSingle();
    const bubbleUserId = String((profileDb as any)?.bubble_user_id ?? "").trim();
    let { data: memberRows } = await supabase.from("company_members").select("id,company_id,role,permission_level").eq("user_id", uid).limit(50);
    if ((!memberRows || !memberRows.length) && bubbleUserId) {
      const fallback = await supabase.from("company_members").select("id,company_id,role,permission_level").eq("bubble_user_id", bubbleUserId).limit(50);
      memberRows = fallback.data ?? [];
    }
    const companyId = pickBestCompanyId((memberRows ?? []) as any[]);
    const memberRow = (memberRows ?? []).find((r: any) => String(r?.company_id ?? "").trim() === companyId) as any;

    const canAdminWrite = isAdminMemberRow(memberRow);

    if (
      companyId &&
      (companyName != null || companyEmail != null || companyWhatsRaw != null || companyIndustry != null || companyCnpjRaw != null || companyLogoUrlRaw != null)
    ) {
      if (!canAdminWrite) {
      } else {
        const patch: any = {};
        if (companyName != null) {
          const nm = companyName.trim();
          patch.fantasy_name = nm || null;
          patch.legal_name = nm || null;
        }
        if (companyEmail != null) patch.email = companyEmail.trim().toLowerCase() || null;
        if (companyWhatsRaw != null) patch.phone_e164 = companyWhatsRaw ? normalizePhoneBR(companyWhatsRaw) : null;
        if (companyIndustry != null) patch.industry = companyIndustry || null;
        if (companyCnpjRaw != null) {
          const digits = digitsOnly(companyCnpjRaw);
          patch.cnpj = digits ? digits : null;
        }
        if (companyLogoUrlRaw != null) patch.logo_url = companyLogoUrlRaw ? companyLogoUrlRaw : null;
        const up = await supabase.from("companies").update(patch).eq("id", companyId);
        if (up.error) return json({ ok: false, error: up.error.message }, { status: 500 });
      }
    }

    if (companyId && permissao != null) {
      if (canAdminWrite) {
        const desiredIsAdmin = permissao.toLowerCase().includes("admin");
        const desiredRole = desiredIsAdmin ? "admin" : "member";
        const permValue = (() => {
          const raw = (memberRow as any)?.permission_level;
          if (typeof raw === "number") return desiredIsAdmin ? Math.max(1, parsePermissionLevel(raw)) : 0;
          const s = String(raw ?? "").trim();
          if (/^\d+$/.test(s)) return desiredIsAdmin ? Math.max(1, parsePermissionLevel(s)) : 0;
          return desiredIsAdmin ? "Administrador" : "Colaborador";
        })();
        const up = await supabase
          .from("company_members")
          .update({ role: desiredRole, permission_level: permValue } as any)
          .eq("id", String(memberRow?.id ?? "").trim());
        if (up.error) return json({ ok: false, error: up.error.message }, { status: 500 });
      }
    }

    if (
      canAdminWrite &&
      (companyName != null || companyWhatsRaw != null || companyIndustry != null || companyCnpjRaw != null || companyLogoUrlRaw != null || permissao != null)
    ) {
      const bucket = "bubble-imports";
      await ensureBucket(supabase, bucket);
      let prev: any = {};
      try {
        const raw = await downloadText(supabase, bucket, `user:${uid}/profile/overrides.json`);
        const parsed = JSON.parse(raw) as any;
        if (parsed && typeof parsed === "object") prev = parsed;
      } catch {}
      const next: any = { ...prev, updatedAt: new Date().toISOString() };
      if (companyName != null) next.companyName = companyName || "";
      if (companyWhatsRaw != null) next.companyWhatsapp = companyWhatsRaw ? normalizePhoneBR(companyWhatsRaw) ?? "" : "";
      if (companyIndustry != null) next.companyIndustry = companyIndustry || "";
      if (companyCnpjRaw != null) next.companyCnpj = digitsOnly(companyCnpjRaw);
      if (companyLogoUrlRaw != null) next.companyLogoUrl = companyLogoUrlRaw || "";
      if (permissao != null) next.role = permissao.toLowerCase().includes("admin") ? "Administrador" : "Colaborador";
      await uploadJson(supabase, bucket, `user:${uid}/profile/overrides.json`, next);
    }

    return json({ ok: true }, { status: 200 });
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
