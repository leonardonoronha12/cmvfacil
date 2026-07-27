import { NextRequest, NextResponse } from "next/server";
import { getUserIdFromRequest } from "../../../../lib/requestUserId";
import { getSupabaseAdmin } from "../../../../lib/supabaseAdmin";
import { isLocalDevRequest } from "../../../../lib/localDevRequest";
import { createHash } from "crypto";
import { writeFile } from "fs/promises";
import { join } from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return NextResponse.json(data, { ...init, headers });
}

async function ensureBucket(supabase: ReturnType<typeof getSupabaseAdmin>, bucket: string) {
  const got = await supabase.storage.getBucket(bucket);
  if (!got.error) return;
  await supabase.storage.createBucket(bucket, { public: false }).catch(() => {});
}

async function uploadJson(supabase: ReturnType<typeof getSupabaseAdmin>, bucket: string, filePath: string, value: any) {
  const bytes = new TextEncoder().encode(JSON.stringify(value, null, 2));
  const { error } = await supabase.storage.from(bucket).upload(filePath, bytes, { contentType: "application/json", upsert: true } as any);
  if (error) throw new Error(error.message);
}

function normalizeText(v: unknown) {
  return String(v ?? "").replace(/\s+/g, " ").trim();
}

function normalizeNameKey(v: unknown) {
  return normalizeText(v).toLowerCase();
}

function normalizeExternalKeyPart(v: unknown) {
  return normalizeNameKey(v).replace(/:/g, "_").slice(0, 80);
}

function normalizeNumberToken(v: unknown) {
  const s0 = normalizeText(v).replace(/\s+/g, "");
  if (!s0) return "";
  const s = s0.includes(",") && !s0.includes(".") ? s0.replace(",", ".") : s0.replace(/,/g, "");
  const n = Number(s);
  if (!Number.isFinite(n)) return "";
  return String(n);
}

function computeExternalKey(baseType: string | null, normalized: Record<string, any>) {
  const t = String(baseType ?? "").trim().toLowerCase();
  if (!t) return null;
  const get = (keys: string[]) => {
    for (const k of keys) {
      const nk = normalizeKey(k);
      if (normalized[nk] != null) return normalized[nk];
      if ((normalized as any)[k] != null) return (normalized as any)[k];
    }
    return undefined;
  };

  if (t === "custom.categorias") {
    const nome = normalizeExternalKeyPart(get(["nome", "nome_custom_categorias", "name"]) ?? "");
    return nome ? `categoria:${nome}` : null;
  }
  if (t === "custom.fornecedores") {
    const nome = normalizeExternalKeyPart(get(["nome", "nome_custom_fornecedores", "name"]) ?? "");
    return nome ? `fornecedor:${nome}` : null;
  }
  if (t === "custom.notas_fiscais") {
    const fornecedor = normalizeText(get(["fornecedor_id_custom_fornecedores", "fornecedor_id", "fornecedor", "supplier", "supplier_id"]) ?? "");
    const fornecedorPart = fornecedor ? (looksLikeBubbleId(fornecedor) ? `bid_${extractBubbleId(fornecedor)}` : normalizeExternalKeyPart(fornecedor)) : "";
    const dt =
      parseDateOnlyFlex(get(["data_recebimento", "data_recebimento_custom_notas_fiscais", "data"]) ?? "") ??
      parseDateOnlyFlex(get(["data_criacao", "data_criacao_custom_notas_fiscais", "created_date", "Created Date"]) ?? "") ??
      "";
    const datePart = normalizeExternalKeyPart(dt);
    return datePart && fornecedorPart ? `nota:${datePart}:${fornecedorPart}` : null;
  }
  if (t === "custom.inventarios") {
    const dt = parseDateOnlyFlex(get(["data_contagem", "data_contagem_custom_inventarios", "created_date", "Created Date"]) ?? "") ?? "";
    const datePart = normalizeExternalKeyPart(dt);
    return datePart ? `inventario:${datePart}` : null;
  }
  if (t === "custom.motivos_desperdicios") {
    const nome = normalizeExternalKeyPart(get(["titulo", "titulo_custom_motivos_desperdicios", "nome", "nome_custom_motivos_desperdicios", "name", "motivo"]) ?? "");
    return nome ? `motivo:${nome}` : null;
  }
  if (t === "custom.ingredientes") {
    const receita = normalizeText(get(["receita_id_custom_itens", "receita_id", "recipe_id", "receita", "recipe"]) ?? "");
    const receitaPart = receita ? (looksLikeBubbleId(receita) ? `bid_${extractBubbleId(receita)}` : normalizeExternalKeyPart(receita)) : "";
    const item = normalizeText(get(["item_id_custom_itens", "item_id", "item", "ingredient_item_id_custom_itens"]) ?? "");
    const itemPart = item ? (looksLikeBubbleId(item) ? `bid_${extractBubbleId(item)}` : normalizeExternalKeyPart(item)) : "";
    return receitaPart && itemPart ? `ingrediente:${receitaPart}:${itemPart}` : null;
  }
  if (t === "custom.custo_medio_item") {
    const item = normalizeText(get(["item_id_custom_itens", "item_id", "item"]) ?? "");
    const itemPart = item ? (looksLikeBubbleId(item) ? `bid_${extractBubbleId(item)}` : normalizeExternalKeyPart(item)) : "";
    const dt = parseDateOnlyFlex(get(["data_lancamento", "data_lancamento_custom_custo_medio_item", "Created Date", "created_date"]) ?? "") ?? "";
    const datePart = normalizeExternalKeyPart(dt);
    const valor = normalizeNumberToken(get(["custo_medio", "custo_medio_custom_custo_medio_item"]) ?? "");
    const valorPart = normalizeExternalKeyPart(valor);
    return itemPart && datePart && valorPart ? `custo:${itemPart}:${datePart}:${valorPart}` : null;
  }
  if (t === "custom.desperdicio") {
    const dt = parseDateOnlyFlex(get(["lancamento", "lancamento_custom_desperdicio", "Created Date", "created_date"]) ?? "") ?? "";
    const datePart = normalizeExternalKeyPart(dt);
    const item = normalizeText(get(["item_id_custom_itens", "item_id", "item"]) ?? "");
    const itemPart = item ? (looksLikeBubbleId(item) ? `bid_${extractBubbleId(item)}` : normalizeExternalKeyPart(item)) : "";
    const motivo = normalizeText(get(["motivo_custom_motivos_desperdicios", "motivo", "motivo_id_custom_motivos_desperdicios", "motivo_text", "motivo_text_custom_desperdicio"]) ?? "");
    const motivoPart = motivo ? (looksLikeBubbleId(motivo) ? `bid_${extractBubbleId(motivo)}` : normalizeExternalKeyPart(motivo)) : "";
    return datePart && itemPart && motivoPart ? `desperdicio:${datePart}:${itemPart}:${motivoPart}` : null;
  }

  const stable = (() => {
    try {
      const keys = Object.keys(normalized ?? {}).sort();
      const pairs = keys.map((k) => `${k}=${normalizeText((normalized as any)[k])}`);
      return `${t}|${pairs.join("&")}`;
    } catch {
      return t;
    }
  })();
  const h = createHash("sha256").update(stable).digest("hex").slice(0, 24);
  return `ext:${normalizeKey(t)}:${h}`;
}

function safeEmail(input: unknown) {
  const v = String(input ?? "").trim().toLowerCase();
  if (!v || !v.includes("@")) return "";
  return v;
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

async function withTimeout<T>(p: PromiseLike<T>, ms: number, errorCode: string): Promise<T> {
  let t: any = null;
  try {
    const promise = new Promise<T>((resolve, reject) => p.then(resolve, reject));
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        t = setTimeout(() => reject(new Error(errorCode)), ms);
      }),
    ]);
  } finally {
    if (t) clearTimeout(t);
  }
}

async function getUserEmailFromDb(supabase: ReturnType<typeof getSupabaseAdmin>, userId: string) {
  if (!isUuid(userId)) return null;
  const { data, error } = await withTimeout(
    supabase.from("user_profiles").select("email").eq("user_id", userId).maybeSingle(),
    2500,
    "user_profiles_lookup_timeout",
  );
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
    .replace(/^\uFEFF/, "")
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

function looksLikeBubbleId(v: unknown) {
  const s = String(v ?? "").trim();
  return /\d{8,}x\d{6,}/.test(s);
}

function parseDateOnlyFlex(v: unknown) {
  const s0 = String(v ?? "").trim();
  if (!s0) return null;
  const s = s0.replace(/\s+/g, " ");
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

function guessCsvDelimiter(headerLine: string) {
  const line = headerLine ?? "";
  const candidates: Array<{ d: string; count: number }> = [
    { d: ";", count: (line.match(/;/g) ?? []).length },
    { d: ",", count: (line.match(/,/g) ?? []).length },
    { d: "\t", count: (line.match(/\t/g) ?? []).length },
  ];
  candidates.sort((a, b) => b.count - a.count);
  return candidates[0]?.count ? candidates[0].d : ",";
}

function parseCsv(text: string) {
  const src = String(text ?? "");
  const firstNewline = src.indexOf("\n");
  const headerLine = firstNewline >= 0 ? src.slice(0, firstNewline) : src;
  const delimiter = guessCsvDelimiter(headerLine.replace(/\r/g, ""));
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i] ?? "";
    const next = src[i + 1] ?? "";
    if (inQuotes) {
      if (ch === '"' && next === '"') {
        field += '"';
        i += 1;
        continue;
      }
      if (ch === '"') {
        inQuotes = false;
        continue;
      }
      field += ch;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === "\r") continue;
    if (ch === delimiter) {
      row.push(field);
      field = "";
      continue;
    }
    if (ch === "\n") {
      row.push(field);
      field = "";
      const hasAny = row.some((x) => String(x ?? "").trim() !== "");
      if (hasAny) rows.push(row);
      row = [];
      continue;
    }
    field += ch;
  }
  row.push(field);
  const hasAny = row.some((x) => String(x ?? "").trim() !== "");
  if (hasAny) rows.push(row);
  if (!rows.length) return { headers: [] as string[], rows: [] as string[][] };
  const headers = rows[0] ?? [];
  const dataRows = rows.slice(1);
  return { headers, rows: dataRows };
}

function baseTypeFromFileName(name: string) {
  const n = normalizeKey(name);
  if (!n) return null;
  const m: Array<{ want: string[]; baseType: string }> = [
    { want: ["custom.empresas", "empresas", "companies"], baseType: "custom.empresas" },
    { want: ["custom.categorias", "categorias", "categories"], baseType: "custom.categorias" },
    { want: ["custom.itens_notas", "itens_notas", "invoice_items"], baseType: "custom.itens_notas" },
    { want: ["custom.notas_fiscais", "notas_fiscais", "invoices"], baseType: "custom.notas_fiscais" },
    { want: ["custom.itens_inventarios", "itens_inventarios", "inventory_items"], baseType: "custom.itens_inventarios" },
    { want: ["custom.inventarios", "inventarios", "inventories"], baseType: "custom.inventarios" },
    { want: ["custom.motivos_desperdicios", "motivos_desperdicios", "waste_reasons"], baseType: "custom.motivos_desperdicios" },
    { want: ["custom.desperdicio", "desperdicio", "wastes"], baseType: "custom.desperdicio" },
    { want: ["custom.ingredientes", "ingredientes", "recipe_ingredients"], baseType: "custom.ingredientes" },
    { want: ["custom.etiquetas", "etiquetas", "labels"], baseType: "custom.etiquetas" },
    { want: ["custom.fornecedores", "fornecedores", "suppliers"], baseType: "custom.fornecedores" },
    { want: ["custom.custo_medio_item", "custo_medio_item", "custo_medio_items", "avg_cost"], baseType: "custom.custo_medio_item" },
    { want: ["custom.itens", "custom.item", "itens", "items"], baseType: "custom.itens" },
    { want: ["user", "usuarios", "users", "user_profiles"], baseType: "user" },
  ];
  for (const it of m) {
    if (it.want.some((w) => n.includes(normalizeKey(w)))) return it.baseType;
  }
  return null;
}

function baseTypeFromHeaders(headers: string[]) {
  const keys = new Set(headers.map((h) => normalizeKey(h)));
  const hasAny = (want: string[]) => want.some((w) => keys.has(normalizeKey(w)));
  if (hasAny(["cnpj", "razao_social", "razao social"])) return "custom.empresas";
  if (hasAny(["categoria", "nome_categoria", "nome categoria"])) return "custom.categorias";
  if (hasAny(["nota_id", "nota", "nota_fiscal", "nota_fiscal_id"])) return "custom.itens_notas";
  if (hasAny(["inventario_id", "inventario"])) return "custom.itens_inventarios";
  if (hasAny(["motivo", "motivo_text"])) return "custom.desperdicio";
  if (hasAny(["receita", "receita_id", "ingredient_item_id"])) return "custom.ingredientes";
  if (hasAny(["email"]) && hasAny(["name", "nome"])) return "user";
  if (hasAny(["vendedor", "whatsapp"])) return "custom.fornecedores";
  if (hasAny(["custo_medio", "data_lancamento"])) return "custom.custo_medio_item";
  if (hasAny(["custo_total_receita", "item_receita"])) return "custom.itens";
  return null;
}

function applyRelationAliases(baseType: string, normalized: Record<string, any>) {
  const t = String(baseType || "").trim().toLowerCase();
  const get = (keys: string[]) => {
    for (const k of keys) {
      const nk = normalizeKey(k);
      if (normalized[nk] != null) return normalized[nk];
    }
    return undefined;
  };
  const setIfMissing = (key: string, value: any) => {
    const nk = normalizeKey(key);
    if (normalized[nk] == null && value != null) normalized[nk] = value;
  };

  const empresa = get(["empresa", "empresa_id", "empresa_custom_empresas", "empresa_id_custom_empresas"]);
  const categoria = get(["categoria", "categoria_id", "categoria_id_custom_categorias", "category", "category_id"]);
  const fornecedor = get(["fornecedor", "fornecedor_id", "fornecedor_id_custom_fornecedores", "supplier", "supplier_id"]);
  const item = get(["item", "item_id", "item_id_custom_itens"]);
  const nota = get(["nota", "nota_id", "nota_fiscal", "nota_fiscal_id", "invoice", "invoice_id", "nota_id_custom_notas_fiscais"]);
  const inventario = get(["inventario", "inventario_id", "inventario_id_custom_inventarios"]);
  const motivo = get(["motivo", "motivo_id", "motivo_custom_motivos_desperdicios", "motivo_id_custom_motivos_desperdicios"]);
  const receita = get(["receita", "receita_id", "recipe", "recipe_id", "receita_id_custom_itens"]);

  if (t === "custom.itens") setIfMissing("categoria_id_custom_categorias", categoria);
  if (t === "custom.notas_fiscais") {
    setIfMissing("fornecedor_id_custom_fornecedores", fornecedor);
    setIfMissing("empresa_id_custom_empresas", empresa);
  }
  if (t === "custom.itens_notas") {
    setIfMissing("item_id_custom_itens", item);
    setIfMissing("nota_id_custom_notas_fiscais", nota);
    setIfMissing("fornecedor_id_custom_fornecedores", fornecedor);
  }
  if (t === "custom.inventarios") setIfMissing("empresa_id_custom_empresas", empresa);
  if (t === "custom.itens_inventarios") {
    setIfMissing("item_id_custom_itens", item);
    setIfMissing("inventario_id_custom_inventarios", inventario);
  }
  if (t === "custom.desperdicio") {
    setIfMissing("item_id_custom_itens", item);
    setIfMissing("motivo_custom_motivos_desperdicios", motivo);
  }
  if (t === "custom.ingredientes") {
    setIfMissing("item_id_custom_itens", item);
    setIfMissing("receita_id_custom_itens", receita);
  }
  if (t === "custom.custo_medio_item") setIfMissing("item_id_custom_itens", item);
}

function buildNetworkRecordsFromCsv(fileName: string, csvText: string) {
  const { headers, rows } = parseCsv(csvText);
  const baseType = baseTypeFromFileName(fileName) ?? baseTypeFromHeaders(headers) ?? null;
  const rawHeaders = headers.map((h) => String(h ?? ""));
  const normalizedHeaders = rawHeaders.map((h) => normalizeKey(h));
  const uniqueIdIdx = normalizedHeaders.findIndex((h) => h === "unique_id" || h === "uniqueid" || h === "bubble_id" || h === "_id" || h === "id");
  const out: Array<{
    bubble_id: string | null;
    bubble_type: string | null;
    base_type: string | null;
    external_key: string | null;
    row_number: number;
    raw: any;
    normalized: any;
    sources: string[];
  }> = [];

  const suffix = baseType ? normalizeKey(baseType).replace(/\./g, "_") : "";

  for (let i = 0; i < rows.length; i += 1) {
    const r = rows[i] ?? [];
    const raw: any = {};
    const normalized: any = {};
    for (let c = 0; c < headers.length; c += 1) {
      const hk = headers[c] ?? "";
      const nk = normalizedHeaders[c] ?? normalizeKey(hk);
      const val0 = r[c] ?? "";
      const val = normalizeBubbleRef(String(val0 ?? "").trim());
      raw[hk] = val;
      normalized[nk] = val;
      if (hk && (hk === "Created Date" || hk === "Modified Date")) normalized[hk] = val;
      if (suffix && nk && normalized[`${nk}_${suffix}`] == null) normalized[`${nk}_${suffix}`] = val;
    }

    const bubbleIdRaw = uniqueIdIdx >= 0 ? r[uniqueIdIdx] : normalized.unique_id ?? normalized.bubble_id ?? normalized._id ?? normalized.id ?? "";
    const bubble_id = extractBubbleId(bubbleIdRaw) || null;
    if (baseType) applyRelationAliases(baseType, normalized);
    const external_key = bubble_id ? null : computeExternalKey(baseType, normalized);

    out.push({
      bubble_id,
      bubble_type: baseType,
      base_type: baseType,
      external_key,
      row_number: i + 2,
      raw,
      normalized,
      sources: [fileName],
    });
  }

  return { baseType, rawHeaders, headers: normalizedHeaders, rows: out.length, records: out };
}

