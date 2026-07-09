import { NextRequest, NextResponse } from "next/server";
import { getUserIdFromRequest } from "../../../../lib/requestUserId";
import { getSupabaseAdmin } from "../../../../lib/supabaseAdmin";
import { isLocalDevRequest } from "../../../../lib/localDevRequest";
import { createHash } from "crypto";

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

function normalizeBubbleRef(value: unknown) {
  if (typeof value !== "string") return value;
  if (value.includes("__LOOKUP__")) return value.split("__LOOKUP__").pop();
  return value;
}

function normalizeRecordDeep(value: unknown, opts?: { normalizeCustomKeys?: boolean }) {
  const normalizeCustomKeys = opts?.normalizeCustomKeys !== false;
  const seen = new WeakMap<object, any>();
  const walk = (v: unknown, keyHint?: string): unknown => {
    const hint = String(keyHint ?? "");
    if (typeof v === "string") {
      const should = v.includes("__LOOKUP__") || (normalizeCustomKeys && normalizeKey(hint).includes("custom_"));
      return should ? normalizeBubbleRef(v) : v;
    }
    if (!v || typeof v !== "object") return v;
    if (Array.isArray(v)) return v.map((it) => walk(it, hint));
    if (seen.has(v as any)) return seen.get(v as any);
    const out: any = {};
    seen.set(v as any, out);
    for (const [k, val] of Object.entries(v as any)) {
      const should = normalizeCustomKeys && normalizeKey(k).includes("custom_");
      out[k] = should ? walk(normalizeBubbleRef(val), k) : walk(val, k);
    }
    return out;
  };
  return walk(value);
}

async function ensureBucket(supabase: ReturnType<typeof getSupabaseAdmin>, bucket: string) {
  const got = await supabase.storage.getBucket(bucket);
  if (!got.error) return;
  await supabase.storage.createBucket(bucket, { public: false }).catch(() => {});
}

async function downloadJsonFromStorage(supabase: ReturnType<typeof getSupabaseAdmin>, bucket: string, path: string) {
  const signed = await supabase.storage.from(bucket).createSignedUrl(path, 60);
  if (signed.error || !signed.data?.signedUrl) {
    const msg = String((signed.error as any)?.message ?? "");
    const lower = msg.toLowerCase();
    if (lower.includes("not found") || lower.includes("object not found")) return { ok: true as const, value: null as any };
    return { ok: false as const, error: msg || "failed_to_sign" };
  }
  const res = await fetch(signed.data.signedUrl);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const lower = String(text ?? "").toLowerCase();
    if (res.status === 404 || lower.includes("not found") || lower.includes("object not found")) return { ok: true as const, value: null as any };
    return { ok: false as const, error: `download_failed_${res.status}` };
  }
  const text = await res.text().catch(() => "");
  try {
    return { ok: true as const, value: JSON.parse(text) };
  } catch {
    return { ok: false as const, error: "invalid_session_json" };
  }
}

async function uploadJsonToStorage(supabase: ReturnType<typeof getSupabaseAdmin>, bucket: string, path: string, value: any) {
  const bytes = new TextEncoder().encode(JSON.stringify(value, null, 2));
  const { error } = await supabase.storage.from(bucket).upload(path, bytes, { contentType: "application/json", upsert: true } as any);
  if (error) throw new Error(error.message);
}

async function removeFromStorage(supabase: ReturnType<typeof getSupabaseAdmin>, bucket: string, paths: string[]) {
  const { error } = await supabase.storage.from(bucket).remove(paths);
  if (error) throw new Error(error.message);
}

function stableStringify(value: any): string {
  const seen = new WeakSet<object>();
  const walk = (v: any): any => {
    if (v == null) return v;
    if (typeof v !== "object") return v;
    if (Array.isArray(v)) return v.map(walk);
    if (seen.has(v)) return null;
    seen.add(v);
    const out: any = {};
    const keys = Object.keys(v).sort((a, b) => a.localeCompare(b));
    for (const k of keys) out[k] = walk(v[k]);
    return out;
  };
  return JSON.stringify(walk(value));
}

function hashNormalized(value: any) {
  const s = stableStringify(value);
  return createHash("sha1").update(s).digest("hex");
}

type NetworkSessionRecord = {
  key: string;
  bubble_id: string;
  bubble_type: string;
  base_type: string | null;
  hash: string;
  raw: any;
  normalized: any;
  sources: string[];
  firstSeenAt: string;
  lastSeenAt: string;
  updates: number;
};

type NetworkSession = {
  version: 1;
  label: string;
  email: string;
  companyId: string;
  createdAt: string;
  updatedAt: string;
  records: NetworkSessionRecord[];
  lastDelta?: { new: number; existing: number; updated: number; duplicates: number };
  lastValidation?: any;
};

function emptySession(email: string, companyId: string): NetworkSession {
  const now = new Date().toISOString();
  const label = `Importação ${String(email).split("@")[0] || email}`;
  return { version: 1, label, email, companyId, createdAt: now, updatedAt: now, records: [] };
}

function asSessionKey(bubble_type: string | null, bubble_id: string | null) {
  const t = normalizeKey(String(bubble_type ?? "")) || "-";
  const id = String(bubble_id ?? "").trim() || "-";
  return `${t}::${id}`;
}

function buildTypeIndex(records: Array<{ bubble_id: string | null; bubble_type: string | null; base_type: string | null }>) {
  const byType = new Map<string, Map<string, number>>();
  const byBase = new Map<string, Map<string, number>>();
  const anyById = new Map<string, Array<{ bubble_type: string | null; base_type: string | null }>>();
  for (let i = 0; i < records.length; i += 1) {
    const r = records[i]!;
    const id = String(r.bubble_id ?? "").trim();
    if (!id) continue;
    const t = normalizeKey(r.bubble_type ?? "") || "";
    if (t) {
      const m = byType.get(t) ?? new Map<string, number>();
      m.set(id, i);
      byType.set(t, m);
    }
    const b = String(r.base_type ?? "").trim().toLowerCase();
    if (b) {
      const m = byBase.get(b) ?? new Map<string, number>();
      m.set(id, i);
      byBase.set(b, m);
    }
    const list = anyById.get(id) ?? [];
    list.push({ bubble_type: r.bubble_type, base_type: r.base_type });
    anyById.set(id, list);
  }
  return { byType, byBase, anyById };
}

