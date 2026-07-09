import { NextRequest, NextResponse } from "next/server";
import { getUserIdFromRequest } from "../../../../lib/requestUserId";
import { getSupabaseAdmin } from "../../../../lib/supabaseAdmin";
import { isLocalDevRequest } from "../../../../lib/localDevRequest";
import { createHash } from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return NextResponse.json(data, { ...init, headers });
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function extractUuidFromRpcData(data: unknown) {
  if (typeof data === "string") {
    const v = data.trim();
    return isUuid(v) ? v : null;
  }
  if (Array.isArray(data)) {
    const first = (data as any[])[0];
    if (first && typeof first === "object") {
      const cand = String((first as any).id ?? (first as any).user_id ?? (first as any).userId ?? (first as any).get_auth_user_id_by_email ?? "").trim();
      return isUuid(cand) ? cand : null;
    }
    return null;
  }
  if (data && typeof data === "object") {
    const cand = String((data as any).id ?? (data as any).user_id ?? (data as any).userId ?? (data as any).get_auth_user_id_by_email ?? "").trim();
    return isUuid(cand) ? cand : null;
  }
  return null;
}

function parseCsvEnv(value: string | undefined) {
  return String(value ?? "")
    .split(/[,\n;]/g)
    .map((x) => x.trim())
    .filter(Boolean);
}

function isAdminUserId(userId: string) {
  const ids = new Set(parseCsvEnv(process.env.ADMIN_USER_IDS).map((x) => x.toLowerCase()));
  const emails = new Set(
    [...parseCsvEnv(process.env.ADMIN_USER_EMAILS), ...parseCsvEnv(process.env.ADMIN_EMAILS), ...parseCsvEnv(process.env.ADMIN_EMAILS_LEGACY)].map((x) => x.toLowerCase()),
  );
  const raw = userId.toLowerCase();
  if (!isUuid(userId) && raw.includes("@") && process.env.ADMIN_SECRET) return true;
  if (ids.size && ids.has(raw)) return true;
  if (emails.size && emails.has(raw)) return true;
  return false;
}

function safeEmail(input: unknown) {
  const v = String(input ?? "").trim().toLowerCase();
  if (!v || !v.includes("@")) return "";
  return v;
}