function validateIntegrity(records: Array<{ bubble_id: string | null; base_type: string | null; normalized: any }>) {
  const byBase = new Map<string, Array<{ bubble_id: string | null; normalized: any }>>();
  for (const r of records) {
    const b = String(r.base_type ?? "").trim().toLowerCase();
    if (!b) continue;
    const list = byBase.get(b) ?? [];
    list.push({ bubble_id: r.bubble_id, normalized: r.normalized });
    byBase.set(b, list);
  }
  const checks: Array<{ key: string; label: string; critical: boolean; count: number; samples: any[] }> = [];
  const push = (key: string, label: string, critical: boolean, count: number, samples: any[]) => checks.push({ key, label, critical, count, samples });

  const ids = (k: string) => new Set((byBase.get(k) ?? []).map((r) => String(r.bubble_id ?? "").trim()).filter(Boolean));
  const companyIds = ids("custom.empresas");
  const categoryIds = ids("custom.categorias");
  const supplierIds = ids("custom.fornecedores");
  const itemIds = new Set([...ids("custom.itens"), ...ids("custom.item")]);
  const invoiceIds = ids("custom.notas_fiscais");
  const inventoryIds = ids("custom.inventarios");
  const reasonIds = ids("custom.motivos_desperdicios");

  const pickAnyNormalized = (raw: any, keys: string[]) => {
    for (const k of keys) {
      const nk = normalizeKey(k);
      if (raw?.[nk] != null) return raw[nk];
      if (raw?.[k] != null) return raw[k];
    }
    return undefined;
  };

  const buildUniqueMap = (pairs: Array<{ key: string; value: string }>) => {
    const temp = new Map<string, { value: string; count: number }>();
    for (const p of pairs) {
      const k = normalizeNameKey(p.key);
      const v = String(p.value ?? "").trim();
      if (!k || !v) continue;
      const cur = temp.get(k);
      if (!cur) temp.set(k, { value: v, count: 1 });
      else temp.set(k, { value: cur.value, count: cur.count + 1 });
    }
    const out = new Map<string, string>();
    for (const [k, v] of temp.entries()) {
      if (v.count === 1 && v.value) out.set(k, v.value);
    }
    return out;
  };

  const categoriesByName = buildUniqueMap(
    (byBase.get("custom.categorias") ?? []).map((r) => ({
      key: normalizeText(pickAnyNormalized(r.normalized, ["nome", "nome_custom_categorias", "categoria", "name"]) ?? ""),
      value: String(r.bubble_id ?? "").trim(),
    })),
  );

  const suppliersByName = buildUniqueMap(
    (byBase.get("custom.fornecedores") ?? []).map((r) => ({
      key: normalizeText(pickAnyNormalized(r.normalized, ["nome", "nome_custom_fornecedores", "fornecedor", "name"]) ?? ""),
      value: String(r.bubble_id ?? "").trim(),
    })),
  );

  const reasonsByName = buildUniqueMap(
    (byBase.get("custom.motivos_desperdicios") ?? []).map((r) => ({
      key: normalizeText(pickAnyNormalized(r.normalized, ["titulo", "titulo_custom_motivos_desperdicios", "nome", "name", "motivo"]) ?? ""),
      value: String(r.bubble_id ?? "").trim(),
    })),
  );

  const companiesByName = buildUniqueMap(
    (byBase.get("custom.empresas") ?? []).map((r) => ({
      key: normalizeText(pickAnyNormalized(r.normalized, ["nome", "nome_custom_empresas", "razao_social", "razao_social_custom_empresas", "name"]) ?? ""),
      value: String(r.bubble_id ?? "").trim(),
    })),
  );

  const itemsByName = buildUniqueMap(
    ([...(byBase.get("custom.itens") ?? []), ...(byBase.get("custom.item") ?? [])] as Array<{ bubble_id: string | null; normalized: any }>).map((r) => ({
      key: normalizeText(pickAnyNormalized(r.normalized, ["nome", "nome_custom_itens", "item_nome", "name"]) ?? ""),
      value: String(r.bubble_id ?? "").trim(),
    })),
  );

  const inventoriesByDate = buildUniqueMap(
    (byBase.get("custom.inventarios") ?? []).map((r) => ({
      key:
        parseDateOnlyFlex(pickAnyNormalized(r.normalized, ["data_contagem", "data_contagem_custom_inventarios", "created_date", "Created Date"]) ?? "") ??
        "",
      value: String(r.bubble_id ?? "").trim(),
    })),
  );
  const inventoriesByName = buildUniqueMap(
    (byBase.get("custom.inventarios") ?? []).map((r) => ({
      key: normalizeText(pickAnyNormalized(r.normalized, ["nome", "nome_custom_inventarios", "inventario", "name"]) ?? ""),
      value: String(r.bubble_id ?? "").trim(),
    })),
  );

  const invoicesByDate = buildUniqueMap(
    (byBase.get("custom.notas_fiscais") ?? [])
      .flatMap((r) => {
        const created = parseDateOnlyFlex(pickAnyNormalized(r.normalized, ["data_criacao", "data_criacao_custom_notas_fiscais", "created_date", "Created Date"]) ?? "");
        const received = parseDateOnlyFlex(pickAnyNormalized(r.normalized, ["data_recebimento", "data_recebimento_custom_notas_fiscais", "data"]) ?? "");
        const out: Array<{ key: string; value: string }> = [];
        const bubble = String(r.bubble_id ?? "").trim();
        if (created && bubble) out.push({ key: created, value: bubble });
        if (received && bubble) out.push({ key: received, value: bubble });
        return out;
      })
      .filter((x) => x.key && x.value),
  );
  const invoicesByCodigo = buildUniqueMap(
    (byBase.get("custom.notas_fiscais") ?? []).map((r) => ({
      key: normalizeText(pickAnyNormalized(r.normalized, ["codigo", "codigo_custom_notas_fiscais", "numero", "nota"]) ?? ""),
      value: String(r.bubble_id ?? "").trim(),
    })),
  );

  const pickRefPreferBubbleId = (raw: any, keys: string[]) => {
    const vals = keys.map((k) => (raw as any)?.[k]).filter((v) => normalizeText(v));
    for (const v of vals) {
      const t = normalizeText(v);
      if (looksLikeBubbleId(t)) return v;
    }
    return vals[0] ?? "";
  };

  const resolveRef = (args: {
    value: any;
    ids: Set<string>;
    byName?: Map<string, string>;
    byDate?: Map<string, string>;
    byPrimary?: Map<string, string>;
  }) => {
    const raw = normalizeText(args.value);
    if (!raw) return "";
    if (looksLikeBubbleId(raw)) {
      const bid = extractBubbleId(raw);
      if (bid && args.ids.has(bid)) return bid;
      return "";
    }
    const d = parseDateOnlyFlex(raw);
    const byDate = d ? args.byDate?.get(d) ?? "" : "";
    if (byDate && args.ids.has(byDate)) return byDate;
    const nameKey = normalizeNameKey(raw);
    const byName = args.byName?.get(nameKey) ?? "";
    if (byName && args.ids.has(byName)) return byName;
    const byPrimary = args.byPrimary?.get(nameKey) ?? "";
    if (byPrimary && args.ids.has(byPrimary)) return byPrimary;
    return "";
  };

  let itemsMissingCategory = 0;
  const itemsMissingCategorySamples: any[] = [];
  const itensRows = [...(byBase.get("custom.itens") ?? []), ...(byBase.get("custom.item") ?? [])];
  for (const r of itensRows) {
    const raw = r.normalized ?? {};
    const catRef = pickRefPreferBubbleId(raw, ["categoria_id_custom_categorias", "categoria_id", "category_id_custom_categorias", "categoria", "category"]);
    const resolved = resolveRef({ value: catRef, ids: categoryIds, byName: categoriesByName });
    if (!normalizeText(catRef)) continue;
    if (!resolved) {
      itemsMissingCategory += 1;
      if (itemsMissingCategorySamples.length < 30) itemsMissingCategorySamples.push({ itemId: r.bubble_id, categoria: normalizeText(catRef) });
    }
  }
  push("items_missing_category", "Itens com categoria inexistente", true, itemsMissingCategory, itemsMissingCategorySamples);

  let invoicesMissingSupplier = 0;
  const invoicesMissingSupplierSamples: any[] = [];
  for (const r of byBase.get("custom.notas_fiscais") ?? []) {
    const raw = r.normalized ?? {};
    const supRef = pickRefPreferBubbleId(raw, ["fornecedor_id_custom_fornecedores", "fornecedor_id", "supplier_id_custom_fornecedores", "fornecedor", "supplier"]);
    const resolved = resolveRef({ value: supRef, ids: supplierIds, byName: suppliersByName });
    if (!normalizeText(supRef)) continue;
    if (!resolved) {
      invoicesMissingSupplier += 1;
      if (invoicesMissingSupplierSamples.length < 30) invoicesMissingSupplierSamples.push({ notaId: r.bubble_id, fornecedor: normalizeText(supRef) });
    }
  }
  push("invoices_missing_supplier", "Notas com fornecedor inexistente", true, invoicesMissingSupplier, invoicesMissingSupplierSamples);

  let invoicesMissingCompany = 0;
  const invoicesMissingCompanySamples: any[] = [];
  for (const r of byBase.get("custom.notas_fiscais") ?? []) {
    const raw = r.normalized ?? {};
    const compRef = pickRefPreferBubbleId(raw, ["empresa_id_custom_empresas", "empresa_id", "company_id_custom_empresas", "empresa", "company"]);
    const resolved = resolveRef({ value: compRef, ids: companyIds, byName: companiesByName });
    if (!normalizeText(compRef)) continue;
    if (!resolved) {
      invoicesMissingCompany += 1;
      if (invoicesMissingCompanySamples.length < 30) invoicesMissingCompanySamples.push({ notaId: r.bubble_id, empresa: normalizeText(compRef) });
    }
  }
  push("invoices_missing_company", "Notas com empresa inexistente (será ignorado e usado a empresa selecionada)", false, invoicesMissingCompany, invoicesMissingCompanySamples);

  let invoiceItemsInvoiceBubbleIdNotFound = 0;
  let invoiceItemsWillUseSyntheticInvoice = 0;
  let invoiceItemsMissingItem = 0;
  const invoiceItemsInvoiceBubbleIdNotFoundSamples: any[] = [];
  const invoiceItemsWillUseSyntheticInvoiceSamples: any[] = [];
  const invoiceItemsMissingItemSamples: any[] = [];
  for (const r of byBase.get("custom.itens_notas") ?? []) {
    const raw = r.normalized ?? {};
    const invRef = pickRefPreferBubbleId(raw, ["nota_id_custom_notas_fiscais", "nota_id", "invoice_id_custom_notas_fiscais", "nota", "invoice"]);
    const itemRef = pickRefPreferBubbleId(raw, ["item_id_custom_itens", "item_id", "item"]);
    const invRefText = normalizeText(invRef);
    const invResolved = invRefText ? resolveRef({ value: invRef, ids: invoiceIds, byDate: invoicesByDate, byPrimary: invoicesByCodigo }) : "";
    const itemResolved = normalizeText(itemRef) ? resolveRef({ value: itemRef, ids: itemIds, byName: itemsByName }) : "";
    if (invRefText && looksLikeBubbleId(invRefText) && !invResolved) {
      invoiceItemsInvoiceBubbleIdNotFound += 1;
      if (invoiceItemsInvoiceBubbleIdNotFoundSamples.length < 30)
        invoiceItemsInvoiceBubbleIdNotFoundSamples.push({ itemNotaId: r.bubble_id, nota: invRefText });
    } else if (!invResolved) {
      invoiceItemsWillUseSyntheticInvoice += 1;
      if (invoiceItemsWillUseSyntheticInvoiceSamples.length < 30)
        invoiceItemsWillUseSyntheticInvoiceSamples.push({ itemNotaId: r.bubble_id, nota: invRefText || "(vazio)" });
    }
    if (normalizeText(itemRef) && !itemResolved) {
      invoiceItemsMissingItem += 1;
      if (invoiceItemsMissingItemSamples.length < 30) invoiceItemsMissingItemSamples.push({ itemNotaId: r.bubble_id, item: normalizeText(itemRef) });
    }
  }
  push(
    "invoice_items_missing_invoice",
    "Item da nota com nota inexistente (Bubble ID informado e não encontrado)",
    true,
    invoiceItemsInvoiceBubbleIdNotFound,
    invoiceItemsInvoiceBubbleIdNotFoundSamples,
  );
  push(
    "invoice_items_synthetic_invoice",
    "Itens de nota serão vinculados a nota agrupadora criada automaticamente (nota vazia ou não resolvida)",
    false,
    invoiceItemsWillUseSyntheticInvoice,
    invoiceItemsWillUseSyntheticInvoiceSamples,
  );
  push("invoice_items_missing_item", "Item da nota com item inexistente", true, invoiceItemsMissingItem, invoiceItemsMissingItemSamples);

  let inventoriesMissingCompany = 0;
  const inventoriesMissingCompanySamples: any[] = [];
  for (const r of byBase.get("custom.inventarios") ?? []) {
    const raw = r.normalized ?? {};
    const compRef = pickRefPreferBubbleId(raw, ["empresa_id_custom_empresas", "empresa_id", "company_id_custom_empresas", "empresa", "company"]);
    const resolved = resolveRef({ value: compRef, ids: companyIds, byName: companiesByName });
    if (!normalizeText(compRef)) continue;
    if (!resolved) {
      inventoriesMissingCompany += 1;
      if (inventoriesMissingCompanySamples.length < 30) inventoriesMissingCompanySamples.push({ inventarioId: r.bubble_id, empresa: normalizeText(compRef) });
    }
  }
  push("inventories_missing_company", "Inventários com empresa inexistente (será ignorado e usado a empresa selecionada)", false, inventoriesMissingCompany, inventoriesMissingCompanySamples);

  let invItemsMissingInv = 0;
  let invItemsMissingItem = 0;
  const invItemsMissingInvSamples: any[] = [];
  const invItemsMissingItemSamples: any[] = [];
  for (const r of byBase.get("custom.itens_inventarios") ?? []) {
    const raw = r.normalized ?? {};
    const invRef = pickRefPreferBubbleId(raw, ["inventario_id_custom_inventarios", "inventario_id", "inventario"]);
    const itemRef = pickRefPreferBubbleId(raw, ["item_id_custom_itens", "item_id", "item"]);
    const invResolved = normalizeText(invRef) ? resolveRef({ value: invRef, ids: inventoryIds, byDate: inventoriesByDate, byPrimary: inventoriesByName }) : "";
    const itemResolved = normalizeText(itemRef) ? resolveRef({ value: itemRef, ids: itemIds, byName: itemsByName }) : "";
    if (normalizeText(invRef) && !invResolved) {
      invItemsMissingInv += 1;
      if (invItemsMissingInvSamples.length < 30) invItemsMissingInvSamples.push({ itemInventarioId: r.bubble_id, inventario: normalizeText(invRef) });
    }
    if (normalizeText(itemRef) && !itemResolved) {
      invItemsMissingItem += 1;
      if (invItemsMissingItemSamples.length < 30) invItemsMissingItemSamples.push({ itemInventarioId: r.bubble_id, item: normalizeText(itemRef) });
    }
  }
  push("inventory_items_missing_inventory", "Item do inventário com inventário inexistente", true, invItemsMissingInv, invItemsMissingInvSamples);
  push(
    "inventory_items_missing_item",
    "Item do inventário sem cadastro atual (será preservado como item temporário do inventário)",
    false,
    invItemsMissingItem,
    invItemsMissingItemSamples,
  );

  let wastesMissingItem = 0;
  let wastesMissingReason = 0;
  const wastesMissingItemSamples: any[] = [];
  const wastesMissingReasonSamples: any[] = [];
  for (const r of byBase.get("custom.desperdicio") ?? []) {
    const raw = r.normalized ?? {};
    const itemRef = pickRefPreferBubbleId(raw, ["item_id_custom_itens", "item_id", "item"]);
    const ridRef = pickRefPreferBubbleId(raw, ["motivo_custom_motivos_desperdicios", "motivo_id", "motivo", "motivo_id_custom_motivos_desperdicios"]);
    const itemResolved = normalizeText(itemRef) ? resolveRef({ value: itemRef, ids: itemIds, byName: itemsByName }) : "";
    const reasonResolved = normalizeText(ridRef) ? resolveRef({ value: ridRef, ids: reasonIds, byName: reasonsByName }) : "";
    if (normalizeText(itemRef) && !itemResolved) {
      wastesMissingItem += 1;
      if (wastesMissingItemSamples.length < 30) wastesMissingItemSamples.push({ desperdicioId: r.bubble_id, item: normalizeText(itemRef) });
    }
    if (normalizeText(ridRef) && !reasonResolved) {
      wastesMissingReason += 1;
      if (wastesMissingReasonSamples.length < 30) wastesMissingReasonSamples.push({ desperdicioId: r.bubble_id, motivo: normalizeText(ridRef) });
    }
  }
  push("wastes_missing_item", "Desperdícios com item inexistente", true, wastesMissingItem, wastesMissingItemSamples);
  push("wastes_missing_reason", "Desperdícios com motivo inexistente", true, wastesMissingReason, wastesMissingReasonSamples);

  let ingredientsMissingRecipe = 0;
  let ingredientsMissingItem = 0;
  const ingredientsMissingRecipeSamples: any[] = [];
  const ingredientsMissingItemSamples: any[] = [];
  for (const r of byBase.get("custom.ingredientes") ?? []) {
    const raw = r.normalized ?? {};
    const recipeRef = pickRefPreferBubbleId(raw, ["receita_id_custom_itens", "receita_id", "recipe_id_custom_itens", "recipe_id", "receita", "recipe"]);
    const itemRef = pickRefPreferBubbleId(raw, ["item_id_custom_itens", "item_id", "ingredient_item_id_custom_itens", "item", "ingredient_item"]);
    const recipeResolved = normalizeText(recipeRef) ? resolveRef({ value: recipeRef, ids: itemIds, byName: itemsByName }) : "";
    const itemResolved = normalizeText(itemRef) ? resolveRef({ value: itemRef, ids: itemIds, byName: itemsByName }) : "";
    if (normalizeText(recipeRef) && !recipeResolved) {
      ingredientsMissingRecipe += 1;
      if (ingredientsMissingRecipeSamples.length < 30) ingredientsMissingRecipeSamples.push({ ingredienteId: r.bubble_id, receita: normalizeText(recipeRef) });
    }
    if (normalizeText(itemRef) && !itemResolved) {
      ingredientsMissingItem += 1;
      if (ingredientsMissingItemSamples.length < 30) ingredientsMissingItemSamples.push({ ingredienteId: r.bubble_id, item: normalizeText(itemRef) });
    }
  }
  push("ingredients_missing_recipe", "Ingrediente com receita inexistente", true, ingredientsMissingRecipe, ingredientsMissingRecipeSamples);
  push("ingredients_missing_item", "Ingrediente com item inexistente", true, ingredientsMissingItem, ingredientsMissingItemSamples);

  let avgCostMissingItem = 0;
  const avgCostMissingItemSamples: any[] = [];
  for (const r of byBase.get("custom.custo_medio_item") ?? []) {
    const raw = r.normalized ?? {};
    const itemRef = pickRefPreferBubbleId(raw, ["item_id_custom_itens", "item_id", "item"]);
    const itemResolved = normalizeText(itemRef) ? resolveRef({ value: itemRef, ids: itemIds, byName: itemsByName }) : "";
    if (normalizeText(itemRef) && !itemResolved) {
      avgCostMissingItem += 1;
      if (avgCostMissingItemSamples.length < 30) avgCostMissingItemSamples.push({ custoMedioId: r.bubble_id, item: normalizeText(itemRef) });
    }
  }
  push("avg_cost_missing_item", "Eventos de custo médio com item inexistente", true, avgCostMissingItem, avgCostMissingItemSamples);

  const criticalCount = checks.filter((c) => c.critical).reduce((acc, c) => acc + c.count, 0);
  const warningsCount = checks.filter((c) => !c.critical).reduce((acc, c) => acc + c.count, 0);
  return { ok: true as const, criticalCount, warningsCount, checks };
}

async function getAllByCompany(supabase: ReturnType<typeof getSupabaseAdmin>, table: string, companyId: string, select: string) {
  const out: any[] = [];
  const pageSize = 1000;
  for (let from = 0; from < 200_000; from += pageSize) {
    const { data, error } = await supabase.from(table).select(select).eq("company_id", companyId).order("id", { ascending: true }).range(from, from + pageSize - 1);
    if (error) throw new Error(`${table}:${error.message}`);
    const rows = (data ?? []) as any[];
    out.push(...rows);
    if (rows.length < pageSize) break;
  }
  return out;
}