function tryParseJsonLoose(input: string) {
  const raw = String(input ?? "");
  if (!raw.trim()) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function parseMultipleJsonBlobs(text: string) {
  const out: Array<{ ok: true; value: any; snippet: string } | { ok: false; error: string; snippet: string }> = [];
  const raw = String(text ?? "");
  const full = raw.trim();
  if (!full) return out;

  const whole = tryParseJsonLoose(full);
  if (whole !== null) {
    out.push({ ok: true, value: whole, snippet: full.slice(0, 2000) });
    return out;
  }

  const s = raw;
  let i = 0;
  const len = s.length;
  const starts = new Set(["{", "["]);
  while (i < len) {
    while (i < len && !starts.has(s[i] ?? "")) i += 1;
    if (i >= len) break;
    const start = i;
    const open = s[start];
    const close = open === "{" ? "}" : "]";
    let depth = 0;
    let inString = false;
    let escaped = false;
    let j = start;
    for (; j < len; j += 1) {
      const ch = s[j] ?? "";
      if (inString) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (ch === "\\") {
          escaped = true;
          continue;
        }
        if (ch === "\"") {
          inString = false;
          continue;
        }
        continue;
      }
      if (ch === "\"") {
        inString = true;
        continue;
      }
      if (ch === open) depth += 1;
      if (ch === close) depth -= 1;
      if (depth === 0) {
        const candidate = s.slice(start, j + 1);
        const parsed = tryParseJsonLoose(candidate);
        if (parsed !== null) out.push({ ok: true, value: parsed, snippet: candidate.slice(0, 2000) });
        else out.push({ ok: false, error: "invalid_json_blob", snippet: candidate.slice(0, 2000) });
        i = j + 1;
        break;
      }
    }
    if (j >= len) break;
  }

  return out;
}

function unwrapPossibleElasticRecord(obj: any) {
  if (!obj || typeof obj !== "object") return null;
  const hasSource = obj && typeof obj._source === "object" && obj._source && !Array.isArray(obj._source);
  if (!hasSource) return null;
  const source = obj._source as any;
  const bubbleId = String(obj._id ?? source._id ?? source.unique_id ?? source.id ?? "").trim();
  const bubbleType = String(obj._type ?? source._type ?? source.type ?? "").trim();
  const merged = { ...source };
  if (bubbleId && !merged._id) merged._id = bubbleId;
  if (bubbleType && !merged._type) merged._type = bubbleType;
  return merged;
}

type DetectedRecord = {
  bubble_id: string | null;
  bubble_type: string | null;
  base_type: string | null;
  raw: any;
  normalized: any;
  sources: string[];
};

function classifyBaseType(bubbleType: string | null) {
  const t = String(bubbleType ?? "").trim();
  if (!t) return null;
  const lower = t.toLowerCase();
  if (lower === "user") return "user";
  if (lower.startsWith("custom.")) return lower;
  if (lower.startsWith("custom_")) return `custom.${lower.slice("custom_".length)}`;
  if (lower.includes("custom.") || lower.includes("custom_")) {
    const m = lower.match(/custom[._]([a-z0-9_]+)/);
    if (m) return `custom.${m[1]}`;
  }
  return lower;
}

function mapBaseTypeToTable(baseType: string | null) {
  const t = String(baseType ?? "").trim().toLowerCase();
  if (!t) return null;
  const m: Record<string, string> = {
    "custom.categorias": "categories",
    "custom.itens": "items",
    "custom.item": "items",
    "custom.fornecedores": "suppliers",
    "custom.itens_fornecedores": "supplier_items",
    "custom.notas_fiscais": "invoices",
    "custom.itens_notas": "invoice_items",
    "custom.inventarios": "inventories",
    "custom.itens_inventarios": "inventory_items",
    "custom.desperdicio": "wastes",
    "custom.motivos_desperdicios": "waste_reasons",
    "custom.etiquetas": "labels",
    "custom.ingredientes": "recipe_ingredients",
    "custom.itens_lista_compras": "shopping_list_items",
    "custom.qtd_compra_real": "purchase_real_qty",
    "custom.faturamentos": "revenues",
    "custom.empresas": "companies",
    user: "user_profiles",
  };
  return m[t] ?? null;
}

function isRefKey(key: string) {
  const k = normalizeKey(key);
  if (!k) return false;
  if (isInternalBubbleKey(k)) return false;
  if (k.includes("__lookup__")) return true;
  if (k.includes("custom_")) return true;
  if (k.endsWith("_id")) return true;
  if (k.includes("_id_custom_")) return true;
  return false;
}

function inferRefTargetBaseType(key: string) {
  const k = normalizeKey(key);
  if (!k) return null;
  if (isInternalBubbleKey(k)) return null;
  const known: Record<string, string> = {
    empresa_id_custom_empresas: "custom.empresas",
    categoria_id_custom_categorias: "custom.categorias",
    item_id_custom_itens: "custom.itens",
    fornecedor_id_custom_fornecedores: "custom.fornecedores",
    nota_id_custom_notas_fiscais: "custom.notas_fiscais",
    inventario_id_custom_inventarios: "custom.inventarios",
    motivo_custom_motivos_desperdicios: "custom.motivos_desperdicios",
    etiqueta_id_custom_etiquetas: "custom.etiquetas",
  };
  if (known[k]) return known[k];
  const m = k.match(/custom_([a-z0-9_]+)/);
  if (m) return `custom.${m[1]}`;
  return null;
}

function isInternalBubbleKey(keyOrNormalizedKey: string) {
  const k = normalizeKey(keyOrNormalizedKey);
  if (!k) return false;
  if (k.startsWith("_") && !k.startsWith("__lookup__")) return true;
  const ignore = new Set([
    "created_by",
    "modified_by",
    "created_date",
    "modified_date",
    "slug",
    "_version",
    "_type",
    "_id",
    "_unique_id",
    "unique_id",
    "_search_text",
    "search_text",
  ]);
  if (ignore.has(k)) return true;
  if (k.startsWith("created_") && k.includes("date")) return true;
  if (k.startsWith("modified_") && k.includes("date")) return true;
  if (k.includes("created_by") || k.includes("modified_by")) return true;
  return false;
}

function parseBool(v: unknown) {
  const s = String(v ?? "")
    .trim()
    .toLowerCase();
  if (s === "1" || s === "true" || s === "sim" || s === "yes") return true;
  if (s === "0" || s === "false" || s === "nao" || s === "não" || s === "no") return false;
  return Boolean(v);
}

