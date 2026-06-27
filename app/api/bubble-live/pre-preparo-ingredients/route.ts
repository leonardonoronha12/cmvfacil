import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin";
import { getUserIdFromRequest } from "../../../lib/requestUserId";
import { readBubbleGlobalConfigFromDb, readBubbleGlobalConfigFromEnv } from "../../../lib/bubbleGlobalConfig";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return NextResponse.json(data, { ...init, headers });
}

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

function getEnv(key: string) {
  const v = process.env[key];
  return typeof v === "string" ? v : "";
}

function normalizeKey(input: string) {
  return String(input ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function parsePtNumber(input: string) {
  const s = String(input ?? "").replace(/[^\d,.-]/g, "").trim();
  if (!s) return 0;
  const neg = s.includes("-");
  const cleaned = s.replace(/-/g, "");
  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");
  const normalized = (() => {
    if (lastComma < 0 && lastDot < 0) return cleaned.replace(/[^\d]/g, "");
    if (lastComma > lastDot) {
      const intPart = cleaned.slice(0, lastComma).replace(/[^\d]/g, "");
      const frac = cleaned.slice(lastComma + 1).replace(/[^\d]/g, "");
      return `${intPart}.${frac}`;
    }
    const intPart = cleaned.slice(0, lastDot).replace(/[^\d]/g, "");
    const frac = cleaned.slice(lastDot + 1).replace(/[^\d]/g, "");
    return `${intPart}.${frac}`;
  })();
  const n = Number.parseFloat(normalized);
  if (!Number.isFinite(n)) return 0;
  return neg ? -n : n;
}

function extractBubbleIdFromText(input: string) {
  const s = String(input ?? "").trim();
  if (!s) return "";
  const m = s.match(/"(?:unique_id|_id|id|bubble_id|user_id)"\s*:\s*"([^"]+)"/i);
  return m ? String(m[1] ?? "").trim() : "";
}

function extractRefId(value: unknown) {
  if (!value) return "";
  if (typeof value === "string") return extractBubbleIdFromText(value) || value.trim();
  if (typeof value === "object") {
    const v: any = value;
    const id = String(v?.unique_id ?? v?._id ?? v?.id ?? v?.bubble_id ?? "").trim();
    if (id) return id;
    try {
      const asText = JSON.stringify(value);
      return extractBubbleIdFromText(asText);
    } catch {
      return "";
    }
  }
  return "";
}

function formatDateDDMMYYYY(d: Date) {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = String(d.getFullYear());
  return `${dd}/${mm}/${yyyy}`;
}

function formatTimeHHMM(d: Date) {
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function parseDateLoose(value: unknown) {
  if (!value) return null;
  if (value instanceof Date && Number.isFinite(value.getTime())) return value;
  if (typeof value === "number" && Number.isFinite(value)) {
    const d = new Date(value);
    return Number.isFinite(d.getTime()) ? d : null;
  }
  const s = String(value ?? "").trim();
  if (!s) return null;
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d : null;
}

function normalizeUnit(input: unknown) {
  const raw = String(input ?? "").trim();
  if (!raw) return "";
  const u = raw.toLowerCase();
  if (u === "kg" || u === "kilo" || u === "kilos" || u === "quilo" || u === "quilos") return "Kg";
  if (u === "g" || u === "grama" || u === "gramas") return "g";
  if (u === "l" || u === "lt" || u === "litro" || u === "litros") return "L";
  if (u === "ml") return "mL";
  if (u === "un" || u === "und" || u === "unid" || u === "unidade" || u === "unidades") return "Und";
  return raw.length <= 6 ? raw : raw.slice(0, 6);
}

function getUnitLoose(obj: any) {
  return (
    getFieldLoose(obj, [
      "unidade",
      "medida",
      "unit",
      "unidade_medida",
      "unidadeMedida",
      "unidade_de_medida",
      "item_medida",
      "itemMedida",
      "medida_item",
      "medidaItem",
      "unidade_item",
      "unidadeItem",
    ]) ?? undefined
  );
}

function getFieldLoose(obj: any, names: string[]) {
  if (!obj || typeof obj !== "object") return undefined;
  for (const n of names) {
    if (obj[n] != null) return obj[n];
  }
  const want = new Set(names.map((x) => normalizeKey(x)));
  for (const [k, v] of Object.entries(obj)) {
    if (want.has(normalizeKey(k))) return v as any;
  }
  return undefined;
}

function parseJsonArrayLoose(value: unknown) {
  if (!value) return null;
  if (Array.isArray(value)) return value as any[];
  if (typeof value === "string") {
    const s = value.trim();
    if (!s) return null;
    if (s.startsWith("[") || s.startsWith("{")) {
      try {
        const parsed = JSON.parse(s);
        return Array.isArray(parsed) ? (parsed as any[]) : null;
      } catch {
        return null;
      }
    }
    return null;
  }
  return null;
}

function pickIngredientListFromItem(item: any) {
  const direct = getFieldLoose(item, ["Ingredients", "ingredients", "ingredientes"]);
  const parsed = parseJsonArrayLoose(direct);
  if (parsed && parsed.length) return { list: parsed, field: "Ingredients/ingredientes" };

  let bestKey = "";
  let bestList: any[] | null = null;
  for (const [k, v] of Object.entries(item ?? {})) {
    const nk = normalizeKey(k);
    if (!nk.includes("ingred")) continue;
    const arr = parseJsonArrayLoose(v);
    if (!arr || !arr.length) continue;
    if (!bestList || arr.length > bestList.length) {
      bestList = arr;
      bestKey = String(k);
    }
  }
  if (bestList) return { list: bestList, field: bestKey || "unknown_ingred_field" };
  return { list: [] as any[], field: "" };
}

function pickModoPreparoFromItem(item: any) {
  const direct = getFieldLoose(item, ["modo_preparo", "modoPreparo", "preparo", "modo", "modo_de_preparo", "modoDePreparo"]);
  const directStr = String(direct ?? "").trim();
  if (directStr) return directStr;
  let best = "";
  for (const [k, v] of Object.entries(item ?? {})) {
    const nk = normalizeKey(k);
    if (!(nk.includes("preparo") || (nk.includes("modo") && nk.includes("prep")))) continue;
    const s = String(v ?? "").trim();
    if (s.length > best.length) best = s;
  }
  return best.trim();
}

function pickItemName(item: any) {
  const name = getFieldLoose(item, ["receita", "nome", "item", "name", "descricao", "description"]);
  return String(name ?? "").trim();
}

function parseQtyAndUnitFromLabel(raw: string) {
  const s = String(raw ?? "").trim();
  if (!s) return { qty: 0, unit: "" };
  const m = s.match(/(\d+(?:[.,]\d+)?)\s*([a-zA-Z]{1,6})/);
  if (!m) return { qty: 0, unit: "" };
  const qty = parsePtNumber(m[1]);
  const unit = normalizeUnit(m[2]);
  return { qty, unit };
}

function hashCode7(input: string) {
  const s = String(input ?? "").trim();
  if (!s) return "";
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const base = Math.abs(h >>> 0).toString(36).toUpperCase();
  return base.padStart(7, "0").slice(0, 7);
}

function pickEtiquetaCode(obj: any, fallbackId: string) {
  const direct = getFieldLoose(obj, ["codigo", "code", "hash", "short_id", "shortId", "uid", "identificador"]);
  const s = String(direct ?? "").trim();
  if (s && s.length <= 16) return s.replace(/^#/, "");
  const f = String(fallbackId ?? "").trim();
  if (!f) return "";
  return hashCode7(f);
}

function pickUserDisplayName(obj: any) {
  const name = getFieldLoose(obj, ["name", "nome", "full_name", "fullName", "display_name", "displayName"]);
  const s = String(name ?? "").trim();
  if (s) return s;
  const email = getFieldLoose(obj, ["email"]);
  const e = String(email ?? "").trim();
  return e;
}

function pickEtiquetaQtyAndUnit(obj: any, fallbackUnit: string) {
  const unitFieldRaw = getFieldLoose(obj, ["unidade_label", "unit_label", "medida_label", "unidade", "medida", "unit", "unidade_medida", "unidadeMedida", "unidade_de_medida"]);
  const unitField = normalizeUnit(unitFieldRaw);

  const labelCandidates: unknown[] = [
    getFieldLoose(obj, ["quantidade_label", "qtd_label", "qtde_label", "peso_label", "label", "titulo", "nome", "name"]),
    getFieldLoose(obj, ["quantidade", "qtd", "qtde", "qty", "amount", "peso"]),
  ];
  let qtyFromText = 0;
  let unitFromText = "";
  for (const v of labelCandidates) {
    const parsed = parseQtyAndUnitFromLabel(String(v ?? ""));
    if (parsed.qty > 0) {
      qtyFromText = parsed.qty;
      unitFromText = parsed.unit;
      break;
    }
  }

  const qtyRaw = getFieldLoose(obj, ["quantidade", "qtd", "qtde", "qty", "amount", "peso"]);
  let qtyNum = qtyRaw != null ? parsePtNumber(String(qtyRaw)) : 0;
  if (!(qtyNum > 0) && qtyFromText > 0) qtyNum = qtyFromText;

  if (!(qtyNum > 0)) {
    for (const [k, v] of Object.entries(obj ?? {})) {
      const nk = normalizeKey(k);
      if (!(nk.includes("qtd") || nk.includes("qtde") || nk.includes("quant") || nk.includes("peso"))) continue;
      const parsed = parseQtyAndUnitFromLabel(String(v ?? ""));
      if (parsed.qty > 0) {
        qtyNum = parsed.qty;
        if (!unitFromText) unitFromText = parsed.unit;
        break;
      }
    }
  }

  const unit = normalizeUnit(unitField || unitFromText || fallbackUnit || "Und") || "Und";
  const qtyLabel = qtyNum > 0 ? formatQtyFixed3(qtyNum) : "0,000";
  return { qtyLabel, unit };
}

function formatQtyFixed3(n: number) {
  return n.toLocaleString("pt-BR", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}

async function fetchBubbleJson(baseUrl: string, token: string, path: string) {
  const url = `${baseUrl}${path.startsWith("/") ? "" : "/"}${path}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  const text = await res.text();
  let parsed: any = null;
  try {
    parsed = JSON.parse(text);
  } catch {}
  if (!res.ok) {
    const msg = parsed?.body?.message || parsed?.message || text || `bubble_failed_${res.status}`;
    throw new BubbleApiError(String(msg).slice(0, 400), res.status, String(text ?? "").slice(0, 2000));
  }
  return parsed;
}

async function fetchBubbleObject(baseUrl: string, token: string, type: string, id: string) {
  const raw = await fetchBubbleJson(baseUrl, token, `/api/1.1/obj/${encodeURIComponent(type)}/${encodeURIComponent(id)}`);
  const response = raw?.response ?? raw ?? {};
  return response && typeof response === "object" ? response : {};
}

type BubbleConstraint = { key: string; constraint_type: string; value: unknown };

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
  const raw = await fetchBubbleJson(baseUrl, token, `/api/1.1/obj/${encodeURIComponent(typeName)}?${qs.toString()}`);
  const response = raw?.response ?? raw ?? {};
  const results = Array.isArray(response?.results) ? response.results : Array.isArray(response) ? response : [];
  const remaining = typeof response?.remaining === "number" ? response.remaining : null;
  return { results: results as unknown[], remaining };
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

export async function POST(req: NextRequest) {
  try {
    const { userId } = getUserIdFromRequest(req);
    if (!userId) return json({ ok: false, error: "unauthorized" }, { status: 401 });

    const body = (await req.json().catch(() => null)) as any;
    const itemId = String(body?.itemId ?? "").trim();
    if (!itemId) return json({ ok: false, error: "missing_itemId" }, { status: 400 });

    let baseUrl = safeBaseUrl(String(body?.baseUrl ?? ""));
    let token = safeToken(String(body?.token ?? ""));

    if (!baseUrl || !token) {
      let supabase: ReturnType<typeof getSupabaseAdmin> | null = null;
      try {
        supabase = getSupabaseAdmin();
      } catch {
        supabase = null;
      }
      if (supabase) {
        const bucket = "bubble-imports";
        const statePath = `user:${userId}/bootstrap/sync-state.json`;
        const state = await downloadJsonFromStorage(supabase, bucket, statePath).catch(() => null);
        const creds = state && typeof state === "object" && (state as any).credentials && typeof (state as any).credentials === "object" ? (state as any).credentials : null;
        if (!baseUrl) baseUrl = safeBaseUrl(String(creds?.baseUrl ?? ""));
        if (!token) token = safeToken(String(creds?.token ?? ""));
      }
    }
    if (!baseUrl || !token) {
      const globalDb = await readBubbleGlobalConfigFromDb();
      const globalEnv = readBubbleGlobalConfigFromEnv();
      const global = (globalDb.ok ? globalDb.value : null) ?? globalEnv ?? null;
      if (!baseUrl) baseUrl = safeBaseUrl(String(global?.baseUrl ?? ""));
      if (!token) token = safeToken(String(global?.token ?? ""));
    }
    if (!baseUrl) baseUrl = safeBaseUrl(getEnv("BUBBLE_BASE_URL") || "");
    if (!token) token = safeToken(getEnv("BUBBLE_API_TOKEN") || "");
    if (!baseUrl) return json({ ok: false, error: "missing_base_url" }, { status: 400 });
    if (!token) return json({ ok: false, error: "missing_token" }, { status: 400 });

    const item = await fetchBubbleObject(baseUrl, token, "itens", itemId);
    const receita = pickItemName(item);
    const modoPreparo = pickModoPreparoFromItem(item);
    const itemUnit = normalizeUnit(getUnitLoose(item)) || "";
    const fromItem = pickIngredientListFromItem(item);
    const ingredientList: any[] = fromItem.list;

    let ingredientEntries: any[] = ingredientList;
    let source: "item_field" | "query" = "item_field";
    let usedConstraintKey = "";
    let usedItemField = fromItem.field;

    if (!ingredientEntries.length) {
      const typeNames = ["Ingredientes", "ingredientes"];
      const candidateKeys = [
        "item_receita_id",
        "item_receita",
        "receita_id",
        "receita",
        "pre_preparo_id",
        "prepreparo_id",
        "item_pre_preparo_id",
        "item_prepreparo_id",
        "pre_preparo",
        "prepreparo",
      ];
      for (const typeName of typeNames) {
        for (const key of candidateKeys) {
          try {
            const out: any[] = [];
            for (let cursor = 0; cursor < 50_000; cursor += 200) {
              const page = await fetchBubblePage({
                baseUrl,
                token,
                typeName,
                cursor,
                limit: 200,
                constraints: [{ key, constraint_type: "equals", value: itemId }],
                sortField: "Created Date",
                descending: false,
              });
              out.push(...(page.results as any[]));
              if (!(typeof page.remaining === "number") || page.remaining <= 0) break;
              if (!page.results.length) break;
            }
            if (out.length) {
              ingredientEntries = out;
              source = "query";
              usedConstraintKey = `${typeName}.${key}`;
              break;
            }
          } catch (err) {
            const status = err instanceof BubbleApiError ? err.bubbleStatus : null;
            if (status === 400) continue;
            if (status === 404) break;
            throw err;
          }
        }
        if (ingredientEntries.length) break;
      }
    }

    const ingredientes: Array<{ id: string; item: string; quantidade: string; unidade: string; custoCents: number }> = [];
    const itemCache = new Map<string, any>();
    const ingCache = new Map<string, any>();

    const getItem = async (id: string) => {
      const k = String(id ?? "").trim();
      if (!k) return null;
      if (itemCache.has(k)) return itemCache.get(k);
      const obj = await fetchBubbleObject(baseUrl, token, "itens", k).catch(() => null);
      itemCache.set(k, obj);
      return obj;
    };

    const getIng = async (id: string) => {
      const k = String(id ?? "").trim();
      if (!k) return null;
      if (ingCache.has(k)) return ingCache.get(k);
      const obj =
        (await fetchBubbleObject(baseUrl, token, "Ingredientes", k).catch(() => null)) ||
        (await fetchBubbleObject(baseUrl, token, "ingredientes", k).catch(() => null));
      ingCache.set(k, obj);
      return obj;
    };

    for (const entry of ingredientEntries) {
      const directObj = entry && typeof entry === "object" && !Array.isArray(entry) ? (entry as any) : null;
      const ingId = extractRefId(entry);
      let ingObj: any =
        directObj && (directObj.item_id || directObj.quantidade || directObj.qtd || directObj.qtde) ? directObj : ingId ? await getIng(ingId) : null;
      if (!ingObj && ingId) {
        const maybeItem = await getItem(ingId);
        if (maybeItem && typeof maybeItem === "object") ingObj = { item_id: ingId, quantidade: 1, unidade: getFieldLoose(maybeItem, ["unidade", "medida", "unit"]) ?? "Und" };
      }
      if (!ingObj || typeof ingObj !== "object") continue;

      const itemRef = getFieldLoose(ingObj, ["item_id", "item", "insumo", "ingrediente"]);
      const itemRefId = extractRefId(itemRef);
      const itemObj = itemRefId ? await getItem(itemRefId) : null;
      const nome = String(getFieldLoose(itemObj, ["item", "nome", "descricao", "name"]) ?? "").trim() || String(getFieldLoose(ingObj, ["nome", "name"]) ?? "").trim();
      if (!nome) continue;

      const qtyRaw = getFieldLoose(ingObj, ["quantidade", "qtd", "qtde", "qty", "amount"]);
      const qtyNum = parsePtNumber(String(qtyRaw ?? ""));
      const quantidade = qtyNum > 0 ? qtyNum.toLocaleString("pt-BR", { minimumFractionDigits: 3, maximumFractionDigits: 3 }) : "0,000";
      const unidadeRaw = getUnitLoose(ingObj);
      const unidadeFromItem = getUnitLoose(itemObj);
      const unidade = normalizeUnit(unidadeRaw ?? unidadeFromItem ?? itemUnit ?? "Und") || "Und";

      const custoRaw = getFieldLoose(ingObj, ["custo", "valor", "subtotal", "total", "custo_total", "cost", "price"]);
      const custoNum = parsePtNumber(String(custoRaw ?? ""));
      const custoCents = custoNum > 0 ? Math.max(0, Math.round(custoNum * 100)) : 0;

      const rid = ingId || itemRefId || String(Date.now());
      ingredientes.push({ id: rid, item: nome, quantidade, unidade, custoCents });
    }

    const etiquetasOut: Array<{
      id: string;
      recipeId: string;
      receita: string;
      responsavel: string;
      quantidade: string;
      unidade: string;
      custo: string;
      dataProducao: string;
      dataValidade: string;
      code?: string;
      createdAt?: string;
      wasteStatus?: "pending" | "launched" | "ignored";
    }> = [];

    const etiquetaTypeNames = ["etiquetas", "Etiquetas", "pre_preparo_etiquetas", "pre_preparo_etiqueta"];
    const etiquetaKeys = [
      "item_id",
      "item",
      "item_receita_id",
      "item_receita",
      "receita_id",
      "receita",
      "pre_preparo_id",
      "prepreparo_id",
      "pre_preparo",
      "prepreparo",
    ];
    let etiquetasSource = "";
    const userNameCache = new Map<string, string>();
    const getUserName = async (raw: unknown) => {
      const directObj = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as any) : null;
      const directName = directObj ? pickUserDisplayName(directObj) : "";
      if (directName) return directName;
      const rawStr = String(raw ?? "").trim();
      const refId = extractRefId(raw);
      const id = refId || rawStr;
      if (!id) return "";
      if (userNameCache.has(id)) return userNameCache.get(id) || "";
      let name = "";
      for (const typeName of ["User", "users", "Usuarios", "usuarios"]) {
        const obj = await fetchBubbleObject(baseUrl, token, typeName, id).catch(() => null);
        const n = obj ? pickUserDisplayName(obj) : "";
        if (n) {
          name = n;
          break;
        }
      }
      userNameCache.set(id, name || rawStr);
      return name || rawStr;
    };
    for (const typeName of etiquetaTypeNames) {
      for (const key of etiquetaKeys) {
        try {
          const out: any[] = [];
          for (let cursor = 0; cursor < 50_000; cursor += 200) {
            const page = await fetchBubblePage({
              baseUrl,
              token,
              typeName,
              cursor,
              limit: 200,
              constraints: [{ key, constraint_type: "equals", value: itemId }],
              sortField: "Created Date",
              descending: true,
            });
            out.push(...(page.results as any[]));
            if (!(typeof page.remaining === "number") || page.remaining <= 0) break;
            if (!page.results.length) break;
          }
          if (out.length) {
            etiquetasSource = `${typeName}.${key}`;
            for (const raw of out) {
              const obj = raw && typeof raw === "object" ? (raw as any) : null;
              if (!obj) continue;
              const bubbleId = String(obj?.unique_id ?? obj?._id ?? obj?.id ?? obj?.bubble_id ?? "").trim() || extractRefId(obj);
              if (!bubbleId) continue;
              const { qtyLabel, unit } = pickEtiquetaQtyAndUnit(obj, itemUnit || "Und");

              const prodRaw = getFieldLoose(obj, ["data_producao", "dataProducao", "producao", "data_prod", "created_date", "Created Date"]);
              const valRaw = getFieldLoose(obj, ["data_validade", "dataValidade", "validade", "data_val", "validade_data"]);
              const prodDate = parseDateLoose(prodRaw);
              const valDate = parseDateLoose(valRaw);
              const dataProducao = prodDate ? formatDateDDMMYYYY(prodDate) : "";
              const dataValidade = valDate ? formatDateDDMMYYYY(valDate) : "";
              if (!dataValidade) continue;

              const createdRaw = getFieldLoose(obj, ["Created Date", "created_date", "createdAt", "created_at", "created"]);
              const createdDate = parseDateLoose(createdRaw);
              const createdAt = createdDate ? createdDate.toISOString() : "";
              const code = pickEtiquetaCode(obj, bubbleId);

              const respRaw = getFieldLoose(obj, ["responsavel", "usuario", "user", "criador", "created_by", "Created By"]);
              const responsavel = await getUserName(respRaw);
              const custoRaw = getFieldLoose(obj, ["custo", "valor", "subtotal", "total", "custo_total", "cost", "price"]);
              const custoNum = parsePtNumber(String(custoRaw ?? ""));
              const custo = custoNum > 0 ? `R$${custoNum.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "R$0,00";

              etiquetasOut.push({
                id: `bubble:${bubbleId}`,
                recipeId: itemId,
                receita: receita || itemId,
                responsavel,
                quantidade: qtyLabel,
                unidade: unit,
                custo,
                dataProducao: dataProducao || "-",
                dataValidade,
                code: code || undefined,
                createdAt: createdAt || undefined,
                wasteStatus: "pending",
              });
            }
            break;
          }
        } catch (err) {
          const status = err instanceof BubbleApiError ? err.bubbleStatus : null;
          if (status === 400) continue;
          if (status === 404) break;
          throw err;
        }
      }
      if (etiquetasSource) break;
    }

    return json(
      {
        ok: true,
        itemId,
        receita: receita || null,
        modoPreparo: modoPreparo || null,
        itemUnit: itemUnit || null,
        etiquetas: etiquetasOut,
        etiquetasSource: etiquetasSource || null,
        ingredientes,
        source,
        usedConstraintKey,
        usedItemField: usedItemField || null,
      },
      { status: 200 },
    );
  } catch (err) {
    if (err instanceof BubbleApiError) return json({ ok: false, error: err.message, bubbleStatus: err.bubbleStatus, bubbleBody: err.bubbleBody }, { status: 502 });
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