async function getDbLookupData(supabase: ReturnType<typeof getSupabaseAdmin>, companyId: string) {
  let companyRow: any = null;
  try {
    const { data } = await withTimeout(
      supabase.from("companies").select("id,bubble_id,fantasy_name,legal_name").eq("id", companyId).maybeSingle(),
      2500,
      "companies_lookup_timeout",
    );
    companyRow = (data as any) ?? null;
  } catch {
    companyRow = null;
  }

  const [dbCategories, dbSuppliers, dbItems, dbInventories, dbInvoices, dbReasons] = await Promise.all([
    getAllByCompany(supabase, "categories", companyId, "id,bubble_id,name").catch(() => []),
    getAllByCompany(supabase, "suppliers", companyId, "id,bubble_id,nome").catch(() => []),
    getAllByCompany(supabase, "items", companyId, "id,bubble_id,name").catch(() => []),
    getAllByCompany(supabase, "inventories", companyId, "id,bubble_id,nome,data_contagem").catch(() => []),
    getAllByCompany(supabase, "invoices", companyId, "id,bubble_id,codigo,data_criacao,data_recebimento").catch(() => []),
    getAllByCompany(supabase, "waste_reasons", companyId, "id,bubble_id,titulo").catch(() => []),
  ]);

  return { companyRow, dbCategories, dbSuppliers, dbItems, dbInventories, dbInvoices, dbReasons };
}

function buildCandidatesByKey(pairs: Array<{ key: string; candidate: { value: string; label: string } }>) {
  const map = new Map<string, Array<{ value: string; label: string }>>();
  for (const p of pairs) {
    const k = normalizeNameKey(p.key);
    const v = p.candidate;
    if (!k || !v?.value) continue;
    const list = map.get(k) ?? [];
    if (!list.some((x) => String(x?.value ?? "") === String(v.value))) list.push(v);
    map.set(k, list);
  }
  return map;
}

function buildCandidatesByDateKey(pairs: Array<{ key: string; candidate: { value: string; label: string } }>) {
  const map = new Map<string, Array<{ value: string; label: string }>>();
  for (const p of pairs) {
    const k = String(p.key ?? "").trim().toLowerCase();
    const v = p.candidate;
    if (!k || !v?.value) continue;
    const list = map.get(k) ?? [];
    if (!list.some((x) => String(x?.value ?? "") === String(v.value))) list.push(v);
    map.set(k, list);
  }
  return map;
}