function collectRefsFromValue(value: any) {
  const out: string[] = [];
  if (value == null) return out;
  if (typeof value === "string") {
    const v = String(normalizeBubbleRef(value) ?? "").trim();
    if (v) out.push(v);
    return out;
  }
  if (Array.isArray(value)) {
    for (const it of value) out.push(...collectRefsFromValue(it));
    return out;
  }
  if (typeof value === "object") {
    const cand = String((value as any)?._id ?? (value as any)?.unique_id ?? (value as any)?.id ?? (value as any)?.bubble_id ?? "").trim();
    if (cand) out.push(cand);
    return out;
  }
  return out;
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

function countKeysNotMapped(raw: any, mappedKeys: string[]) {
  const ignore = new Set<string>([
    "_id",
    "unique_id",
    "id",
    "created date",
    "created by",
    "modified date",
    "slug",
    "bubble_id",
    "_type",
    "type",
  ]);
  const mapped = new Set(mappedKeys.map((k) => normalizeKey(k)));
  const counts: Record<string, number> = {};
  for (const k of Object.keys(raw ?? {})) {
    const key = String(k ?? "").trim();
    const nk = normalizeKey(key).replace(/_/g, " ");
    if (!nk) continue;
    if (ignore.has(nk)) continue;
    const nk2 = normalizeKey(key);
    if (mapped.has(nk2)) continue;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

async function tableExists(supabase: ReturnType<typeof getSupabaseAdmin>, table: string) {
  const { error } = await supabase.from(table).select("*").limit(1);
  if (!error) return true;
  const msg = String((error as any)?.message ?? "").toLowerCase();
  return !msg.includes("does not exist") && !msg.includes("relation") ? true : false;
}

async function existsByCompanyBubbleId(supabase: ReturnType<typeof getSupabaseAdmin>, table: string, pairs: Array<{ company_id: string; bubble_id: string }>) {
  const existing = new Set<string>();
  const chunk = 500;
  for (let i = 0; i < pairs.length; i += chunk) {
    const part = pairs.slice(i, i + chunk);
    const byCompany = new Map<string, string[]>();
    for (const p of part) {
      const list = byCompany.get(p.company_id) ?? [];
      list.push(p.bubble_id);
      byCompany.set(p.company_id, list);
    }
    for (const [company_id, bubble_ids] of byCompany.entries()) {
      const { data, error } = await supabase.from(table).select("bubble_id").eq("company_id", company_id).in("bubble_id", bubble_ids);
      if (error) throw new Error(error.message);
      for (const r of (data ?? []) as any[]) {
        const b = String(r?.bubble_id ?? "").trim();
        if (b) existing.add(`${company_id}::${b}`);
      }
    }
  }
  return existing;
}

async function existsByBubbleId(supabase: ReturnType<typeof getSupabaseAdmin>, table: string, bubbleIds: string[]) {
  const existing = new Set<string>();
  const chunk = 800;
  for (let i = 0; i < bubbleIds.length; i += chunk) {
    const part = bubbleIds.slice(i, i + chunk);
    const { data, error } = await supabase.from(table).select("bubble_id").in("bubble_id", part);
    if (error) throw new Error(error.message);
    for (const r of (data ?? []) as any[]) {
      const b = String(r?.bubble_id ?? "").trim();
      if (b) existing.add(b);
    }
  }
  return existing;
}

function extractCandidatesFromParsedRoot(root: any, sourceLabel: string) {
  const detected: Array<{ raw: any; source: string }> = [];
  const maxNodes = 250_000;
  const maxDepth = 40;
  let nodes = 0;
  const stack: Array<{ v: any; path: string; depth: number }> = [{ v: root, path: "$", depth: 0 }];
  const seen = new WeakSet<object>();

  const pushCandidate = (obj: any, path: string) => {
    detected.push({ raw: obj, source: `${sourceLabel}:${path}` });
  };

  if (root && typeof root === "object") {
    const source = String((root as any)?.source ?? "").trim();
    if (source === "bubble-network-capture") {
      const records = (root as any)?.records;
      if (Array.isArray(records)) {
        for (let i = 0; i < records.length; i += 1) pushCandidate(records[i], `$.records[${i}]`);
      }
      const responses = (root as any)?.responses;
      if (Array.isArray(responses)) {
        for (let i = 0; i < responses.length; i += 1) {
          const r = responses[i];
          if (r && typeof r === "object" && "json" in (r as any)) pushCandidate((r as any).json, `$.responses[${i}].json`);
        }
      }
    }
  }

  while (stack.length) {
    const it = stack.pop()!;
    nodes += 1;
    if (nodes > maxNodes) break;
    const v = it.v;
    const depth = it.depth;
    if (!v || typeof v !== "object") continue;
    if (seen.has(v as any)) continue;
    seen.add(v as any);
    if (Array.isArray(v)) {
      if (depth >= maxDepth) continue;
      for (let i = v.length - 1; i >= 0; i -= 1) {
        stack.push({ v: v[i], path: `${it.path}[${i}]`, depth: depth + 1 });
      }
      continue;
    }

    const unwrapped = unwrapPossibleElasticRecord(v);
    if (unwrapped) pushCandidate(unwrapped, `${it.path}._source`);

    const obj: any = v as any;
    const bubbleId = String(obj?._id ?? obj?.unique_id ?? obj?.id ?? "").trim();
    const bubbleType = String(obj?._type ?? obj?.type ?? "").trim();
    if (bubbleId || bubbleType) pushCandidate(obj, it.path);

    if (depth >= maxDepth) continue;
    for (const [k, val] of Object.entries(obj)) {
      if (k === "_source") continue;
      const nextPath = `${it.path}.${k}`;
      stack.push({ v: val, path: nextPath, depth: depth + 1 });
    }
  }

  return detected;
}

function normalizeDetectedRecord(raw: any, sources: string[]) {
  const picked = unwrapPossibleElasticRecord(raw) ?? raw;
  const bubble_id = String(picked?._id ?? picked?.unique_id ?? picked?.id ?? "").trim() || null;
  const bubble_type = String(picked?._type ?? picked?.type ?? "").trim() || null;
  const base_type = classifyBaseType(bubble_type);
  const normalized = normalizeRecordDeep(picked);
  return { bubble_id, bubble_type, base_type, raw: picked, normalized, sources } as DetectedRecord;
}

function buildPreview(args: { companyId: string; records: DetectedRecord[]; parsedOk: number; parsedErr: number }) {
  const all = args.records;
  const totalRecordsDetected = all.length;
  const byType = new Map<string, DetectedRecord[]>();
  const missingId: DetectedRecord[] = [];
  const missingType: DetectedRecord[] = [];
  const duplicates: Array<{ key: string; count: number; sources: string[] }> = [];
  const seen = new Map<string, { count: number; sources: string[] }>();
  const indexById = new Map<string, Array<{ base_type: string | null; bubble_type: string | null }>>();
  for (const r of all) {
    if (!r.bubble_id) missingId.push(r);
    if (!r.bubble_type) missingType.push(r);
    const key = `${r.bubble_type ?? "-"}::${r.bubble_id ?? "-"}`;
    const prev = seen.get(key) ?? { count: 0, sources: [] as string[] };
    prev.count += 1;
    prev.sources.push(...r.sources);
    seen.set(key, prev);

    if (r.bubble_id) {
      const list = indexById.get(r.bubble_id) ?? [];
      list.push({ base_type: r.base_type, bubble_type: r.bubble_type });
      indexById.set(r.bubble_id, list);
    }

    const typeKey = String(r.base_type ?? r.bubble_type ?? "unknown");
    const list = byType.get(typeKey) ?? [];
    list.push(r);
    byType.set(typeKey, list);
  }
  for (const [k, v] of seen.entries()) {
    if (v.count >= 2) duplicates.push({ key: k, count: v.count, sources: v.sources.slice(0, 8) });
  }
  duplicates.sort((a, b) => b.count - a.count);

  const refStats = {
    total: 0,
    resolved: 0,
    broken: 0,
    byRelation: {} as Record<string, { resolved: number; broken: number }>,
    brokenSamples: [] as Array<{ from_type: string; from_id: string; key: string; expected: string; inferred_to: string | null }>,
    resolvedSamples: [] as Array<{ from_type: string; from_id: string; key: string; to_id: string; inferred_to: string | null }>,
  };

  const index = buildTypeIndex(all);

  for (const r of all) {
    const fromType = String(r.base_type ?? r.bubble_type ?? "unknown");
    const fromId = String(r.bubble_id ?? "-");
    if (!r.normalized || typeof r.normalized !== "object") continue;
    for (const [k, v] of Object.entries(r.normalized as any)) {
      if (!isRefKey(k)) continue;
      const inferred = inferRefTargetBaseType(k);
      const ids = collectRefsFromValue(v);
      for (const id of ids) {
        const clean = String(id ?? "").trim();
        if (!clean) continue;
        refStats.total += 1;
        const relKey = `${fromType}:${k}->${inferred ?? "*"}`;
        const hasInferred = inferred ? Boolean(index.byBase.get(inferred)?.has(clean)) : false;
        const hasAny = Boolean(index.anyById.get(clean)?.length);
        const ok = inferred ? hasInferred || hasAny : hasAny;
        if (!refStats.byRelation[relKey]) refStats.byRelation[relKey] = { resolved: 0, broken: 0 };
        if (ok) {
          refStats.resolved += 1;
          refStats.byRelation[relKey]!.resolved += 1;
          if (refStats.resolvedSamples.length < 20)
            refStats.resolvedSamples.push({ from_type: fromType, from_id: fromId, key: k, to_id: clean, inferred_to: inferred });
        } else {
          refStats.broken += 1;
          refStats.byRelation[relKey]!.broken += 1;
          if (refStats.brokenSamples.length < 20)
            refStats.brokenSamples.push({ from_type: fromType, from_id: fromId, key: k, expected: clean, inferred_to: inferred });
        }
      }
    }
  }

  const typeCounts = Array.from(byType.entries())
    .map(([type, rows]) => ({ type, count: rows.length }))
    .sort((a, b) => b.count - a.count);

  const sampleByType: Record<string, any[]> = {};
  for (const [type, rows] of byType.entries()) {
    sampleByType[type] = rows
      .slice(0, 3)
      .map((r) => ({ bubble_id: r.bubble_id, bubble_type: r.bubble_type, base_type: r.base_type, normalized: r.normalized }));
  }

  const destinationByType = typeCounts.map((t) => ({ type: t.type, table: mapBaseTypeToTable(t.type) }));

  const topUnmappedKeysByType: Record<string, Array<{ key: string; count: number }>> = {};
  for (const [type, rows] of byType.entries()) {
    const counts: Record<string, number> = {};
    for (const r of rows) {
      const raw = r.raw;
      if (!raw || typeof raw !== "object") continue;
      const mappedKeys = Object.keys(r.normalized ?? {});
      const miss = countKeysNotMapped(raw, mappedKeys);
      for (const [k, c] of Object.entries(miss)) counts[k] = (counts[k] ?? 0) + c;
    }
    topUnmappedKeysByType[type] = Object.entries(counts)
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20);
  }

  return {
    ok: true,
    mode: "bubble_network_json" as const,
    parsed: { ok: args.parsedOk, error: args.parsedErr },
    totals: {
      recordsDetected: totalRecordsDetected,
      missingBubbleId: missingId.length,
      missingBubbleType: missingType.length,
      duplicateKeys: duplicates.length,
    },
    byType: typeCounts,
    destinationByType,
    duplicates: duplicates.slice(0, 50),
    missing: {
      bubbleId: missingId.slice(0, 50).map((r) => ({ bubble_type: r.bubble_type, bubble_id: r.bubble_id, sources: r.sources.slice(0, 5) })),
      bubbleType: missingType.slice(0, 50).map((r) => ({ bubble_type: r.bubble_type, bubble_id: r.bubble_id, sources: r.sources.slice(0, 5) })),
    },
    relations: refStats,
    unmapped: { topUnmappedKeysByType },
    samples: sampleByType,
    plan: {
      companyId: args.companyId,
      byTable: [] as Array<{
        table: string;
        baseTypes: string[];
        sourceRows: number;
        plannedRows: number;
        missingBubbleId: number;
        duplicatesInSource: number;
        wouldCreate: number;
        wouldUpdate: number;
        wouldIgnore: number;
        brokenRelations: number;
      }>,
    },
    detectedRecords: all.map((r) => {
      const bubble_type = r.bubble_type;
      const bubble_id = r.bubble_id;
      const base = String(r.base_type ?? r.bubble_type ?? "").trim().toLowerCase();
      const table = mapBaseTypeToTable(base);
      const ignoreReason = !bubble_id ? "missing_bubble_id" : !bubble_type ? "missing_bubble_type" : !table ? "unmapped_destination" : "";
      const status = ignoreReason ? "ignored" : "ready";
      return { bubble_type, bubble_id, table, status, ignoreReason };
    }),
    recordsForApply: all.map((r) => ({
      bubble_id: r.bubble_id,
      bubble_type: r.bubble_type,
      base_type: r.base_type,
      raw: r.raw,
      normalized: r.normalized,
      sources: r.sources,
    })),
  };
}

function validateIntegrity(records: DetectedRecord[]) {
  const idx = buildTypeIndex(records);
  const byBaseType = new Map<string, DetectedRecord[]>();
  for (const r of records) {
    const b = String(r.base_type ?? "").trim().toLowerCase();
    const list = byBaseType.get(b) ?? [];
    list.push(r);
    byBaseType.set(b, list);
  }

  const checks: Array<{ key: string; label: string; critical: boolean; count: number; samples: any[] }> = [];
  const push = (key: string, label: string, critical: boolean, count: number, samples: any[]) => {
    checks.push({ key, label, critical, count, samples });
  };

  const companyIds = new Set((byBaseType.get("custom.empresas") ?? []).map((r) => String(r.bubble_id ?? "").trim()).filter(Boolean));
  const categoryIds = new Set((byBaseType.get("custom.categorias") ?? []).map((r) => String(r.bubble_id ?? "").trim()).filter(Boolean));
  const supplierIds = new Set((byBaseType.get("custom.fornecedores") ?? []).map((r) => String(r.bubble_id ?? "").trim()).filter(Boolean));
  const itemIds = new Set(
    [...(byBaseType.get("custom.itens") ?? []), ...(byBaseType.get("custom.item") ?? [])].map((r) => String(r.bubble_id ?? "").trim()).filter(Boolean),
  );
  const invoiceIds = new Set((byBaseType.get("custom.notas_fiscais") ?? []).map((r) => String(r.bubble_id ?? "").trim()).filter(Boolean));
  const inventoryIds = new Set((byBaseType.get("custom.inventarios") ?? []).map((r) => String(r.bubble_id ?? "").trim()).filter(Boolean));
  const wasteReasonIds = new Set((byBaseType.get("custom.motivos_desperdicios") ?? []).map((r) => String(r.bubble_id ?? "").trim()).filter(Boolean));

  const categoriasInexistentesSamples: any[] = [];
  let categoriasInexistentes = 0;
  const items = byBaseType.get("custom.itens") ?? byBaseType.get("custom.item") ?? [];
  for (const r of items) {
    const raw = r.normalized ?? {};
    const categoriaId = extractBubbleId((raw as any)?.categoria_id_custom_categorias ?? (raw as any)?.categoria_id ?? "");
    if (!categoriaId) continue;
    if (categoryIds.has(categoriaId)) continue;
    categoriasInexistentes += 1;
    if (categoriasInexistentesSamples.length < 30) categoriasInexistentesSamples.push({ itemId: r.bubble_id, categoriaId });
  }
  push("missing_categories", "Categorias inexistentes (itens)", true, categoriasInexistentes, categoriasInexistentesSamples);

  const itensEmpresaInexistenteSamples: any[] = [];
  let itensEmpresaInexistente = 0;
  for (const r of items) {
    const raw = r.normalized ?? {};
    const empresaId = extractBubbleId((raw as any)?.empresa_id_custom_empresas ?? (raw as any)?.empresa_id ?? (raw as any)?.empresa ?? "");
    if (!empresaId) continue;
    if (companyIds.has(empresaId)) continue;
    itensEmpresaInexistente += 1;
    if (itensEmpresaInexistenteSamples.length < 30) itensEmpresaInexistenteSamples.push({ itemId: r.bubble_id, empresaId });
  }
  push("missing_company_items", "Empresa inexistente (itens)", true, itensEmpresaInexistente, itensEmpresaInexistenteSamples);

  const fornecedoresInexistentesSamples: any[] = [];
  let fornecedoresInexistentes = 0;
  const invoices = byBaseType.get("custom.notas_fiscais") ?? [];
  for (const r of invoices) {
    const raw = r.normalized ?? {};
    const fornecedorId = extractBubbleId((raw as any)?.fornecedor_id_custom_fornecedores ?? (raw as any)?.fornecedor_id ?? "");
    if (!fornecedorId) continue;
    if (supplierIds.has(fornecedorId)) continue;
    fornecedoresInexistentes += 1;
    if (fornecedoresInexistentesSamples.length < 30) fornecedoresInexistentesSamples.push({ notaId: r.bubble_id, fornecedorId });
  }
  push("missing_suppliers", "Fornecedores inexistentes (notas)", true, fornecedoresInexistentes, fornecedoresInexistentesSamples);

  const notasEmpresaInexistenteSamples: any[] = [];
  let notasEmpresaInexistente = 0;
  for (const r of invoices) {
    const raw = r.normalized ?? {};
    const empresaId = extractBubbleId((raw as any)?.empresa_id_custom_empresas ?? (raw as any)?.empresa_id ?? (raw as any)?.empresa ?? "");
    if (!empresaId) continue;
    if (companyIds.has(empresaId)) continue;
    notasEmpresaInexistente += 1;
    if (notasEmpresaInexistenteSamples.length < 30) notasEmpresaInexistenteSamples.push({ notaId: r.bubble_id, empresaId });
  }
  push("missing_company_invoices", "Empresa inexistente (notas)", true, notasEmpresaInexistente, notasEmpresaInexistenteSamples);

  const notasSemFornecedorSamples: any[] = [];
  let notasSemFornecedor = 0;
  for (const r of invoices) {
    const raw = r.normalized ?? {};
    const fornecedorId = extractBubbleId((raw as any)?.fornecedor_id_custom_fornecedores ?? (raw as any)?.fornecedor_id ?? "");
    if (fornecedorId) continue;
    notasSemFornecedor += 1;
    if (notasSemFornecedorSamples.length < 30) notasSemFornecedorSamples.push({ notaId: r.bubble_id });
  }
  push("invoices_without_supplier", "Notas sem fornecedor", true, notasSemFornecedor, notasSemFornecedorSamples);

  const invItemsRows = byBaseType.get("custom.itens_notas") ?? [];
  const itensNotasSemNotaSamples: any[] = [];
  let itensNotasSemNota = 0;
  const itensNotasSemItemSamples: any[] = [];
  let itensNotasSemItem = 0;
  for (const r of invItemsRows) {
    const raw = r.normalized ?? {};
    const notaId = extractBubbleId((raw as any)?.nota_id_custom_notas_fiscais ?? (raw as any)?.nota_id ?? (raw as any)?.invoice_id ?? "");
    const itemId = extractBubbleId((raw as any)?.item_id_custom_itens ?? (raw as any)?.item_id ?? "");
    if (notaId && !invoiceIds.has(notaId)) {
      itensNotasSemNota += 1;
      if (itensNotasSemNotaSamples.length < 30) itensNotasSemNotaSamples.push({ itemNotaId: r.bubble_id, notaId });
    }
    if (itemId && !itemIds.has(itemId)) {
      itensNotasSemItem += 1;
      if (itensNotasSemItemSamples.length < 30) itensNotasSemItemSamples.push({ itemNotaId: r.bubble_id, itemId });
    }
  }
  push("invoice_items_missing_invoice", "Itens da nota com nota inexistente", true, itensNotasSemNota, itensNotasSemNotaSamples);
  push("invoice_items_missing_item", "Itens da nota com item inexistente", true, itensNotasSemItem, itensNotasSemItemSamples);

  const invItems = byBaseType.get("custom.itens_inventarios") ?? [];
  const invIdHasItems = new Map<string, number>();
  for (const r of invItems) {
    const raw = r.normalized ?? {};
    const invId = extractBubbleId((raw as any)?.inventario_id_custom_inventarios ?? (raw as any)?.inventario_id ?? "");
    if (!invId) continue;
    invIdHasItems.set(invId, (invIdHasItems.get(invId) ?? 0) + 1);
  }
  const inventariosSemItensSamples: any[] = [];
  let inventariosSemItens = 0;
  const inventories = byBaseType.get("custom.inventarios") ?? [];
  for (const r of inventories) {
    const invId = String(r.bubble_id ?? "").trim();
    if (!invId) continue;
    if ((invIdHasItems.get(invId) ?? 0) > 0) continue;
    inventariosSemItens += 1;
    if (inventariosSemItensSamples.length < 30) inventariosSemItensSamples.push({ inventarioId: invId });
  }
  push("inventories_without_items", "Inventários sem itens", false, inventariosSemItens, inventariosSemItensSamples);

  const inventariosEmpresaInexistenteSamples: any[] = [];
  let inventariosEmpresaInexistente = 0;
  for (const r of inventories) {
    const raw = r.normalized ?? {};
    const empresaId = extractBubbleId((raw as any)?.empresa_id_custom_empresas ?? (raw as any)?.empresa_id ?? (raw as any)?.empresa ?? "");
    if (!empresaId) continue;
    if (companyIds.has(empresaId)) continue;
    inventariosEmpresaInexistente += 1;
    if (inventariosEmpresaInexistenteSamples.length < 30) inventariosEmpresaInexistenteSamples.push({ inventarioId: r.bubble_id, empresaId });
  }
  push("missing_company_inventories", "Empresa inexistente (inventários)", true, inventariosEmpresaInexistente, inventariosEmpresaInexistenteSamples);

  const inventoryItems = byBaseType.get("custom.itens_inventarios") ?? [];
  const itensInventarioInventarioInexistenteSamples: any[] = [];
  let itensInventarioInventarioInexistente = 0;
  const itensInventarioItemInexistenteSamples: any[] = [];
  let itensInventarioItemInexistente = 0;
  for (const r of inventoryItems) {
    const raw = r.normalized ?? {};
    const invId = extractBubbleId((raw as any)?.inventario_id_custom_inventarios ?? (raw as any)?.inventario_id ?? "");
    const itemId = extractBubbleId((raw as any)?.item_id_custom_itens ?? (raw as any)?.item_id ?? "");
    if (invId && !inventoryIds.has(invId)) {
      itensInventarioInventarioInexistente += 1;
      if (itensInventarioInventarioInexistenteSamples.length < 30) itensInventarioInventarioInexistenteSamples.push({ itemInventarioId: r.bubble_id, inventarioId: invId });
    }
    if (itemId && !itemIds.has(itemId)) {
      itensInventarioItemInexistente += 1;
      if (itensInventarioItemInexistenteSamples.length < 30) itensInventarioItemInexistenteSamples.push({ itemInventarioId: r.bubble_id, itemId });
    }
  }
  push("inventory_items_missing_inventory", "Itens do inventário com inventário inexistente", true, itensInventarioInventarioInexistente, itensInventarioInventarioInexistenteSamples);
  push("inventory_items_missing_item", "Itens do inventário com item inexistente", true, itensInventarioItemInexistente, itensInventarioItemInexistenteSamples);

  const wastes = byBaseType.get("custom.desperdicio") ?? [];
  const desperdicioSemMotivoSamples: any[] = [];
  let desperdicioSemMotivo = 0;
  for (const r of wastes) {
    const raw = r.normalized ?? {};
    const motivoId = extractBubbleId((raw as any)?.motivo_custom_motivos_desperdicios ?? (raw as any)?.motivo ?? "");
    if (motivoId) continue;
    desperdicioSemMotivo += 1;
    if (desperdicioSemMotivoSamples.length < 30) desperdicioSemMotivoSamples.push({ desperdicioId: r.bubble_id });
  }
  push("wastes_without_reason", "Desperdícios sem motivo", true, desperdicioSemMotivo, desperdicioSemMotivoSamples);

  const desperdicioMotivoInexistenteSamples: any[] = [];
  let desperdicioMotivoInexistente = 0;
  const desperdicioItemInexistenteSamples: any[] = [];
  let desperdicioItemInexistente = 0;
  for (const r of wastes) {
    const raw = r.normalized ?? {};
    const motivoId = extractBubbleId((raw as any)?.motivo_custom_motivos_desperdicios ?? (raw as any)?.motivo ?? "");
    const itemId = extractBubbleId((raw as any)?.item_id_custom_itens ?? (raw as any)?.item_id ?? "");
    if (motivoId && !wasteReasonIds.has(motivoId)) {
      desperdicioMotivoInexistente += 1;
      if (desperdicioMotivoInexistenteSamples.length < 30) desperdicioMotivoInexistenteSamples.push({ desperdicioId: r.bubble_id, motivoId });
    }
    if (itemId && !itemIds.has(itemId)) {
      desperdicioItemInexistente += 1;
      if (desperdicioItemInexistenteSamples.length < 30) desperdicioItemInexistenteSamples.push({ desperdicioId: r.bubble_id, itemId });
    }
  }
  push("wastes_missing_reason", "Motivo inexistente (desperdícios)", true, desperdicioMotivoInexistente, desperdicioMotivoInexistenteSamples);
  push("wastes_missing_item", "Item inexistente (desperdícios)", true, desperdicioItemInexistente, desperdicioItemInexistenteSamples);

  const ingredients = byBaseType.get("custom.ingredientes") ?? [];
  const ingredientesReceitaInexistenteSamples: any[] = [];
  let ingredientesReceitaInexistente = 0;
  const ingredientesItemInexistenteSamples: any[] = [];
  let ingredientesItemInexistente = 0;
  for (const r of ingredients) {
    const raw = r.normalized ?? {};
    const recipeId = extractBubbleId((raw as any)?.receita_id_custom_itens ?? (raw as any)?.receita_id ?? (raw as any)?.recipe_id ?? "");
    const itemId = extractBubbleId((raw as any)?.item_id_custom_itens ?? (raw as any)?.item_id ?? (raw as any)?.ingredient_item_id_custom_itens ?? "");
    if (recipeId && !itemIds.has(recipeId)) {
      ingredientesReceitaInexistente += 1;
      if (ingredientesReceitaInexistenteSamples.length < 30) ingredientesReceitaInexistenteSamples.push({ ingredienteId: r.bubble_id, receitaId: recipeId });
    }
    if (itemId && !itemIds.has(itemId)) {
      ingredientesItemInexistente += 1;
      if (ingredientesItemInexistenteSamples.length < 30) ingredientesItemInexistenteSamples.push({ ingredienteId: r.bubble_id, itemId });
    }
  }
  push("ingredients_missing_recipe", "Ingrediente com receita inexistente", true, ingredientesReceitaInexistente, ingredientesReceitaInexistenteSamples);
  push("ingredients_missing_item", "Ingrediente com item inexistente", true, ingredientesItemInexistente, ingredientesItemInexistenteSamples);

  const byRecipe = new Map<string, number>();
  for (const r of ingredients) {
    const raw = r.normalized ?? {};
    const recipeId = extractBubbleId((raw as any)?.receita_id_custom_itens ?? (raw as any)?.receita_id ?? (raw as any)?.recipe_id ?? "");
    if (!recipeId) continue;
    byRecipe.set(recipeId, (byRecipe.get(recipeId) ?? 0) + 1);
  }
  const receitasSemIngredientesSamples: any[] = [];
  let receitasSemIngredientes = 0;
  for (const r of items) {
    const raw = r.normalized ?? {};
    const isRecipe = parseBool((raw as any)?.boolean_item_receita ?? (raw as any)?.boolean_item_receita_custom_itens ?? (raw as any)?.item_receita);
    if (!isRecipe) continue;
    const recipeId = String(r.bubble_id ?? "").trim();
    if (!recipeId) continue;
    if ((byRecipe.get(recipeId) ?? 0) > 0) continue;
    receitasSemIngredientes += 1;
    if (receitasSemIngredientesSamples.length < 30) receitasSemIngredientesSamples.push({ receitaId: recipeId });
  }
  push("recipes_without_ingredients", "Receitas sem ingredientes", false, receitasSemIngredientes, receitasSemIngredientesSamples);

  const criticalCount = checks.filter((c) => c.critical).reduce((acc, c) => acc + c.count, 0);
  const warningsCount = checks.filter((c) => !c.critical).reduce((acc, c) => acc + c.count, 0);
  return { ok: true, criticalCount, warningsCount, checks };
}

export async function POST(req: NextRequest) {
  try {
    const isLocalDev = isLocalDevRequest(req);
    const { userId } = getUserIdFromRequest(req);
    if (!userId && !isLocalDev) return json({ ok: false, error: "unauthorized" }, { status: 401 });

    const body = (await req.json().catch(() => null)) as any;
    const email = safeEmail(body?.email);
    const companyId = String(body?.companyId ?? "").trim();
    const action = String(body?.action ?? "append").trim().toLowerCase();
    const text = String(body?.text ?? "");
    if (!email) return json({ ok: false, error: "invalid_email" }, { status: 400 });
    if (!companyId) return json({ ok: false, error: "missing_company_id" }, { status: 400 });

    let supabase: ReturnType<typeof getSupabaseAdmin>;
    try {
      supabase = getSupabaseAdmin();
    } catch {
      return json({ ok: false, error: "supabase_not_configured" }, { status: 500 });
    }

    const requesterId = String(userId ?? "").trim();
    const requesterEmail = await getUserEmailFromDb(supabase, requesterId);
    const selfOk = isUuid(requesterId) && requesterEmail === email;
    const adminOk = isLocalDev ? true : await isAdminRequester(supabase, requesterId);
    if (!selfOk && !adminOk) return json({ ok: false, error: "forbidden" }, { status: 403 });

    const bucket = "admin-importacao-manual";
    await ensureBucket(supabase, bucket);
    const sessionPath = `sessions/network-json/${email}/${companyId}/current.json`;
    const loaded = await downloadJsonFromStorage(supabase, bucket, sessionPath);
    if (!loaded.ok) return json({ ok: false, error: loaded.error }, { status: 500 });
    const currentSession = (loaded.value && typeof loaded.value === "object" ? (loaded.value as NetworkSession) : null) ?? emptySession(email, companyId);
    const session: NetworkSession = {
      version: 1,
      label: String((currentSession as any)?.label ?? `Importação ${String(email).split("@")[0] || email}`),
      email,
      companyId,
      createdAt: String((currentSession as any)?.createdAt ?? currentSession.createdAt),
      updatedAt: action === "append" ? new Date().toISOString() : String((currentSession as any)?.updatedAt ?? currentSession.updatedAt ?? new Date().toISOString()),
      records: Array.isArray((currentSession as any)?.records) ? ((currentSession as any).records as NetworkSessionRecord[]) : [],
      lastDelta: (currentSession as any)?.lastDelta,
      lastValidation: (currentSession as any)?.lastValidation,
    };

    const recordByKey = new Map<string, NetworkSessionRecord>();
    for (const r of session.records) {
      const k = String((r as any)?.key ?? "");
      if (k) recordByKey.set(k, r as NetworkSessionRecord);
    }

    const delta = { new: 0, existing: 0, updated: 0, duplicates: 0 };
    let parsedOk = 0;
    let parsedErr = 0;

    if (action === "reset") {
      await removeFromStorage(supabase, bucket, [sessionPath]).catch(() => {});
      const preview = buildPreview({ companyId, records: [], parsedOk: 0, parsedErr: 0 });
      (preview as any).session = { label: session.label, companyId, updatedAt: new Date().toISOString(), records: 0, path: sessionPath };
      (preview as any).delta = delta;
      return json({ ok: true, result: preview }, { status: 200 });
    }

    if (action === "append") {
      if (!text.trim()) return json({ ok: false, error: "missing_text" }, { status: 400 });
      const blobs = parseMultipleJsonBlobs(text);
      parsedOk = blobs.filter((b) => b.ok).length;
      parsedErr = blobs.filter((b) => !b.ok).length;
      const parsedRoots = blobs.filter((b): b is { ok: true; value: any; snippet: string } => b.ok).map((b) => b.value);

      const candidates: Array<{ raw: any; source: string }> = [];
      for (let idx = 0; idx < parsedRoots.length; idx += 1) {
        const root = parsedRoots[idx];
        const found = extractCandidatesFromParsedRoot(root, `json#${idx + 1}`);
        candidates.push(...found);
      }

      const merged = new Map<string, DetectedRecord>();
      for (const c of candidates) {
        const raw = c.raw;
        const bubble_id = String(raw?._id ?? raw?.unique_id ?? raw?.id ?? "").trim();
        const bubble_type = String(raw?._type ?? raw?.type ?? "").trim();
        const key = `${bubble_type || "-"}::${bubble_id || "-"}::${normalizeKey(JSON.stringify(Object.keys(raw ?? {}).slice(0, 20)))}`;
        const prev = merged.get(key);
        if (!prev) merged.set(key, normalizeDetectedRecord(raw, [c.source]));
        else prev.sources.push(c.source);
      }

      const newRecords = Array.from(merged.values()).filter((r) => r.bubble_id && r.bubble_type);
      const seenInPaste = new Set<string>();
      const now = new Date().toISOString();
      for (const r of newRecords) {
        const key = asSessionKey(r.bubble_type, r.bubble_id);
        if (seenInPaste.has(key)) {
          delta.duplicates += 1;
          continue;
        }
        seenInPaste.add(key);
        const hash = hashNormalized(r.normalized);
        const prev = recordByKey.get(key) ?? null;
        if (!prev) {
          delta.new += 1;
          recordByKey.set(key, {
            key,
            bubble_id: String(r.bubble_id),
            bubble_type: String(r.bubble_type),
            base_type: r.base_type,
            hash,
            raw: r.raw,
            normalized: r.normalized,
            sources: r.sources,
            firstSeenAt: now,
            lastSeenAt: now,
            updates: 0,
          });
          continue;
        }
        if (String(prev.hash ?? "") === hash) {
          delta.existing += 1;
          prev.lastSeenAt = now;
          prev.sources = Array.from(new Set([...(prev.sources ?? []), ...(r.sources ?? [])])).slice(0, 200);
          continue;
        }
        delta.updated += 1;
        prev.hash = hash;
        prev.raw = r.raw;
        prev.normalized = r.normalized;
        prev.base_type = r.base_type;
        prev.lastSeenAt = now;
        prev.updates = Number(prev.updates ?? 0) + 1;
        prev.sources = Array.from(new Set([...(prev.sources ?? []), ...(r.sources ?? [])])).slice(0, 200);
      }
    }

    const recordsForPreview: DetectedRecord[] = Array.from(recordByKey.values()).map((r) => ({
      bubble_id: r.bubble_id,
      bubble_type: r.bubble_type,
      base_type: r.base_type,
      raw: r.raw,
      normalized: r.normalized,
      sources: r.sources,
    })) as any;

    const preview = buildPreview({ companyId, records: recordsForPreview, parsedOk, parsedErr });

    const typesByTable = new Map<string, Set<string>>();
    const rowsByTable = new Map<string, DetectedRecord[]>();
    for (const r of recordsForPreview) {
      const base = String(r.base_type ?? r.bubble_type ?? "").trim().toLowerCase();
      const table = mapBaseTypeToTable(base);
      if (!table) continue;
      if (!typesByTable.has(table)) typesByTable.set(table, new Set());
      typesByTable.get(table)!.add(base);
      const list = rowsByTable.get(table) ?? [];
      list.push(r);
      rowsByTable.set(table, list);
    }

    const planByTable = [] as any[];
    for (const [table, rows] of rowsByTable.entries()) {
      const baseTypes = Array.from(typesByTable.get(table) ?? []).sort();
      const tableOk = await tableExists(supabase, table);
      const sourceRows = rows.length;
      const withId = rows.filter((r) => r.bubble_id).map((r) => String(r.bubble_id));
      const missingBubbleId = sourceRows - withId.length;
      const duplicatesInSource = (() => {
        const m = new Map<string, number>();
        for (const r of rows) {
          const k = String(r.bubble_id ?? "-");
          if (!k || k === "-") continue;
          m.set(k, (m.get(k) ?? 0) + 1);
        }
        return Array.from(m.values()).filter((c) => c >= 2).length;
      })();
      if (!tableOk) {
        planByTable.push({
          table,
          baseTypes,
          sourceRows,
          plannedRows: withId.length,
          missingBubbleId,
          duplicatesInSource,
          wouldCreate: 0,
          wouldUpdate: 0,
          wouldIgnore: withId.length,
          brokenRelations: 0,
          reason: "table_missing",
        });
        continue;
      }

      const companyScoped = table !== "companies" && table !== "user_profiles" && table !== "company_members";
      let existing: Set<string>;
      if (!withId.length) existing = new Set();
      else if (!companyScoped) {
        existing = await existsByBubbleId(supabase, table, withId);
      } else {
        const pairs = withId.map((bubble_id) => ({ company_id: companyId, bubble_id }));
        existing = await existsByCompanyBubbleId(supabase, table, pairs);
      }

      let wouldUpdate = 0;
      let wouldCreate = 0;
      for (const bubble_id of withId) {
        const k = companyScoped ? `${companyId}::${bubble_id}` : bubble_id;
        if (existing.has(k)) wouldUpdate += 1;
        else wouldCreate += 1;
      }
      planByTable.push({
        table,
        baseTypes,
        sourceRows,
        plannedRows: withId.length,
        missingBubbleId,
        duplicatesInSource,
        wouldCreate,
        wouldUpdate,
        wouldIgnore: missingBubbleId,
        brokenRelations: 0,
      });
    }

    (preview as any).plan.byTable = planByTable.sort((a: any, b: any) => String(a.table).localeCompare(String(b.table)));
    (preview as any).delta = delta;
    (preview as any).session = {
      label: session.label,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      records: recordByKey.size,
      path: sessionPath,
    };
    if (action === "validate") (preview as any).validation = validateIntegrity(recordsForPreview);

    if (action === "append") {
      session.records = Array.from(recordByKey.values());
      session.lastDelta = delta;
      session.updatedAt = new Date().toISOString();
      const stamp = session.updatedAt.replace(/[:.]/g, "-");
      const historyPath = `sessions/network-json/${email}/${companyId}/history/${stamp}.json`;
      await uploadJsonToStorage(supabase, bucket, sessionPath, session);
      await uploadJsonToStorage(supabase, bucket, historyPath, session);
    }

    return json({ ok: true, result: preview }, { status: 200 });
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
