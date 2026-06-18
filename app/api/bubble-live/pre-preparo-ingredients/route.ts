import { NextRequest, NextResponse } from "next/server";
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

export async function POST(req: NextRequest) {
  try {
    const { userId } = getUserIdFromRequest(req);
    if (!userId) return json({ ok: false, error: "unauthorized" }, { status: 401 });

    const body = (await req.json().catch(() => null)) as any;
    const baseUrl = safeBaseUrl(String(body?.baseUrl ?? ""));
    const token = safeToken(String(body?.token ?? ""));
    const itemId = String(body?.itemId ?? "").trim();

    if (!baseUrl) return json({ ok: false, error: "missing_base_url" }, { status: 400 });
    if (!token) return json({ ok: false, error: "missing_token" }, { status: 400 });
    if (!itemId) return json({ ok: false, error: "missing_itemId" }, { status: 400 });

    const item = await fetchBubbleObject(baseUrl, token, "itens", itemId);
    const ingredientListRaw = getFieldLoose(item, ["Ingredients", "ingredients", "ingredientes"]);
    const ingredientList: any[] = Array.isArray(ingredientListRaw)
      ? (ingredientListRaw as any[])
      : typeof ingredientListRaw === "string" && ingredientListRaw.trim().startsWith("[")
        ? (JSON.parse(ingredientListRaw) as any[])
        : [];

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
      const obj = await fetchBubbleObject(baseUrl, token, "Ingredientes", k).catch(() => null);
      ingCache.set(k, obj);
      return obj;
    };

    for (const entry of ingredientList) {
      const directObj = entry && typeof entry === "object" && !Array.isArray(entry) ? (entry as any) : null;
      const ingId = extractRefId(entry);
      const ingObj = directObj && (directObj.item_id || directObj.quantidade || directObj.qtd || directObj.qtde) ? directObj : ingId ? await getIng(ingId) : null;
      if (!ingObj || typeof ingObj !== "object") continue;

      const itemRef = getFieldLoose(ingObj, ["item_id", "item", "insumo", "ingrediente"]);
      const itemRefId = extractRefId(itemRef);
      const itemObj = itemRefId ? await getItem(itemRefId) : null;
      const nome = String(getFieldLoose(itemObj, ["item", "nome", "descricao", "name"]) ?? "").trim() || String(getFieldLoose(ingObj, ["nome", "name"]) ?? "").trim();
      if (!nome) continue;

      const qtyRaw = getFieldLoose(ingObj, ["quantidade", "qtd", "qtde", "qty", "amount"]);
      const qtyNum = parsePtNumber(String(qtyRaw ?? ""));
      const quantidade = qtyNum > 0 ? qtyNum.toLocaleString("pt-BR", { minimumFractionDigits: 3, maximumFractionDigits: 3 }) : "0,000";
      const unidadeRaw = getFieldLoose(ingObj, ["unidade", "medida", "unit"]);
      const unidade = String(unidadeRaw ?? getFieldLoose(itemObj, ["unidade", "medida", "unit"]) ?? "Und").trim() || "Und";

      const custoRaw = getFieldLoose(ingObj, ["custo", "valor", "subtotal", "total", "custo_total", "cost", "price"]);
      const custoNum = parsePtNumber(String(custoRaw ?? ""));
      const custoCents = custoNum > 0 ? Math.max(0, Math.round(custoNum * 100)) : 0;

      const rid = ingId || itemRefId || String(Date.now());
      ingredientes.push({ id: rid, item: nome, quantidade, unidade, custoCents });
    }

    return json({ ok: true, itemId, ingredientes }, { status: 200 });
  } catch (err) {
    if (err instanceof BubbleApiError) return json({ ok: false, error: err.message, bubbleStatus: err.bubbleStatus, bubbleBody: err.bubbleBody }, { status: 502 });
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