async function buildRelationResolutionPreview(args: { supabase: ReturnType<typeof getSupabaseAdmin>; companyId: string; records: any[]; db?: Awaited<ReturnType<typeof getDbLookupData>> | null }) {
  const { supabase, companyId, records } = args;

  const byBase = new Map<string, any[]>();
  for (const r of records) {
    const bt = String(r?.base_type ?? "").trim().toLowerCase();
    if (!bt) continue;
    const list = byBase.get(bt) ?? [];
    list.push(r);
    byBase.set(bt, list);
  }

  const pickNorm = (raw: any, keys: string[]) => {
    for (const k of keys) {
      const nk = normalizeKey(k);
      if (raw?.[nk] != null) return raw[nk];
      if (raw?.[k] != null) return raw[k];
    }
    return undefined;
  };

  const pickNormPreferBubbleId = (raw: any, keys: string[]) => {
    const vals = keys.map((k) => pickNorm(raw, [k])).filter((v) => normalizeText(v));
    for (const v of vals) {
      const t = normalizeText(v);
      if (looksLikeBubbleId(t)) return v;
    }
    return vals[0] ?? "";
  };

  const db = args.db ?? (await getDbLookupData(supabase, companyId).catch(() => null));
  const companyRow = (db as any)?.companyRow ?? null;
  const dbCategories = ((db as any)?.dbCategories ?? []) as any[];
  const dbSuppliers = ((db as any)?.dbSuppliers ?? []) as any[];
  const dbItems = ((db as any)?.dbItems ?? []) as any[];
  const dbInventories = ((db as any)?.dbInventories ?? []) as any[];
  const dbInvoices = ((db as any)?.dbInvoices ?? []) as any[];
  const dbReasons = ((db as any)?.dbReasons ?? []) as any[];

  const csvCategories = (byBase.get("custom.categorias") ?? []).map((r) => {
    const bubbleId = String(r?.bubble_id ?? "").trim();
    const raw = (r as any)?.normalized ?? {};
    const name = normalizeText(pickNorm(raw, ["nome", "nome_custom_categorias", "name"]) ?? "");
    return { bubbleId, name };
  });
  const csvSuppliers = (byBase.get("custom.fornecedores") ?? []).map((r) => {
    const bubbleId = String(r?.bubble_id ?? "").trim();
    const raw = (r as any)?.normalized ?? {};
    const name = normalizeText(pickNorm(raw, ["nome", "nome_custom_fornecedores", "name"]) ?? "");
    return { bubbleId, name };
  });
  const csvCompanies = (byBase.get("custom.empresas") ?? []).map((r) => {
    const bubbleId = String(r?.bubble_id ?? "").trim();
    const raw = (r as any)?.normalized ?? {};
    const name = normalizeText(pickNorm(raw, ["nome", "nome_custom_empresas", "razao_social", "name"]) ?? "");
    return { bubbleId, name };
  });
  const csvItems = [...(byBase.get("custom.itens") ?? []), ...(byBase.get("custom.item") ?? [])].map((r) => {
    const bubbleId = String((r as any)?.bubble_id ?? "").trim();
    const raw = (r as any)?.normalized ?? {};
    const name = normalizeText(pickNorm(raw, ["nome", "nome_custom_itens", "name"]) ?? "");
    return { bubbleId, name };
  });
  const csvInventories = (byBase.get("custom.inventarios") ?? []).map((r) => {
    const bubbleId = String(r?.bubble_id ?? "").trim();
    const raw = (r as any)?.normalized ?? {};
    const dateKey =
      parseDateOnlyFlex(pickNorm(raw, ["data_contagem", "data_contagem_custom_inventarios", "created_date", "Created Date"]) ?? "") ?? "";
    const nome = normalizeText(pickNorm(raw, ["nome", "nome_custom_inventarios"]) ?? "");
    return { bubbleId, dateKey, nome };
  });
  const csvInvoices = (byBase.get("custom.notas_fiscais") ?? []).map((r) => {
    const bubbleId = String(r?.bubble_id ?? "").trim();
    const raw = (r as any)?.normalized ?? {};
    const created = parseDateOnlyFlex(pickNorm(raw, ["data_criacao", "data_criacao_custom_notas_fiscais", "created_date", "Created Date"]) ?? "") ?? "";
    const received = parseDateOnlyFlex(pickNorm(raw, ["data_recebimento", "data_recebimento_custom_notas_fiscais", "data"]) ?? "") ?? "";
    const codigo = normalizeText(pickNorm(raw, ["codigo", "codigo_custom_notas_fiscais", "numero"]) ?? "");
    return { bubbleId, created, received, codigo };
  });
  const csvReasons = (byBase.get("custom.motivos_desperdicios") ?? []).map((r) => {
    const bubbleId = String(r?.bubble_id ?? "").trim();
    const raw = (r as any)?.normalized ?? {};
    const titulo = normalizeText(pickNorm(raw, ["titulo", "titulo_custom_motivos_desperdicios", "nome", "name", "motivo"]) ?? "");
    return { bubbleId, titulo };
  });

  const categoriesByBubbleId = new Map<string, { value: string; label: string }>();
  for (const c of csvCategories) if (c.bubbleId) categoriesByBubbleId.set(c.bubbleId, { value: `bubble:${c.bubbleId}`, label: `Categoria "${c.name || c.bubbleId}" (CSV)` });
  for (const c of dbCategories as any[]) {
    const bid = String(c?.bubble_id ?? "").trim();
    const id = String(c?.id ?? "").trim();
    const name = normalizeText(c?.name ?? "");
    if (bid && id) categoriesByBubbleId.set(bid, { value: `id:${id}`, label: `Categoria "${name || bid}"` });
  }

  const suppliersByBubbleId = new Map<string, { value: string; label: string }>();
  for (const s of csvSuppliers) if (s.bubbleId) suppliersByBubbleId.set(s.bubbleId, { value: `bubble:${s.bubbleId}`, label: `Fornecedor "${s.name || s.bubbleId}" (CSV)` });
  for (const s of dbSuppliers as any[]) {
    const bid = String(s?.bubble_id ?? "").trim();
    const id = String(s?.id ?? "").trim();
    const name = normalizeText(s?.nome ?? "");
    if (bid && id) suppliersByBubbleId.set(bid, { value: `id:${id}`, label: `Fornecedor "${name || bid}"` });
  }

  const itemsByBubbleId = new Map<string, { value: string; label: string }>();
  for (const it of csvItems) if (it.bubbleId) itemsByBubbleId.set(it.bubbleId, { value: `bubble:${it.bubbleId}`, label: `Item "${it.name || it.bubbleId}" (CSV)` });
  for (const it of dbItems as any[]) {
    const bid = String(it?.bubble_id ?? "").trim();
    const id = String(it?.id ?? "").trim();
    const name = normalizeText(it?.name ?? "");
    if (bid && id) itemsByBubbleId.set(bid, { value: `id:${id}`, label: `Item "${name || bid}"` });
  }

  const inventoriesByBubbleId = new Map<string, { value: string; label: string }>();
  for (const inv of csvInventories) {
    if (!inv.bubbleId) continue;
    const label = inv.dateKey ? `Inventário de ${inv.dateKey} (CSV)` : `Inventário "${inv.nome || inv.bubbleId}" (CSV)`;
    inventoriesByBubbleId.set(inv.bubbleId, { value: `bubble:${inv.bubbleId}`, label });
  }
  for (const inv of dbInventories as any[]) {
    const bid = String(inv?.bubble_id ?? "").trim();
    const id = String(inv?.id ?? "").trim();
    const dateKey = parseDateOnlyFlex(inv?.data_contagem ?? "") ?? "";
    const nome = normalizeText(inv?.nome ?? "");
    const label = dateKey ? `Inventário de ${dateKey}` : `Inventário "${nome || bid}"`;
    if (bid && id) inventoriesByBubbleId.set(bid, { value: `id:${id}`, label });
  }

  const invoicesByBubbleId = new Map<string, { value: string; label: string }>();
  for (const inv of csvInvoices) {
    if (!inv.bubbleId) continue;
    const dateKey = inv.received || inv.created || "";
    const label = dateKey ? `Nota Fiscal de ${dateKey} (CSV)` : `Nota Fiscal "${inv.codigo || inv.bubbleId}" (CSV)`;
    invoicesByBubbleId.set(inv.bubbleId, { value: `bubble:${inv.bubbleId}`, label });
  }
  for (const inv of dbInvoices as any[]) {
    const bid = String(inv?.bubble_id ?? "").trim();
    const id = String(inv?.id ?? "").trim();
    const dateKey = parseDateOnlyFlex(inv?.data_recebimento ?? "") ?? parseDateOnlyFlex(inv?.data_criacao ?? "") ?? "";
    const codigo = normalizeText(inv?.codigo ?? "");
    const label = dateKey ? `Nota Fiscal de ${dateKey}` : `Nota Fiscal "${codigo || bid}"`;
    if (bid && id) invoicesByBubbleId.set(bid, { value: `id:${id}`, label });
  }

  const reasonsByBubbleId = new Map<string, { value: string; label: string }>();
  for (const r of csvReasons) if (r.bubbleId) reasonsByBubbleId.set(r.bubbleId, { value: `bubble:${r.bubbleId}`, label: `Motivo "${r.titulo || r.bubbleId}" (CSV)` });
  for (const r of dbReasons as any[]) {
    const bid = String(r?.bubble_id ?? "").trim();
    const id = String(r?.id ?? "").trim();
    const titulo = normalizeText(r?.titulo ?? "");
    if (bid && id) reasonsByBubbleId.set(bid, { value: `id:${id}`, label: `Motivo "${titulo || bid}"` });
  }

  const categoriesByName = buildCandidatesByKey(
    [
      ...csvCategories.filter((c) => c.bubbleId && c.name).map((c) => ({ key: c.name, candidate: { value: `bubble:${c.bubbleId}`, label: `Categoria "${c.name}" (CSV)` } })),
      ...(dbCategories as any[])
        .map((c) => ({ key: normalizeText(c?.name ?? ""), candidate: { value: `id:${String(c?.id ?? "").trim()}`, label: `Categoria "${normalizeText(c?.name ?? "")}"` } }))
        .filter((x) => x.key && x.candidate.value !== "id:"),
    ],
  );
  const suppliersByName = buildCandidatesByKey(
    [
      ...csvSuppliers.filter((s) => s.bubbleId && s.name).map((s) => ({ key: s.name, candidate: { value: `bubble:${s.bubbleId}`, label: `Fornecedor "${s.name}" (CSV)` } })),
      ...(dbSuppliers as any[])
        .map((s) => ({ key: normalizeText(s?.nome ?? ""), candidate: { value: `id:${String(s?.id ?? "").trim()}`, label: `Fornecedor "${normalizeText(s?.nome ?? "")}"` } }))
        .filter((x) => x.key && x.candidate.value !== "id:"),
    ],
  );
  const itemsByName = buildCandidatesByKey(
    [
      ...csvItems.filter((it) => it.bubbleId && it.name).map((it) => ({ key: it.name, candidate: { value: `bubble:${it.bubbleId}`, label: `Item "${it.name}" (CSV)` } })),
      ...(dbItems as any[])
        .map((it) => ({ key: normalizeText(it?.name ?? ""), candidate: { value: `id:${String(it?.id ?? "").trim()}`, label: `Item "${normalizeText(it?.name ?? "")}"` } }))
        .filter((x) => x.key && x.candidate.value !== "id:"),
    ],
  );
  const inventoriesByDate = buildCandidatesByDateKey(
    [
      ...csvInventories.filter((inv) => inv.bubbleId && inv.dateKey).map((inv) => ({ key: inv.dateKey, candidate: { value: `bubble:${inv.bubbleId}`, label: `Inventário de ${inv.dateKey} (CSV)` } })),
      ...(dbInventories as any[])
        .map((inv) => {
          const k = parseDateOnlyFlex(inv?.data_contagem ?? "") ?? "";
          return { key: k, candidate: { value: `id:${String(inv?.id ?? "").trim()}`, label: `Inventário de ${k}` } };
        })
        .filter((x) => x.key && x.candidate.value !== "id:"),
    ],
  );
  const inventoriesByName = buildCandidatesByKey(
    [
      ...csvInventories.filter((inv) => inv.bubbleId && inv.nome).map((inv) => ({ key: inv.nome, candidate: { value: `bubble:${inv.bubbleId}`, label: `Inventário "${inv.nome}" (CSV)` } })),
      ...(dbInventories as any[])
        .map((inv) => ({ key: normalizeText(inv?.nome ?? ""), candidate: { value: `id:${String(inv?.id ?? "").trim()}`, label: `Inventário "${normalizeText(inv?.nome ?? "")}"` } }))
        .filter((x) => x.key && x.candidate.value !== "id:"),
    ],
  );
  const invoicesByDate = buildCandidatesByDateKey(
    [
      ...csvInvoices
        .flatMap((inv) => {
          const out: Array<{ key: string; candidate: { value: string; label: string } }> = [];
          if (inv.bubbleId && inv.created) out.push({ key: inv.created, candidate: { value: `bubble:${inv.bubbleId}`, label: `Nota Fiscal de ${inv.created} (CSV)` } });
          if (inv.bubbleId && inv.received) out.push({ key: inv.received, candidate: { value: `bubble:${inv.bubbleId}`, label: `Nota Fiscal de ${inv.received} (CSV)` } });
          return out;
        })
        .filter((x) => x.key),
      ...(dbInvoices as any[])
        .flatMap((inv) => {
          const id = String(inv?.id ?? "").trim();
          const d1 = parseDateOnlyFlex(inv?.data_criacao ?? "") ?? "";
          const d2 = parseDateOnlyFlex(inv?.data_recebimento ?? "") ?? "";
          const out: Array<{ key: string; candidate: { value: string; label: string } }> = [];
          if (id && d1) out.push({ key: d1, candidate: { value: `id:${id}`, label: `Nota Fiscal de ${d1}` } });
          if (id && d2) out.push({ key: d2, candidate: { value: `id:${id}`, label: `Nota Fiscal de ${d2}` } });
          return out;
        })
        .filter((x) => x.key && x.candidate.value !== "id:"),
    ],
  );
  const invoicesByCodigo = buildCandidatesByKey(
    [
      ...csvInvoices.filter((inv) => inv.bubbleId && inv.codigo).map((inv) => ({ key: inv.codigo, candidate: { value: `bubble:${inv.bubbleId}`, label: `Nota Fiscal "${inv.codigo}" (CSV)` } })),
      ...(dbInvoices as any[])
        .map((inv) => ({ key: normalizeText(inv?.codigo ?? ""), candidate: { value: `id:${String(inv?.id ?? "").trim()}`, label: `Nota Fiscal "${normalizeText(inv?.codigo ?? "")}"` } }))
        .filter((x) => x.key && x.candidate.value !== "id:"),
    ],
  );
  const reasonsByTitulo = buildCandidatesByKey(
    [
      ...csvReasons.filter((r) => r.bubbleId && r.titulo).map((r) => ({ key: r.titulo, candidate: { value: `bubble:${r.bubbleId}`, label: `Motivo "${r.titulo}" (CSV)` } })),
      ...(dbReasons as any[])
        .map((r) => ({ key: normalizeText(r?.titulo ?? ""), candidate: { value: `id:${String(r?.id ?? "").trim()}`, label: `Motivo "${normalizeText(r?.titulo ?? "")}"` } }))
        .filter((x) => x.key && x.candidate.value !== "id:"),
    ],
  );

  const stats = { bubbleId: 0, name: 0, date: 0, primaryField: 0, ambiguous: 0, notFound: 0 };
  const rows: any[] = [];
  const maxRows = 5000;
  let total = 0;
  let truncated = false;

  const resolutionLabel = (kind: string) => {
    if (kind === "bubble_id") return "✅ Resolvido por Bubble ID";
    if (kind === "name") return "✅ Resolvido por Nome";
    if (kind === "date") return "✅ Resolvido por Data";
    if (kind === "primary_field") return "✅ Resolvido por Primary Field";
    if (kind === "ambiguous") return "⚠️ Resolução ambígua (mais de um candidato)";
    if (kind === "not_found") return "❌ Não encontrado";
    return "—";
  };

  const inc = (kind: string) => {
    if (kind === "bubble_id") stats.bubbleId += 1;
    else if (kind === "name") stats.name += 1;
    else if (kind === "date") stats.date += 1;
    else if (kind === "primary_field") stats.primaryField += 1;
    else if (kind === "ambiguous") stats.ambiguous += 1;
    else if (kind === "not_found") stats.notFound += 1;
  };

  const push = (it: any) => {
    total += 1;
    if (rows.length < maxRows) rows.push(it);
    else truncated = true;
  };

  const resolve = (args: {
    type: string;
    csvValue: string;
    bubbleIdMap: Map<string, { value: string; label: string }>;
    nameCandidates?: Map<string, Array<{ value: string; label: string }>>;
    dateCandidates?: Map<string, Array<{ value: string; label: string }>>;
    primaryCandidates?: Map<string, Array<{ value: string; label: string }>>;
  }) => {
    const raw = normalizeText(args.csvValue);
    if (!raw) return null;
    if (looksLikeBubbleId(raw)) {
      const bid = extractBubbleId(raw);
      const cand = bid ? args.bubbleIdMap.get(bid) ?? null : null;
      if (cand) return { kind: "bubble_id", found: cand.label, candidates: null, overrideKey: null, strategy: null, reason: "" };
      return { kind: "not_found", found: "", candidates: null, overrideKey: null, strategy: null, reason: "Bubble ID não existe (nem no CSV nem no banco)." };
    }
    const dateKey = parseDateOnlyFlex(raw);
    if (dateKey && args.dateCandidates) {
      const list = args.dateCandidates.get(String(dateKey).toLowerCase()) ?? [];
      if (list.length === 1) return { kind: "date", found: String(list[0]?.label ?? ""), candidates: null, overrideKey: null, strategy: null, reason: "" };
      if (list.length > 1)
        return {
          kind: "ambiguous",
          found: "",
          candidates: list.slice(0, 15),
          overrideKey: `${args.type}:date:${String(dateKey).toLowerCase()}`,
          strategy: "date",
          reason: "Mais de um candidato para a mesma data.",
        };
      return { kind: "not_found", found: "", candidates: null, overrideKey: null, strategy: "date", reason: "Nenhum registro com essa data." };
    }
    const nameKey = normalizeNameKey(raw);
    if (args.nameCandidates) {
      const list = args.nameCandidates.get(nameKey) ?? [];
      if (list.length === 1) return { kind: "name", found: String(list[0]?.label ?? ""), candidates: null, overrideKey: null, strategy: null, reason: "" };
      if (list.length > 1)
        return {
          kind: "ambiguous",
          found: "",
          candidates: list.slice(0, 15),
          overrideKey: `${args.type}:name:${nameKey}`,
          strategy: "name",
          reason: "Mais de um candidato para o mesmo nome.",
        };
      return { kind: "not_found", found: "", candidates: null, overrideKey: null, strategy: "name", reason: "Nenhum registro com esse nome." };
    }
    if (args.primaryCandidates) {
      const list = args.primaryCandidates.get(nameKey) ?? [];
      if (list.length === 1) return { kind: "primary_field", found: String(list[0]?.label ?? ""), candidates: null, overrideKey: null, strategy: null, reason: "" };
      if (list.length > 1)
        return {
          kind: "ambiguous",
          found: "",
          candidates: list.slice(0, 15),
          overrideKey: `${args.type}:primary:${nameKey}`,
          strategy: "primary_field",
          reason: "Mais de um candidato para o mesmo Primary Field.",
        };
      return { kind: "not_found", found: "", candidates: null, overrideKey: null, strategy: "primary_field", reason: "Nenhum registro com esse Primary Field." };
    }
    return { kind: "not_found", found: "", candidates: null, overrideKey: null, strategy: null, reason: "Não foi possível resolver." };
  };

  const splitCsvList = (v: unknown) => {
    const s = normalizeText(v);
    if (!s) return [];
    return s
      .split(",")
      .map((x) => normalizeText(x))
      .filter(Boolean);
  };

  const recipeBubbleIdByIngredientItemNameKey = (() => {
    const m = new Map<string, string>();
    const ambiguous = new Set<string>();
    const itemRows0 = [...(byBase.get("custom.itens") ?? []), ...(byBase.get("custom.item") ?? [])];
    for (const r of itemRows0 as any[]) {
      const raw = r?.normalized ?? {};
      const recipeBubbleId = String(r?.bubble_id ?? "").trim();
      if (!recipeBubbleId) continue;
      const list = splitCsvList((raw as any)?.lista_ingredientes_custom_itens ?? (raw as any)?.lista_ingredientes_custom_item ?? (raw as any)?.lista_ingredientes ?? "");
      for (const it of list) {
        const k = normalizeNameKey(it);
        if (!k) continue;
        if (ambiguous.has(k)) continue;
        const prev = m.get(k);
        if (!prev) {
          m.set(k, recipeBubbleId);
          continue;
        }
        if (prev !== recipeBubbleId) {
          m.delete(k);
          ambiguous.add(k);
        }
      }
    }
    return m;
  })();

  const supplierKeyFromText = (supplierRefText: string) => {
    const t = normalizeText(supplierRefText);
    if (!t) return "";
    if (looksLikeBubbleId(t)) return `bid:${extractBubbleId(t)}`;
    const k = normalizeNameKey(t);
    const list = suppliersByName.get(k) ?? [];
    if (list.length === 1) return `bid:${String(list[0]?.value ?? "").trim().replace(/^bubble:/, "").replace(/^id:/, "")}`;
    return `name:${k}`;
  };

  const invoiceMetaByBubbleId = (() => {
    const m = new Map<string, { supplierKey: string; dateKeys: Set<string>; itemKeys: Set<string> }>();
    for (const inv of csvInvoices as any[]) {
      const bubbleId = String(inv?.bubbleId ?? "").trim();
      if (!bubbleId) continue;
      const raw = (byBase.get("custom.notas_fiscais") ?? []).find((r: any) => String(r?.bubble_id ?? "").trim() === bubbleId)?.normalized ?? {};
      const supplier = normalizeText(
        pickNormPreferBubbleId(raw, ["fornecedor_id_custom_fornecedores", "fornecedor_id", "supplier_id_custom_fornecedores", "fornecedor", "supplier"]),
      );
      const supplierKey = supplierKeyFromText(supplier);
      const dateKeys = new Set<string>();
      for (const d of [String(inv?.created ?? ""), String(inv?.received ?? "")]) {
        const dk = String(d ?? "").trim().toLowerCase();
        if (dk) dateKeys.add(dk);
      }
      const itemKeys = new Set<string>();
      const list = splitCsvList((raw as any)?.lista_itens_custom_notas_fiscais ?? (raw as any)?.lista_itens ?? "");
      for (const it of list) itemKeys.add(normalizeNameKey(it));
      m.set(bubbleId, { supplierKey, dateKeys, itemKeys });
    }
    return m;
  })();

  const invoiceBubbleIdsByDateKey = (() => {
    const m = new Map<string, string[]>();
    for (const [bid, meta] of invoiceMetaByBubbleId.entries()) {
      for (const dk of meta.dateKeys) {
        const list = m.get(dk) ?? [];
        list.push(bid);
        m.set(dk, list);
      }
    }
    return m;
  })();

  const itemRows = [...(byBase.get("custom.itens") ?? []), ...(byBase.get("custom.item") ?? [])];
  for (const r of itemRows) {
    const raw = (r as any)?.normalized ?? {};
    const v = normalizeText(pickNormPreferBubbleId(raw, ["categoria_id_custom_categorias", "categoria_id", "category_id_custom_categorias", "categoria", "category"]));
    const res = resolve({ type: "categories", csvValue: v, bubbleIdMap: categoriesByBubbleId, nameCandidates: categoriesByName });
    if (!res) continue;
    inc(res.kind);
    push({ type: "Categoria", csvValue: v, resolution: resolutionLabel(res.kind), found: res.found, reason: res.kind === "not_found" ? res.reason : "", overrideKey: res.overrideKey, strategy: res.strategy, candidates: res.candidates });
  }

  for (const r of byBase.get("custom.notas_fiscais") ?? []) {
    const raw = (r as any)?.normalized ?? {};
    const supplier = normalizeText(pickNormPreferBubbleId(raw, ["fornecedor_id_custom_fornecedores", "fornecedor_id", "supplier_id_custom_fornecedores", "fornecedor", "supplier"]));
    const supplierRes = resolve({ type: "suppliers", csvValue: supplier, bubbleIdMap: suppliersByBubbleId, nameCandidates: suppliersByName });
    if (supplierRes) {
      inc(supplierRes.kind);
      push({ type: "Fornecedor", csvValue: supplier, resolution: resolutionLabel(supplierRes.kind), found: supplierRes.found, reason: supplierRes.kind === "not_found" ? supplierRes.reason : "", overrideKey: supplierRes.overrideKey, strategy: supplierRes.strategy, candidates: supplierRes.candidates });
    }

    const empresa = normalizeText(pickNormPreferBubbleId(raw, ["empresa_id_custom_empresas", "empresa_id", "company_id_custom_empresas", "empresa", "company"]));
    if (empresa) {
      const companyBubbleId = String(companyRow?.bubble_id ?? "").trim();
      const companyName1 = normalizeText(companyRow?.fantasy_name ?? "");
      const companyName2 = normalizeText(companyRow?.legal_name ?? "");
      const matches =
        (companyBubbleId && looksLikeBubbleId(empresa) && extractBubbleId(empresa) === companyBubbleId) ||
        normalizeNameKey(empresa) === normalizeNameKey(companyName1) ||
        normalizeNameKey(empresa) === normalizeNameKey(companyName2);
      const kind = matches ? (looksLikeBubbleId(empresa) ? "bubble_id" : "name") : "not_found";
      inc(kind);
      const companiesCandidates = (() => {
        const list: Array<{ value: string; label: string }> = [];
        const selectedLabel = `Empresa "${companyName1 || companyName2 || companyId}" (selecionada)`;
        list.push({ value: `id:${companyId}`, label: selectedLabel });
        for (const c of csvCompanies) if (c.bubbleId && c.name) list.push({ value: `bubble:${c.bubbleId}`, label: `Empresa "${c.name}" (CSV)` });
        return list;
      })();
      push({
        type: "Empresa",
        csvValue: empresa,
        resolution: resolutionLabel(kind),
        found: matches ? `Empresa "${companyName1 || companyName2 || companyId}"` : "",
        reason: matches ? "" : "Empresa do CSV não corresponde à empresa selecionada para importação.",
        overrideKey: matches ? null : `companies:name:${normalizeNameKey(empresa)}`,
        strategy: matches ? null : "name",
        candidates: matches ? null : companiesCandidates.slice(0, 15),
      });
    }
  }

  for (const r of byBase.get("custom.itens_notas") ?? []) {
    const raw = (r as any)?.normalized ?? {};
    const item = normalizeText(pickNormPreferBubbleId(raw, ["item_id_custom_itens", "item_id", "item"]));
    const itemRes = resolve({ type: "items", csvValue: item, bubbleIdMap: itemsByBubbleId, nameCandidates: itemsByName });
    if (itemRes) {
      inc(itemRes.kind);
      push({ type: "Item", csvValue: item, resolution: resolutionLabel(itemRes.kind), found: itemRes.found, reason: itemRes.kind === "not_found" ? itemRes.reason : "", overrideKey: itemRes.overrideKey, strategy: itemRes.strategy, candidates: itemRes.candidates });
    }

    const nota = normalizeText(pickNormPreferBubbleId(raw, ["nota_id_custom_notas_fiscais", "nota_id", "invoice_id_custom_notas_fiscais", "nota", "invoice"]));
    const notaResolvedValue = (() => {
      if (!nota) return nota;
      if (looksLikeBubbleId(nota)) return nota;
      const dateKey = parseDateOnlyFlex(nota);
      if (!dateKey) return nota;
      const dk = String(dateKey).toLowerCase();
      const candidates = invoiceBubbleIdsByDateKey.get(dk) ?? [];
      if (candidates.length <= 1) return nota;

      const supplierRef = normalizeText(pickNormPreferBubbleId(raw, ["fornecedor_id_custom_fornecedores", "fornecedor_id", "supplier_id_custom_fornecedores", "fornecedor", "supplier"]));
      const supplierKey = supplierKeyFromText(supplierRef);
      const bySupplier = supplierKey ? candidates.filter((bid) => invoiceMetaByBubbleId.get(bid)?.supplierKey === supplierKey) : [];
      const narrowed1 = bySupplier.length ? bySupplier : candidates;
      if (narrowed1.length === 1) return narrowed1[0] ?? nota;

      const itemKey = item ? normalizeNameKey(item) : "";
      const byItem = itemKey ? narrowed1.filter((bid) => invoiceMetaByBubbleId.get(bid)?.itemKeys?.has(itemKey)) : [];
      const narrowed2 = byItem.length ? byItem : narrowed1;
      if (narrowed2.length === 1) return narrowed2[0] ?? nota;

      return nota;
    })();
    const notaStrategyOverride = (() => {
      if (!nota) return null;
      if (looksLikeBubbleId(nota)) return "bubble_id";
      const dateKey = parseDateOnlyFlex(nota);
      if (!dateKey) return null;
      const dk = String(dateKey).toLowerCase();
      const candidates = invoiceBubbleIdsByDateKey.get(dk) ?? [];
      if (candidates.length <= 1) return "date";

      const supplierRef = normalizeText(pickNormPreferBubbleId(raw, ["fornecedor_id_custom_fornecedores", "fornecedor_id", "supplier_id_custom_fornecedores", "fornecedor", "supplier"]));
      const supplierKey = supplierKeyFromText(supplierRef);
      const bySupplier = supplierKey ? candidates.filter((bid) => invoiceMetaByBubbleId.get(bid)?.supplierKey === supplierKey) : [];
      const narrowed1 = bySupplier.length ? bySupplier : candidates;
      if (narrowed1.length === 1) return "date+supplier";

      const itemKey = item ? normalizeNameKey(item) : "";
      const byItem = itemKey ? narrowed1.filter((bid) => invoiceMetaByBubbleId.get(bid)?.itemKeys?.has(itemKey)) : [];
      const narrowed2 = byItem.length ? byItem : narrowed1;
      if (narrowed2.length === 1) return supplierKey ? "date+supplier+item" : "date+item";

      return "date";
    })();
    const notaRes = resolve({ type: "invoices", csvValue: notaResolvedValue, bubbleIdMap: invoicesByBubbleId, dateCandidates: invoicesByDate, primaryCandidates: invoicesByCodigo });
    if (notaRes) {
      inc(notaRes.kind);
      push({
        type: "Nota Fiscal",
        csvValue: nota,
        resolution: resolutionLabel(notaRes.kind),
        found: notaRes.found,
        reason: notaRes.kind === "not_found" ? notaRes.reason : "",
        overrideKey: notaRes.overrideKey,
        strategy: notaStrategyOverride ?? notaRes.strategy,
        candidates: notaRes.candidates,
      });
    }
  }

  for (const r of byBase.get("custom.itens_inventarios") ?? []) {
    const raw = (r as any)?.normalized ?? {};
    const inv = normalizeText(pickNormPreferBubbleId(raw, ["inventario_id_custom_inventarios", "inventario_id", "inventario"]));
    const invRes = resolve({ type: "inventories", csvValue: inv, bubbleIdMap: inventoriesByBubbleId, dateCandidates: inventoriesByDate, primaryCandidates: inventoriesByName });
    if (invRes) {
      inc(invRes.kind);
      push({ type: "Inventário", csvValue: inv, resolution: resolutionLabel(invRes.kind), found: invRes.found, reason: invRes.kind === "not_found" ? invRes.reason : "", overrideKey: invRes.overrideKey, strategy: invRes.strategy, candidates: invRes.candidates });
    }

    const item = normalizeText(pickNormPreferBubbleId(raw, ["item_id_custom_itens", "item_id", "item"]));
    const itemRes = resolve({ type: "items", csvValue: item, bubbleIdMap: itemsByBubbleId, nameCandidates: itemsByName });
    if (itemRes && itemRes.kind !== "not_found") {
      inc(itemRes.kind);
      push({ type: "Item", csvValue: item, resolution: resolutionLabel(itemRes.kind), found: itemRes.found, reason: itemRes.kind === "not_found" ? itemRes.reason : "", overrideKey: itemRes.overrideKey, strategy: itemRes.strategy, candidates: itemRes.candidates });
    }
  }

  for (const r of byBase.get("custom.desperdicio") ?? []) {
    const raw = (r as any)?.normalized ?? {};
    const item = normalizeText(pickNormPreferBubbleId(raw, ["item_id_custom_itens", "item_id", "item"]));
    const itemRes = resolve({ type: "items", csvValue: item, bubbleIdMap: itemsByBubbleId, nameCandidates: itemsByName });
    if (itemRes) {
      inc(itemRes.kind);
      push({ type: "Item", csvValue: item, resolution: resolutionLabel(itemRes.kind), found: itemRes.found, reason: itemRes.kind === "not_found" ? itemRes.reason : "", overrideKey: itemRes.overrideKey, strategy: itemRes.strategy, candidates: itemRes.candidates });
    }

    const motivo = normalizeText(pickNormPreferBubbleId(raw, ["motivo_custom_motivos_desperdicios", "motivo_id", "motivo", "motivo_id_custom_motivos_desperdicios"]));
    const motivoRes = resolve({ type: "waste_reasons", csvValue: motivo, bubbleIdMap: reasonsByBubbleId, primaryCandidates: reasonsByTitulo });
    if (motivoRes) {
      inc(motivoRes.kind);
      push({ type: "Motivo", csvValue: motivo, resolution: resolutionLabel(motivoRes.kind), found: motivoRes.found, reason: motivoRes.kind === "not_found" ? motivoRes.reason : "", overrideKey: motivoRes.overrideKey, strategy: motivoRes.strategy, candidates: motivoRes.candidates });
    }
  }

  const recipeCandidates = (() => {
    const out: Array<{ value: string; label: string }> = [];
    const itemRows = [...(byBase.get("custom.itens") ?? []), ...(byBase.get("custom.item") ?? [])];
    for (const r of itemRows as any[]) {
      const bid = String(r?.bubble_id ?? "").trim();
      if (!bid) continue;
      const raw = (r as any)?.normalized ?? {};
      const nome = normalizeText(pickNormPreferBubbleId(raw, ["nome_custom_itens", "nome", "name"]));
      if (!nome) continue;
      out.push({ value: `bubble:${bid}`, label: `Receita "${nome}"` });
      if (out.length >= 50) break;
    }
    return out;
  })();

  for (const r of byBase.get("custom.ingredientes") ?? []) {
    const raw = (r as any)?.normalized ?? {};
    const ing = normalizeText(pickNormPreferBubbleId(raw, ["item_id_custom_itens", "item_id", "ingredient_item_id_custom_itens", "item", "ingredient_item"]));
    const receita0 = normalizeText(pickNormPreferBubbleId(raw, ["receita_id_custom_itens", "receita_id", "recipe_id_custom_itens", "recipe_id", "receita", "recipe"]));
    const inferred = !receita0 && ing ? recipeBubbleIdByIngredientItemNameKey.get(normalizeNameKey(ing)) ?? "" : "";
    const receita = receita0 || inferred;
    const receitaRes = resolve({ type: "items", csvValue: receita, bubbleIdMap: itemsByBubbleId, nameCandidates: itemsByName });
    if (!receita0 && !inferred) {
      const ingredientKey = String((r as any)?.bubble_id ?? "").trim();
      const overrideKey = ingredientKey ? `recipe_ingredients:recipe:${ingredientKey}` : null;
      inc("ambiguous");
      push({
        type: "Receita (Ingrediente)",
        csvValue: ing,
        resolution: "⚠️ Receita vazia (selecione)",
        found: "",
        reason: "Receita vazia no CSV e não foi possível inferir pela lista_ingredientes.",
        overrideKey,
        strategy: "missing",
        candidates: recipeCandidates.length ? recipeCandidates : null,
      });
    } else if (receitaRes) {
      inc(receitaRes.kind);
      push({
        type: "Receita",
        csvValue: receita0,
        resolution: resolutionLabel(receitaRes.kind),
        found: receitaRes.found,
        reason: receitaRes.kind === "not_found" ? receitaRes.reason : "",
        overrideKey: receitaRes.overrideKey,
        strategy: receita0 ? receitaRes.strategy : inferred ? "inferred_from_items.lista_ingredientes" : receitaRes.strategy,
        candidates: receitaRes.candidates,
      });
    }

    const ingRes = resolve({ type: "items", csvValue: ing, bubbleIdMap: itemsByBubbleId, nameCandidates: itemsByName });
    if (ingRes) {
      inc(ingRes.kind);
      push({ type: "Ingrediente", csvValue: ing, resolution: resolutionLabel(ingRes.kind), found: ingRes.found, reason: ingRes.kind === "not_found" ? ingRes.reason : "", overrideKey: ingRes.overrideKey, strategy: ingRes.strategy, candidates: ingRes.candidates });
    }
  }

  return { ok: true as const, total, truncated, stats, rows };
}