function normalizeConfirm(v: unknown) {
  return String(v ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ");
}

async function findAuthUserIdByEmail(supabase: ReturnType<typeof getSupabaseAdmin>, email: string) {
  const target = email.trim().toLowerCase();
  if (!target || !target.includes("@")) return null;

  try {
    const { data: p1, error: e1 } = await supabase.from("user_profiles").select("user_id,email").eq("email", target).limit(1).maybeSingle();
    if (!e1) {
      const id = String((p1 as any)?.user_id ?? "").trim();
      const em = String((p1 as any)?.email ?? "").trim().toLowerCase();
      if (id && em === target) return id;
    }
  } catch {}

  try {
    const { data: p2, error: e2 } = await supabase
      .from("bubble_obj_user_map")
      .select("email,supabase_user_id")
      .eq("email", target)
      .not("supabase_user_id", "is", null)
      .limit(1)
      .maybeSingle();
    if (!e2) {
      const em = String((p2 as any)?.email ?? "").trim().toLowerCase();
      const id = String((p2 as any)?.supabase_user_id ?? "").trim();
      if (id && isUuid(id) && em === target) return id;
    }
  } catch {}

  try {
    const { data, error } = await supabase.rpc("get_auth_user_id_by_email", { p_email: target } as any);
    if (!error) {
      const id = extractUuidFromRpcData(data);
      if (id) return id;
    }
  } catch {}

  return null;
}

async function getUserEmailFromDb(supabase: ReturnType<typeof getSupabaseAdmin>, userId: string) {
  if (!isUuid(userId)) return null;
  const { data, error } = await supabase.from("user_profiles").select("email").eq("user_id", userId).maybeSingle();
  if (error) return null;
  const email = String((data as any)?.email ?? "").trim().toLowerCase();
  return email && email.includes("@") ? email : null;
}

async function isAdminRequester(supabase: ReturnType<typeof getSupabaseAdmin>, requesterUserId: string) {
  if (isAdminUserId(requesterUserId)) return true;
  const requesterEmail = await getUserEmailFromDb(supabase, requesterUserId);
  if (!requesterEmail) return false;
  const allow = new Set(
    [...parseCsvEnv(process.env.ADMIN_USER_EMAILS), ...parseCsvEnv(process.env.ADMIN_EMAILS), ...parseCsvEnv(process.env.ADMIN_EMAILS_LEGACY)].map((x) => x.toLowerCase()),
  );
  return allow.has(requesterEmail);
}

function normalizeKey(v: unknown) {
  return String(v ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "_")
    .replace(/[^\w.]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizeText(v: unknown) {
  return String(v ?? "").replace(/\s+/g, " ").trim();
}

function normalizeLower(v: unknown) {
  return normalizeText(v).toLowerCase();
}

function normalizeNameKey(v: unknown) {
  return normalizeLower(v);
}

function pickRefPreferBubbleId(raw: any, keys: string[]) {
  const vals = keys.map((k) => (raw as any)?.[k]).filter((v) => normalizeText(v));
  for (const v of vals) {
    const t = normalizeText(v);
    if (looksLikeBubbleId(t)) return v;
  }
  return vals[0] ?? "";
}

function normalizeExternalKeyPart(v: unknown) {
  return normalizeNameKey(v).replace(/:/g, "_").slice(0, 80);
}

function normalizeNumberToken(v: unknown) {
  const n = parseNumber(v);
  return n == null ? "" : String(n);
}

function computeExternalKeyFromBaseKey(baseKey: string, raw: any) {
  const k = String(baseKey ?? "").trim().toLowerCase();
  const get = (keys: string[]) => pickAny(raw, keys);

  if (k === "categorias") {
    const nome = normalizeExternalKeyPart(get(["nome", "nome_custom_categorias", "name"]) ?? "");
    return nome ? `categoria:${nome}` : null;
  }
  if (k === "fornecedores") {
    const nome = normalizeExternalKeyPart(get(["nome", "nome_custom_fornecedores", "name"]) ?? "");
    return nome ? `fornecedor:${nome}` : null;
  }
  if (k === "notas_fiscais") {
    const fornecedor = normalizeText(get(["fornecedor_id_custom_fornecedores", "fornecedor_id", "fornecedor", "supplier", "supplier_id"]) ?? "");
    const fornecedorPart = fornecedor ? (looksLikeBubbleId(fornecedor) ? `bid_${extractBubbleId(fornecedor)}` : normalizeExternalKeyPart(fornecedor)) : "";
    const dt = parseDateOnly(get(["data_recebimento", "data_recebimento_custom_notas_fiscais", "data"])) ?? parseDateOnly(get(["data_criacao", "Created Date", "data_criacao_custom_notas_fiscais"])) ?? "";
    const datePart = normalizeExternalKeyPart(dt);
    return datePart && fornecedorPart ? `nota:${datePart}:${fornecedorPart}` : null;
  }
  if (k === "inventarios") {
    const dt = parseDateOnly(get(["data_contagem", "data_contagem_custom_inventarios", "Created Date", "created_date"])) ?? "";
    const datePart = normalizeExternalKeyPart(dt);
    return datePart ? `inventario:${datePart}` : null;
  }
  if (k === "motivos_desperdicios") {
    const nome = normalizeExternalKeyPart(get(["titulo", "titulo_custom_motivos_desperdicios", "nome", "nome_custom_motivos_desperdicios", "name", "motivo"]) ?? "");
    return nome ? `motivo:${nome}` : null;
  }
  if (k === "ingredientes") {
    const receita = normalizeText(get(["receita_id_custom_itens", "receita_id", "recipe_id", "receita", "recipe"]) ?? "");
    const receitaPart = receita ? (looksLikeBubbleId(receita) ? `bid_${extractBubbleId(receita)}` : normalizeExternalKeyPart(receita)) : "";
    const item = normalizeText(get(["item_id_custom_itens", "item_id", "item", "ingredient_item_id_custom_itens"]) ?? "");
    const itemPart = item ? (looksLikeBubbleId(item) ? `bid_${extractBubbleId(item)}` : normalizeExternalKeyPart(item)) : "";
    return receitaPart && itemPart ? `ingrediente:${receitaPart}:${itemPart}` : null;
  }
  if (k === "custo_medio_item") {
    const item = normalizeText(get(["item_id_custom_itens", "item_id", "item"]) ?? "");
    const itemPart = item ? (looksLikeBubbleId(item) ? `bid_${extractBubbleId(item)}` : normalizeExternalKeyPart(item)) : "";
    const dt = parseDateOnly(get(["data_lancamento", "data_lancamento_custom_custo_medio_item", "Created Date", "created_date"])) ?? "";
    const datePart = normalizeExternalKeyPart(dt);
    const valor = normalizeExternalKeyPart(normalizeNumberToken(get(["custo_medio", "custo_medio_custom_custo_medio_item"]) ?? ""));
    return itemPart && datePart && valor ? `custo:${itemPart}:${datePart}:${valor}` : null;
  }
  if (k === "desperdicio") {
    const dt = parseDateOnly(get(["lancamento", "lancamento_custom_desperdicio", "Created Date", "created_date"])) ?? "";
    const datePart = normalizeExternalKeyPart(dt);
    const item = normalizeText(get(["item_id_custom_itens", "item_id", "item"]) ?? "");
    const itemPart = item ? (looksLikeBubbleId(item) ? `bid_${extractBubbleId(item)}` : normalizeExternalKeyPart(item)) : "";
    const motivo = normalizeText(get(["motivo_custom_motivos_desperdicios", "motivo", "motivo_id_custom_motivos_desperdicios", "motivo_text", "motivo_text_custom_desperdicio"]) ?? "");
    const motivoPart = motivo ? (looksLikeBubbleId(motivo) ? `bid_${extractBubbleId(motivo)}` : normalizeExternalKeyPart(motivo)) : "";
    return datePart && itemPart && motivoPart ? `desperdicio:${datePart}:${itemPart}:${motivoPart}` : null;
  }

  const stable = (() => {
    try {
      const keys = Object.keys(raw ?? {}).sort();
      const parts = keys.map((k) => `${k}=${normalizeText(raw?.[k])}`);
      return `${k}|${parts.join("&")}`;
    } catch {
      return k;
    }
  })();
  const h = createHash("sha256").update(stable).digest("hex").slice(0, 24);
  return `ext:${normalizeKey(k)}:${h}`;
}

function looksLikeBubbleId(v: unknown) {
  const s = String(v ?? "").trim();
  return /\d{8,}x\d{6,}/.test(s);
}

function normalizeCnpj(v: unknown) {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const digits = s.replace(/\D/g, "");
  return digits ? digits : null;
}

function parseNumber(v: unknown) {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const s = String(v ?? "").trim();
  if (!s) return null;
  const cleaned = s.replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function parseBool(v: unknown) {
  const s = normalizeLower(v);
  if (s === "1" || s === "true" || s === "sim" || s === "yes") return true;
  if (s === "0" || s === "false" || s === "nao" || s === "não" || s === "no") return false;
  return Boolean(v);
}

function parseDateOnly(v: unknown) {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const m1 = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m1) return `${m1[1]}-${m1[2]}-${m1[3]}`;
  const m2 = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m2) return `${m2[3]}-${m2[2]}-${m2[1]}`;
  const m3 = s.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (m3) return `${m3[3]}-${m3[2]}-${m3[1]}`;
  const d = new Date(s);
  if (!Number.isFinite(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function parseTime(v: unknown) {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const d = new Date(s);
  if (!Number.isFinite(d.getTime())) {
    const dateOnly = parseDateOnly(s);
    if (!dateOnly) return null;
    const d2 = new Date(`${dateOnly}T00:00:00.000Z`);
    if (!Number.isFinite(d2.getTime())) return null;
    return d2.toISOString();
  }
  return d.toISOString();
}

function normalizeBubbleRef(value: unknown) {
  if (typeof value !== "string") return value;
  if (value.includes("__LOOKUP__")) return value.split("__LOOKUP__").pop();
  return value;
}

function normalizeRecordDeep(value: unknown) {
  const seen = new WeakMap<object, any>();
  const walk = (v: unknown, keyHint?: string): unknown => {
    const hint = String(keyHint ?? "");
    if (typeof v === "string") {
      const should = v.includes("__LOOKUP__") || normalizeKey(hint).includes("custom_");
      return should ? normalizeBubbleRef(v) : v;
    }
    if (!v || typeof v !== "object") return v;
    if (Array.isArray(v)) return v.map((it) => walk(it, hint));
    if (seen.has(v as any)) return seen.get(v as any);
    const out: any = {};
    seen.set(v as any, out);
    for (const [k, val] of Object.entries(v as any)) out[k] = walk(val, k);
    return out;
  };
  return walk(value);
}

function extractBubbleId(input: unknown) {
  if (input == null) return "";
  if (typeof input === "object") {
    const v: any = input as any;
    const direct = String(v?.unique_id ?? v?._id ?? v?.id ?? v?.bubble_id ?? "").trim();
    if (direct) return direct;
    try {
      const s = JSON.stringify(input);
      const m = s.match(/\d{8,}x\d{6,}/);
      return m ? String(m[0]).trim() : "";
    } catch {
      return "";
    }
  }
  const s = String(input ?? "").trim();
  if (!s) return "";
  if (s.includes("__LOOKUP__")) return String(normalizeBubbleRef(s) ?? "").trim();
  const m = s.match(/\d{8,}x\d{6,}/);
  return m ? String(m[0]).trim() : s;
}

function pickAny(obj: any, keys: string[]) {
  if (!obj || typeof obj !== "object") return undefined;
  for (const k of keys) {
    if (obj[k] != null) return obj[k];
  }
  const want = new Set(keys.map((k) => normalizeKey(k)));
  for (const [k, v] of Object.entries(obj)) {
    if (want.has(normalizeKey(k))) return v as any;
  }
  for (const [k, v] of Object.entries(obj)) {
    const nk = normalizeKey(k);
    for (const w of want) if (nk.includes(w) || w.includes(nk)) return v as any;
  }
  return undefined;
}

function baseTypeKeyFromNetwork(baseType: string | null) {
  const t = String(baseType ?? "").trim();
  if (!t) return "";
  const k0 = t.toLowerCase();
  const m = k0.match(/custom[._][a-z0-9_]+/);
  const k = m ? m[0] : k0.split(/[\s#@/]/, 1)[0] ?? k0;
  if (k === "user") return "user";
  if (k === "custom.empresas") return "empresas";
  if (k === "custom.categorias") return "categorias";
  if (k === "custom.itens" || k === "custom.item") return "item";
  if (k === "custom.fornecedores") return "fornecedores";
  if (k === "custom.itens_fornecedores") return "itens_fornecedores";
  if (k === "custom.notas_fiscais") return "notas_fiscais";
  if (k === "custom.itens_notas") return "itens_notas";
  if (k === "custom.inventarios") return "inventarios";
  if (k === "custom.itens_inventarios") return "itens_inventarios";
  if (k === "custom.motivos_desperdicios") return "motivos_desperdicios";
  if (k === "custom.desperdicio") return "desperdicio";
  if (k === "custom.etiquetas") return "etiquetas";
  if (k === "custom.ingredientes") return "ingredientes";
  if (k === "custom.itens_lista_compras") return "itens_lista_compras";
  if (k === "custom.qtd_compra_real") return "qtd_compra_real";
  if (k === "custom.faturamentos") return "faturamentos";
  if (k === "custom.custo_medio_item") return "custo_medio_item";
  return k;
}

function tableFromBaseKey(baseKey: string) {
  const k = String(baseKey ?? "").trim().toLowerCase();
  const m: Record<string, string> = {
    empresas: "companies",
    user: "user_profiles",
    categorias: "categories",
    item: "items",
    fornecedores: "suppliers",
    itens_fornecedores: "supplier_items",
    notas_fiscais: "invoices",
    itens_notas: "invoice_items",
    inventarios: "inventories",
    itens_inventarios: "inventory_items",
    desperdicio: "wastes",
    motivos_desperdicios: "waste_reasons",
    etiquetas: "labels",
    ingredientes: "recipe_ingredients",
    itens_lista_compras: "shopping_list_items",
    qtd_compra_real: "purchase_real_qty",
    faturamentos: "revenues",
    custo_medio_item: "avg_cost_events",
  };
  return m[k] ?? null;
}

function resolveCompanyBubbleIdFromRecord(raw: any) {
  const direct =
    extractBubbleId(pickAny(raw, ["empresa_id_custom_empresas", "empresa_id", "empresa", "company", "company_id_custom_empresas", "company_id"]) ?? "") || "";
  return String(direct ?? "").trim();
}

async function ensureBucket(supabase: ReturnType<typeof getSupabaseAdmin>, bucket: string) {
  const got = await supabase.storage.getBucket(bucket);
  if (!got.error) return;
  await supabase.storage.createBucket(bucket, { public: false }).catch(() => {});
}

async function uploadJsonLog(supabase: ReturnType<typeof getSupabaseAdmin>, bucket: string, path: string, value: any) {
  const bytes = new TextEncoder().encode(JSON.stringify(value, null, 2));
  const { error } = await supabase.storage.from(bucket).upload(path, bytes, { contentType: "application/json", upsert: true } as any);
  if (error) throw new Error(error.message);
}

async function getCompanyBubbleIdById(supabase: ReturnType<typeof getSupabaseAdmin>, companyId: string) {
  const { data, error } = await supabase.from("companies").select("id,bubble_id").eq("id", companyId).maybeSingle();
  if (error) throw new Error(error.message);
  return String((data as any)?.bubble_id ?? "").trim() || null;
}

async function getByCompanyBubbleId(supabase: ReturnType<typeof getSupabaseAdmin>, table: string, companyId: string, bubbleIds: string[]) {
  if (!bubbleIds.length) return new Map<string, string>();
  const { data, error } = await supabase.from(table).select("id,bubble_id").eq("company_id", companyId).in("bubble_id", bubbleIds);
  if (error) throw new Error(error.message);
  const map = new Map<string, string>();
  for (const r of (data ?? []) as any[]) {
    const b = String(r?.bubble_id ?? "").trim();
    const id = String(r?.id ?? "").trim();
    if (b && id) map.set(b, id);
  }
  return map;
}

async function getByCompanyExternalKey(supabase: ReturnType<typeof getSupabaseAdmin>, table: string, companyId: string, externalKeys: string[]) {
  if (!externalKeys.length) return new Map<string, string>();
  const keys = externalKeys.map((k) => String(k ?? "").trim()).filter(Boolean);
  if (!keys.length) return new Map<string, string>();
  const { data, error } = await supabase.from(table).select("id,external_key").eq("company_id", companyId).in("external_key", keys);
  if (error) throw new Error(error.message);
  const map = new Map<string, string>();
  for (const r of (data ?? []) as any[]) {
    const k = String(r?.external_key ?? "").trim();
    const id = String(r?.id ?? "").trim();
    if (k && id) map.set(k, id);
  }
  return map;
}

async function getAllByCompany(supabase: ReturnType<typeof getSupabaseAdmin>, table: string, companyId: string, select: string) {
  const out: any[] = [];
  const pageSize = 1000;
  for (let from = 0; from < 200_000; from += pageSize) {
    const { data, error } = await supabase.from(table).select(select).eq("company_id", companyId).order("id", { ascending: true }).range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as any[];
    out.push(...rows);
    if (rows.length < pageSize) break;
  }
  return out;
}

function buildUniqueIdByKey(rows: Array<{ key: string; id: string }>) {
  const temp = new Map<string, { id: string; count: number }>();
  for (const r of rows) {
    const k = String(r.key ?? "").trim().toLowerCase();
    const id = String(r.id ?? "").trim();
    if (!k || !id) continue;
    const cur = temp.get(k);
    if (!cur) temp.set(k, { id, count: 1 });
    else temp.set(k, { id: cur.id, count: cur.count + 1 });
  }
  const out = new Map<string, string>();
  for (const [k, v] of temp.entries()) {
    if (v.count === 1 && v.id) out.set(k, v.id);
  }
  return out;
}

async function upsertRows(args: {
  supabase: ReturnType<typeof getSupabaseAdmin>;
  table: string;
  rows: any[];
  onConflict: string;
  chunkSize?: number;
  existingKeys?: Set<string>;
  keyField?: string;
}) {
  const { supabase, table, rows, onConflict } = args;
  const chunkSize = typeof args.chunkSize === "number" && args.chunkSize > 0 ? args.chunkSize : 50;
  const keyField = String(args.keyField ?? "bubble_id").trim() || "bubble_id";
  const existingKeys = args.existingKeys ?? null;
  const errors: Array<{ bubble_id: string; error: string }> = [];
  let attempted = 0;
  let created = 0;
  let updated = 0;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const part = rows.slice(i, i + chunkSize);
    attempted += part.length;
    const existedCount = existingKeys ? part.filter((r) => existingKeys.has(String(r?.[keyField] ?? "").trim())).length : 0;
    const { error } = await supabase.from(table).upsert(part as any, { onConflict });
    if (error) {
      for (const row of part) errors.push({ bubble_id: String(row?.bubble_id ?? row?.external_key ?? row?.id ?? ""), error: error.message });
      continue;
    }
    updated += existedCount;
    created += part.length - existedCount;
  }
  return { attempted, created, updated, errors };
}

async function mergeExistingRaw(args: { supabase: ReturnType<typeof getSupabaseAdmin>; table: string; companyId?: string; keyField: "bubble_id" | "external_key"; keys: string[] }) {
  const { supabase, table, keyField, keys } = args;
  if (!keys.length) return new Map<string, any>();
  let q = supabase.from(table).select(`${keyField},raw`).in(keyField, keys);
  if (args.companyId) q = q.eq("company_id", args.companyId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const m = new Map<string, any>();
  for (const r of (data ?? []) as any[]) {
    const k = String((r as any)?.[keyField] ?? "").trim();
    if (!k) continue;
    m.set(k, (r as any)?.raw ?? {});
  }
  return m;
}

type NetworkRecord = {
  bubble_id: string | null;
  external_key?: string | null;
  bubble_type: string | null;
  base_type: string | null;
  raw: any;
  normalized: any;
  sources?: string[];
};

type PerTable = {
  attempted: number;
  created: number;
  updated: number;
  ignored: number;
  errors: Array<{ bubble_id: string; error: string }>;
  ignoredReasons: Record<string, number>;
  brokenRelations: number;
  brokenSamples: Array<{ bubble_id: string; relation: string; column: string; expected: string }>;
};

type IgnoredRecord = {
  bubble_id: string;
  bubble_type: string | null;
  base_type: string;
  table: string | null;
  reason: string;
  broken?: Array<{ relation: string; column: string; expected: string }> | null;
};

type BuilderResult =
  | { row: any }
  | { ignoreReason: string; broken?: Array<{ relation: string; column: string; expected: string }> }
  | null;

function perTableInit(): PerTable {
  return { attempted: 0, created: 0, updated: 0, ignored: 0, errors: [], ignoredReasons: {}, brokenRelations: 0, brokenSamples: [] };
}

function inc(map: Record<string, number>, key: string) {
  map[key] = (map[key] ?? 0) + 1;
}

function parseRelationOverrides(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    const key = String(k ?? "").trim();
    const val = typeof v === "string" ? v.trim() : "";
    if (key && val) out[key] = val;
  }
  return out;
}

function getOverride(overrides: Record<string, string>, key: string) {
  const v = overrides[key];
  return typeof v === "string" ? v.trim() : "";
}

function overrideToDbId(value: string, bubbleIdToId?: Map<string, string>) {
  const v = String(value ?? "").trim();
  if (!v) return null;
  if (v.startsWith("id:")) {
    const id = v.slice(3).trim();
    return id ? id : null;
  }
  if (v.startsWith("bubble:")) {
    const bid = v.slice(7).trim();
    if (!bid) return null;
    return bubbleIdToId?.get(bid) ?? null;
  }
  if (looksLikeBubbleId(v)) {
    const bid = extractBubbleId(v);
    return bid ? bubbleIdToId?.get(bid) ?? null : null;
  }
  if (isUuid(v)) return v;
  return null;
}

export async function POST(req: NextRequest) {
  const startedAt = new Date().toISOString();
  try {
    const isLocalDev = isLocalDevRequest(req);
    const { userId } = getUserIdFromRequest(req);
    if (!userId && !isLocalDev) return json({ ok: false, error: "unauthorized" }, { status: 401 });

    const body = (await req.json().catch(() => null)) as any;
    const email = safeEmail(body?.email);
    const companyId = String(body?.companyId ?? "").trim();
    const records = Array.isArray(body?.records) ? (body.records as NetworkRecord[]) : [];
    const progressKey = normalizeText(body?.progressKey);
    const sourceMode = normalizeText(body?.sourceMode ?? body?.mode);
    const isCsvMode = sourceMode === "bubble_csv";
    const relationOverrides = parseRelationOverrides(body?.relationOverrides ?? body?.csvRelationOverrides ?? body?.overrides);
    if (!email) return json({ ok: false, error: "invalid_email" }, { status: 400 });
    if (!companyId) return json({ ok: false, error: "missing_company_id" }, { status: 400 });
    if (!records.length) return json({ ok: false, error: "missing_records" }, { status: 400 });

    let supabase: ReturnType<typeof getSupabaseAdmin>;
    try {
      supabase = getSupabaseAdmin();
    } catch {
      return json({ ok: false, error: "supabase_not_configured" }, { status: 500 });
    }

    const requesterId = String(userId ?? "").trim();
    let selfOk = false;
    let adminOk = false;
    if (isLocalDev) {
      adminOk = true;
    } else {
      const requesterEmail = await getUserEmailFromDb(supabase, requesterId);
      selfOk = isUuid(requesterId) && requesterEmail === email;
      adminOk = await isAdminRequester(supabase, requesterId);
      if (!selfOk && !adminOk) return json({ ok: false, error: "forbidden" }, { status: 403 });
    }

    let targetUserId: string | null = selfOk ? requesterId : await findAuthUserIdByEmail(supabase, email);
    if (!targetUserId && !(isLocalDev && isCsvMode)) return json({ ok: false, error: "user_not_found" }, { status: 404 });

    if (!adminOk && targetUserId) {
      const { data: memberRows, error: memberErr } = await supabase
        .from("company_members")
        .select("company_id")
        .eq("user_id", targetUserId)
        .eq("company_id", companyId)
        .limit(1);
      if (memberErr) return json({ ok: false, error: memberErr.message }, { status: 500 });
      if (!(memberRows ?? [])[0]) return json({ ok: false, error: "company_not_linked_to_user" }, { status: 400 });
    }

    const selectedCompanyBubbleId = await getCompanyBubbleIdById(supabase, companyId);

    const byBaseType: Record<string, NetworkRecord[]> = {};
    const ignoredRecords: IgnoredRecord[] = [];
    const pushIgnored = (it: IgnoredRecord) => {
      ignoredRecords.push(it);
    };
    const allowedBaseKeysCsv = new Set([
      "empresas",
      "categorias",
      "item",
      "fornecedores",
      "etiquetas",
      "notas_fiscais",
      "itens_notas",
      "inventarios",
      "itens_inventarios",
      "motivos_desperdicios",
      "desperdicio",
      "ingredientes",
      "custo_medio_item",
    ]);
    for (const r0 of records) {
      const bubble_id = String(r0?.bubble_id ?? "").trim();
      const external_key0 = String((r0 as any)?.external_key ?? "").trim();
      const bubble_type = (r0 as any)?.bubble_type != null ? String((r0 as any)?.bubble_type) : null;
      const base_type = String(r0?.base_type ?? "").trim();
      const baseKey = baseTypeKeyFromNetwork(base_type);
      if (!baseKey) {
        pushIgnored({ bubble_id: bubble_id || external_key0 || "-", bubble_type, base_type: base_type || "-", table: null, reason: "missing_type", broken: null });
        continue;
      }
      if (isCsvMode && !allowedBaseKeysCsv.has(baseKey)) {
        pushIgnored({ bubble_id: bubble_id || external_key0 || "-", bubble_type, base_type: baseKey, table: null, reason: "type_not_allowed_in_csv_migration", broken: null });
        continue;
      }
      const table = tableFromBaseKey(baseKey);
      if (!table) {
        pushIgnored({ bubble_id: bubble_id || external_key0 || "-", bubble_type, base_type: baseKey, table: null, reason: "unsupported_type", broken: null });
        continue;
      }
      const normalized = normalizeRecordDeep((r0 as any)?.normalized ?? (r0 as any)?.raw ?? {});
      const external_key = bubble_id ? "" : external_key0 || computeExternalKeyFromBaseKey(baseKey, normalized) || "";
      if (!bubble_id && !external_key) {
        pushIgnored({ bubble_id: "-", bubble_type, base_type: baseKey, table, reason: "missing_key", broken: null });
        continue;
      }
      const companyBubbleIdFromRecord = resolveCompanyBubbleIdFromRecord(normalized);
      if (
        selectedCompanyBubbleId &&
        companyBubbleIdFromRecord &&
        looksLikeBubbleId(companyBubbleIdFromRecord) &&
        companyBubbleIdFromRecord !== selectedCompanyBubbleId &&
        baseKey !== "empresas"
      ) {
        pushIgnored({ bubble_id: bubble_id || external_key || "-", bubble_type, base_type: baseKey, table, reason: "company_mismatch", broken: null });
        continue;
      }
      const row: NetworkRecord = {
        bubble_id: bubble_id || null,
        external_key: bubble_id ? null : external_key,
        bubble_type: r0?.bubble_type ?? null,
        base_type: r0?.base_type ?? null,
        raw: (r0 as any)?.raw ?? (r0 as any)?.normalized ?? {},
        normalized,
        sources: Array.isArray((r0 as any)?.sources) ? (r0 as any).sources : [],
      };
      const list = byBaseType[baseKey] ?? [];
      list.push(row);
      byBaseType[baseKey] = list;
    }

    const report: any = {
      ok: true,
      mode: isCsvMode ? "bubble_csv" : "bubble_network_json",
      email,
      companyId,
      userId: targetUserId,
      startedAt,
      finishedAt: "",
      totals: { processed: 0, created: 0, updated: 0, ignored: ignoredRecords.length, errors: 0, brokenRelations: 0 },
      perTable: {} as Record<string, PerTable>,
      ignoredSamples: ignoredRecords.slice(0, 50).map((x) => ({ bubble_id: x.bubble_id, base_type: x.base_type, reason: x.reason })),
      ignoredRecords,
      links: [
        { label: "Insumos", href: "/insumos?source=compat" },
        { label: "Fornecedores", href: "/fornecedores?source=compat" },
        { label: "Entradas", href: "/entradas?source=compat" },
        { label: "Inventário", href: "/inventario?source=compat" },
        { label: "Desperdícios", href: "/desperdicios?source=compat" },
        { label: "Lista de Compras", href: "/lista-de-compras?source=compat" },
        { label: "Fichas Técnicas", href: "/fichas-tecnicas?source=compat" },
      ],
      audit: { bucket: "admin-importacao-manual", path: "" },
    };

    const progressEnabled = Boolean(progressKey);
    const progressBucket = "admin-importacao-manual";
    const progressPath = progressEnabled ? `sessions/csv/${normalizeLower(email)}/${companyId}/progress/${progressKey}.json` : "";
    if (progressEnabled) await ensureBucket(supabase, progressBucket);
    const updateProgress = async (phase: string, table?: string) => {
      if (!progressEnabled) return;
      const payload = {
        ok: true,
        mode: "bubble_csv",
        phase,
        table: table || "",
        email,
        companyId,
        updatedAt: new Date().toISOString(),
        totals: report.totals,
        perTable: report.perTable,
        ignored: ignoredRecords.length,
      };
      await uploadJsonLog(supabase, progressBucket, progressPath, payload);
    };
    await updateProgress("started");

    const ensurePerTable = (table: string) => {
      if (!report.perTable[table]) report.perTable[table] = perTableInit();
      return report.perTable[table] as PerTable;
    };

    type UpsertKey = { bubbleId: string | null; externalKey: string | null; display: string };

    const applyCompanyScopedByUpsertKey = async (table: string, baseKey: string, builder: (raw: any, key: UpsertKey) => BuilderResult) => {
      const srcRows = byBaseType[baseKey] ?? [];
      const pt = ensurePerTable(table);
      const toUpsert: any[] = [];
      for (const r of srcRows) {
        const bubbleId = String(r.bubble_id ?? "").trim();
        const base_type = String(r.base_type ?? r.bubble_type ?? baseKey ?? "").trim() || baseKey;
        const raw = r.normalized ?? {};
        const externalKey = bubbleId ? "" : String((r as any)?.external_key ?? "").trim() || computeExternalKeyFromBaseKey(baseKey, raw) || "";
        const display = bubbleId || externalKey || "-";
        if (!bubbleId && !externalKey) {
          pt.ignored += 1;
          inc(pt.ignoredReasons, "missing_key");
          pushIgnored({ bubble_id: "-", bubble_type: r.bubble_type ?? null, base_type, table, reason: "missing_key", broken: null });
          continue;
        }
        try {
          const built = builder(raw, { bubbleId: bubbleId || null, externalKey: bubbleId ? null : externalKey || null, display });
          if (!built) {
            pt.ignored += 1;
            inc(pt.ignoredReasons, "builder_returned_null");
            pushIgnored({ bubble_id: display, bubble_type: r.bubble_type ?? null, base_type, table, reason: "builder_returned_null", broken: null });
            continue;
          }
          if ("ignoreReason" in built) {
            pt.ignored += 1;
            inc(pt.ignoredReasons, built.ignoreReason);
            if (Array.isArray(built.broken) && built.broken.length) {
              pt.brokenRelations += built.broken.length;
              for (const b of built.broken) {
                if (pt.brokenSamples.length < 25) pt.brokenSamples.push({ bubble_id: display, relation: b.relation, column: b.column, expected: b.expected });
              }
            }
            pushIgnored({ bubble_id: display, bubble_type: r.bubble_type ?? null, base_type, table, reason: built.ignoreReason, broken: built.broken ?? null });
            continue;
          }
          const row = built.row ?? {};
          row.bubble_id = bubbleId || null;
          row.external_key = bubbleId ? null : externalKey || null;
          toUpsert.push(row);
        } catch (err) {
          pt.errors.push({ bubble_id: display, error: err instanceof Error ? err.message : String(err) });
        }
      }

      const bubbleRows = toUpsert.filter((r) => String(r?.bubble_id ?? "").trim());
      const externalRows = toUpsert.filter((r) => !String(r?.bubble_id ?? "").trim() && String(r?.external_key ?? "").trim());

      if (bubbleRows.length) {
        const bubbleIds = bubbleRows.map((r) => String(r?.bubble_id ?? "").trim()).filter(Boolean);
        const existingRawByBubbleId = await mergeExistingRaw({ supabase, table, companyId, keyField: "bubble_id", keys: bubbleIds });
        const existing = new Set(existingRawByBubbleId.keys());
        for (const row of bubbleRows) {
          const b = String(row?.bubble_id ?? "").trim();
          const prev = b ? existingRawByBubbleId.get(b) ?? {} : {};
          row.raw = { ...(prev ?? {}), ...(row.raw ?? {}) };
        }
        const res = await upsertRows({ supabase, table, rows: bubbleRows, onConflict: "company_id,bubble_id", existingKeys: existing, keyField: "bubble_id" });
        pt.attempted += res.attempted;
        pt.created += res.created;
        pt.updated += res.updated;
        pt.errors.push(...res.errors);
      }

      if (externalRows.length) {
        const externalKeys = externalRows.map((r) => String(r?.external_key ?? "").trim()).filter(Boolean);
        const existingRawByExternalKey = await mergeExistingRaw({ supabase, table, companyId, keyField: "external_key", keys: externalKeys });
        const existing = new Set(existingRawByExternalKey.keys());
        for (const row of externalRows) {
          const k = String(row?.external_key ?? "").trim();
          const prev = k ? existingRawByExternalKey.get(k) ?? {} : {};
          row.raw = { ...(prev ?? {}), ...(row.raw ?? {}) };
        }
        const res = await upsertRows({ supabase, table, rows: externalRows, onConflict: "company_id,external_key", existingKeys: existing, keyField: "external_key" });
        pt.attempted += res.attempted;
        pt.created += res.created;
        pt.updated += res.updated;
        pt.errors.push(...res.errors);
      }
    };

    const applyCompanyScopedByBubbleId = async (table: string, baseKey: string, builder: (raw: any, bubbleId: string) => BuilderResult) => {
      return applyCompanyScopedByUpsertKey(table, baseKey, (raw, key) => {
        const bubbleId = String(key?.bubbleId ?? "").trim();
        if (!bubbleId) return { ignoreReason: "missing_bubble_id" };
        return builder(raw, bubbleId);
      });
    };

    await updateProgress("applying", "companies");
    if (byBaseType["empresas"]?.length) {
      const table = "companies";
      const pt = ensurePerTable(table);
      const toUpsert: any[] = [];
      for (const r of byBaseType["empresas"] ?? []) {
        const bubbleId = String(r.bubble_id ?? "").trim();
        const raw = r.normalized ?? {};
        const externalKey = bubbleId ? "" : String((r as any)?.external_key ?? "").trim() || computeExternalKeyFromBaseKey("empresas", raw) || "";
        const display = bubbleId || externalKey || "-";
        if (!bubbleId && !externalKey) {
          pt.ignored += 1;
          inc(pt.ignoredReasons, "missing_key");
          pushIgnored({ bubble_id: "-", bubble_type: r.bubble_type ?? null, base_type: "empresas", table, reason: "missing_key" });
          continue;
        }
        const cnpj = normalizeCnpj(pickAny(raw, ["cnpj_custom_empresas", "cnpj", "CNPJ"]));
        const em = normalizeLower(pickAny(raw, ["email_custom_empresas", "email"]));
        const phone = normalizeText(pickAny(raw, ["whatsapp_custom_empresas", "whatsapp", "phone"]));
        const nome = normalizeText(pickAny(raw, ["nome_custom_empresas", "nome", "name"])) || "Empresa";
        const metaCmv = parseNumber(pickAny(raw, ["meta_cmv_custom_empresas", "meta_cmv"]));
        const planCode = normalizeText(pickAny(raw, ["plano_custom_empresas", "plano"])) || null;
        const planStatus = normalizeText(pickAny(raw, ["status_plano_custom_empresas", "status_plano"])) || null;
        toUpsert.push({
          bubble_id: bubbleId || null,
          external_key: bubbleId ? null : externalKey || null,
          fantasy_name: nome,
          legal_name: nome,
          cnpj: cnpj || null,
          email: em || null,
          phone_e164: phone || null,
          meta_cmv: metaCmv,
          plan_code: planCode,
          plan_status: planStatus,
          created_by_user_id: targetUserId,
          raw: { bubble: r.raw ?? {}, bubble_normalized: raw },
        });
      }
      const bubbleRows = toUpsert.filter((r) => String(r?.bubble_id ?? "").trim());
      const externalRows = toUpsert.filter((r) => !String(r?.bubble_id ?? "").trim() && String(r?.external_key ?? "").trim());

      if (bubbleRows.length) {
        const bubbleIds = bubbleRows.map((r) => String(r?.bubble_id ?? "").trim()).filter(Boolean);
        const existingRawByBubbleId = await mergeExistingRaw({ supabase, table, keyField: "bubble_id", keys: bubbleIds });
        const existing = new Set(existingRawByBubbleId.keys());
        for (const row of bubbleRows) {
          const b = String(row?.bubble_id ?? "").trim();
          const prev = b ? existingRawByBubbleId.get(b) ?? {} : {};
          row.raw = { ...(prev ?? {}), ...(row.raw ?? {}) };
        }
        const res = await upsertRows({ supabase, table, rows: bubbleRows, onConflict: "bubble_id", existingKeys: existing, keyField: "bubble_id" });
        pt.attempted += res.attempted;
        pt.created += res.created;
        pt.updated += res.updated;
        pt.errors.push(...res.errors);
      }

      if (externalRows.length) {
        const externalKeys = externalRows.map((r) => String(r?.external_key ?? "").trim()).filter(Boolean);
        const existingRawByExternalKey = await mergeExistingRaw({ supabase, table, keyField: "external_key", keys: externalKeys });
        const existing = new Set(existingRawByExternalKey.keys());
        for (const row of externalRows) {
          const k = String(row?.external_key ?? "").trim();
          const prev = k ? existingRawByExternalKey.get(k) ?? {} : {};
          row.raw = { ...(prev ?? {}), ...(row.raw ?? {}) };
        }
        const res = await upsertRows({ supabase, table, rows: externalRows, onConflict: "external_key", existingKeys: existing, keyField: "external_key" });
        pt.attempted += res.attempted;
        pt.created += res.created;
        pt.updated += res.updated;
        pt.errors.push(...res.errors);
      }
    }
    await updateProgress("done", "companies");

    if (!isCsvMode && byBaseType["user"]?.length) {
      const profileTable = "user_profiles";
      const pt = ensurePerTable(profileTable);
      const userRow = byBaseType["user"]?.find((r) => String(r.bubble_id ?? "").trim()) ?? null;
      if (userRow) {
        const bubbleUserId = String(userRow.bubble_id ?? "").trim();
        const raw = userRow.normalized ?? {};
        const nome = normalizeText(pickAny(raw, ["nome", "nome_custom_user", "first_name", "Nome"]));
        const sobrenome = normalizeText(pickAny(raw, ["sobrenome", "last_name", "Sobrenome"]));
        const nomeCompleto = normalizeText(pickAny(raw, ["nome_completo", "nome completo", "full_name"]));
        const whatsapp = normalizeText(pickAny(raw, ["whatsapp", "phone"]));
        const proprietarioEmpresa = parseBool(pickAny(raw, ["proprietario_empresa", "proprietario"]));
        const nivelPermissao = normalizeText(pickAny(raw, ["nivel_permissao", "nivel", "permission"])) || null;
        const mergedRaw = { bubble: userRow.raw ?? {}, bubble_normalized: raw };
        const { data: existing, error: exErr } = await supabase.from(profileTable).select("id,raw").eq("user_id", targetUserId).maybeSingle();
        if (exErr) throw new Error(exErr.message);
        const prevRaw = (existing as any)?.raw ?? {};
        const payload = {
          user_id: targetUserId,
          bubble_user_id: bubbleUserId,
          email,
          nome: nome || null,
          sobrenome: sobrenome || null,
          nome_completo: nomeCompleto || null,
          whatsapp: whatsapp || null,
          proprietario_empresa: proprietarioEmpresa,
          nivel_permissao: nivelPermissao,
          raw: { ...(prevRaw ?? {}), ...(mergedRaw ?? {}) },
        };
        const existed = Boolean((existing as any)?.id);
        const { error } = await supabase.from(profileTable).upsert(payload as any, { onConflict: "user_id" });
        if (error) pt.errors.push({ bubble_id: bubbleUserId, error: error.message });
        else {
          pt.attempted += 1;
          if (existed) pt.updated += 1;
          else pt.created += 1;
        }

        const membersTable = ensurePerTable("company_members");
        const role = proprietarioEmpresa ? "owner" : "member";
        const permissionLevel = (() => {
          const n = parseNumber(nivelPermissao);
          return typeof n === "number" && Number.isFinite(n) ? Math.trunc(n) : null;
        })();
        const { data: memExisting, error: memErr } = await supabase
          .from("company_members")
          .select("id,raw")
          .eq("company_id", companyId)
          .eq("user_id", targetUserId)
          .maybeSingle();
        if (memErr) throw new Error(memErr.message);
        const prevMemRaw = (memExisting as any)?.raw ?? {};
        const memPayload = {
          company_id: companyId,
          user_id: targetUserId,
          role,
          permission_level: permissionLevel,
          bubble_user_id: bubbleUserId,
          raw: { ...(prevMemRaw ?? {}), bubble: mergedRaw },
        };
        const memExisted = Boolean((memExisting as any)?.id);
        const { error: upErr } = await supabase.from("company_members").upsert(memPayload as any, { onConflict: "company_id,user_id" });
        if (upErr) membersTable.errors.push({ bubble_id: bubbleUserId, error: upErr.message });
        else {
          membersTable.attempted += 1;
          if (memExisted) membersTable.updated += 1;
          else membersTable.created += 1;
        }
      }
    }

    await updateProgress("applying", "categories");
    await applyCompanyScopedByUpsertKey("categories", "categorias", (raw, key) => {
      const name = normalizeText(pickAny(raw, ["nome", "nome_custom_categorias", "name"])) || "Sem categoria";
      return { row: { company_id: companyId, bubble_id: key.bubbleId, external_key: key.externalKey, name, created_by_user_id: targetUserId, raw: { bubble: raw } } };
    });
    await updateProgress("done", "categories");

    const categoriesBubbleIds = (byBaseType["categorias"] ?? []).map((r) => String(r.bubble_id ?? "").trim()).filter(Boolean);
    const categoryIdByBubbleId = await getByCompanyBubbleId(supabase, "categories", companyId, categoriesBubbleIds);
    const categoryIdByName = buildUniqueIdByKey(
      (await getAllByCompany(supabase, "categories", companyId, "id,name")).map((r) => ({
        key: normalizeNameKey((r as any)?.name ?? ""),
        id: String((r as any)?.id ?? ""),
      })),
    );
    const defaultCategoryName = "Sem categoria";
    const defaultCategoryExternalKey = "category:default:sem_categoria";
    let defaultCategoryId = categoryIdByName.get(normalizeNameKey(defaultCategoryName)) ?? null;
    if (!defaultCategoryId) {
      await upsertRows({
        supabase,
        table: "categories",
        rows: [
          {
            company_id: companyId,
            bubble_id: null,
            external_key: defaultCategoryExternalKey,
            name: defaultCategoryName,
            created_by_user_id: targetUserId,
            raw: { system: { default: true } },
          },
        ],
        onConflict: "company_id,external_key",
      });
      const found = await getByCompanyExternalKey(supabase, "categories", companyId, [defaultCategoryExternalKey]);
      defaultCategoryId = found.get(defaultCategoryExternalKey) ?? null;
      if (defaultCategoryId) categoryIdByName.set(normalizeNameKey(defaultCategoryName), defaultCategoryId);
    }

    await updateProgress("applying", "items");
    await applyCompanyScopedByUpsertKey("items", "item", (raw, key) => {
      const catRaw = pickRefPreferBubbleId(raw, ["categoria_id_custom_categorias", "categoria_id", "category_id_custom_categorias", "categoria", "category"]);
      const catText = normalizeText(catRaw);
      const categoriaBubbleId = looksLikeBubbleId(catText) ? extractBubbleId(catRaw) : "";
      const catNameKey = catText ? normalizeNameKey(catText) : "";
      const categoryId = (() => {
        if (categoriaBubbleId) return categoryIdByBubbleId.get(categoriaBubbleId) ?? null;
        if (!catText) return defaultCategoryId;
        const overrideKey = `categories:name:${catNameKey}`;
        const override = getOverride(relationOverrides, overrideKey);
        const overrideId = override ? overrideToDbId(override, categoryIdByBubbleId) : null;
        if (overrideId) return overrideId;
        return categoryIdByName.get(catNameKey) ?? null;
      })();
      if (!categoryId) {
        if (categoriaBubbleId && !categoryId) {
          return {
            ignoreReason: "category_bubble_id_not_found",
            broken: [{ relation: "category", column: "categoria_id_custom_categorias", expected: categoriaBubbleId }],
          };
        }
        return {
          ignoreReason: "missing_category_relation",
          broken: [{ relation: "category", column: "categoria_id_custom_categorias", expected: catText || "-" }],
        };
      }
      return {
        row: {
          company_id: companyId,
          bubble_id: key.bubbleId,
          external_key: key.externalKey,
          name: normalizeText(pickAny(raw, ["nome", "nome_custom_itens", "name"])) || "Item",
          descricao: normalizeText(pickAny(raw, ["descricao", "descricao_custom_itens"])) || "",
          modo_preparo: normalizeText(pickAny(raw, ["modo_preparo", "modo_preparo_custom_itens"])) || "",
          rendimento: parseNumber(pickAny(raw, ["rendimento", "rendimento_custom_itens"])),
          custo_medio: parseNumber(pickAny(raw, ["custo_medio", "custo_medio_custom_itens"])),
          validade_data: parseDateOnly(pickAny(raw, ["validade_data", "validade_data_custom_itens"])),
          validade_dias:
            pickAny(raw, ["validade_dias", "validade_dias_custom_itens"]) != null
              ? Math.trunc(Number(parseNumber(pickAny(raw, ["validade_dias", "validade_dias_custom_itens"])) ?? 0))
              : null,
          cmv_desejado: parseNumber(pickAny(raw, ["cmv_desejado", "cmv_desejado_custom_itens"])),
          dias_estoque_minimo: parseNumber(pickAny(raw, ["dias_estoque_minimo", "dias_estoque_minimo_custom_itens"])),
          ocultar_cmv: parseBool(pickAny(raw, ["boolean_ocultar_cmv", "boolean_ocultar_cmv_custom_itens", "ocultar_cmv"])),
          item_receita: parseBool(pickAny(raw, ["boolean_item_receita", "boolean_item_receita_custom_itens"])),
          item_do_cardapio: parseBool(pickAny(raw, ["boolean_item_do_cardapio", "boolean_item_do_cardapio_custom_itens"])),
          preco_venda_total: parseNumber(pickAny(raw, ["preco_venda_total", "preco_venda_total_custom_itens"])),
          custo_total_receita: parseNumber(pickAny(raw, ["custo_total_receita", "custo_total_receita_custom_itens"])),
          dias_prazo_fornecedor:
            pickAny(raw, ["dias_prazo_fornecedor", "dias_prazo_fornecedor_custom_itens"]) != null
              ? Math.trunc(Number(parseNumber(pickAny(raw, ["dias_prazo_fornecedor", "dias_prazo_fornecedor_custom_itens"])) ?? 0))
              : null,
          dias_total_estoque_minimo:
            pickAny(raw, ["dias_total_estoque_minimo", "dias_total_estoque_minimo_custom_itens"]) != null
              ? Math.trunc(Number(parseNumber(pickAny(raw, ["dias_total_estoque_minimo", "dias_total_estoque_minimo_custom_itens"])) ?? 0))
              : null,
          popularidade: normalizeText(pickAny(raw, ["popularidade", "popularidade_custom_itens"])) || null,
          quadrante_ficha_tecnica: normalizeText(pickAny(raw, ["quadrante_ficha_tecnica", "quadrante_ficha_tecnica_custom_itens"])) || null,
          unidade_medida: normalizeText(pickAny(raw, ["unidade_medida", "unidade_medida_custom_itens"])) || null,
          category_id: categoryId,
          created_by_user_id: targetUserId,
          raw: { bubble: raw },
        },
      };
    });
    await updateProgress("done", "items");

    const itemsBubbleIds = (byBaseType["item"] ?? []).map((r) => String(r.bubble_id ?? "").trim()).filter(Boolean);
    const itemIdByBubbleId = await getByCompanyBubbleId(supabase, "items", companyId, itemsBubbleIds);
    const itemIdByName = buildUniqueIdByKey(
      (await getAllByCompany(supabase, "items", companyId, "id,name")).map((r) => ({
        key: normalizeNameKey((r as any)?.name ?? ""),
        id: String((r as any)?.id ?? ""),
      })),
    );
    let labelIdByBubbleId = new Map<string, string>();

    await updateProgress("applying", "suppliers");
    await applyCompanyScopedByUpsertKey("suppliers", "fornecedores", (raw, key) => {
      return {
        row: {
          company_id: companyId,
          bubble_id: key.bubbleId,
          external_key: key.externalKey,
          nome: normalizeText(pickAny(raw, ["nome", "nome_custom_fornecedores"])) || "",
          endereco: normalizeText(pickAny(raw, ["endereco", "endereco_custom_fornecedores"])) || "",
          vendedor: normalizeText(pickAny(raw, ["vendedor", "vendedor_custom_fornecedores"])) || "",
          whatsapp: normalizeText(pickAny(raw, ["whatsapp", "whatsapp_custom_fornecedores"])) || "",
          created_by_user_id: targetUserId,
          raw: { bubble: raw },
        },
      };
    });
    await updateProgress("done", "suppliers");

    const suppliersBubbleIds = (byBaseType["fornecedores"] ?? []).map((r) => String(r.bubble_id ?? "").trim()).filter(Boolean);
    const supplierIdByBubbleId = await getByCompanyBubbleId(supabase, "suppliers", companyId, suppliersBubbleIds);
    const supplierIdByName = buildUniqueIdByKey(
      (await getAllByCompany(supabase, "suppliers", companyId, "id,nome")).map((r) => ({
        key: normalizeNameKey((r as any)?.nome ?? ""),
        id: String((r as any)?.id ?? ""),
      })),
    );
    const defaultSupplierName = "Sem fornecedor";
    const defaultSupplierExternalKey = "supplier:default:sem_fornecedor";
    let defaultSupplierId = supplierIdByName.get(normalizeNameKey(defaultSupplierName)) ?? null;
    if (!defaultSupplierId) {
      await upsertRows({
        supabase,
        table: "suppliers",
        rows: [
          {
            company_id: companyId,
            bubble_id: null,
            external_key: defaultSupplierExternalKey,
            nome: defaultSupplierName,
            created_by_user_id: targetUserId,
            raw: { system: { default: true } },
          },
        ],
        onConflict: "company_id,external_key",
      });
      const found = await getByCompanyExternalKey(supabase, "suppliers", companyId, [defaultSupplierExternalKey]);
      defaultSupplierId = found.get(defaultSupplierExternalKey) ?? null;
      if (defaultSupplierId) supplierIdByName.set(normalizeNameKey(defaultSupplierName), defaultSupplierId);
    }

    await updateProgress("applying", "labels");
    await applyCompanyScopedByUpsertKey("labels", "etiquetas", (raw, key) => {
      const itemRefRaw = pickAny(raw, ["item_id_custom_itens", "item_id"]) ?? "";
      const itemRefText = normalizeText(itemRefRaw);
      const itemBubbleId = looksLikeBubbleId(itemRefText) ? extractBubbleId(itemRefRaw) : "";
      const itemId = (() => {
        if (itemBubbleId) return itemIdByBubbleId.get(itemBubbleId) ?? null;
        if (!itemRefText) return null;
        return itemIdByName.get(normalizeNameKey(itemRefText)) ?? null;
      })();
      return {
        row: {
          company_id: companyId,
          bubble_id: key.bubbleId,
          external_key: key.externalKey,
          codigo: normalizeText(pickAny(raw, ["codigo", "codigo_custom_etiquetas"])) || "",
          item_nome: normalizeText(pickAny(raw, ["item_nome", "item_nome_custom_etiquetas"])) || "",
          data_criacao_log: parseTime(pickAny(raw, ["data_criacao_log", "data_criacao_log_custom_etiquetas", "Created Date"])),
          data_producao: parseDateOnly(pickAny(raw, ["data_producao", "data_producao_custom_etiquetas"])),
          data_validade: parseDateOnly(pickAny(raw, ["data_validade", "data_validade_custom_etiquetas"])),
          boolean_desperdicado: parseBool(pickAny(raw, ["boolean_desperdiçado", "boolean_desperdicado", "boolean_desperdicado_custom_etiquetas"])),
          dias_validade: parseNumber(pickAny(raw, ["dias_validade", "dias_validade_custom_etiquetas"])),
          item_id: itemId,
          boolean_baixa_vencimento: parseBool(pickAny(raw, ["boolean_baixa_vencimento", "boolean_baixa_vencimento_custom_etiquetas"])),
          quantidade_produzida: parseNumber(pickAny(raw, ["quantidade_produzida", "quantidade_produzida_custom_etiquetas"])),
          responsavel_nome_completo: normalizeText(pickAny(raw, ["responsavel_nome_completo", "responsavel_nome_completo_custom_etiquetas"])) || "",
          created_by_user_id: targetUserId,
          raw: { bubble: raw },
        },
      };
    });

    {
      const labelsBubbleIds = (byBaseType["etiquetas"] ?? []).map((r) => String(r.bubble_id ?? "").trim()).filter(Boolean);
      labelIdByBubbleId = await getByCompanyBubbleId(supabase, "labels", companyId, labelsBubbleIds);
    }
    await updateProgress("done", "labels");

    if (!isCsvMode && (byBaseType["itens_fornecedores"] ?? []).length) {
      const table = "supplier_items";
      const pt = ensurePerTable(table);
      const srcRows = byBaseType["itens_fornecedores"] ?? [];
      const toUpsert: any[] = [];
      for (const r of srcRows) {
        const bubbleId = String(r.bubble_id ?? "").trim();
        if (!bubbleId) {
          pt.ignored += 1;
          inc(pt.ignoredReasons, "missing_bubble_id");
          pushIgnored({ bubble_id: "-", bubble_type: r.bubble_type ?? null, base_type: String(r.base_type ?? r.bubble_type ?? "itens_fornecedores"), table, reason: "missing_bubble_id" });
          continue;
        }
        const raw = r.normalized ?? {};
        const supplierRefRaw = pickAny(raw, ["fornecedor_id_custom_fornecedores", "fornecedor_id", "fornecedor"]) ?? "";
        const supplierRefText = normalizeText(supplierRefRaw);
        const supplierBubbleId = looksLikeBubbleId(supplierRefText) ? extractBubbleId(supplierRefRaw) : "";
        const supplierId = (() => {
          if (supplierBubbleId) return supplierIdByBubbleId.get(supplierBubbleId) ?? null;
          if (!supplierRefText) return null;
          return supplierIdByName.get(normalizeNameKey(supplierRefText)) ?? null;
        })();

        const itemRefRaw = pickAny(raw, ["item_id_custom_itens", "item_id", "item"]) ?? "";
        const itemRefText = normalizeText(itemRefRaw);
        const itemBubbleId = looksLikeBubbleId(itemRefText) ? extractBubbleId(itemRefRaw) : "";
        const itemId = (() => {
          if (itemBubbleId) return itemIdByBubbleId.get(itemBubbleId) ?? null;
          if (!itemRefText) return null;
          return itemIdByName.get(normalizeNameKey(itemRefText)) ?? null;
        })();
        if (!supplierId || !itemId) {
          pt.ignored += 1;
          const reason = !supplierId ? "missing_supplier_relation" : "missing_item_relation";
          inc(pt.ignoredReasons, reason);
          const broken: Array<{ relation: string; column: string; expected: string }> = [];
          if (!supplierId) broken.push({ relation: "supplier", column: "fornecedor_id_custom_fornecedores", expected: supplierRefText || "-" });
          if (!itemId) broken.push({ relation: "item", column: "item_id_custom_itens", expected: itemRefText || "-" });
          for (const b of broken) if (pt.brokenSamples.length < 25) pt.brokenSamples.push({ bubble_id: bubbleId, relation: b.relation, column: b.column, expected: b.expected });
          pt.brokenRelations += broken.length;
          pushIgnored({ bubble_id: bubbleId, bubble_type: r.bubble_type ?? null, base_type: String(r.base_type ?? r.bubble_type ?? "itens_fornecedores"), table, reason, broken });
          continue;
        }
        toUpsert.push({ company_id: companyId, bubble_id: bubbleId, supplier_id: supplierId, item_id: itemId, created_by_user_id: targetUserId, raw: { bubble: raw } });
      }
      const bubbleIds = toUpsert.map((r) => String(r?.bubble_id ?? "").trim()).filter(Boolean);
      const existingRawByBubbleId = await mergeExistingRaw({ supabase, table, companyId, keyField: "bubble_id", keys: bubbleIds });
      const existing = new Set(existingRawByBubbleId.keys());
      for (const row of toUpsert) {
        const b = String(row?.bubble_id ?? "").trim();
        const prev = b ? existingRawByBubbleId.get(b) ?? {} : {};
        row.raw = { ...(prev ?? {}), ...(row.raw ?? {}) };
      }
      const res = await upsertRows({ supabase, table, rows: toUpsert, onConflict: "company_id,bubble_id", existingKeys: existing, keyField: "bubble_id" });
      pt.attempted += res.attempted;
      pt.created += res.created;
      pt.updated += res.updated;
      pt.errors.push(...res.errors);
    }

    await updateProgress("applying", "invoices");
    await applyCompanyScopedByUpsertKey("invoices", "notas_fiscais", (raw, key) => {
      const supplierRefRaw = pickRefPreferBubbleId(raw, ["fornecedor_id_custom_fornecedores", "fornecedor_id", "supplier_id_custom_fornecedores", "fornecedor", "supplier"]) ?? "";
      const supplierRefText = normalizeText(supplierRefRaw);
      const supplierBubbleId = looksLikeBubbleId(supplierRefText) ? extractBubbleId(supplierRefRaw) : "";
      const supplierNameKey = supplierRefText ? normalizeNameKey(supplierRefText) : "";
      const supplierId = (() => {
        if (supplierBubbleId) return supplierIdByBubbleId.get(supplierBubbleId) ?? null;
        if (!supplierRefText) return null;
        const overrideKey = `suppliers:name:${supplierNameKey}`;
        const override = getOverride(relationOverrides, overrideKey);
        const overrideId = override ? overrideToDbId(override, supplierIdByBubbleId) : null;
        if (overrideId) return overrideId;
        return supplierIdByName.get(supplierNameKey) ?? null;
      })();
      if (!supplierId) {
        if (supplierBubbleId) {
          return {
            ignoreReason: "supplier_bubble_id_not_found",
            broken: [{ relation: "supplier", column: "fornecedor_id_custom_fornecedores", expected: supplierBubbleId }],
          };
        }
        return {
          ignoreReason: "missing_supplier_relation",
          broken: [{ relation: "supplier", column: "fornecedor_id_custom_fornecedores", expected: supplierRefText || "-" }],
        };
      }
      const responsavelBubbleId = extractBubbleId(pickAny(raw, ["Created By", "created_by", "responsavel_id", "responsavel_id_custom_users"]) ?? "");
      const responsavelUserId = responsavelBubbleId && byBaseType["user"]?.[0]?.bubble_id === responsavelBubbleId ? targetUserId : null;
      return {
        row: {
          company_id: companyId,
          bubble_id: key.bubbleId,
          external_key: key.externalKey,
          codigo: normalizeText(pickAny(raw, ["codigo", "codigo_custom_notas_fiscais", "numero"])) || "",
          responsavel_user_id: responsavelUserId,
          fornecedor_id: supplierId,
          data_criacao: parseTime(pickAny(raw, ["data_criacao", "Created Date", "data_criacao_custom_notas_fiscais"])),
          data_recebimento: parseDateOnly(pickAny(raw, ["data_recebimento", "data_recebimento_custom_notas_fiscais", "data"])),
          created_by_user_id: targetUserId,
          raw: { bubble: raw },
        },
      };
    });
    await updateProgress("done", "invoices");

    const invoicesBubbleIds = (byBaseType["notas_fiscais"] ?? []).map((r) => String(r.bubble_id ?? "").trim()).filter(Boolean);
    const invoiceIdByBubbleId = await getByCompanyBubbleId(supabase, "invoices", companyId, invoicesBubbleIds);
    const invoiceIdByDate = (() => {
      const map = new Map<string, string>();
      const seen = new Set<string>();
      return { map, seen };
    })();
    let invoiceIdByCodigo = new Map<string, string>();
    try {
      const invoiceRowsAll = await getAllByCompany(supabase, "invoices", companyId, "id,codigo,data_criacao,data_recebimento");
      const pairs: Array<{ key: string; id: string }> = [];
      for (const r of invoiceRowsAll as any[]) {
        const id = String(r?.id ?? "").trim();
        if (!id) continue;
        const d1 = parseDateOnly(r?.data_criacao);
        const d2 = parseDateOnly(r?.data_recebimento);
        if (d1) pairs.push({ key: d1, id });
        if (d2) pairs.push({ key: d2, id });
      }
      for (const p of pairs) {
        const k = String(p.key ?? "").trim().toLowerCase();
        if (!k) continue;
        if (!invoiceIdByDate.map.has(k) && !invoiceIdByDate.seen.has(k)) invoiceIdByDate.map.set(k, p.id);
        else {
          invoiceIdByDate.map.delete(k);
          invoiceIdByDate.seen.add(k);
        }
      }
      invoiceIdByCodigo = buildUniqueIdByKey(
        (invoiceRowsAll as any[])
          .map((r) => ({ key: normalizeNameKey(r?.codigo ?? ""), id: String(r?.id ?? "") }))
          .filter((x) => x.key && x.id),
      );
    } catch {}

    await updateProgress("applying", "invoice_items");
    {
      const table = "invoice_items";
      const pt = ensurePerTable(table);
      const srcRows = byBaseType["itens_notas"] ?? [];
      const itemKeyFromRef = (v: unknown) => {
        const text = normalizeText(v);
        if (!text) return "";
        if (looksLikeBubbleId(text)) return `bubble:${extractBubbleId(text)}`;
        return `name:${normalizeNameKey(text)}`;
      };
      const invoicesByItemId = new Map<string, Array<{ invoiceBubbleId: string; supplierBubbleId: string; dataRecebimento: string; dataCriacao: string }>>();
      for (const inv of byBaseType["notas_fiscais"] ?? []) {
        const invBubbleId = String(inv.bubble_id ?? "").trim();
        if (!invBubbleId) continue;
        const invRaw = inv.normalized ?? {};
        const supplierBubbleId = extractBubbleId(pickAny(invRaw, ["fornecedor_id_custom_fornecedores", "fornecedor_id"]) ?? "");
        const dataRecebimento = String(pickAny(invRaw, ["data_recebimento", "data_recebimento_custom_notas_fiscais"]) ?? "").trim();
        const dataCriacao = String(pickAny(invRaw, ["data_criacao", "Created Date", "data_criacao_custom_notas_fiscais"]) ?? "").trim();
        const list = pickAny(invRaw, ["lista_itens", "lista_itens_custom_notas_fiscais"]);
        const entries = Array.isArray(list) ? list : typeof list === "string" ? [list] : [];
        for (const e of entries) {
          const key = itemKeyFromRef(e);
          if (!key) continue;
          const arr = invoicesByItemId.get(key) ?? [];
          arr.push({ invoiceBubbleId: invBubbleId, supplierBubbleId, dataRecebimento, dataCriacao });
          invoicesByItemId.set(key, arr);
        }
      }
      const dateOnly = (s: string) => String(s ?? "").trim().slice(0, 10);
      const timeMs = (s: string) => {
        const d = new Date(String(s ?? "").trim());
        const t = d.getTime();
        return Number.isFinite(t) ? t : null;
      };
      const syntheticInvoiceIdByExternalKey = new Map<string, string>();
      const toUpsert: any[] = [];
      for (const r of srcRows) {
        const bubbleId = String(r.bubble_id ?? "").trim();
        const raw = r.normalized ?? {};
        const externalKey0 = bubbleId ? "" : String((r as any)?.external_key ?? "").trim() || computeExternalKeyFromBaseKey("itens_notas", raw) || "";
        const recordKey = bubbleId || externalKey0 || "-";
        if (!bubbleId && !externalKey0) {
          pt.ignored += 1;
          inc(pt.ignoredReasons, "missing_key");
          pushIgnored({ bubble_id: "-", bubble_type: r.bubble_type ?? null, base_type: String(r.base_type ?? r.bubble_type ?? "itens_notas"), table, reason: "missing_key", broken: null });
          continue;
        }
        const itemRefRaw = pickAny(raw, ["item_id_custom_itens", "item_id"]) ?? "";
        const itemRefText = normalizeText(itemRefRaw);
        const itemBubbleId = looksLikeBubbleId(itemRefText) ? extractBubbleId(itemRefRaw) : "";
        const itemKey = itemKeyFromRef(itemRefText);
        const supplierRefRaw = pickRefPreferBubbleId(raw, [
          "fornecedor_id_custom_fornecedores",
          "fornecedor_id_custom_itens_notas",
          "fornecedor_id",
          "supplier_id_custom_fornecedores",
          "fornecedor",
          "supplier",
        ]) ?? "";
        const supplierRefText = normalizeText(supplierRefRaw);
        const supplierBubbleId = looksLikeBubbleId(supplierRefText) ? extractBubbleId(supplierRefRaw) : "";
        const supplierId = (() => {
          const direct = supplierBubbleId ? supplierIdByBubbleId.get(supplierBubbleId) ?? null : null;
          if (direct) return direct;
          const supplierNameKey = supplierRefText ? normalizeNameKey(supplierRefText) : "";
          const overrideKey = supplierNameKey ? `suppliers:name:${supplierNameKey}` : "";
          const override = overrideKey ? getOverride(relationOverrides, overrideKey) : "";
          const overrideId = override ? overrideToDbId(override, supplierIdByBubbleId) : null;
          if (overrideId) return overrideId;
          const byName = supplierNameKey ? supplierIdByName.get(supplierNameKey) ?? null : null;
          if (byName) return byName;
          return null;
        })();
        const explicitInvoiceRaw = pickRefPreferBubbleId(raw, ["nota_id_custom_notas_fiscais", "nota_id", "invoice_id_custom_notas_fiscais", "nota", "invoice"]) ?? "";
        const explicitInvoiceText = normalizeText(explicitInvoiceRaw);
        const explicitInvoiceBubbleId = looksLikeBubbleId(explicitInvoiceText) ? extractBubbleId(explicitInvoiceRaw) : "";
        const explicitInvoiceDate = explicitInvoiceText ? parseDateOnly(explicitInvoiceText) : null;
        const explicitInvoicePrimaryKey = explicitInvoiceText ? normalizeNameKey(explicitInvoiceText) : "";
        const derivedInvoiceBubbleId = (() => {
          if (explicitInvoiceBubbleId) return explicitInvoiceBubbleId;
          if (!itemKey) return "";
          const candidates = invoicesByItemId.get(itemKey) ?? [];
          if (!candidates.length) return "";
          if (candidates.length === 1) return candidates[0]!.invoiceBubbleId;
          const itemDate = dateOnly(String(pickAny(raw, ["data_lancamento", "Created Date", "data_lancamento_custom_itens_notas"]) ?? ""));
          const itemTime = timeMs(String(pickAny(raw, ["data_lancamento", "Created Date", "data_lancamento_custom_itens_notas"]) ?? ""));
          const scored = candidates
            .map((c) => {
              const invDate = dateOnly(c.dataRecebimento);
              const datePenalty = itemDate && invDate ? (invDate === itemDate ? 0 : 1) : 1;
              const invTime = timeMs(c.dataCriacao);
              const timePenalty = itemTime != null && invTime != null ? Math.abs(invTime - itemTime) : Number.MAX_SAFE_INTEGER;
              return { c, datePenalty, timePenalty };
            })
            .sort((a, b) => (a.datePenalty - b.datePenalty) || (a.timePenalty - b.timePenalty));
          return scored[0]?.c.invoiceBubbleId ?? "";
        })();
        let invoiceId = (() => {
          if (explicitInvoiceBubbleId) return invoiceIdByBubbleId.get(explicitInvoiceBubbleId) ?? null;
          if (explicitInvoiceDate) {
            const dateKey = String(explicitInvoiceDate).toLowerCase();
            const overrideKey = `invoices:date:${dateKey}`;
            const override = getOverride(relationOverrides, overrideKey);
            const overrideId = override ? overrideToDbId(override, invoiceIdByBubbleId) : null;
            if (overrideId) return overrideId;
            return invoiceIdByDate.map.get(dateKey) ?? null;
          }
          if (explicitInvoicePrimaryKey) {
            const overrideKey = `invoices:primary:${explicitInvoicePrimaryKey}`;
            const override = getOverride(relationOverrides, overrideKey);
            const overrideId = override ? overrideToDbId(override, invoiceIdByBubbleId) : null;
            if (overrideId) return overrideId;
            return invoiceIdByCodigo.get(explicitInvoicePrimaryKey) ?? null;
          }
          if (derivedInvoiceBubbleId) return invoiceIdByBubbleId.get(derivedInvoiceBubbleId) ?? null;
          return null;
        })();
        if (explicitInvoiceBubbleId && !invoiceId) {
          pt.ignored += 1;
          inc(pt.ignoredReasons, "invoice_bubble_id_not_found");
          pt.brokenRelations += 1;
          if (pt.brokenSamples.length < 25) pt.brokenSamples.push({ bubble_id: recordKey, relation: "invoice", column: "nota_id_custom_notas_fiscais", expected: explicitInvoiceBubbleId });
          pushIgnored({
            bubble_id: recordKey,
            bubble_type: r.bubble_type ?? null,
            base_type: String(r.base_type ?? r.bubble_type ?? "itens_notas"),
            table,
            reason: "invoice_bubble_id_not_found",
            broken: [{ relation: "invoice", column: "nota_id_custom_notas_fiscais", expected: explicitInvoiceBubbleId }],
          });
          continue;
        }
        if (!invoiceId) {
          const supplierIdForInvoice = supplierId ?? defaultSupplierId;
          const dateKeyForInvoice =
            parseDateOnly(pickAny(raw, ["data_lancamento", "data_lancamento_custom_itens_notas", "Created Date"])) ??
            explicitInvoiceDate ??
            null;
          const datePart = dateKeyForInvoice ? String(dateKeyForInvoice) : "sem_data";
          const supplierPart = normalizeExternalKeyPart(supplierRefText || defaultSupplierName || "sem_fornecedor");
          const syntheticExternalKey = `nota:${datePart}:${supplierPart}:manual`;
          const cached = syntheticInvoiceIdByExternalKey.get(syntheticExternalKey) ?? null;
          if (cached) invoiceId = cached;
          else if (supplierIdForInvoice) {
            await upsertRows({
              supabase,
              table: "invoices",
              rows: [
                {
                  company_id: companyId,
                  bubble_id: null,
                  external_key: syntheticExternalKey,
                  codigo: "",
                  responsavel_user_id: null,
                  fornecedor_id: supplierIdForInvoice,
                  data_criacao: null,
                  data_recebimento: dateKeyForInvoice,
                  created_by_user_id: targetUserId,
                  raw: { system: { synthetic: true, source: "invoice_items" }, bubble: raw },
                },
              ],
              onConflict: "company_id,external_key",
            });
            const found = await getByCompanyExternalKey(supabase, "invoices", companyId, [syntheticExternalKey]);
            const createdId = found.get(syntheticExternalKey) ?? null;
            if (createdId) {
              syntheticInvoiceIdByExternalKey.set(syntheticExternalKey, createdId);
              invoiceId = createdId;
            }
          }
        }
        const itemId = (() => {
          if (itemBubbleId) return itemIdByBubbleId.get(itemBubbleId) ?? null;
          if (!itemRefText) return null;
          const itemNameKey = normalizeNameKey(itemRefText);
          const overrideKey = `items:name:${itemNameKey}`;
          const override = getOverride(relationOverrides, overrideKey);
          const overrideId = override ? overrideToDbId(override, itemIdByBubbleId) : null;
          if (overrideId) return overrideId;
          return itemIdByName.get(itemNameKey) ?? null;
        })();
        const broken: Array<{ relation: string; column: string; expected: string }> = [];
        if (!invoiceId) broken.push({ relation: "invoice", column: "nota_id_custom_notas_fiscais", expected: explicitInvoiceText || derivedInvoiceBubbleId || "-" });
        if (!itemId) broken.push({ relation: "item", column: "item_id_custom_itens", expected: itemRefText || "-" });
        if (broken.length) {
          pt.ignored += 1;
          const reason = broken.length >= 2 ? "missing_relations" : broken[0]?.relation === "invoice" ? "missing_invoice_relation" : "missing_item_relation";
          inc(pt.ignoredReasons, reason);
          pt.brokenRelations += broken.length;
          for (const b of broken) if (pt.brokenSamples.length < 25) pt.brokenSamples.push({ bubble_id: recordKey, relation: b.relation, column: b.column, expected: b.expected });
          pushIgnored({ bubble_id: recordKey, bubble_type: r.bubble_type ?? null, base_type: String(r.base_type ?? r.bubble_type ?? "itens_notas"), table, reason, broken });
          continue;
        }
        const supplierIdFinal = supplierId ?? defaultSupplierId;
        const externalKeyFinal = (() => {
          if (bubbleId) return null;
          const dateKey = parseDateOnly(pickAny(raw, ["data_lancamento", "data_lancamento_custom_itens_notas", "Created Date"])) ?? "";
          const qty = normalizeNumberToken(pickAny(raw, ["quantidade", "quantidade_custom_itens_notas"]) ?? "");
          const unit = normalizeNumberToken(pickAny(raw, ["custo_unitario", "custo_unitario_custom_itens_notas"]) ?? "");
          const subtotal = normalizeNumberToken(pickAny(raw, ["subtotal", "subtotal_custom_itens_notas"]) ?? "");
          const seed = `${invoiceId}|${itemId}|${dateKey}|${qty}|${unit}|${subtotal}`;
          const h = createHash("sha256").update(seed).digest("hex").slice(0, 24);
          return `invoice_item:${h}`;
        })();
        toUpsert.push({
          company_id: companyId,
          bubble_id: bubbleId || null,
          external_key: bubbleId ? null : externalKeyFinal || externalKey0 || null,
          invoice_id: invoiceId,
          item_id: itemId,
          supplier_id: supplierIdFinal,
          data_lancamento: parseDateOnly(pickAny(raw, ["data_lancamento", "data_lancamento_custom_itens_notas", "Created Date"])),
          quantidade: parseNumber(pickAny(raw, ["quantidade", "quantidade_custom_itens_notas"])),
          custo_unitario: parseNumber(pickAny(raw, ["custo_unitario", "custo_unitario_custom_itens_notas"])),
          subtotal: parseNumber(pickAny(raw, ["subtotal", "subtotal_custom_itens_notas"])),
          ocultar_cmv: parseBool(pickAny(raw, ["ocultar_cmv", "ocultar_cmv_custom_itens_notas"])),
          cadastro_item: parseBool(pickAny(raw, ["cadastro_Item", "cadastro_item"])),
          excluivel_detalhes_item: parseBool(pickAny(raw, ["excluível_detalhes_item", "excluivel_detalhes_item"])),
          created_by_user_id: targetUserId,
          raw: { bubble: raw },
        });
      }
      const bubbleRows = toUpsert.filter((r) => String(r?.bubble_id ?? "").trim());
      const externalRows = toUpsert.filter((r) => !String(r?.bubble_id ?? "").trim() && String(r?.external_key ?? "").trim());
      if (bubbleRows.length) {
        const bubbleIds = bubbleRows.map((r) => String(r?.bubble_id ?? "").trim()).filter(Boolean);
        const existingRawByBubbleId = await mergeExistingRaw({ supabase, table, companyId, keyField: "bubble_id", keys: bubbleIds });
        const existing = new Set(existingRawByBubbleId.keys());
        for (const row of bubbleRows) {
          const b = String(row?.bubble_id ?? "").trim();
          const prev = b ? existingRawByBubbleId.get(b) ?? {} : {};
          row.raw = { ...(prev ?? {}), ...(row.raw ?? {}) };
        }
        const res = await upsertRows({ supabase, table, rows: bubbleRows, onConflict: "company_id,bubble_id", existingKeys: existing, keyField: "bubble_id" });
        pt.attempted += res.attempted;
        pt.created += res.created;
        pt.updated += res.updated;
        pt.errors.push(...res.errors);
      }
      if (externalRows.length) {
        const externalKeys = externalRows.map((r) => String(r?.external_key ?? "").trim()).filter(Boolean);
        const existingRawByExternalKey = await mergeExistingRaw({ supabase, table, companyId, keyField: "external_key", keys: externalKeys });
        const existing = new Set(existingRawByExternalKey.keys());
        for (const row of externalRows) {
          const k = String(row?.external_key ?? "").trim();
          const prev = k ? existingRawByExternalKey.get(k) ?? {} : {};
          row.raw = { ...(prev ?? {}), ...(row.raw ?? {}) };
        }
        const res = await upsertRows({ supabase, table, rows: externalRows, onConflict: "company_id,external_key", existingKeys: existing, keyField: "external_key" });
        pt.attempted += res.attempted;
        pt.created += res.created;
        pt.updated += res.updated;
        pt.errors.push(...res.errors);
      }
    }
    await updateProgress("done", "invoice_items");

    await updateProgress("applying", "inventories");
    await applyCompanyScopedByUpsertKey("inventories", "inventarios", (raw, key) => {
      return {
        row: {
          company_id: companyId,
          bubble_id: key.bubbleId,
          external_key: key.externalKey,
          nome: normalizeText(pickAny(raw, ["nome", "nome_custom_inventarios"])) || "",
          data_contagem: parseTime(pickAny(raw, ["data_contagem", "data_contagem_custom_inventarios"])) || null,
          created_by_user_id: targetUserId,
          raw: { bubble: raw },
        },
      };
    });
    await updateProgress("done", "inventories");

    const inventoriesBubbleIds = (byBaseType["inventarios"] ?? []).map((r) => String(r.bubble_id ?? "").trim()).filter(Boolean);
    const inventoryIdByBubbleId = await getByCompanyBubbleId(supabase, "inventories", companyId, inventoriesBubbleIds);
    const inventoryIdByDate = (() => {
      const map = new Map<string, string>();
      const seen = new Set<string>();
      return { map, seen };
    })();
    let inventoryIdByName = new Map<string, string>();
    try {
      const inventoryRowsAll = await getAllByCompany(supabase, "inventories", companyId, "id,nome,data_contagem");
      for (const r of inventoryRowsAll as any[]) {
        const id = String(r?.id ?? "").trim();
        const d = parseDateOnly(r?.data_contagem);
        if (!id || !d) continue;
        const k = String(d).toLowerCase();
        if (!inventoryIdByDate.map.has(k) && !inventoryIdByDate.seen.has(k)) inventoryIdByDate.map.set(k, id);
        else {
          inventoryIdByDate.map.delete(k);
          inventoryIdByDate.seen.add(k);
        }
      }
      inventoryIdByName = buildUniqueIdByKey(
        (inventoryRowsAll as any[])
          .map((r) => ({ key: normalizeNameKey(r?.nome ?? ""), id: String(r?.id ?? "") }))
          .filter((x) => x.key && x.id),
      );
    } catch {}

    await updateProgress("applying", "inventory_items");
    {
      const table = "inventory_items";
      const pt = ensurePerTable(table);
      const srcRows = byBaseType["itens_inventarios"] ?? [];
      const toUpsert: any[] = [];
      for (const r of srcRows) {
        const bubbleId = String(r.bubble_id ?? "").trim();
        const raw = r.normalized ?? {};
        const invRefRaw = pickRefPreferBubbleId(raw, ["inventario_id_custom_inventarios", "inventario_id", "inventario"]) ?? "";
        const invRefText = normalizeText(invRefRaw);
        const invBubbleId = looksLikeBubbleId(invRefText) ? extractBubbleId(invRefRaw) : "";
        const invDate = invRefText ? parseDateOnly(invRefText) : null;
        const invPrimaryKey = invRefText ? normalizeNameKey(invRefText) : "";
        const inventoryId = (() => {
          if (invBubbleId) return inventoryIdByBubbleId.get(invBubbleId) ?? null;
          if (invDate) {
            const dateKey = String(invDate).toLowerCase();
            const overrideKey = `inventories:date:${dateKey}`;
            const override = getOverride(relationOverrides, overrideKey);
            const overrideId = override ? overrideToDbId(override, inventoryIdByBubbleId) : null;
            if (overrideId) return overrideId;
            return inventoryIdByDate.map.get(dateKey) ?? null;
          }
          if (invPrimaryKey) {
            const overrideKey = `inventories:primary:${invPrimaryKey}`;
            const override = getOverride(relationOverrides, overrideKey);
            const overrideId = override ? overrideToDbId(override, inventoryIdByBubbleId) : null;
            if (overrideId) return overrideId;
            return inventoryIdByName.get(invPrimaryKey) ?? null;
          }
          return null;
        })();
        if (invBubbleId && !inventoryId) {
          pt.ignored += 1;
          inc(pt.ignoredReasons, "inventory_bubble_id_not_found");
          pt.brokenRelations += 1;
          if (pt.brokenSamples.length < 25) pt.brokenSamples.push({ bubble_id: bubbleId || "-", relation: "inventory", column: "inventario_id_custom_inventarios", expected: invBubbleId });
          pushIgnored({
            bubble_id: bubbleId || String((r as any)?.external_key ?? "").trim() || "-",
            bubble_type: r.bubble_type ?? null,
            base_type: String(r.base_type ?? r.bubble_type ?? "itens_inventarios"),
            table,
            reason: "inventory_bubble_id_not_found",
            broken: [{ relation: "inventory", column: "inventario_id_custom_inventarios", expected: invBubbleId }],
          });
          continue;
        }

        const itemRefRaw = pickAny(raw, ["item_id_custom_itens", "item_id", "item"]) ?? "";
        const itemRefText = normalizeText(itemRefRaw);
        const itemBubbleId = looksLikeBubbleId(itemRefText) ? extractBubbleId(itemRefRaw) : "";
        const itemId = (() => {
          if (itemBubbleId) return itemIdByBubbleId.get(itemBubbleId) ?? null;
          if (!itemRefText) return null;
          const itemNameKey = normalizeNameKey(itemRefText);
          const overrideKey = `items:name:${itemNameKey}`;
          const override = getOverride(relationOverrides, overrideKey);
          const overrideId = override ? overrideToDbId(override, itemIdByBubbleId) : null;
          if (overrideId) return overrideId;
          return itemIdByName.get(itemNameKey) ?? null;
        })();
        if (!inventoryId || !itemId) {
          pt.ignored += 1;
          const reason = !inventoryId ? "missing_inventory_relation" : "missing_item_relation";
          inc(pt.ignoredReasons, reason);
          const broken: Array<{ relation: string; column: string; expected: string }> = [];
          if (!inventoryId) broken.push({ relation: "inventory", column: "inventario_id_custom_inventarios", expected: invRefText || "-" });
          if (!itemId) broken.push({ relation: "item", column: "item_id_custom_itens", expected: itemRefText || "-" });
          const display = bubbleId || String((r as any)?.external_key ?? "").trim() || "-";
          for (const b of broken) if (pt.brokenSamples.length < 25) pt.brokenSamples.push({ bubble_id: display, relation: b.relation, column: b.column, expected: b.expected });
          pt.brokenRelations += broken.length;
          pushIgnored({ bubble_id: display, bubble_type: r.bubble_type ?? null, base_type: String(r.base_type ?? r.bubble_type ?? "itens_inventarios"), table, reason, broken });
          continue;
        }
        const externalKey0 = (() => {
          if (bubbleId) return "";
          const provided = String((r as any)?.external_key ?? "").trim();
          if (provided) return provided;
          const seed = `${inventoryId}|${itemId}`;
          const h = createHash("sha256").update(seed).digest("hex").slice(0, 24);
          return `inventory_item:${h}`;
        })();
        const display = bubbleId || externalKey0 || "-";
        if (!bubbleId && !externalKey0) {
          pt.ignored += 1;
          inc(pt.ignoredReasons, "missing_key");
          pushIgnored({ bubble_id: display, bubble_type: r.bubble_type ?? null, base_type: String(r.base_type ?? r.bubble_type ?? "itens_inventarios"), table, reason: "missing_key", broken: null });
          continue;
        }
        toUpsert.push({
          company_id: companyId,
          bubble_id: bubbleId || null,
          external_key: bubbleId ? null : externalKey0 || null,
          inventory_id: inventoryId,
          item_id: itemId,
          data_contagem: parseTime(pickAny(raw, ["data_contagem", "data_contagem_custom_itens_inventarios"])),
          quantidade_contada: parseNumber(pickAny(raw, ["quantidade_contada", "quantidade_contada_custom_itens_inventarios"])),
          ocultar_cmv: parseBool(pickAny(raw, ["ocultar_cmv", "ocultar_cmv_custom_itens_inventarios"])),
          item_temporario: parseBool(pickAny(raw, ["item_temporario", "item_temporario_custom_itens_inventarios"])),
          created_by_user_id: targetUserId,
          raw: { bubble: raw },
        });
      }
      const bubbleRows = toUpsert.filter((r) => String(r?.bubble_id ?? "").trim());
      const externalRows = toUpsert.filter((r) => !String(r?.bubble_id ?? "").trim() && String(r?.external_key ?? "").trim());
      if (bubbleRows.length) {
        const bubbleIds = bubbleRows.map((r) => String(r?.bubble_id ?? "").trim()).filter(Boolean);
        const existingRawByBubbleId = await mergeExistingRaw({ supabase, table, companyId, keyField: "bubble_id", keys: bubbleIds });
        const existing = new Set(existingRawByBubbleId.keys());
        for (const row of bubbleRows) {
          const b = String(row?.bubble_id ?? "").trim();
          const prev = b ? existingRawByBubbleId.get(b) ?? {} : {};
          row.raw = { ...(prev ?? {}), ...(row.raw ?? {}) };
        }
        const res = await upsertRows({ supabase, table, rows: bubbleRows, onConflict: "company_id,bubble_id", existingKeys: existing, keyField: "bubble_id" });
        pt.attempted += res.attempted;
        pt.created += res.created;
        pt.updated += res.updated;
        pt.errors.push(...res.errors);
      }
      if (externalRows.length) {
        const externalKeys = externalRows.map((r) => String(r?.external_key ?? "").trim()).filter(Boolean);
        const existingRawByExternalKey = await mergeExistingRaw({ supabase, table, companyId, keyField: "external_key", keys: externalKeys });
        const existing = new Set(existingRawByExternalKey.keys());
        for (const row of externalRows) {
          const k = String(row?.external_key ?? "").trim();
          const prev = k ? existingRawByExternalKey.get(k) ?? {} : {};
          row.raw = { ...(prev ?? {}), ...(row.raw ?? {}) };
        }
        const res = await upsertRows({ supabase, table, rows: externalRows, onConflict: "company_id,external_key", existingKeys: existing, keyField: "external_key" });
        pt.attempted += res.attempted;
        pt.created += res.created;
        pt.updated += res.updated;
        pt.errors.push(...res.errors);
      }
    }
    await updateProgress("done", "inventory_items");

    await updateProgress("applying", "waste_reasons");
    await applyCompanyScopedByUpsertKey("waste_reasons", "motivos_desperdicios", (raw, key) => {
      return {
        row: {
          company_id: companyId,
          bubble_id: key.bubbleId,
          external_key: key.externalKey,
          titulo: normalizeText(pickAny(raw, ["titulo", "titulo_custom_motivos_desperdicios"])) || "",
          created_by_user_id: targetUserId,
          raw: { bubble: raw },
        },
      };
    });
    await updateProgress("done", "waste_reasons");

    const reasonsBubbleIds = (byBaseType["motivos_desperdicios"] ?? []).map((r) => String(r.bubble_id ?? "").trim()).filter(Boolean);
    const reasonIdByBubbleId = await getByCompanyBubbleId(supabase, "waste_reasons", companyId, reasonsBubbleIds);
    const reasonIdByName = buildUniqueIdByKey(
      (await getAllByCompany(supabase, "waste_reasons", companyId, "id,titulo")).map((r) => ({
        key: normalizeNameKey((r as any)?.titulo ?? ""),
        id: String((r as any)?.id ?? ""),
      })),
    );

    await updateProgress("applying", "wastes");
    await applyCompanyScopedByUpsertKey("wastes", "desperdicio", (raw, key) => {
      const itemRefRaw = pickRefPreferBubbleId(raw, ["item_id_custom_itens", "item_id", "item"]) ?? "";
      const itemRefText = normalizeText(itemRefRaw);
      const itemBubbleId = looksLikeBubbleId(itemRefText) ? extractBubbleId(itemRefRaw) : "";
      const itemId = (() => {
        if (itemBubbleId) return itemIdByBubbleId.get(itemBubbleId) ?? null;
        if (!itemRefText) return null;
        const itemNameKey = normalizeNameKey(itemRefText);
        const overrideKey = `items:name:${itemNameKey}`;
        const override = getOverride(relationOverrides, overrideKey);
        const overrideId = override ? overrideToDbId(override, itemIdByBubbleId) : null;
        if (overrideId) return overrideId;
        return itemIdByName.get(itemNameKey) ?? null;
      })();
      if (!itemId) {
        if (itemBubbleId) {
          return { ignoreReason: "item_bubble_id_not_found", broken: [{ relation: "item", column: "item_id_custom_itens", expected: itemBubbleId }] };
        }
        return { ignoreReason: "missing_item_relation", broken: [{ relation: "item", column: "item_id_custom_itens", expected: itemRefText || "-" }] };
      }
      const labelBubbleId = extractBubbleId(pickAny(raw, ["etiqueta_id_custom_etiquetas", "etiqueta_id"]) ?? "");
      const labelId = labelBubbleId ? labelIdByBubbleId.get(labelBubbleId) ?? null : null;
      const reasonRefRaw = pickRefPreferBubbleId(raw, ["motivo_custom_motivos_desperdicios", "motivo", "motivo_id_custom_motivos_desperdicios", "motivo_id"]) ?? "";
      const reasonRefText = normalizeText(reasonRefRaw);
      const reasonBubbleId = looksLikeBubbleId(reasonRefText) ? extractBubbleId(reasonRefRaw) : "";
      const reasonPrimaryKey = reasonRefText ? normalizeNameKey(reasonRefText) : "";
      const reasonId = (() => {
        if (reasonBubbleId) return reasonIdByBubbleId.get(reasonBubbleId) ?? null;
        if (!reasonRefText) return null;
        const overrideKey = `waste_reasons:primary:${reasonPrimaryKey}`;
        const override = getOverride(relationOverrides, overrideKey);
        const overrideId = override ? overrideToDbId(override, reasonIdByBubbleId) : null;
        if (overrideId) return overrideId;
        return reasonIdByName.get(reasonPrimaryKey) ?? null;
      })();
      if (reasonBubbleId && !reasonId) {
        return { ignoreReason: "reason_bubble_id_not_found", broken: [{ relation: "reason", column: "motivo_custom_motivos_desperdicios", expected: reasonBubbleId }] };
      }
      return {
        row: {
          company_id: companyId,
          bubble_id: key.bubbleId,
          external_key: key.externalKey,
          lancamento: parseDateOnly(pickAny(raw, ["lancamento", "lancamento_custom_desperdicio"])),
          motivo_text: normalizeText(pickAny(raw, ["motivo_text", "motivo_text_custom_desperdicio"])) || "",
          quantidade: parseNumber(pickAny(raw, ["quantidade", "quantidade_custom_desperdicio"])),
          custo_total: parseNumber(pickAny(raw, ["custo_total", "custo_total_custom_desperdicio"])),
          custo_unitario: parseNumber(pickAny(raw, ["custo_unitario", "custo_unitario_custom_desperdicio"])),
          unidade_medida: normalizeText(pickAny(raw, ["unidade_medida", "unidade_medida_custom_desperdicio"])) || "",
          item_id: itemId,
          etiqueta_id: labelId,
          motivo_id: reasonId,
          created_by_user_id: targetUserId,
          raw: { bubble: raw },
        },
      };
    });
    await updateProgress("done", "wastes");

    const recipeItemIdByIngredientItemId = (() => {
      const map = new Map<string, string>();
      const ambiguous = new Set<string>();
      const splitCsvList = (v: unknown) => {
        const s = normalizeText(v);
        if (!s) return [];
        return s
          .split(",")
          .map((x) => normalizeText(x))
          .filter(Boolean);
      };
      const recipeRows = byBaseType["item"] ?? [];
      for (const r of recipeRows) {
        const raw = r?.normalized ?? {};
        const recipeBubbleId = String(r?.bubble_id ?? "").trim();
        const recipeName = normalizeText(pickAny(raw, ["nome", "nome_custom_itens", "name"]));
        const recipeItemId = (() => {
          if (recipeBubbleId) return itemIdByBubbleId.get(recipeBubbleId) ?? null;
          if (!recipeName) return null;
          return itemIdByName.get(normalizeNameKey(recipeName)) ?? null;
        })();
        if (!recipeItemId) continue;
        const list = splitCsvList(pickAny(raw, ["lista_ingredientes_custom_itens", "lista_ingredientes_custom_item", "lista_ingredientes"]) ?? "");
        for (const it of list) {
          const t = normalizeText(it);
          if (!t) continue;
          const ingredientItemId = (() => {
            if (looksLikeBubbleId(t)) return itemIdByBubbleId.get(extractBubbleId(t)) ?? null;
            return itemIdByName.get(normalizeNameKey(t)) ?? null;
          })();
          if (!ingredientItemId) continue;
          if (ambiguous.has(ingredientItemId)) continue;
          const prev = map.get(ingredientItemId);
          if (!prev) {
            map.set(ingredientItemId, recipeItemId);
            continue;
          }
          if (prev !== recipeItemId) {
            map.delete(ingredientItemId);
            ambiguous.add(ingredientItemId);
          }
        }
      }
      return map;
    })();

    await updateProgress("applying", "recipe_ingredients");
    await applyCompanyScopedByUpsertKey("recipe_ingredients", "ingredientes", (raw, key) => {
      const ingredientRefRaw = pickRefPreferBubbleId(raw, ["item_id_custom_itens", "item_id", "ingredient_item_id_custom_itens", "item", "ingredient_item"]) ?? "";
      const ingredientRefText = normalizeText(ingredientRefRaw);
      const ingredientBubbleId = looksLikeBubbleId(ingredientRefText) ? extractBubbleId(ingredientRefRaw) : "";
      const recipeRefRaw = pickRefPreferBubbleId(raw, ["receita_id_custom_itens", "receita_id", "recipe_id_custom_itens", "recipe_id", "receita", "recipe"]) ?? "";
      const recipeRefText = normalizeText(recipeRefRaw);
      const recipeBubbleId = looksLikeBubbleId(recipeRefText) ? extractBubbleId(recipeRefRaw) : "";
      const ingredientItemId = (() => {
        if (ingredientBubbleId) return itemIdByBubbleId.get(ingredientBubbleId) ?? null;
        if (!ingredientRefText) return null;
        const itemNameKey = normalizeNameKey(ingredientRefText);
        const overrideKey = `items:name:${itemNameKey}`;
        const override = getOverride(relationOverrides, overrideKey);
        const overrideId = override ? overrideToDbId(override, itemIdByBubbleId) : null;
        if (overrideId) return overrideId;
        return itemIdByName.get(itemNameKey) ?? null;
      })();
      const recipeItemId = (() => {
        if (recipeBubbleId) return itemIdByBubbleId.get(recipeBubbleId) ?? null;
        if (!recipeRefText) {
          const recordKey = String(key.bubbleId ?? key.externalKey ?? "").trim();
          const overrideKey = recordKey ? `recipe_ingredients:recipe:${recordKey}` : "";
          const override = overrideKey ? getOverride(relationOverrides, overrideKey) : "";
          const overrideId = override ? overrideToDbId(override, itemIdByBubbleId) : null;
          if (overrideId) return overrideId;
          if (!ingredientItemId) return null;
          return recipeItemIdByIngredientItemId.get(ingredientItemId) ?? null;
        }
        const itemNameKey = normalizeNameKey(recipeRefText);
        const overrideKey = `items:name:${itemNameKey}`;
        const override = getOverride(relationOverrides, overrideKey);
        const overrideId = override ? overrideToDbId(override, itemIdByBubbleId) : null;
        if (overrideId) return overrideId;
        return itemIdByName.get(itemNameKey) ?? null;
      })();
      if (recipeBubbleId && !recipeItemId) {
        return { ignoreReason: "recipe_bubble_id_not_found", broken: [{ relation: "recipe_item", column: "receita_id_custom_itens", expected: recipeBubbleId }] };
      }
      if (ingredientBubbleId && !ingredientItemId) {
        return { ignoreReason: "ingredient_bubble_id_not_found", broken: [{ relation: "ingredient_item", column: "item_id_custom_itens", expected: ingredientBubbleId }] };
      }
      if (!ingredientItemId || !recipeItemId) {
        const missingRecipe = !recipeItemId;
        const missingIngredient = !ingredientItemId;
        const reason = missingRecipe ? "missing_recipe_item_relation" : "missing_ingredient_item_relation";
        const broken = [
          ...(missingRecipe ? [{ relation: "recipe_item", column: "receita_id_custom_itens", expected: recipeRefText || "-" }] : []),
          ...(missingIngredient ? [{ relation: "ingredient_item", column: "item_id_custom_itens", expected: ingredientRefText || "-" }] : []),
        ];
        return { ignoreReason: reason, broken };
      }
      return {
        row: {
          company_id: companyId,
          bubble_id: key.bubbleId,
          external_key: key.externalKey,
          recipe_item_id: recipeItemId,
          ingredient_item_id: ingredientItemId,
          quantidade: parseNumber(pickAny(raw, ["quantidade", "quantidade_custom_ingredientes"])),
          custo: parseNumber(pickAny(raw, ["custo", "custo_custom_ingredientes"])),
          ingrediente_temporario: parseBool(pickAny(raw, ["ingrediente_temporario", "ingrediente_temporario_custom_ingredientes"])),
          created_by_user_id: targetUserId,
          raw: { bubble: raw },
        },
      };
    });
    await updateProgress("done", "recipe_ingredients");

    if (!isCsvMode && (byBaseType["itens_lista_compras"] ?? []).length)
      await applyCompanyScopedByBubbleId("shopping_list_items", "itens_lista_compras", (raw, bubbleId) => {
      const itemRefRaw = pickAny(raw, ["item_id_custom_itens", "item_id", "item"]) ?? "";
      const itemRefText = normalizeText(itemRefRaw);
      const itemBubbleId = looksLikeBubbleId(itemRefText) ? extractBubbleId(itemRefRaw) : "";
      const itemId = (() => {
        if (itemBubbleId) return itemIdByBubbleId.get(itemBubbleId) ?? null;
        if (!itemRefText) return null;
        return itemIdByName.get(normalizeNameKey(itemRefText)) ?? null;
      })();
      return {
        row: {
          company_id: companyId,
          bubble_id: bubbleId,
          item_id: itemId,
          item_nome: normalizeText(pickAny(raw, ["Item_nome", "item_nome", "Item_nome_custom_Itens_lista_compras"])) || "",
          item_medida: normalizeText(pickAny(raw, ["item_medida", "item_medida_custom_Itens_lista_compras"])) || "",
          qtd_compra: parseNumber(pickAny(raw, ["qtd_compra", "qtd_compra_custom_Itens_lista_compras"])),
          qtd_sugestao: parseNumber(pickAny(raw, ["qtd_sugestao", "qtd_sugestao_custom_Itens_lista_compras"])),
          tipo: normalizeText(pickAny(raw, ["tipo", "tipo_custom_Itens_lista_compras"])) || "",
          created_by_user_id: targetUserId,
          raw: { bubble: raw },
        },
      };
    });

    if (!isCsvMode && (byBaseType["qtd_compra_real"] ?? []).length)
      await applyCompanyScopedByBubbleId("purchase_real_qty", "qtd_compra_real", (raw, bubbleId) => {
      const itemRefRaw = pickAny(raw, ["item_id_custom_itens", "item_id", "item"]) ?? "";
      const itemRefText = normalizeText(itemRefRaw);
      const itemBubbleId = looksLikeBubbleId(itemRefText) ? extractBubbleId(itemRefRaw) : "";
      const itemId = (() => {
        if (itemBubbleId) return itemIdByBubbleId.get(itemBubbleId) ?? null;
        if (!itemRefText) return null;
        return itemIdByName.get(normalizeNameKey(itemRefText)) ?? null;
      })();
      if (!itemId) {
        return { ignoreReason: "missing_item_relation", broken: [{ relation: "item", column: "item_id_custom_itens", expected: itemRefText || "-" }] };
      }
      return {
        row: {
          company_id: companyId,
          bubble_id: bubbleId,
          item_id: itemId,
          quantidade: parseNumber(pickAny(raw, ["quantidade", "quantidade_custom_qtd_compra_real"])) ?? 0,
          created_by_user_id: targetUserId,
          raw: { bubble: raw },
        },
      };
    });

    if (!isCsvMode && (byBaseType["faturamentos"] ?? []).length)
      await applyCompanyScopedByBubbleId("revenues", "faturamentos", (raw, bubbleId) => {
      const invFinalRefRaw = pickAny(raw, ["inventario_final", "inventario_final_custom_inventarios", "inventario_final_custom_faturamentos"]) ?? "";
      const invInicialRefRaw = pickAny(raw, ["inventario_inicial", "inventario_inicial_custom_inventarios", "inventario_inicial_custom_faturamentos"]) ?? "";
      const invFinalRefText = normalizeText(invFinalRefRaw);
      const invInicialRefText = normalizeText(invInicialRefRaw);
      const invFinalBubbleId = looksLikeBubbleId(invFinalRefText) ? extractBubbleId(invFinalRefRaw) : "";
      const invInicialBubbleId = looksLikeBubbleId(invInicialRefText) ? extractBubbleId(invInicialRefRaw) : "";
      const invFinalDate = invFinalRefText ? parseDateOnly(invFinalRefText) : null;
      const invInicialDate = invInicialRefText ? parseDateOnly(invInicialRefText) : null;
      const invFinalId = (() => {
        if (invFinalBubbleId) return inventoryIdByBubbleId.get(invFinalBubbleId) ?? null;
        if (invFinalDate) return inventoryIdByDate.map.get(String(invFinalDate).toLowerCase()) ?? null;
        return null;
      })();
      const invInicialId = (() => {
        if (invInicialBubbleId) return inventoryIdByBubbleId.get(invInicialBubbleId) ?? null;
        if (invInicialDate) return inventoryIdByDate.map.get(String(invInicialDate).toLowerCase()) ?? null;
        return null;
      })();
      return {
        row: {
          company_id: companyId,
          bubble_id: bubbleId,
          data_inicial: parseDateOnly(pickAny(raw, ["data_inicial", "data_inicial_custom_faturamentos"])),
          data_final: parseDateOnly(pickAny(raw, ["data_final", "data_final_custom_faturamentos"])),
          faturamento: parseNumber(pickAny(raw, ["faturamento", "faturamento_custom_faturamentos"])),
          inventario_inicial_id: invInicialId,
          inventario_final_id: invFinalId,
          created_by_user_id: targetUserId,
          raw: { bubble: raw },
        },
      };
    });

    await updateProgress("applying", "avg_cost_events");
    await applyCompanyScopedByUpsertKey("avg_cost_events", "custo_medio_item", (raw, key) => {
      const itemRefRaw = pickRefPreferBubbleId(raw, ["item_id_custom_itens", "item", "item_custom_itens", "item_id"]) ?? "";
      const itemRefText = normalizeText(itemRefRaw);
      const itemBubbleId = looksLikeBubbleId(itemRefText) ? extractBubbleId(itemRefRaw) : "";
      const itemId = (() => {
        if (itemBubbleId) return itemIdByBubbleId.get(itemBubbleId) ?? null;
        if (!itemRefText) return null;
        return itemIdByName.get(normalizeNameKey(itemRefText)) ?? null;
      })();
      if (!itemId) {
        if (itemBubbleId) {
          return { ignoreReason: "item_bubble_id_not_found", broken: [{ relation: "item", column: "item_id_custom_itens", expected: itemBubbleId }] };
        }
        return { ignoreReason: "missing_item_relation", broken: [{ relation: "item", column: "item_id_custom_itens", expected: itemRefText || "-" }] };
      }
      return {
        row: {
          company_id: companyId,
          bubble_id: key.bubbleId,
          external_key: key.externalKey,
          data_lancamento: parseDateOnly(pickAny(raw, ["data_lancamento", "data_lancamento_custom_custo_medio_item", "Created Date"])),
          item_id: itemId,
          custo_medio: parseNumber(pickAny(raw, ["custo_medio", "custo_medio_custom_custo_medio_item"])),
          alteracao_custo_inicial: parseBool(pickAny(raw, ["alteracao_custo_inicial", "alteracao_custo_inicial_custom_custo_medio_item"])),
          created_by_user_id: targetUserId,
          raw: { bubble: raw },
        },
      };
    });
    await updateProgress("done", "avg_cost_events");

    let processed = 0;
    let created = 0;
    let updated = 0;
    let ignored = 0;
    let errors = 0;
    let brokenRelations = 0;
    for (const pt of Object.values(report.perTable) as PerTable[]) {
      processed += pt.attempted;
      created += pt.created;
      updated += pt.updated;
      errors += pt.errors.length;
      brokenRelations += pt.brokenRelations;
    }
    ignored = ignoredRecords.length;
    report.ignoredSamples = ignoredRecords.slice(0, 50).map((x) => ({ bubble_id: x.bubble_id, base_type: x.base_type, reason: x.reason }));
    report.totals = { processed, created, updated, ignored, errors, brokenRelations };
    report.finishedAt = new Date().toISOString();

    const bucket = "admin-importacao-manual";
    await ensureBucket(supabase, bucket);
    const stamp = report.finishedAt.replace(/[:.]/g, "-");
    const path = `apply/network-json/${normalizeLower(email)}/${stamp}.json`;
    report.audit = { bucket, path };
    await uploadJsonLog(supabase, bucket, path, {
      meta: { email, companyId, userId: targetUserId, requesterId, requestedAt: startedAt, finishedAt: report.finishedAt },
      totals: report.totals,
      perTable: report.perTable,
      ignoredSamples: report.ignoredSamples,
      ignoredRecords: report.ignoredRecords,
      sampleKeys: Object.keys(byBaseType).sort(),
    });

    await updateProgress("finished");

    return json({ ok: true, result: report }, { status: 200 });
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