function hashResponseText(text: string) {
  try {
    return createHash("sha256").update(text).digest("hex").slice(0, 16);
  } catch {
    return "";
  }
}

function mapBaseTypeToDestinationTable(baseType: string | null) {
  const t = String(baseType ?? "").trim().toLowerCase();
  const k = t.includes("custom.") ? t : t;
  if (k === "custom.empresas") return "companies";
  if (k === "custom.categorias") return "categories";
  if (k === "custom.itens" || k === "custom.item") return "items";
  if (k === "custom.fornecedores") return "suppliers";
  if (k === "custom.etiquetas") return "labels";
  if (k === "custom.notas_fiscais") return "invoices";
  if (k === "custom.itens_notas") return "invoice_items";
  if (k === "custom.inventarios") return "inventories";
  if (k === "custom.itens_inventarios") return "inventory_items";
  if (k === "custom.motivos_desperdicios") return "waste_reasons";
  if (k === "custom.desperdicio") return "wastes";
  if (k === "custom.ingredientes") return "recipe_ingredients";
  if (k === "custom.custo_medio_item") return "avg_cost_events";
  return null;
}

function requiredHeadersForBaseType(baseType: string | null) {
  const t = String(baseType ?? "").trim().toLowerCase();
  const idKeys = ["unique_id", "uniqueid", "_id", "bubble_id", "id"];
  if (t === "custom.empresas") return [idKeys, ["nome", "nome_custom_empresas", "name"]];
  if (t === "custom.categorias") return [idKeys, ["nome", "nome_custom_categorias", "name"]];
  if (t === "custom.itens" || t === "custom.item")
    return [idKeys, ["nome", "nome_custom_itens", "name"], ["categoria_id_custom_categorias", "categoria_id", "categoria"]];
  if (t === "custom.fornecedores") return [idKeys, ["nome", "nome_custom_fornecedores"]];
  if (t === "custom.etiquetas") return [idKeys];
  if (t === "custom.notas_fiscais") return [idKeys, ["fornecedor_id_custom_fornecedores", "fornecedor_id", "fornecedor", "supplier", "supplier_id"]];
  if (t === "custom.itens_notas")
    return [
      idKeys,
      ["item_id_custom_itens", "item_id", "item"],
      ["nota_id_custom_notas_fiscais", "nota_id", "nota", "nota_fiscal", "invoice", "invoice_id"],
    ];
  if (t === "custom.inventarios") return [idKeys];
  if (t === "custom.itens_inventarios")
    return [idKeys, ["item_id_custom_itens", "item_id", "item"], ["inventario_id_custom_inventarios", "inventario_id", "inventario"]];
  if (t === "custom.motivos_desperdicios")
    return [idKeys, ["titulo", "titulo_custom_motivos_desperdicios", "nome", "nome_custom_motivos_desperdicios", "name", "motivo"]];
  if (t === "custom.desperdicio") return [idKeys, ["item_id_custom_itens", "item_id", "item"]];
  if (t === "custom.ingredientes")
    return [idKeys, ["item_id_custom_itens", "item_id", "item"], ["receita_id_custom_itens", "receita_id", "recipe_id", "receita", "recipe"]];
  if (t === "custom.custo_medio_item")
    return [
      idKeys,
      ["item_id_custom_itens", "item_id", "item"],
      ["data_lancamento", "data_lancamento_custom_custo_medio_item", "Created Date", "created_date"],
    ];
  return [idKeys];
}

function knownNormalizedHeadersForBaseType(baseType: string | null) {
  const t = String(baseType ?? "").trim().toLowerCase();
  const add = (arr: string[], keys: string[]) => {
    for (const k of keys) {
      const nk = normalizeKey(k);
      if (nk && !arr.includes(nk)) arr.push(nk);
    }
  };
  const out: string[] = [];
  add(out, ["unique_id", "uniqueid", "bubble_id", "_id", "id", "created_date", "modified_date", "created", "modified"]);
  if (t === "custom.empresas") {
    add(out, [
      "cnpj_custom_empresas",
      "cnpj",
      "email_custom_empresas",
      "email",
      "whatsapp_custom_empresas",
      "whatsapp",
      "phone",
      "nome_custom_empresas",
      "nome",
      "name",
      "meta_cmv_custom_empresas",
      "meta_cmv",
      "plano_custom_empresas",
      "plano",
      "status_plano_custom_empresas",
      "status_plano",
    ]);
  } else if (t === "custom.categorias") {
    add(out, ["nome", "nome_custom_categorias", "name"]);
  } else if (t === "custom.itens" || t === "custom.item") {
    add(out, [
      "nome",
      "nome_custom_itens",
      "name",
      "descricao",
      "descricao_custom_itens",
      "modo_preparo",
      "modo_preparo_custom_itens",
      "rendimento",
      "rendimento_custom_itens",
      "custo_medio",
      "custo_medio_custom_itens",
      "validade_data",
      "validade_data_custom_itens",
      "validade_dias",
      "validade_dias_custom_itens",
      "cmv_desejado",
      "cmv_desejado_custom_itens",
      "dias_estoque_minimo",
      "dias_estoque_minimo_custom_itens",
      "boolean_ocultar_cmv",
      "boolean_ocultar_cmv_custom_itens",
      "ocultar_cmv",
      "boolean_item_receita",
      "boolean_item_receita_custom_itens",
      "boolean_item_do_cardapio",
      "boolean_item_do_cardapio_custom_itens",
      "preco_venda_total",
      "preco_venda_total_custom_itens",
      "custo_total_receita",
      "custo_total_receita_custom_itens",
      "dias_prazo_fornecedor",
      "dias_prazo_fornecedor_custom_itens",
      "dias_total_estoque_minimo",
      "dias_total_estoque_minimo_custom_itens",
      "popularidade",
      "popularidade_custom_itens",
      "quadrante_ficha_tecnica",
      "quadrante_ficha_tecnica_custom_itens",
      "unidade_medida",
      "unidade_medida_custom_itens",
      "categoria_id_custom_categorias",
      "categoria_id",
      "category_id_custom_categorias",
      "categoria",
    ]);
  } else if (t === "custom.fornecedores") {
    add(out, ["nome", "nome_custom_fornecedores", "endereco", "endereco_custom_fornecedores", "vendedor", "vendedor_custom_fornecedores", "whatsapp", "whatsapp_custom_fornecedores"]);
  } else if (t === "custom.etiquetas") {
    add(out, [
      "codigo",
      "codigo_custom_etiquetas",
      "item_nome",
      "item_nome_custom_etiquetas",
      "data_criacao_log",
      "data_criacao_log_custom_etiquetas",
      "created_date",
      "data_producao",
      "data_producao_custom_etiquetas",
      "data_validade",
      "data_validade_custom_etiquetas",
      "boolean_desperdicado",
      "boolean_desperdicado_custom_etiquetas",
      "dias_validade",
      "dias_validade_custom_etiquetas",
      "item_id_custom_itens",
      "item_id",
      "boolean_baixa_vencimento",
      "boolean_baixa_vencimento_custom_etiquetas",
      "quantidade_produzida",
      "quantidade_produzida_custom_etiquetas",
      "responsavel_nome_completo",
      "responsavel_nome_completo_custom_etiquetas",
    ]);
  } else if (t === "custom.notas_fiscais") {
    add(out, [
      "fornecedor_id_custom_fornecedores",
      "fornecedor_id",
      "supplier_id_custom_fornecedores",
      "created_by",
      "created_by_custom_users",
      "responsavel_id",
      "responsavel_id_custom_users",
      "codigo",
      "codigo_custom_notas_fiscais",
      "numero",
      "data_criacao",
      "data_criacao_custom_notas_fiscais",
      "created_date",
      "data_recebimento",
      "data_recebimento_custom_notas_fiscais",
      "data",
      "empresa_id_custom_empresas",
      "empresa_id",
      "empresa",
    ]);
  } else if (t === "custom.itens_notas") {
    add(out, [
      "item_id_custom_itens",
      "item_id",
      "nota_id_custom_notas_fiscais",
      "nota_id",
      "nota",
      "invoice_id_custom_notas_fiscais",
      "fornecedor_id_custom_fornecedores",
      "fornecedor_id",
      "data_lancamento",
      "data_lancamento_custom_itens_notas",
      "created_date",
      "quantidade",
      "quantidade_custom_itens_notas",
      "custo_unitario",
      "custo_unitario_custom_itens_notas",
      "subtotal",
      "subtotal_custom_itens_notas",
      "ocultar_cmv",
      "ocultar_cmv_custom_itens_notas",
      "cadastro_item",
      "cadastro_Item",
      "excluivel_detalhes_item",
      "excluível_detalhes_item",
    ]);
  } else if (t === "custom.inventarios") {
    add(out, ["nome", "nome_custom_inventarios", "data_contagem", "data_contagem_custom_inventarios", "empresa_id_custom_empresas", "empresa_id", "empresa"]);
  } else if (t === "custom.itens_inventarios") {
    add(out, [
      "inventario_id_custom_inventarios",
      "inventario_id",
      "inventario",
      "item_id_custom_itens",
      "item_id",
      "item",
      "data_contagem",
      "data_contagem_custom_itens_inventarios",
      "quantidade_contada",
      "quantidade_contada_custom_itens_inventarios",
      "ocultar_cmv",
      "ocultar_cmv_custom_itens_inventarios",
      "item_temporario",
      "item_temporario_custom_itens_inventarios",
    ]);
  } else if (t === "custom.motivos_desperdicios") {
    add(out, ["titulo", "titulo_custom_motivos_desperdicios", "nome", "nome_custom_motivos_desperdicios", "name", "motivo"]);
  } else if (t === "custom.desperdicio") {
    add(out, [
      "item_id_custom_itens",
      "item_id",
      "etiqueta_id_custom_etiquetas",
      "etiqueta_id",
      "motivo_custom_motivos_desperdicios",
      "motivo",
      "motivo_id_custom_motivos_desperdicios",
      "lancamento",
      "lancamento_custom_desperdicio",
      "motivo_text",
      "motivo_text_custom_desperdicio",
      "quantidade",
      "quantidade_custom_desperdicio",
      "custo_total",
      "custo_total_custom_desperdicio",
      "custo_unitario",
      "custo_unitario_custom_desperdicio",
      "unidade_medida",
      "unidade_medida_custom_desperdicio",
    ]);
  } else if (t === "custom.ingredientes") {
    add(out, [
      "item_id_custom_itens",
      "item_id",
      "ingredient_item_id_custom_itens",
      "receita_id_custom_itens",
      "receita_id",
      "recipe_id_custom_itens",
      "quantidade",
      "quantidade_custom_ingredientes",
      "custo",
      "custo_custom_ingredientes",
      "ingrediente_temporario",
      "ingrediente_temporario_custom_ingredientes",
    ]);
  } else if (t === "custom.custo_medio_item") {
    add(out, [
      "item_id_custom_itens",
      "item",
      "item_custom_itens",
      "item_id",
      "data_lancamento",
      "data_lancamento_custom_custo_medio_item",
      "created_date",
      "custo_medio",
      "custo_medio_custom_custo_medio_item",
      "alteracao_custo_inicial",
      "alteracao_custo_inicial_custom_custo_medio_item",
    ]);
  }
  return out;
}

async function existingBubbleIdsByCompanyAndBubbleId(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  table: string,
  companyId: string,
  bubbleIds: string[],
) {
  const out = new Set<string>();
  for (let i = 0; i < bubbleIds.length; i += 500) {
    const chunk = bubbleIds.slice(i, i + 500);
    const q = supabase.from(table).select("bubble_id").in("bubble_id", chunk);
    const { data, error } = table === "companies" ? await q : await q.eq("company_id", companyId);
    if (error) throw new Error(`${table}:${error.message}`);
    for (const r of (data ?? []) as any[]) {
      const b = String((r as any)?.bubble_id ?? "").trim();
      if (b) out.add(b);
    }
  }
  return out;
}

async function existingExternalKeysByCompanyAndExternalKey(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  table: string,
  companyId: string,
  externalKeys: string[],
) {
  const out = new Set<string>();
  for (let i = 0; i < externalKeys.length; i += 500) {
    const chunk = externalKeys.slice(i, i + 500);
    try {
      const q = supabase.from(table).select("external_key").in("external_key", chunk);
      const { data, error } = table === "companies" ? await q : await q.eq("company_id", companyId);
      if (error) break;
      for (const r of (data ?? []) as any[]) {
        const k = String((r as any)?.external_key ?? "").trim();
        if (k) out.add(k);
      }
    } catch {
      break;
    }
  }
  return out;
}

export async function POST(req: NextRequest) {
  try {
    const isLocalDev = isLocalDevRequest(req);
    const { userId } = getUserIdFromRequest(req);
    if (!userId && !isLocalDev) return json({ ok: false, error: "unauthorized" }, { status: 401 });

    let supabase: ReturnType<typeof getSupabaseAdmin>;
    try {
      supabase = getSupabaseAdmin();
    } catch {
      return json({ ok: false, error: "supabase_not_configured" }, { status: 500 });
    }

    const form = await req.formData();
    const email = safeEmail(form.get("email"));
    let companyId = String(form.get("companyId") ?? "").trim();
    if (!email) return json({ ok: false, error: "invalid_email" }, { status: 400 });

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

    const files = form.getAll("files").filter((f): f is File => typeof (f as any)?.arrayBuffer === "function");
    if (!files.length) return json({ ok: false, error: "missing_files" }, { status: 400 });

    const allRecords: any[] = [];
    const byType = new Map<string, number>();
    const fileReports: any[] = [];
    const unknownFiles: any[] = [];
    const detection: any[] = [];

    for (const f of files) {
      const name = String((f as any)?.name ?? "arquivo.csv");
      const text = await (f as any).text();
      const built = buildNetworkRecordsFromCsv(name, text);
      if (!built.baseType) {
        unknownFiles.push({ name, rows: built.rows, headers: built.headers.slice(0, 30) });
      }
      const bt = built.baseType ?? "unknown";
      byType.set(bt, (byType.get(bt) ?? 0) + built.rows);
      const destTable = mapBaseTypeToDestinationTable(built.baseType);
      const required = requiredHeadersForBaseType(built.baseType);
      const headSet = new Set((built.headers ?? []).map((h) => normalizeKey(h)));
      const missingRequired = required
        .map((alts) => {
          const ok = alts.some((k) => headSet.has(normalizeKey(k)));
          return ok ? null : alts;
        })
        .filter(Boolean);
      const known = new Set(knownNormalizedHeadersForBaseType(built.baseType));
      const unknownColumns = ((built as any).rawHeaders ?? [])
        .map((h: any) => String(h ?? ""))
        .filter(Boolean)
        .filter((h: string) => {
          const nk = normalizeKey(h);
          if (!nk) return false;
          if (known.has(nk)) return false;
          if (nk === "created_date" || nk === "modified_date") return false;
          if (nk === "unique_id" || nk === "uniqueid" || nk === "bubble_id" || nk === "_id" || nk === "id") return false;
          return true;
        })
        .slice(0, 250);
      const status = built.baseType && destTable ? "ok" : "error";
      const statusReason = !built.baseType
        ? "tipo_nao_detectado"
        : !destTable
          ? "tabela_destino_nao_mapeada"
          : "";

      fileReports.push({
        name,
        baseType: built.baseType,
        destinationTable: destTable,
        rows: built.rows,
        headers: built.headers.slice(0, 80),
        rawHeaders: (built as any).rawHeaders?.slice(0, 80) ?? [],
        missingRequiredColumns: missingRequired,
        unknownColumns,
        status,
        statusReason,
        hash: hashResponseText(text),
      });
      detection.push({ name, baseType: built.baseType, destinationTable: destTable, rows: built.rows, status, statusReason });
      allRecords.push(...built.records);
    }

    let derivedCompany: { companyId: string; companyName: string | null; bubbleCompanyId: string } | null = null;
    if (!companyId) {
      if (!isLocalDev) return json({ ok: false, error: "missing_company_id" }, { status: 400 });

      const companies = allRecords
        .filter((r) => String(r.base_type ?? "").trim().toLowerCase() === "custom.empresas")
        .map((r) => {
          const bubbleId = String(r.bubble_id ?? "").trim();
          const raw = (r as any)?.normalized ?? {};
          const nome = normalizeText((raw as any).nome_custom_empresas ?? (raw as any).nome ?? (raw as any).name ?? "") || null;
          return { bubbleId, nome };
        })
        .filter((x) => Boolean(x.bubbleId));

      const unique = new Map<string, string | null>();
      for (const c of companies) if (!unique.has(c.bubbleId)) unique.set(c.bubbleId, c.nome);
      const ids = Array.from(unique.keys());
      if (!ids.length) return json({ ok: false, error: "missing_company_in_csv" }, { status: 400 });
      if (ids.length > 1) {
        return json(
          { ok: false, error: "multiple_companies_in_csv", companies: ids.map((id) => ({ bubbleCompanyId: id, name: unique.get(id) ?? null })) },
          { status: 400 },
        );
      }

      const bubbleCompanyId = ids[0] as string;
      const companyNameFromCsv = unique.get(bubbleCompanyId) ?? null;
      const nameForUpsert = companyNameFromCsv ?? "Empresa";

      await withTimeout(
        supabase.from("companies").upsert({ bubble_id: bubbleCompanyId, fantasy_name: nameForUpsert, legal_name: nameForUpsert } as any, { onConflict: "bubble_id" }),
        6000,
        "companies_upsert_timeout",
      );
      const { data: companyRow, error: companyErr } = await withTimeout(
        supabase.from("companies").select("id,fantasy_name,legal_name,bubble_id").eq("bubble_id", bubbleCompanyId).limit(1).maybeSingle(),
        6000,
        "companies_lookup_timeout",
      );
      if (companyErr) return json({ ok: false, error: companyErr.message }, { status: 500 });
      const cid = String((companyRow as any)?.id ?? "").trim();
      if (!cid) return json({ ok: false, error: "company_not_created" }, { status: 500 });
      companyId = cid;
      const companyName =
        normalizeText((companyRow as any)?.fantasy_name ?? (companyRow as any)?.legal_name ?? companyNameFromCsv ?? "") || null;
      derivedCompany = { companyId, companyName, bubbleCompanyId };
    }

    const order = [
      "custom.empresas",
      "custom.categorias",
      "custom.itens",
      "custom.fornecedores",
      "custom.etiquetas",
      "custom.notas_fiscais",
      "custom.itens_notas",
      "custom.inventarios",
      "custom.itens_inventarios",
      "custom.motivos_desperdicios",
      "custom.desperdicio",
      "custom.ingredientes",
      "custom.custo_medio_item",
    ];
    const orderIndex = new Map<string, number>();
    for (let i = 0; i < order.length; i += 1) orderIndex.set(order[i]!, i);
    allRecords.sort((a, b) => {
      const ai = orderIndex.get(String(a.base_type ?? "").toLowerCase()) ?? 999;
      const bi = orderIndex.get(String(b.base_type ?? "").toLowerCase()) ?? 999;
      if (ai !== bi) return ai - bi;
      return String(a.sources?.[0] ?? "").localeCompare(String(b.sources?.[0] ?? ""));
    });

    const typeCounts = Array.from(byType.entries())
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count);

    const requiredTypes = order.slice();
    const presentTypes = new Set(allRecords.map((r) => String(r.base_type ?? "").trim().toLowerCase()).filter(Boolean));
    const inventoryOnlyTypes = new Set(["custom.inventarios", "custom.itens_inventarios"]);
    const isInventoryOnlyImport =
      presentTypes.size > 0 &&
      presentTypes.has("custom.inventarios") &&
      presentTypes.has("custom.itens_inventarios") &&
      Array.from(presentTypes).every((type) => inventoryOnlyTypes.has(type));
    const missingFiles = isInventoryOnlyImport ? [] : requiredTypes.filter((t) => !presentTypes.has(t));

    const duplicatesInCsv: Array<{ baseType: string; bubble_id: string; count: number; files: string[] }> = [];
    {
      const seen = new Map<string, { count: number; files: Set<string> }>();
      for (const r of allRecords) {
        const bt = String(r.base_type ?? "").trim().toLowerCase() || "unknown";
        const id = String(r.bubble_id ?? "").trim();
        if (!bt || !id) continue;
        const k = bt + "::" + id;
        const prev = seen.get(k) ?? { count: 0, files: new Set<string>() };
        prev.count += 1;
        const src = Array.isArray(r.sources) ? String(r.sources[0] ?? "") : "";
        if (src) prev.files.add(src);
        seen.set(k, prev);
      }
      for (const [k, v] of seen.entries()) {
        if (v.count <= 1) continue;
        const [bt, id] = k.split("::");
        duplicatesInCsv.push({ baseType: bt || "unknown", bubble_id: id || "-", count: v.count, files: Array.from(v.files).slice(0, 5) });
      }
      duplicatesInCsv.sort((a, b) => b.count - a.count);
    }

    const duplicateUpsertKeySet = (() => {
      const dup = new Set<string>();
      const seen = new Map<string, number>();
      for (const r of allRecords) {
        const bt = String(r.base_type ?? "").trim().toLowerCase() || "unknown";
        const bubbleId = String(r.bubble_id ?? "").trim();
        const externalKey = String((r as any)?.external_key ?? "").trim();
        const key = bubbleId ? `bubble:${bubbleId}` : externalKey ? `external:${externalKey}` : "";
        if (!bt || !key) continue;
        const k = `${bt}::${key}`;
        seen.set(k, (seen.get(k) ?? 0) + 1);
      }
      for (const [k, n] of seen.entries()) if (n > 1) dup.add(k);
      return dup;
    })();

    const dbLookup = await getDbLookupData(supabase, companyId).catch(() => null);
    const planCandidates = (() => {
      const byBase = new Map<string, any[]>();
      for (const r of allRecords) {
        const bt = String(r?.base_type ?? "").trim().toLowerCase();
        if (!bt) continue;
        const list = byBase.get(bt) ?? [];
        list.push(r);
        byBase.set(bt, list);
      }

      const categoriesBubbleIds = new Map<string, true>();
      const suppliersBubbleIds = new Map<string, true>();
      const itemsBubbleIds = new Map<string, true>();
      const inventoriesBubbleIds = new Map<string, true>();
      const invoicesBubbleIds = new Map<string, true>();
      const reasonsBubbleIds = new Map<string, true>();

      const csvCategories = (byBase.get("custom.categorias") ?? []).map((r) => {
        const bubbleId = String(r?.bubble_id ?? "").trim();
        const raw = (r as any)?.normalized ?? {};
        const name = normalizeText((raw as any)?.nome_custom_categorias ?? (raw as any)?.nome ?? (raw as any)?.name ?? "");
        if (bubbleId) categoriesBubbleIds.set(bubbleId, true);
        return { bubbleId, name };
      });
      const csvSuppliers = (byBase.get("custom.fornecedores") ?? []).map((r) => {
        const bubbleId = String(r?.bubble_id ?? "").trim();
        const raw = (r as any)?.normalized ?? {};
        const name = normalizeText((raw as any)?.nome_custom_fornecedores ?? (raw as any)?.nome ?? (raw as any)?.name ?? "");
        if (bubbleId) suppliersBubbleIds.set(bubbleId, true);
        return { bubbleId, name };
      });
      const csvItems = [...(byBase.get("custom.itens") ?? []), ...(byBase.get("custom.item") ?? [])].map((r) => {
        const bubbleId = String((r as any)?.bubble_id ?? "").trim();
        const raw = (r as any)?.normalized ?? {};
        const name = normalizeText((raw as any)?.nome_custom_itens ?? (raw as any)?.nome ?? (raw as any)?.name ?? "");
        if (bubbleId) itemsBubbleIds.set(bubbleId, true);
        return { bubbleId, name };
      });
      const csvInventories = (byBase.get("custom.inventarios") ?? []).map((r) => {
        const bubbleId = String(r?.bubble_id ?? "").trim();
        const raw = (r as any)?.normalized ?? {};
        const dateKey = parseDateOnlyFlex((raw as any)?.data_contagem_custom_inventarios ?? (raw as any)?.data_contagem ?? (raw as any)?.created_date ?? (raw as any)?.["Created Date"] ?? "") ?? "";
        const nome = normalizeText((raw as any)?.nome_custom_inventarios ?? (raw as any)?.nome ?? "");
        if (bubbleId) inventoriesBubbleIds.set(bubbleId, true);
        return { bubbleId, dateKey, nome };
      });
      const csvInvoices = (byBase.get("custom.notas_fiscais") ?? []).map((r) => {
        const bubbleId = String(r?.bubble_id ?? "").trim();
        const raw = (r as any)?.normalized ?? {};
        const created = parseDateOnlyFlex((raw as any)?.data_criacao_custom_notas_fiscais ?? (raw as any)?.data_criacao ?? (raw as any)?.created_date ?? (raw as any)?.["Created Date"] ?? "") ?? "";
        const received = parseDateOnlyFlex((raw as any)?.data_recebimento_custom_notas_fiscais ?? (raw as any)?.data_recebimento ?? (raw as any)?.data ?? "") ?? "";
        const codigo = normalizeText((raw as any)?.codigo_custom_notas_fiscais ?? (raw as any)?.codigo ?? (raw as any)?.numero ?? "");
        const fornecedor = normalizeText(
          (raw as any)?.fornecedor_id_custom_fornecedores ?? (raw as any)?.fornecedor_id_custom_notas_fiscais ?? (raw as any)?.fornecedor_id ?? (raw as any)?.fornecedor ?? "",
        );
        const listaItens = normalizeText((raw as any)?.lista_itens_custom_notas_fiscais ?? (raw as any)?.lista_itens ?? "");
        if (bubbleId) invoicesBubbleIds.set(bubbleId, true);
        return { bubbleId, created, received, codigo, fornecedor, listaItens };
      });
      const csvReasons = (byBase.get("custom.motivos_desperdicios") ?? []).map((r) => {
        const bubbleId = String(r?.bubble_id ?? "").trim();
        const raw = (r as any)?.normalized ?? {};
        const titulo = normalizeText((raw as any)?.titulo_custom_motivos_desperdicios ?? (raw as any)?.titulo ?? (raw as any)?.nome ?? (raw as any)?.motivo ?? (raw as any)?.name ?? "");
        if (bubbleId) reasonsBubbleIds.set(bubbleId, true);
        return { bubbleId, titulo };
      });

      for (const c of ((dbLookup as any)?.dbCategories ?? []) as any[]) {
        const bid = String(c?.bubble_id ?? "").trim();
        if (bid) categoriesBubbleIds.set(bid, true);
      }
      for (const s of ((dbLookup as any)?.dbSuppliers ?? []) as any[]) {
        const bid = String(s?.bubble_id ?? "").trim();
        if (bid) suppliersBubbleIds.set(bid, true);
      }
      for (const it of ((dbLookup as any)?.dbItems ?? []) as any[]) {
        const bid = String(it?.bubble_id ?? "").trim();
        if (bid) itemsBubbleIds.set(bid, true);
      }
      for (const inv of ((dbLookup as any)?.dbInventories ?? []) as any[]) {
        const bid = String(inv?.bubble_id ?? "").trim();
        if (bid) inventoriesBubbleIds.set(bid, true);
      }
      for (const inv of ((dbLookup as any)?.dbInvoices ?? []) as any[]) {
        const bid = String(inv?.bubble_id ?? "").trim();
        if (bid) invoicesBubbleIds.set(bid, true);
      }
      for (const r of ((dbLookup as any)?.dbReasons ?? []) as any[]) {
        const bid = String(r?.bubble_id ?? "").trim();
        if (bid) reasonsBubbleIds.set(bid, true);
      }

      const categoriesByName = buildCandidatesByKey(
        [
          ...csvCategories.filter((c) => c.bubbleId && c.name).map((c) => ({ key: c.name, candidate: { value: c.bubbleId, label: c.name } })),
          ...(((dbLookup as any)?.dbCategories ?? []) as any[])
            .map((c) => ({ key: normalizeText(c?.name ?? ""), candidate: { value: String(c?.bubble_id ?? "").trim(), label: normalizeText(c?.name ?? "") } }))
            .filter((x) => x.key && x.candidate.value),
        ],
      );
      const suppliersByName = buildCandidatesByKey(
        [
          ...csvSuppliers.filter((s) => s.bubbleId && s.name).map((s) => ({ key: s.name, candidate: { value: s.bubbleId, label: s.name } })),
          ...(((dbLookup as any)?.dbSuppliers ?? []) as any[])
            .map((s) => ({ key: normalizeText(s?.nome ?? ""), candidate: { value: String(s?.bubble_id ?? "").trim(), label: normalizeText(s?.nome ?? "") } }))
            .filter((x) => x.key && x.candidate.value),
        ],
      );
      const itemsByName = buildCandidatesByKey(
        [
          ...csvItems.filter((it) => it.bubbleId && it.name).map((it) => ({ key: it.name, candidate: { value: it.bubbleId, label: it.name } })),
          ...(((dbLookup as any)?.dbItems ?? []) as any[])
            .map((it) => ({ key: normalizeText(it?.name ?? ""), candidate: { value: String(it?.bubble_id ?? "").trim(), label: normalizeText(it?.name ?? "") } }))
            .filter((x) => x.key && x.candidate.value),
        ],
      );
      const inventoriesByDate = buildCandidatesByDateKey(
        [
          ...csvInventories
            .filter((inv) => inv.bubbleId && inv.dateKey)
            .map((inv) => ({ key: inv.dateKey, candidate: { value: inv.bubbleId, label: inv.dateKey } })),
          ...(((dbLookup as any)?.dbInventories ?? []) as any[])
            .map((inv) => {
              const k = parseDateOnlyFlex(inv?.data_contagem ?? "") ?? "";
              return { key: k, candidate: { value: String(inv?.bubble_id ?? "").trim(), label: k } };
            })
            .filter((x) => x.key && x.candidate.value),
        ],
      );
      const inventoriesByName = buildCandidatesByKey(
        [
          ...csvInventories.filter((inv) => inv.bubbleId && inv.nome).map((inv) => ({ key: inv.nome, candidate: { value: inv.bubbleId, label: inv.nome } })),
          ...(((dbLookup as any)?.dbInventories ?? []) as any[])
            .map((inv) => ({ key: normalizeText(inv?.nome ?? ""), candidate: { value: String(inv?.bubble_id ?? "").trim(), label: normalizeText(inv?.nome ?? "") } }))
            .filter((x) => x.key && x.candidate.value),
        ],
      );
      const invoicesByDate = buildCandidatesByDateKey(
        [
          ...csvInvoices
            .flatMap((inv) => {
              const out: Array<{ key: string; candidate: { value: string; label: string } }> = [];
              if (inv.bubbleId && inv.created) out.push({ key: inv.created, candidate: { value: inv.bubbleId, label: inv.created } });
              if (inv.bubbleId && inv.received) out.push({ key: inv.received, candidate: { value: inv.bubbleId, label: inv.received } });
              return out;
            })
            .filter((x) => x.key && x.candidate.value),
          ...(((dbLookup as any)?.dbInvoices ?? []) as any[])
            .flatMap((inv) => {
              const d1 = parseDateOnlyFlex(inv?.data_criacao ?? "") ?? "";
              const d2 = parseDateOnlyFlex(inv?.data_recebimento ?? "") ?? "";
              const bid = String(inv?.bubble_id ?? "").trim();
              const out: Array<{ key: string; candidate: { value: string; label: string } }> = [];
              if (bid && d1) out.push({ key: d1, candidate: { value: bid, label: d1 } });
              if (bid && d2) out.push({ key: d2, candidate: { value: bid, label: d2 } });
              return out;
            })
            .filter((x) => x.key && x.candidate.value),
        ],
      );
      const invoicesByCodigo = buildCandidatesByKey(
        [
          ...csvInvoices.filter((inv) => inv.bubbleId && inv.codigo).map((inv) => ({ key: inv.codigo, candidate: { value: inv.bubbleId, label: inv.codigo } })),
          ...(((dbLookup as any)?.dbInvoices ?? []) as any[])
            .map((inv) => ({ key: normalizeText(inv?.codigo ?? ""), candidate: { value: String(inv?.bubble_id ?? "").trim(), label: normalizeText(inv?.codigo ?? "") } }))
            .filter((x) => x.key && x.candidate.value),
        ],
      );
      const reasonsByTitulo = buildCandidatesByKey(
        [
          ...csvReasons.filter((r) => r.bubbleId && r.titulo).map((r) => ({ key: r.titulo, candidate: { value: r.bubbleId, label: r.titulo } })),
          ...(((dbLookup as any)?.dbReasons ?? []) as any[])
            .map((r) => ({ key: normalizeText(r?.titulo ?? ""), candidate: { value: String(r?.bubble_id ?? "").trim(), label: normalizeText(r?.titulo ?? "") } }))
            .filter((x) => x.key && x.candidate.value),
        ],
      );

      return {
        byBase,
        categoriesBubbleIds,
        suppliersBubbleIds,
        itemsBubbleIds,
        inventoriesBubbleIds,
        invoicesBubbleIds,
        reasonsBubbleIds,
        categoriesByName,
        suppliersByName,
        itemsByName,
        inventoriesByDate,
        inventoriesByName,
        invoicesByDate,
        invoicesByCodigo,
        reasonsByTitulo,
        csvInvoices,
      };
    })();

    const pickCsvRefPreferBubbleId = (raw: any, keys: string[]) => {
      const vals = keys.map((k) => (raw as any)?.[k]).filter((v) => normalizeText(v));
      for (const v of vals) {
        const t = normalizeText(v);
        if (looksLikeBubbleId(t)) return v;
      }
      return vals[0] ?? "";
    };

    const resolveForPlan = (args: {
      csvValue: string;
      bubbleIds: Map<string, true>;
      nameCandidates?: Map<string, Array<{ value: string; label: string }>>;
      dateCandidates?: Map<string, Array<{ value: string; label: string }>>;
      primaryCandidates?: Map<string, Array<{ value: string; label: string }>>;
    }) => {
      const raw = normalizeText(args.csvValue);
      if (!raw) return { kind: "not_found" as const, strategy: "missing" as const };
      if (looksLikeBubbleId(raw)) {
        const bid = extractBubbleId(raw);
        if (bid && args.bubbleIds.has(bid)) return { kind: "bubble_id" as const, strategy: "bubble_id" as const };
        return { kind: "bubble_id_not_found" as const, strategy: "bubble_id" as const };
      }
      const dateKey = parseDateOnlyFlex(raw);
      if (dateKey && args.dateCandidates) {
        const list = args.dateCandidates.get(String(dateKey).toLowerCase()) ?? [];
        if (list.length === 1) return { kind: "date" as const, strategy: "date" as const };
        if (list.length > 1) return { kind: "ambiguous" as const, strategy: "date" as const };
        return { kind: "not_found" as const, strategy: "date" as const };
      }
      const nameKey = normalizeNameKey(raw);
      if (args.nameCandidates) {
        const list = args.nameCandidates.get(nameKey) ?? [];
        if (list.length === 1) return { kind: "name" as const, strategy: "name" as const };
        if (list.length > 1) return { kind: "ambiguous" as const, strategy: "name" as const };
      }
      if (args.primaryCandidates) {
        const list = args.primaryCandidates.get(nameKey) ?? [];
        if (list.length === 1) return { kind: "primary_field" as const, strategy: "primary_field" as const };
        if (list.length > 1) return { kind: "ambiguous" as const, strategy: "primary_field" as const };
      }
      return { kind: "not_found" as const, strategy: "not_found" as const };
    };

    const relationStrategyCounts: Record<string, Record<string, number>> = {};
    const relationStrategySamples: Array<{ relation: string; strategy: string; value: string; base_type: string; table: string }> = [];
    const incStrategy = (relation: string, strategy: string, value: string, baseType: string, table: string) => {
      if (!relation) return;
      const rel = normalizeText(relation) || "relation";
      const strat = normalizeText(strategy) || "unknown";
      if (!relationStrategyCounts[rel]) relationStrategyCounts[rel] = {};
      relationStrategyCounts[rel]![strat] = (relationStrategyCounts[rel]![strat] ?? 0) + 1;
      if (relationStrategySamples.length < 120) {
        relationStrategySamples.push({ relation: rel, strategy: strat, value: normalizeText(value).slice(0, 160), base_type: baseType, table });
      }
    };

    const splitCsvList = (v: unknown) => {
      const s = normalizeText(v);
      if (!s) return [];
      return s
        .split(",")
        .map((x) => normalizeText(x))
        .filter(Boolean);
    };

    const supplierKeyFromRefText = (supplierRefText: string) => {
      const t = normalizeText(supplierRefText);
      if (!t) return "";
      if (looksLikeBubbleId(t)) return `bid:${extractBubbleId(t)}`;
      const k = normalizeNameKey(t);
      const list = planCandidates.suppliersByName.get(k) ?? [];
      if (list.length === 1) return `bid:${String(list[0]?.value ?? "").trim()}`;
      return `name:${k}`;
    };

    const invoiceMetaByBubbleId = (() => {
      const m = new Map<string, { supplierKey: string; dateKeys: Set<string>; itemKeys: Set<string> }>();
      for (const inv of planCandidates.csvInvoices ?? []) {
        const bid = String((inv as any)?.bubbleId ?? "").trim();
        if (!bid) continue;
        const supplierKey = supplierKeyFromRefText(String((inv as any)?.fornecedor ?? ""));
        const dateKeys = new Set<string>();
        for (const d of [String((inv as any)?.received ?? ""), String((inv as any)?.created ?? "")]) {
          const k = String(d ?? "").trim().toLowerCase();
          if (k) dateKeys.add(k);
        }
        const itemKeys = new Set<string>();
        for (const it of splitCsvList((inv as any)?.listaItens ?? "")) itemKeys.add(normalizeNameKey(it));
        m.set(bid, { supplierKey, dateKeys, itemKeys });
      }
      return m;
    })();

    const invoiceBubbleIdsByDateKey = (() => {
      const m = new Map<string, string[]>();
      for (const [bid, meta] of invoiceMetaByBubbleId.entries()) {
        for (const dk of meta.dateKeys) {
          const list = m.get(dk) ?? [];
          list.push(bid);
          m.set(dk, list);
        }
      }
      return m;
    })();

    const recipeBubbleIdByIngredientItemNameKey = (() => {
      const m = new Map<string, string>();
      const ambiguous = new Set<string>();
      const itemRows = [...(planCandidates.byBase.get("custom.itens") ?? []), ...(planCandidates.byBase.get("custom.item") ?? [])];
      for (const r of itemRows as any[]) {
        const raw = r?.normalized ?? {};
        const recipeBubbleId = String(r?.bubble_id ?? "").trim();
        if (!recipeBubbleId) continue;
        const list = splitCsvList((raw as any)?.lista_ingredientes_custom_itens ?? (raw as any)?.lista_ingredientes_custom_item ?? (raw as any)?.lista_ingredientes ?? "");
        for (const it of list) {
          const k = normalizeNameKey(it);
          if (!k) continue;
          if (ambiguous.has(k)) continue;
          const prev = m.get(k);
          if (!prev) {
            m.set(k, recipeBubbleId);
            continue;
          }
          if (prev !== recipeBubbleId) {
            m.delete(k);
            ambiguous.add(k);
          }
        }
      }
      return m;
    })();

    const resolveInvoiceForInvoiceItemRow = (args: { raw: any; baseType: string; tableName: string }) => {
      const nota = normalizeText(pickCsvRefPreferBubbleId(args.raw, ["nota_id_custom_notas_fiscais", "nota_id", "invoice_id_custom_notas_fiscais", "nota", "invoice"]));
      if (!nota) return { kind: "not_found" as const, strategy: "missing" as const };
      if (looksLikeBubbleId(nota)) {
        const bid = extractBubbleId(nota);
        if (bid && planCandidates.invoicesBubbleIds.has(bid)) return { kind: "bubble_id" as const, strategy: "bubble_id" as const };
        return { kind: "bubble_id_not_found" as const, strategy: "bubble_id" as const };
      }

      const dateKey = parseDateOnlyFlex(nota);
      if (!dateKey) return resolveForPlan({ csvValue: nota, bubbleIds: planCandidates.invoicesBubbleIds, primaryCandidates: planCandidates.invoicesByCodigo });

      const dk = String(dateKey).toLowerCase();
      const candidates = invoiceBubbleIdsByDateKey.get(dk) ?? [];
      if (candidates.length <= 1) {
        return candidates.length === 1 ? { kind: "date" as const, strategy: "date" as const } : { kind: "not_found" as const, strategy: "date" as const };
      }

      const supplierRef = normalizeText(pickCsvRefPreferBubbleId(args.raw, ["fornecedor_id_custom_fornecedores", "fornecedor_id", "supplier_id_custom_fornecedores", "fornecedor", "supplier"]));
      const supplierKey = supplierKeyFromRefText(supplierRef);
      const bySupplier = supplierKey ? candidates.filter((bid) => invoiceMetaByBubbleId.get(bid)?.supplierKey === supplierKey) : [];
      const narrowed1 = bySupplier.length ? bySupplier : candidates;
      if (narrowed1.length === 1) return { kind: "date" as const, strategy: "date+supplier" as const };

      const itemRef = normalizeText(pickCsvRefPreferBubbleId(args.raw, ["item_id_custom_itens", "item_id", "item"]));
      const itemKey = itemRef ? normalizeNameKey(itemRef) : "";
      const byItem = itemKey ? narrowed1.filter((bid) => invoiceMetaByBubbleId.get(bid)?.itemKeys?.has(itemKey)) : [];
      const narrowed2 = byItem.length ? byItem : narrowed1;
      if (narrowed2.length === 1) return { kind: "date" as const, strategy: supplierKey ? "date+supplier+item" : "date+item" };

      return { kind: "ambiguous" as const, strategy: supplierKey ? "date+supplier" : "date" };
    };

    const planByTable: Array<{
      order: number;
      table: string;
      baseTypes: string[];
      sourceRows: number;
      missingBubbleId: number;
      duplicatesInSource: number;
      wouldCreate: number;
      wouldUpdate: number;
      wouldIgnore: number;
      ignoreReasons: Record<string, number>;
      ignoreReasonTop: string;
    }> = [];

    const baseTypesByTable = new Map<string, string[]>();
    for (const bt of requiredTypes) {
      const t = mapBaseTypeToDestinationTable(bt);
      if (!t) continue;
      const list = baseTypesByTable.get(t) ?? [];
      if (!list.includes(bt)) list.push(bt);
      baseTypesByTable.set(t, list);
    }

    for (const [table, baseTypes] of baseTypesByTable.entries()) {
      const rows = allRecords.filter((r) => baseTypes.includes(String(r.base_type ?? "").trim().toLowerCase()));
      const missingBubbleId = rows.filter((r) => !String(r.bubble_id ?? "").trim()).length;
      const dups = duplicatesInCsv.filter((d) => baseTypes.includes(d.baseType)).reduce((acc, d) => acc + d.count - 1, 0);
      const ignoreReasons: Record<string, number> = {};
      const eligibleBubbleIds: string[] = [];
      const eligibleExternalKeys: string[] = [];

      const incReason = (reason: string) => {
        const k = normalizeText(reason) || "Ignorado";
        ignoreReasons[k] = (ignoreReasons[k] ?? 0) + 1;
      };

      const baseTypesSet = new Set(baseTypes);
      for (const r of rows) {
        const bt = String(r.base_type ?? "").trim().toLowerCase() || "unknown";
        const bubbleId = String(r.bubble_id ?? "").trim();
        const externalKey = String((r as any)?.external_key ?? "").trim();
        if (!bubbleId && !externalKey) {
          incReason("Sem Bubble ID e external_key não pôde ser gerada");
          continue;
        }
        if (bubbleId && duplicateUpsertKeySet.has(`${bt}::bubble:${bubbleId}`)) {
          incReason("Bubble ID duplicado no CSV");
          continue;
        }
        if (!bubbleId && externalKey && duplicateUpsertKeySet.has(`${bt}::external:${externalKey}`)) {
          incReason("external_key duplicada no CSV");
          continue;
        }

        const raw = (r as any)?.normalized ?? {};
        const tableName = table;

        const ignore = (() => {
          if (tableName === "items" && (bt === "custom.itens" || bt === "custom.item")) {
            const cat = normalizeText(pickCsvRefPreferBubbleId(raw, ["categoria_id_custom_categorias", "categoria_id", "category_id_custom_categorias", "categoria", "category"]));
            if (!cat) {
              incStrategy("items.category", "default:Sem categoria", "Sem categoria", bt, tableName);
              return "";
            }
            const res = resolveForPlan({ csvValue: cat, bubbleIds: planCandidates.categoriesBubbleIds, nameCandidates: planCandidates.categoriesByName });
            incStrategy("items.category", res.strategy, cat, bt, tableName);
            if (res.kind === "bubble_id_not_found") return "Categoria: Bubble ID não encontrado";
            if (res.kind === "ambiguous") return "Categoria ambígua (selecione)";
            if (res.kind === "not_found") return "Categoria não encontrada";
            return "";
          }

          if (tableName === "invoices" && bt === "custom.notas_fiscais") {
            const supplier = normalizeText(
              pickCsvRefPreferBubbleId(raw, ["fornecedor_id_custom_fornecedores", "fornecedor_id", "supplier_id_custom_fornecedores", "fornecedor", "supplier"]),
            );
            if (!supplier) return "Fornecedor vazio";
            const res = resolveForPlan({ csvValue: supplier, bubbleIds: planCandidates.suppliersBubbleIds, nameCandidates: planCandidates.suppliersByName });
            incStrategy("invoices.supplier", res.strategy, supplier, bt, tableName);
            if (res.kind === "bubble_id_not_found") return "Fornecedor: Bubble ID não encontrado";
            if (res.kind === "ambiguous") return "Fornecedor ambíguo (selecione)";
            if (res.kind === "not_found") return "Fornecedor não encontrado";
            return "";
          }

          if (tableName === "invoice_items" && bt === "custom.itens_notas") {
            const item = normalizeText(pickCsvRefPreferBubbleId(raw, ["item_id_custom_itens", "item_id", "item"]));
            const nota = normalizeText(pickCsvRefPreferBubbleId(raw, ["nota_id_custom_notas_fiscais", "nota_id", "invoice_id_custom_notas_fiscais", "nota", "invoice"]));
            if (!nota) {
              incStrategy("invoice_items.invoice", "missing->synthetic", "nota:manual", bt, tableName);
              if (!item) return "Item vazio";
              const itemRes = resolveForPlan({ csvValue: item, bubbleIds: planCandidates.itemsBubbleIds, nameCandidates: planCandidates.itemsByName });
              incStrategy("invoice_items.item", itemRes.strategy, item, bt, tableName);
              if (itemRes.kind === "bubble_id_not_found") return "Item: Bubble ID não encontrado";
              if (itemRes.kind === "ambiguous") return "Item ambíguo (selecione)";
              if (itemRes.kind === "not_found") return "Item não encontrado";
              return "";
            }
            const notaRes = resolveInvoiceForInvoiceItemRow({ raw, baseType: bt, tableName });
            incStrategy("invoice_items.invoice", (notaRes as any)?.strategy ?? "unknown", nota, bt, tableName);
            if (notaRes.kind === "bubble_id_not_found") return "Nota fiscal: Bubble ID não encontrado";
            if (notaRes.kind === "ambiguous") return "Nota fiscal ambígua (selecione)";
            if (notaRes.kind === "not_found") return "Nota fiscal não encontrada";
            if (!item) return "Item vazio";
            const itemRes = resolveForPlan({ csvValue: item, bubbleIds: planCandidates.itemsBubbleIds, nameCandidates: planCandidates.itemsByName });
            incStrategy("invoice_items.item", itemRes.strategy, item, bt, tableName);
            if (itemRes.kind === "bubble_id_not_found") return "Item: Bubble ID não encontrado";
            if (itemRes.kind === "ambiguous") return "Item ambíguo (selecione)";
            if (itemRes.kind === "not_found") return "Item não encontrado";
            return "";
          }

          if (tableName === "inventory_items" && bt === "custom.itens_inventarios") {
            const inv = normalizeText(pickCsvRefPreferBubbleId(raw, ["inventario_id_custom_inventarios", "inventario_id", "inventario"]));
            const item = normalizeText(pickCsvRefPreferBubbleId(raw, ["item_id_custom_itens", "item_id", "item"]));
            if (!inv) return "Inventário vazio";
            const invRes = resolveForPlan({ csvValue: inv, bubbleIds: planCandidates.inventoriesBubbleIds, dateCandidates: planCandidates.inventoriesByDate, primaryCandidates: planCandidates.inventoriesByName });
            incStrategy("inventory_items.inventory", invRes.strategy, inv, bt, tableName);
            if (invRes.kind === "bubble_id_not_found") return "Inventário: Bubble ID não encontrado";
            if (invRes.kind === "ambiguous") return "Inventário ambíguo (selecione)";
            if (invRes.kind === "not_found") return "Inventário não encontrado";
            if (!item) return "Item vazio";
            const itemRes = resolveForPlan({ csvValue: item, bubbleIds: planCandidates.itemsBubbleIds, nameCandidates: planCandidates.itemsByName });
            incStrategy("inventory_items.item", itemRes.strategy, item, bt, tableName);
            if (itemRes.kind === "bubble_id_not_found") return "Item: Bubble ID não encontrado";
            if (itemRes.kind === "ambiguous") return "Item ambíguo (selecione)";
            if (itemRes.kind === "not_found") return "";
            return "";
          }

          if (tableName === "wastes" && bt === "custom.desperdicio") {
            const item = normalizeText(pickCsvRefPreferBubbleId(raw, ["item_id_custom_itens", "item_id", "item"]));
            const motivo = normalizeText(pickCsvRefPreferBubbleId(raw, ["motivo_custom_motivos_desperdicios", "motivo_id", "motivo", "motivo_id_custom_motivos_desperdicios"]));
            if (!item) return "Item vazio";
            const itemRes = resolveForPlan({ csvValue: item, bubbleIds: planCandidates.itemsBubbleIds, nameCandidates: planCandidates.itemsByName });
            incStrategy("wastes.item", itemRes.strategy, item, bt, tableName);
            if (itemRes.kind === "bubble_id_not_found") return "Item: Bubble ID não encontrado";
            if (itemRes.kind === "ambiguous") return "Item ambíguo (selecione)";
            if (itemRes.kind === "not_found") return "Item não encontrado";
            if (!motivo) return "Motivo vazio";
            const motivoRes = resolveForPlan({ csvValue: motivo, bubbleIds: planCandidates.reasonsBubbleIds, primaryCandidates: planCandidates.reasonsByTitulo });
            incStrategy("wastes.reason", motivoRes.strategy, motivo, bt, tableName);
            if (motivoRes.kind === "bubble_id_not_found") return "Motivo: Bubble ID não encontrado";
            if (motivoRes.kind === "ambiguous") return "Motivo ambíguo (selecione)";
            if (motivoRes.kind === "not_found") return "Motivo não encontrado";
            return "";
          }

          if (tableName === "recipe_ingredients" && bt === "custom.ingredientes") {
            const receita = normalizeText(pickCsvRefPreferBubbleId(raw, ["receita_id_custom_itens", "receita_id", "recipe_id_custom_itens", "recipe_id", "receita", "recipe"]));
            const ing = normalizeText(pickCsvRefPreferBubbleId(raw, ["item_id_custom_itens", "item_id", "ingredient_item_id_custom_itens", "item", "ingredient_item"]));
            const inferredRecipeBubbleId = !receita && ing ? recipeBubbleIdByIngredientItemNameKey.get(normalizeNameKey(ing)) ?? "" : "";
            const receitaValue = receita || inferredRecipeBubbleId;
            if (!receitaValue) {
              incStrategy("recipe_ingredients.recipe", "missing->manual", "(vazio)", bt, tableName);
              if (!ing) return "Ingrediente vazio";
              const ingRes = resolveForPlan({ csvValue: ing, bubbleIds: planCandidates.itemsBubbleIds, nameCandidates: planCandidates.itemsByName });
              incStrategy("recipe_ingredients.ingredient", ingRes.strategy, ing, bt, tableName);
              if (ingRes.kind === "bubble_id_not_found") return "Ingrediente: Bubble ID não encontrado";
              if (ingRes.kind === "ambiguous") return "Ingrediente ambíguo (selecione)";
              if (ingRes.kind === "not_found") return "Ingrediente não encontrado";
              return "";
            }
            const receitaRes = resolveForPlan({ csvValue: receitaValue, bubbleIds: planCandidates.itemsBubbleIds, nameCandidates: planCandidates.itemsByName });
            incStrategy("recipe_ingredients.recipe", receita ? receitaRes.strategy : "inferred_from_items.lista_ingredientes", receitaValue, bt, tableName);
            if (receitaRes.kind === "bubble_id_not_found") return "Receita: Bubble ID não encontrado";
            if (receitaRes.kind === "ambiguous") return "Receita ambígua (selecione)";
            if (receitaRes.kind === "not_found") return "Receita não encontrada";
            if (!ing) return "Ingrediente vazio";
            const ingRes = resolveForPlan({ csvValue: ing, bubbleIds: planCandidates.itemsBubbleIds, nameCandidates: planCandidates.itemsByName });
            incStrategy("recipe_ingredients.ingredient", ingRes.strategy, ing, bt, tableName);
            if (ingRes.kind === "bubble_id_not_found") return "Ingrediente: Bubble ID não encontrado";
            if (ingRes.kind === "ambiguous") return "Ingrediente ambíguo (selecione)";
            if (ingRes.kind === "not_found") return "Ingrediente não encontrado";
            return "";
          }

          if (tableName === "avg_cost_events" && bt === "custom.custo_medio_item") {
            const item = normalizeText(pickCsvRefPreferBubbleId(raw, ["item_id_custom_itens", "item_id", "item"]));
            if (!item) return "Item vazio";
            const itemRes = resolveForPlan({ csvValue: item, bubbleIds: planCandidates.itemsBubbleIds, nameCandidates: planCandidates.itemsByName });
            incStrategy("avg_cost_events.item", itemRes.strategy, item, bt, tableName);
            if (itemRes.kind === "bubble_id_not_found") return "Item: Bubble ID não encontrado";
            if (itemRes.kind === "ambiguous") return "Item ambíguo (selecione)";
            if (itemRes.kind === "not_found") return "Item não encontrado";
            return "";
          }

          if (tableName === "labels" && bt === "custom.etiquetas") {
            return "";
          }

          if (tableName === "categories" && bt === "custom.categorias") return "";
          if (tableName === "suppliers" && bt === "custom.fornecedores") return "";
          if (tableName === "inventories" && bt === "custom.inventarios") return "";
          if (tableName === "waste_reasons" && bt === "custom.motivos_desperdicios") return "";
          if (tableName === "companies" && bt === "custom.empresas") return "";
          if (!baseTypesSet.has(bt)) return "";
          return "";
        })();

        if (ignore) {
          incReason(ignore);
          continue;
        }

        if (bubbleId) eligibleBubbleIds.push(bubbleId);
        else if (externalKey) eligibleExternalKeys.push(externalKey);
      }

      let wouldUpdate = 0;
      let wouldCreate = 0;
      if (eligibleBubbleIds.length) {
        const existing = await existingBubbleIdsByCompanyAndBubbleId(supabase, table, companyId, Array.from(new Set(eligibleBubbleIds)));
        for (const id of eligibleBubbleIds) {
          if (existing.has(id)) wouldUpdate += 1;
          else wouldCreate += 1;
        }
      }
      if (eligibleExternalKeys.length) {
        const existing = await existingExternalKeysByCompanyAndExternalKey(supabase, table, companyId, Array.from(new Set(eligibleExternalKeys)));
        for (const k of eligibleExternalKeys) {
          if (existing.has(k)) wouldUpdate += 1;
          else wouldCreate += 1;
        }
      }
      const wouldIgnore = Object.values(ignoreReasons).reduce((acc, n) => acc + Number(n ?? 0), 0);

      const ignoreReasonTop = (() => {
        const entries = Object.entries(ignoreReasons);
        if (!entries.length) return "";
        entries.sort((a, b) => Number(b[1] ?? 0) - Number(a[1] ?? 0) || a[0].localeCompare(b[0]));
        const [k, n] = entries[0] as [string, number];
        return n ? `${k} (${String(n)})` : k;
      })();

      planByTable.push({
        order: order.findIndex((t) => baseTypes.includes(t)) + 1,
        table,
        baseTypes,
        sourceRows: rows.length,
        missingBubbleId,
        duplicatesInSource: dups,
        wouldCreate,
        wouldUpdate,
        wouldIgnore,
        ignoreReasons,
        ignoreReasonTop,
      });
    }
    planByTable.sort((a, b) => a.order - b.order);

    const debugReport = (() => {
      const normalizeCols = (o: any) => Object.keys(o ?? {}).map((k) => String(k ?? "")).filter(Boolean).sort();
      const listNonEmptyCols = (o: any) => Object.keys(o ?? {}).filter((k) => normalizeText((o as any)?.[k])).sort();

      const candidatePick = (raw: any, candidateKeys: string[]) => {
        const evaluated = candidateKeys.map((k) => {
          const nk = normalizeKey(k);
          const v = raw?.[nk] ?? raw?.[k] ?? "";
          const text = normalizeText(v);
          const hasBubbleId = looksLikeBubbleId(text);
          return { key: k, normalized_key: nk, value: text, has_bubble_id: hasBubbleId, bubble_id: hasBubbleId ? extractBubbleId(text) : "" };
        });
        const nonEmpty = evaluated.filter((e) => e.value);
        const chosen = (() => {
          for (const e of nonEmpty) if (e.has_bubble_id) return e;
          return nonEmpty[0] ?? { key: "", normalized_key: "", value: "", has_bubble_id: false, bubble_id: "" };
        })();
        const anyBubbleId = nonEmpty.some((e) => e.has_bubble_id);
        const bubbleIdColsOutsideCandidates = (() => {
          const out: Array<{ key: string; value: string; bubble_id: string }> = [];
          const candidateNorm = new Set(candidateKeys.map((k) => normalizeKey(k)));
          for (const k of Object.keys(raw ?? {})) {
            const nk = normalizeKey(k);
            if (candidateNorm.has(nk)) continue;
            const v = normalizeText((raw as any)?.[k]);
            if (!v) continue;
            if (!looksLikeBubbleId(v)) continue;
            out.push({ key: k, value: v, bubble_id: extractBubbleId(v) });
          }
          return out.slice(0, 30);
        })();
        return { evaluated, chosen, anyBubbleId, bubbleIdColsOutsideCandidates };
      };

      const resolveDebug = (args: {
        csvValue: string;
        bubbleIds: Map<string, true>;
        nameCandidates?: Map<string, Array<{ value: string; label: string }>>;
        dateCandidates?: Map<string, Array<{ value: string; label: string }>>;
        primaryCandidates?: Map<string, Array<{ value: string; label: string }>>;
      }) => {
        const raw = normalizeText(args.csvValue);
        if (!raw) return { kind: "empty" as const, strategy: "missing" as const, candidates: [] as any[], reason: "Valor vazio." };
        if (looksLikeBubbleId(raw)) {
          const bid = extractBubbleId(raw);
          const ok = Boolean(bid && args.bubbleIds.has(bid));
          return {
            kind: ok ? ("resolved" as const) : ("bubble_id_not_found" as const),
            strategy: "bubble_id" as const,
            candidates: ok ? [{ value: bid, label: "Bubble ID (encontrado)" }] : [],
            reason: ok ? "" : "Bubble ID existe no CSV, mas não foi encontrado (nem no CSV nem no banco).",
          };
        }
        const dateKey = parseDateOnlyFlex(raw);
        if (dateKey && args.dateCandidates) {
          const list = args.dateCandidates.get(String(dateKey).toLowerCase()) ?? [];
          if (list.length === 1) return { kind: "resolved" as const, strategy: "date" as const, candidates: list, reason: "" };
          if (list.length > 1) return { kind: "ambiguous" as const, strategy: "date" as const, candidates: list.slice(0, 20), reason: "Mais de um candidato para a mesma data." };
          return { kind: "not_found" as const, strategy: "date" as const, candidates: [], reason: "Nenhum candidato para a data." };
        }
        const nameKey = normalizeNameKey(raw);
        if (args.nameCandidates) {
          const list = args.nameCandidates.get(nameKey) ?? [];
          if (list.length === 1) return { kind: "resolved" as const, strategy: "name" as const, candidates: list, reason: "" };
          if (list.length > 1) return { kind: "ambiguous" as const, strategy: "name" as const, candidates: list.slice(0, 20), reason: "Mais de um candidato para o mesmo nome." };
          return { kind: "not_found" as const, strategy: "name" as const, candidates: [], reason: "Nenhum candidato para o nome." };
        }
        if (args.primaryCandidates) {
          const list = args.primaryCandidates.get(nameKey) ?? [];
          if (list.length === 1) return { kind: "resolved" as const, strategy: "primary_field" as const, candidates: list, reason: "" };
          if (list.length > 1)
            return { kind: "ambiguous" as const, strategy: "primary_field" as const, candidates: list.slice(0, 20), reason: "Mais de um candidato para o mesmo Primary Field." };
          return { kind: "not_found" as const, strategy: "primary_field" as const, candidates: [], reason: "Nenhum candidato para o Primary Field." };
        }
        return { kind: "not_found" as const, strategy: "not_found" as const, candidates: [], reason: "Não foi possível resolver." };
      };

      const KEYS = {
        item_category: ["categoria_id_custom_categorias", "categoria_id", "category_id_custom_categorias", "categoria", "category"],
        invoice_supplier: ["fornecedor_id_custom_fornecedores", "fornecedor_id", "supplier_id_custom_fornecedores", "fornecedor", "supplier"],
        invoice_item_invoice: ["nota_id_custom_notas_fiscais", "nota_id", "invoice_id_custom_notas_fiscais", "nota", "invoice"],
        ingredient_recipe: ["receita_id_custom_itens", "receita_id", "recipe_id_custom_itens", "recipe_id", "receita", "recipe"],
        ingredient_item: ["item_id_custom_itens", "item_id", "ingredient_item_id_custom_itens", "item", "ingredient_item"],
      } as const;

      type DebugIssue = {
        issue_type: string;
        csv_value: string;
        base_type: string;
        table: string;
        occurrences: number;
        original_row: any;
        available_columns: { raw_headers: string[]; normalized_keys: string[]; normalized_non_empty: string[] };
        candidate_columns_evaluated: any[];
        chosen_column: string;
        chosen_value: string;
        has_bubble_id_in_any_candidate: boolean;
        bubble_id_columns_outside_candidates: any[];
        strategy_used: string;
        candidates_found: any[];
        ambiguity_reason: string;
        suggested_fix: string;
      };

      const issuesByKey = new Map<string, DebugIssue>();
      const add = (issue: Omit<DebugIssue, "occurrences">) => {
        const k = `${issue.issue_type}::${issue.table}::${normalizeText(issue.csv_value).toLowerCase()}`;
        const prev = issuesByKey.get(k);
        if (prev) {
          prev.occurrences += 1;
          return;
        }
        issuesByKey.set(k, { ...issue, occurrences: 1 });
      };

      const suggestFix = (args: {
        relationLabel: string;
        pick: ReturnType<typeof candidatePick>;
        resolved: ReturnType<typeof resolveDebug>;
        chosenValue: string;
      }) => {
        if (args.pick.bubbleIdColsOutsideCandidates.length) {
          const cols = args.pick.bubbleIdColsOutsideCandidates.map((c) => String(c.key ?? "")).filter(Boolean).slice(0, 5);
          return `Adicionar estas colunas à lista de candidatos de ${args.relationLabel} e priorizar Bubble ID: ${cols.join(", ")}.`;
        }
        if (args.pick.anyBubbleId) {
          if (args.resolved.kind === "bubble_id_not_found") return `O relacionamento contém Bubble ID, mas ele não foi encontrado no grafo (CSV + banco). Corrigir o CSV (referência apontando para ID inexistente) ou garantir que o registro referenciado foi enviado/importado.`;
          return `O relacionamento contém Bubble ID em alguma coluna candidata; garantir que a coluna com Bubble ID esteja preenchida e consistente.`;
        }
        if (args.resolved.kind === "ambiguous") return `O CSV não forneceu Bubble ID para o relacionamento; por isso caiu em ${args.resolved.strategy} e ficou ambíguo. Ajustar export/colunas para incluir a referência por Bubble ID.`;
        if (args.resolved.kind === "not_found") return `O CSV não forneceu Bubble ID e nenhum candidato foi encontrado via ${args.resolved.strategy}. Ajustar export/aliases para trazer o ID da referência.`;
        if (args.resolved.kind === "empty") return `A referência está vazia no CSV. Verifique se o Bubble exportou o campo de relacionamento e se o header corresponde ao esperado.`;
        return "";
      };

      for (const r of allRecords as any[]) {
        const bt = String(r?.base_type ?? "").trim().toLowerCase();
        const raw = (r as any)?.normalized ?? {};
        const table = mapBaseTypeToDestinationTable(bt) ?? "";
        const base_type = bt;

        if (bt === "custom.itens" || bt === "custom.item") {
          const pick = candidatePick(raw, [...KEYS.item_category]);
          const chosenValue = normalizeText(pick.chosen.value);
          const resolved = resolveDebug({ csvValue: chosenValue, bubbleIds: planCandidates.categoriesBubbleIds, nameCandidates: planCandidates.categoriesByName });
          if (resolved.kind === "ambiguous" || resolved.kind === "bubble_id_not_found" || resolved.kind === "not_found") {
            add({
              issue_type: resolved.kind === "ambiguous" ? "category_ambiguous" : resolved.kind === "bubble_id_not_found" ? "category_bubble_id_not_found" : "category_not_found",
              csv_value: chosenValue,
              base_type,
              table,
              original_row: { row_number: (r as any)?.row_number ?? null, bubble_id: r?.bubble_id ?? null, sources: r?.sources ?? [], raw: r?.raw ?? {}, normalized: raw },
              available_columns: { raw_headers: normalizeCols(r?.raw ?? {}), normalized_keys: normalizeCols(raw), normalized_non_empty: listNonEmptyCols(raw) },
              candidate_columns_evaluated: pick.evaluated,
              chosen_column: pick.chosen.key,
              chosen_value: chosenValue,
              has_bubble_id_in_any_candidate: pick.anyBubbleId,
              bubble_id_columns_outside_candidates: pick.bubbleIdColsOutsideCandidates,
              strategy_used: resolved.strategy,
              candidates_found: resolved.candidates,
              ambiguity_reason: resolved.reason,
              suggested_fix: suggestFix({ relationLabel: "categoria", pick, resolved, chosenValue }),
            });
          }
        }

        if (bt === "custom.notas_fiscais") {
          const pick = candidatePick(raw, [...KEYS.invoice_supplier]);
          const chosenValue = normalizeText(pick.chosen.value);
          const resolved = resolveDebug({ csvValue: chosenValue, bubbleIds: planCandidates.suppliersBubbleIds, nameCandidates: planCandidates.suppliersByName });
          if (resolved.kind === "ambiguous" || resolved.kind === "bubble_id_not_found" || resolved.kind === "not_found") {
            add({
              issue_type: resolved.kind === "ambiguous" ? "supplier_ambiguous" : resolved.kind === "bubble_id_not_found" ? "supplier_bubble_id_not_found" : "supplier_not_found",
              csv_value: chosenValue,
              base_type,
              table,
              original_row: { row_number: (r as any)?.row_number ?? null, bubble_id: r?.bubble_id ?? null, sources: r?.sources ?? [], raw: r?.raw ?? {}, normalized: raw },
              available_columns: { raw_headers: normalizeCols(r?.raw ?? {}), normalized_keys: normalizeCols(raw), normalized_non_empty: listNonEmptyCols(raw) },
              candidate_columns_evaluated: pick.evaluated,
              chosen_column: pick.chosen.key,
              chosen_value: chosenValue,
              has_bubble_id_in_any_candidate: pick.anyBubbleId,
              bubble_id_columns_outside_candidates: pick.bubbleIdColsOutsideCandidates,
              strategy_used: resolved.strategy,
              candidates_found: resolved.candidates,
              ambiguity_reason: resolved.reason,
              suggested_fix: suggestFix({ relationLabel: "fornecedor", pick, resolved, chosenValue }),
            });
          }
        }

        if (bt === "custom.itens_notas") {
          const pick = candidatePick(raw, [...KEYS.invoice_item_invoice]);
          const chosenValue = normalizeText(pick.chosen.value);
          const resolved = resolveDebug({ csvValue: chosenValue, bubbleIds: planCandidates.invoicesBubbleIds, dateCandidates: planCandidates.invoicesByDate, primaryCandidates: planCandidates.invoicesByCodigo });
          if (resolved.kind === "ambiguous" || resolved.kind === "bubble_id_not_found" || resolved.kind === "not_found") {
            add({
              issue_type: resolved.kind === "ambiguous" ? "invoice_ambiguous" : resolved.kind === "bubble_id_not_found" ? "invoice_bubble_id_not_found" : "invoice_not_found",
              csv_value: chosenValue,
              base_type,
              table,
              original_row: { row_number: (r as any)?.row_number ?? null, bubble_id: r?.bubble_id ?? null, sources: r?.sources ?? [], raw: r?.raw ?? {}, normalized: raw },
              available_columns: { raw_headers: normalizeCols(r?.raw ?? {}), normalized_keys: normalizeCols(raw), normalized_non_empty: listNonEmptyCols(raw) },
              candidate_columns_evaluated: pick.evaluated,
              chosen_column: pick.chosen.key,
              chosen_value: chosenValue,
              has_bubble_id_in_any_candidate: pick.anyBubbleId,
              bubble_id_columns_outside_candidates: pick.bubbleIdColsOutsideCandidates,
              strategy_used: resolved.strategy,
              candidates_found: resolved.candidates,
              ambiguity_reason: resolved.reason,
              suggested_fix: suggestFix({ relationLabel: "nota_fiscal", pick, resolved, chosenValue }),
            });
          }
        }

        if (bt === "custom.ingredientes") {
          const pickRecipe = candidatePick(raw, [...KEYS.ingredient_recipe]);
          const recipeValue = normalizeText(pickRecipe.chosen.value);
          const recipeResolved = resolveDebug({ csvValue: recipeValue, bubbleIds: planCandidates.itemsBubbleIds, nameCandidates: planCandidates.itemsByName });

          const pickItem = candidatePick(raw, [...KEYS.ingredient_item]);
          const itemValue = normalizeText(pickItem.chosen.value);
          const itemResolved = resolveDebug({ csvValue: itemValue, bubbleIds: planCandidates.itemsBubbleIds, nameCandidates: planCandidates.itemsByName });

          if (!recipeValue || recipeResolved.kind === "ambiguous" || recipeResolved.kind === "bubble_id_not_found" || recipeResolved.kind === "not_found") {
            add({
              issue_type: !recipeValue ? "recipe_empty" : recipeResolved.kind === "ambiguous" ? "recipe_ambiguous" : recipeResolved.kind === "bubble_id_not_found" ? "recipe_bubble_id_not_found" : "recipe_not_found",
              csv_value: recipeValue || "(vazio)",
              base_type,
              table,
              original_row: { row_number: (r as any)?.row_number ?? null, bubble_id: r?.bubble_id ?? null, sources: r?.sources ?? [], raw: r?.raw ?? {}, normalized: raw },
              available_columns: { raw_headers: normalizeCols(r?.raw ?? {}), normalized_keys: normalizeCols(raw), normalized_non_empty: listNonEmptyCols(raw) },
              candidate_columns_evaluated: [
                { role: "recipe", evaluated: pickRecipe.evaluated, chosen: pickRecipe.chosen },
                { role: "item", evaluated: pickItem.evaluated, chosen: pickItem.chosen, item_resolution: itemResolved },
              ],
              chosen_column: pickRecipe.chosen.key,
              chosen_value: recipeValue,
              has_bubble_id_in_any_candidate: pickRecipe.anyBubbleId,
              bubble_id_columns_outside_candidates: pickRecipe.bubbleIdColsOutsideCandidates,
              strategy_used: recipeResolved.strategy,
              candidates_found: recipeResolved.candidates,
              ambiguity_reason: recipeResolved.reason || (!recipeValue ? "Receita vazia no CSV." : ""),
              suggested_fix: suggestFix({ relationLabel: "receita", pick: pickRecipe, resolved: recipeResolved, chosenValue: recipeValue }),
            });
          }
        }
      }

      const issues = Array.from(issuesByKey.values())
        .sort((a, b) => b.occurrences - a.occurrences || a.issue_type.localeCompare(b.issue_type) || a.csv_value.localeCompare(b.csv_value))
        .slice(0, 500);

      const summary = issues.reduce(
        (acc, it) => {
          acc.totalIssues += 1;
          acc.totalOccurrences += it.occurrences;
          acc.byType[it.issue_type] = (acc.byType[it.issue_type] ?? 0) + it.occurrences;
          return acc;
        },
        { totalIssues: 0, totalOccurrences: 0, byType: {} as Record<string, number> },
      );

      return {
        fileName: "debug_relacionamentos_csv.json",
        generatedAt: new Date().toISOString(),
        email,
        companyId,
        summary,
        issues,
      };
    })();

    const isLocalDevDebug = isLocalDevRequest(req);
    let debugReportWrite: { written: boolean; path: string } | null = null;
    if (isLocalDevDebug) {
      try {
        const outPath = join(process.cwd(), debugReport.fileName);
        await writeFile(outPath, JSON.stringify(debugReport, null, 2), "utf8");
        debugReportWrite = { written: true, path: outPath };
      } catch {
        debugReportWrite = { written: false, path: "" };
      }
    }

    const validation = validateIntegrity(allRecords);
    const relationResolution = await buildRelationResolutionPreview({ supabase, companyId, records: allRecords, db: dbLookup }).catch((err) => ({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }));

    try {
      const bucket = "admin-importacao-manual";
      await ensureBucket(supabase, bucket);
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const basePath = `sessions/csv/${normalizeNameKey(email)}/${companyId}/staging`;
      const groups = new Map<string, any[]>();
      for (const rec of allRecords as any[]) {
        const t = String(rec?.base_type ?? "").trim() || "unknown";
        const list = groups.get(t) ?? [];
        list.push(rec);
        groups.set(t, list);
      }
      for (const [baseType, group] of groups.entries()) {
        const key = normalizeKey(baseType).replace(/\./g, "_") || "unknown";
        await uploadJson(supabase, bucket, `${basePath}/${key}_latest.json`, {
          meta: { email, companyId, requesterId, baseType, capturedAt: new Date().toISOString(), records: group.length },
          records: group,
        });
        await uploadJson(supabase, bucket, `${basePath}/${key}_${stamp}.json`, {
          meta: { email, companyId, requesterId, baseType, capturedAt: new Date().toISOString(), records: group.length },
          records: group,
        });
      }
    } catch {}

    return json(
      {
        ok: true,
        mode: "bubble_csv",
        email,
        companyId,
        derivedCompany,
        files: fileReports,
        detection,
        unknownFiles,
        missingFiles,
        duplicatesInCsv: duplicatesInCsv.slice(0, 200),
        plan: { order: requiredTypes, byTable: planByTable },
        relationStrategy: { counts: relationStrategyCounts, samples: relationStrategySamples },
        debugReport: { fileName: debugReport.fileName, writtenToDisk: Boolean(debugReportWrite?.written), diskPath: debugReportWrite?.path ?? "" },
        totals: { files: files.length, rows: allRecords.length, byType: typeCounts.length },
        byType: typeCounts,
        recordsForApply: allRecords,
        validation,
        relationResolution,
      },
      { status: 200 },
    );
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
