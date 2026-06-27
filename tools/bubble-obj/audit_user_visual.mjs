import fs from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";

const ROOT = process.cwd();
const ENV_PATH = path.join(ROOT, ".env.local");
const OUT_DIR = path.join(ROOT, "tools", "bubble-obj", "out");

function nowIso() {
  return new Date().toISOString();
}

function readDotenv(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const raw = fs.readFileSync(filePath, "utf8");
  const out = {};
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i <= 0) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if (v.length >= 2) {
      const a = v.charCodeAt(0);
      const b = v.charCodeAt(v.length - 1);
      if ((a === 34 && b === 34) || (a === 39 && b === 39)) v = v.slice(1, -1);
    }
    out[k] = v;
  }
  return out;
}

function requireEnv(env, key) {
  const v = String(env[key] ?? "").trim();
  if (!v) throw new Error(`missing_env:${key}`);
  return v;
}

function safeFileKey(input) {
  return String(input ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9@._+-]+/g, "_")
    .slice(0, 120);
}

function parseArgs(argv) {
  const args = { site: "", email: "", bubbleLimit: 10, systemLimit: 10, bubbleCursor: 0 };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--site") args.site = String(argv[i + 1] ?? "");
    if (a === "--email") args.email = String(argv[i + 1] ?? "");
    if (a === "--bubbleLimit") args.bubbleLimit = Number(argv[i + 1] ?? args.bubbleLimit);
    if (a === "--systemLimit") args.systemLimit = Number(argv[i + 1] ?? args.systemLimit);
  }
  args.site = String(args.site || "").trim().replace(/\/+$/g, "");
  args.email = String(args.email || "").trim().toLowerCase();
  args.bubbleLimit = Number.isFinite(args.bubbleLimit) && args.bubbleLimit > 0 ? Math.min(50, Math.floor(args.bubbleLimit)) : 10;
  args.systemLimit = Number.isFinite(args.systemLimit) && args.systemLimit > 0 ? Math.min(50, Math.floor(args.systemLimit)) : 10;
  if (!args.site) throw new Error("missing_arg:--site");
  if (!args.email) throw new Error("missing_arg:--email");
  return args;
}

function parseObjectType(objectType) {
  const raw = String(objectType ?? "").trim();
  const withoutScope = raw.includes("#") ? raw.split("#", 1)[0] : raw;
  const parts = withoutScope.split("@");
  const baseType = String(parts[0] ?? "").trim();
  const companyId = String(parts[1] ?? "").trim() || null;
  return { objectType: raw, baseType, companyId };
}

function normalizeKey(input) {
  return String(input ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function pickAnyCI(obj, keys) {
  const o = obj && typeof obj === "object" ? obj : null;
  if (!o) return "";
  for (const k of keys) {
    const direct = o[k];
    if (direct != null && String(direct).trim()) return direct;
  }
  const byNorm = new Map();
  for (const [k, v] of Object.entries(o)) byNorm.set(normalizeKey(k), v);
  for (const k of keys) {
    const v = byNorm.get(normalizeKey(k));
    if (v != null && String(v).trim()) return v;
  }
  return "";
}

function extractBubbleId(input) {
  const s = String(input ?? "").trim();
  if (!s) return "";
  const m = s.match(/\d{8,}x\d{6,}/);
  return m ? String(m[0]).trim() : "";
}

function parsePtNumber(input) {
  const s = String(input ?? "").replace(/[^\d,.-]/g, "").trim();
  if (!s) return 0;
  const neg = s.includes("-");
  const cleaned = s.replace(/-/g, "");
  const normalized = (() => {
    const hasDot = cleaned.includes(".");
    const hasComma = cleaned.includes(",");
    if (hasDot && hasComma) return cleaned.replace(/\./g, "").replace(",", ".");
    if (hasComma && !hasDot) return cleaned.replace(",", ".");
    return cleaned;
  })();
  const n = Number.parseFloat(normalized);
  if (!Number.isFinite(n)) return 0;
  return neg ? -n : n;
}

function parseDateLoose(input) {
  const s = String(input ?? "").trim();
  if (!s) return null;
  const t = Date.parse(s);
  if (Number.isFinite(t)) return t;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) {
    const t2 = Date.parse(`${m[1]}-${m[2]}-${m[3]}T00:00:00.000Z`);
    if (Number.isFinite(t2)) return t2;
  }
  return null;
}

function brlToCents(input) {
  const n = parsePtNumber(input);
  if (!n) return 0;
  return Math.round(n * 100);
}

function centsToBrl(cents) {
  const n = Number(cents);
  if (!Number.isFinite(n)) return "";
  return formatMoneyBRL(n / 100);
}

function formatMoneyBRL(num) {
  const n = Number(num);
  if (!Number.isFinite(n)) return "";
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function bubbleCountAndSampleDirect(args) {
  const page1 = await bubbleFetchPage({ ...args, cursor: 0, limit: 1 });
  if (!page1.ok) return { ok: false, total: null, sample: [], error: page1.error || "", url: page1.url || "" };
  const remaining = typeof page1.remaining === "number" ? page1.remaining : null;
  const total = remaining == null ? null : page1.results.length + Math.max(0, remaining);
  const maxAll = Number.isFinite(args.maxAll) ? Math.max(1, Math.floor(args.maxAll)) : 300;
  if (typeof total === "number" && total >= 0 && total <= maxAll) {
    const all = [];
    const pageLimit = Math.max(1, Math.min(100, total || 1));
    for (let cursor = 0; all.length < maxAll; cursor += pageLimit) {
      const page = await bubbleFetchPage({ ...args, cursor, limit: pageLimit });
      if (!page.ok) return { ok: false, total, sample: [], error: page.error || "", url: page.url || "" };
      for (const r of page.results) all.push(r);
      if (page.remaining === 0 || page.results.length < pageLimit) break;
    }
    return { ok: true, total, sample: all, error: "", url: page1.url || "" };
  }

  const sample = await bubbleFetchPage({ ...args, cursor: 0, limit: args.limit || 10 });
  return { ok: sample.ok, total, sample: sample.ok ? sample.results : [], error: sample.ok ? "" : sample.error || "", url: sample.url || "" };
}

function countSystemRows(result) {
  if (!result?.ok) return null;
  const j = result.json ?? null;
  if (!j || typeof j !== "object") return null;
  if (Array.isArray(j.rows)) return j.rows.length;
  if (Array.isArray(j.payload)) return j.payload.length;
  if (Array.isArray(j.list)) return j.list.length;
  if (j.row && typeof j.row === "object") {
    const info = j.row.info;
    if (info && typeof info === "object" && !Array.isArray(info)) return Object.keys(info).length;
    return 1;
  }
  return null;
}

function normalizeItemIdForMatch(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (raw.includes("insumo:")) return raw.split("insumo:", 2)[1].trim();
  return extractBubbleId(raw);
}

function indexPayloadById(payload) {
  const map = new Map();
  for (const r of Array.isArray(payload) ? payload : []) {
    const id = String(r?.id ?? "").trim();
    if (id) map.set(id, r);
  }
  return map;
}

function getInventarioItemSnapshot(inventarioRows, bubbleInventarioId, bubbleItemId) {
  const invIdToken = extractBubbleId(bubbleInventarioId) || bubbleInventarioId;
  const itemIdToken = extractBubbleId(bubbleItemId) || bubbleItemId;
  for (const inv of Array.isArray(inventarioRows) ? inventarioRows : []) {
    const invId = String(inv?.id ?? "");
    if (!invId.includes(invIdToken)) continue;
    for (const cat of Array.isArray(inv?.categorias) ? inv.categorias : []) {
      for (const it of Array.isArray(cat?.itens) ? cat.itens : []) {
        const itId = String(it?.id ?? "");
        if (!itId.includes(itemIdToken)) continue;
        return { inventarioId: String(inv?.id ?? ""), categoria: String(cat?.nome ?? ""), itemId: itId, item: String(it?.item ?? ""), unidade: String(it?.unidade ?? ""), estoqueFinal: String(it?.estoqueFinal ?? "") };
      }
    }
  }
  return null;
}

function deriveCmvRealAndListaCompras(input) {
  const diasEstoque = Number.isFinite(input?.diasEstoque) ? Math.max(1, Math.floor(input.diasEstoque)) : 7;
  const diasEntrega = Number.isFinite(input?.diasEntrega) ? Math.max(0, Math.floor(input.diasEntrega)) : 1;
  const insumosRows = Array.isArray(input?.insumosRows) ? input.insumosRows : [];
  const inventarioRows = Array.isArray(input?.inventarioRows) ? input.inventarioRows : [];
  const entradasRows = Array.isArray(input?.entradasRows) ? input.entradasRows : [];

  const invOpts = inventarioRows
    .map((inv) => {
      const id = String(inv?.id ?? "").trim();
      const data = String(inv?.data ?? "").trim();
      const t = parseDateLoose(data);
      if (!id || !t) return null;
      return { id, data, t, inv };
    })
    .filter(Boolean)
    .sort((a, b) => a.t - b.t);

  const start = invOpts[0] ?? null;
  const end = invOpts[invOpts.length - 1] ?? null;
  const minT = start && end ? Math.min(start.t, end.t) : 0;
  const maxT = start && end ? Math.max(start.t, end.t) : 0;
  const periodDays = start && end ? Math.max(Math.round((maxT - minT) / (1000 * 60 * 60 * 24)), 1) : 1;

  const initialById = new Map();
  const finalById = new Map();

  const readContagem = (contagem, targetMap) => {
    for (const cat of Array.isArray(contagem?.categorias) ? contagem.categorias : []) {
      for (const it of Array.isArray(cat?.itens) ? cat.itens : []) {
        const id = String(it?.id ?? "").trim();
        if (!id) continue;
        if (Boolean(it?.removido)) continue;
        targetMap.set(id, parsePtNumber(it?.estoqueFinal ?? "0"));
      }
    }
  };

  if (start?.inv) readContagem(start.inv, initialById);
  if (end?.inv) readContagem(end.inv, finalById);

  const insumoById = new Map();
  const insumoIdByName = new Map();
  for (const r of insumosRows) {
    const id = String(r?.id ?? "").trim();
    const name = String(r?.item ?? "").trim();
    if (!id || !name) continue;
    insumoById.set(id, r);
    const key = normalizeKey(name);
    if (key && !insumoIdByName.has(key)) insumoIdByName.set(key, id);
  }

  const periodEntradas = [];
  for (const e of entradasRows) {
    const t = parseDateLoose(e?.data_lancamento ?? e?.dataLancamento ?? "");
    if (!t) continue;
    if (minT && t < minT) continue;
    if (maxT && t > maxT) continue;
    periodEntradas.push(e);
  }

  const comprasQtyById = new Map();
  const costSumCentsById = new Map();
  const qtySumById = new Map();
  let comprasCents = 0;

  for (const e of periodEntradas) {
    const itens = Array.isArray(e?.itens_nota) ? e.itens_nota : Array.isArray(e?.itensNota) ? e.itensNota : [];
    for (const it of itens) {
      const insumoEquivalente = String(it?.insumoEquivalente ?? "").trim();
      if (!insumoEquivalente) continue;
      const insumoId = insumoIdByName.get(normalizeKey(insumoEquivalente)) ?? "";
      if (!insumoId) continue;
      const qty = parsePtNumber(it?.equivalenteQuantidade ?? it?.quantidade ?? "0");
      const subtotalCents = brlToCents(it?.subtotal ?? "");
      const unitCentsFromSubtotal = qty > 0 && subtotalCents > 0 ? Math.round(subtotalCents / qty) : 0;
      const unitCents = unitCentsFromSubtotal || brlToCents(it?.custoUnitario ?? "");

      if (qty > 0) comprasQtyById.set(insumoId, (comprasQtyById.get(insumoId) ?? 0) + qty);
      if (unitCents > 0 && qty > 0) {
        costSumCentsById.set(insumoId, (costSumCentsById.get(insumoId) ?? 0) + unitCents * qty);
        qtySumById.set(insumoId, (qtySumById.get(insumoId) ?? 0) + qty);
      }
      if (subtotalCents > 0) comprasCents += subtotalCents;
    }
  }

  const avgUnitCostCentsById = new Map();
  for (const [id, sumC] of costSumCentsById.entries()) {
    const sumQ = qtySumById.get(id) ?? 0;
    if (!sumQ) continue;
    avgUnitCostCentsById.set(id, Math.round(sumC / sumQ));
  }

  const unitCostForId = (id) => {
    const fromAvg = avgUnitCostCentsById.get(id) ?? 0;
    if (fromAvg) return fromAvg;
    const ins = insumoById.get(id) ?? null;
    const cm = brlToCents(ins?.custoMedio ?? ins?.custo_medio ?? "");
    return cm || 0;
  };

  const totalInventoryCents = (qtyById) => {
    let total = 0;
    for (const [id, qty] of qtyById.entries()) {
      const unit = unitCostForId(id);
      if (!unit || !qty) continue;
      total += Math.round(unit * qty);
    }
    return total;
  };

  const initialCents = totalInventoryCents(initialById);
  const finalCents = totalInventoryCents(finalById);
  const cmvCents = initialCents + comprasCents - finalCents;

  const listaRows = [];
  for (const r of insumosRows) {
    const id = String(r?.id ?? "").trim();
    if (!id) continue;
    const item = String(r?.item ?? "").trim() || "Item";
    const categoria = String(r?.categoria ?? "").trim() || "Sem categoria";
    const medida = String(r?.medida ?? "").trim() || "Und";
    const unitCostCents = unitCostForId(id);
    const initialQty = initialById.get(id) ?? 0;
    const finalQty = finalById.get(id) ?? 0;
    const entradasQty = comprasQtyById.get(id) ?? 0;
    const consumoDiario = Math.max((initialQty + entradasQty - finalQty) / periodDays, 0);
    const demanda = consumoDiario * (diasEstoque + diasEntrega);
    const comprar = Math.max(demanda - finalQty, 0);
    listaRows.push({
      id,
      item,
      categoria,
      medida,
      custoMedio: unitCostCents ? centsToBrl(unitCostCents) : "",
      consumoDiario,
      estoqueFinal: finalQty,
      comprar,
    });
  }

  const listaRowsComprar = listaRows.filter((r) => r.comprar > 0.00001).sort((a, b) => b.comprar - a.comprar);

  const cmvItemRows = [];
  for (const r of insumosRows) {
    const id = String(r?.id ?? "").trim();
    if (!id) continue;
    const initialQty = initialById.get(id) ?? 0;
    const finalQty = finalById.get(id) ?? 0;
    const entradasQty = comprasQtyById.get(id) ?? 0;
    const saidasQty = initialQty + entradasQty - finalQty;
    const unit = unitCostForId(id);
    const saidasCents = unit && saidasQty > 0 ? Math.round(unit * saidasQty) : 0;
    if (!saidasQty) continue;
    cmvItemRows.push({
      id,
      item: String(r?.item ?? "").trim() || "Item",
      unidade: String(r?.medida ?? "").trim() || "Und",
      initialQty,
      entradasQty,
      finalQty,
      saidasQty,
      unitCost: unit ? centsToBrl(unit) : "",
      cmv: saidasCents ? centsToBrl(saidasCents) : "",
    });
  }
  cmvItemRows.sort((a, b) => parsePtNumber(b.cmv) - parsePtNumber(a.cmv));

  return {
    ok: Boolean(start && end),
    period: {
      startId: start?.id ?? null,
      startDate: start?.data ?? null,
      endId: end?.id ?? null,
      endDate: end?.data ?? null,
      days: periodDays,
    },
    cmv: {
      initial: centsToBrl(initialCents),
      compras: centsToBrl(comprasCents),
      final: centsToBrl(finalCents),
      cmv: centsToBrl(cmvCents),
      initialCents,
      comprasCents,
      finalCents,
      cmvCents,
    },
    lista: {
      totalRows: listaRows.length,
      rowsComprar: listaRowsComprar.length,
      top: listaRowsComprar.slice(0, 10),
    },
    cmvItemsTop: cmvItemRows.slice(0, 10),
  };
}

function buildBubbleObjUrl(input) {
  const { baseUrl, type, cursor, limit, constraints } = input;
  const url = new URL(`${String(baseUrl ?? "").replace(/\/+$/, "")}/api/1.1/obj/${encodeURIComponent(type)}`);
  url.searchParams.set("cursor", String(cursor));
  url.searchParams.set("limit", String(limit));
  if (constraints && constraints.length) url.searchParams.set("constraints", JSON.stringify(constraints));
  return url.toString();
}

async function bubbleFetchPage(args) {
  const url = buildBubbleObjUrl(args);
  const timeoutMs = 15_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${args.token}` },
      cache: "no-store",
      signal: controller.signal,
    });
    const text = await res.text();
    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
    const response = parsed?.response ?? parsed ?? {};
    const results = Array.isArray(response?.results) ? response.results : Array.isArray(response) ? response : [];
    const remaining = typeof response?.remaining === "number" ? response.remaining : null;
    if (!res.ok) {
      const msg = String(parsed?.body?.message ?? parsed?.message ?? text).slice(0, 600);
      return { ok: false, status: res.status, error: msg, results: [], remaining: null, url };
    }
    return { ok: true, status: res.status, error: "", results, remaining, url };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, status: 0, error: `bubble_timeout:request:${msg}`, results: [], remaining: null, url };
  } finally {
    clearTimeout(timer);
  }
}

function constraintKeysForType(baseType) {
  return [
    "Created By",
    "created_by",
    "criado_por",
    "owner",
    "Owner",
    "usuario",
    "usuário",
    "user",
    "User",
    "usuario_id",
    "user_id",
    "bubble_user_id",
    "responsavel_id",
  ];
}

async function bubbleCountAndSample(args) {
  const { baseUrl, token, baseType, bubbleUserId, companyId, limit } = args;
  const type = String(baseType ?? "").trim();
  const companyKeys = ["empresa_id", "empresa", "company_id", "company", "restaurante_id", "restaurante"];
  const keys = companyId ? companyKeys : constraintKeysForType(type);
  const value = companyId ? companyId : bubbleUserId;

  let last = null;
  for (const key of keys) {
    const constraints = [{ key, constraint_type: "equals", value }];
    const page1 = await bubbleFetchPage({ baseUrl, token, type, cursor: 0, limit: 1, constraints });
    if (!page1.ok) {
      last = { key, page1 };
      const e = String(page1.error ?? "");
      const lower = e.toLowerCase();
      if (page1.status === 400 && (lower.includes("constraint") || lower.includes("constraints") || lower.includes("key") || lower.includes("field"))) continue;
      if (page1.status === 404) continue;
      continue;
    }
    const remaining = typeof page1.remaining === "number" ? page1.remaining : null;
    const total = remaining == null ? null : page1.results.length + Math.max(0, remaining);
    const maxAll = Number.isFinite(args.maxAll) ? Math.max(1, Math.floor(args.maxAll)) : 300;
    if (typeof total === "number" && total >= 0 && total <= maxAll) {
      const all = [];
      const pageLimit = Math.max(1, Math.min(100, total || 1));
      for (let cursor = 0; all.length < maxAll; cursor += pageLimit) {
        const page = await bubbleFetchPage({ baseUrl, token, type, cursor, limit: pageLimit, constraints });
        if (!page.ok) return { ok: false, scopedBy: key, total, sample: [], error: page.error || "", url: page.url };
        for (const r of page.results) all.push(r);
        if (page.remaining === 0 || page.results.length < pageLimit) break;
      }
      return { ok: true, scopedBy: key, total, sample: all, error: "", url: page1.url };
    }

    const sample = await bubbleFetchPage({ baseUrl, token, type, cursor: 0, limit, constraints });
    const sampleResults = sample.ok ? sample.results : [];
    return { ok: true, scopedBy: key, total, sample: sampleResults, error: "", url: sample.url };
  }

  return { ok: false, scopedBy: last?.key ?? null, total: null, sample: [], error: last?.page1?.error ?? "unable_to_scope", url: last?.page1?.url ?? "" };
}

function parseLinkTokenHash(actionLink) {
  const s = String(actionLink ?? "").trim();
  if (!s) return "";
  const q = s.includes("?") ? s.split("?", 2)[1] : "";
  if (!q) return "";
  const params = new URLSearchParams(q);
  return String(params.get("token_hash") ?? params.get("token") ?? "").trim();
}

async function getSessionForEmail(admin, anon, email) {
  let lastErr = null;
  for (let i = 0; i < 6; i++) {
    const gen = await admin.auth.admin.generateLink({ type: "magiclink", email });
    if (gen.error) {
      lastErr = gen.error;
      continue;
    }
    const tokenHash = parseLinkTokenHash(gen.data?.properties?.action_link);
    if (!tokenHash) {
      lastErr = new Error("missing_token_hash");
      continue;
    }
    const v = await anon.auth.verifyOtp({ type: "magiclink", token_hash: tokenHash });
    if (v.error) {
      lastErr = v.error;
      continue;
    }
    const session = v.data?.session || null;
    if (!session?.access_token) {
      lastErr = new Error("missing_access_token");
      continue;
    }
    return session;
  }
  throw new Error(String(lastErr?.message ?? lastErr ?? "unable_to_get_session"));
}

function cookieFromSession(session) {
  const accessToken = String(session?.access_token ?? "").trim();
  if (!accessToken) return "";
  return `cmv_at=${accessToken}`;
}

async function httpJson(url, init) {
  const timeoutMs = Math.max(1000, Math.min(60_000, Number(init?.timeoutMs ?? 15_000)));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, cache: "no-store", signal: controller.signal });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = { _raw: text };
    }
    return { ok: res.ok, status: res.status, json };
  } finally {
    clearTimeout(timer);
  }
}

function indexInsumosByBubbleId(insumosRows) {
  const map = new Map();
  for (const r of Array.isArray(insumosRows) ? insumosRows : []) {
    const id = String(r?.id ?? "");
    const bubbleId = id.includes("insumo:") ? id.split("insumo:", 2)[1] : extractBubbleId(id);
    if (bubbleId) map.set(bubbleId, r);
  }
  return map;
}

function normalizeItemFromBubble(raw) {
  const bubbleItemId = String(raw?._id ?? "").trim() || extractBubbleId(JSON.stringify(raw ?? {}));
  const item =
    String(pickAnyCI(raw, ["nome", "item", "produto", "descricao", "name", "Nome", "Item", "Produto", "Descrição"]) ?? "")
      .replace(/\s+/g, " ")
      .trim() || "";
  const medida =
    String(pickAnyCI(raw, ["medida", "unidade", "unidade_medida", "unidade_de_medida", "unidade_de_compra", "unidade_base", "Medida", "Unidade"]) ?? "")
      .replace(/\s+/g, " ")
      .trim() || "";
  const categoriaId = String(pickAnyCI(raw, ["categoria_id", "categoria", "id_categoria", "Categoria"]) ?? "").trim();
  const categoriaNome = String(pickAnyCI(raw, ["categoria_nome", "categoria_label", "grupo", "category", "Categoria Nome"]) ?? "").trim();
  return { bubbleItemId, item, medida, categoriaId, categoriaNome };
}

function normalizeCustoFromBubble(raw) {
  const bubbleItemId = extractBubbleId(pickAnyCI(raw, ["item_id", "item", "id_item", "insumo_id", "Item"]) ?? "") || extractBubbleId(JSON.stringify(raw ?? {}));
  const custoRaw = pickAnyCI(raw, ["custo_medio", "custo", "valor", "preco", "preco_unitario", "custo_unitario", "valor_unitario", "Custo Médio", "Custo", "Preço"]);
  const num = parsePtNumber(String(custoRaw ?? ""));
  return { bubbleItemId, custoMedio: num ? formatMoneyBRL(num) : "" };
}

async function loadBubbleCreds(admin) {
  const { data, error } = await admin.from("bubble_global_config").select("base_url,api_token").eq("id", "global").maybeSingle();
  if (error) throw new Error(error.message);
  const raw = String(data?.base_url ?? "").trim().replace(/\/+$/g, "");
  const baseUrl = raw.replace(/\/api\/1\.1\/obj$/i, "").replace(/\/api\/1\.1$/i, "") || raw;
  const token = String((data?.api_token ?? "")).trim();
  if (!baseUrl || !token) throw new Error("missing_bubble_global_config");
  return { baseUrl, token };
}

async function main() {
  const args = parseArgs(process.argv);
  const env = { ...readDotenv(ENV_PATH), ...process.env };
  const supabaseUrl = requireEnv(env, "SUPABASE_URL");
  const anonKey = requireEnv(env, "SUPABASE_ANON_KEY");
  const serviceKey = requireEnv(env, "SUPABASE_SERVICE_ROLE_KEY");
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const anon = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const creds = await loadBubbleCreds(admin);

  const { data: mig, error: migErr } = await admin.from("bubble_obj_user_migration").select("*").eq("email", args.email).maybeSingle();
  if (migErr) throw new Error(migErr.message);
  if (!mig) throw new Error("migration_not_found_for_email");

  const userId = String(mig.supabase_user_id ?? "").trim();
  const runId = String(mig.last_run_id ?? "").trim();
  const bubbleUserId = String(mig.bubble_user_id ?? "").trim();
  if (!userId || !runId || !bubbleUserId) throw new Error("missing_userId_or_runId_or_bubbleUserId");

  const { data: runItems, error: runItemsErr } = await admin
    .from("bubble_obj_import_run_item")
    .select("object_type,total_received,total_saved_staging,total_processed,total_error,status")
    .eq("supabase_user_id", userId)
    .eq("run_id", runId)
    .order("object_type", { ascending: true });
  if (runItemsErr) throw new Error(runItemsErr.message);

  const objectTypes = (runItems ?? []).map((x) => String(x.object_type ?? "").trim()).filter(Boolean);
  const baseTypes = Array.from(new Set(objectTypes.map((ot) => String(parseObjectType(ot).baseType ?? "").trim()).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b),
  );

  const byBase = new Map();
  for (const ot of objectTypes) {
    const p = parseObjectType(ot);
    const baseType = String(p.baseType ?? "").trim();
    if (!baseType) continue;
    const prev = byBase.get(baseType) ?? { baseType, companyId: p.companyId, objectTypes: [] };
    prev.objectTypes.push(ot);
    if (!prev.companyId && p.companyId) prev.companyId = p.companyId;
    byBase.set(baseType, prev);
  }
  const companyId =
    Array.from(byBase.values())
      .map((g) => g?.companyId)
      .find((x) => typeof x === "string" && String(x).trim()) || null;

  const bubbleDump = {};
  for (const baseType of baseTypes) {
    const group = byBase.get(baseType);
    const companyId = group?.companyId ?? null;
    const dump = await bubbleCountAndSample({
      baseUrl: creds.baseUrl,
      token: creds.token,
      baseType,
      bubbleUserId,
      companyId,
      limit: args.bubbleLimit,
    });
    bubbleDump[baseType] = { ...dump, objectTypes: group?.objectTypes ?? [] };
  }

  const stateId = `user:${userId}`;
  const insState = await admin.from("insumos_state").select("payload").eq("id", stateId).maybeSingle();
  const insumosPayload = (insState.data ?? null)?.payload ?? null;
  const insumosRows = Array.isArray(insumosPayload?.rows) ? insumosPayload.rows : [];

  const fornState = await admin.from("fornecedores_state").select("info,produtos,equivalencias").eq("id", stateId).maybeSingle();
  const fornInfo = fornState.data?.info ?? null;
  const fornProdutos = fornState.data?.produtos ?? null;
  const fornEquivalencias = fornState.data?.equivalencias ?? null;

  const prefix = `${stateId}:`;
  const inventarioDb = await admin.from("inventario").select("*").like("id", `${prefix}%`).order("created_at", { ascending: false });
  const entradasDb = await admin.from("entradas").select("*").like("id", `${prefix}%`).order("created_at", { ascending: false });
  const desperdiciosDb = await admin.from("desperdicios").select("*").like("id", `${prefix}%`).order("created_at", { ascending: false });
  const fichasDb = await admin.from("fichas_tecnicas_state").select("payload").eq("id", stateId).maybeSingle();
  const preDb = await admin.from("pre_preparo_state").select("payload").eq("id", stateId).maybeSingle();

  const session = await getSessionForEmail(admin, anon, args.email);
  const cookie = cookieFromSession(session);
  const origin = args.site;
  const ts = Date.now();

  const system = {
    insumos: await httpJson(`${args.site}/api/insumos?ts=${ts}`, { method: "GET", headers: { cookie, origin }, timeoutMs: 30_000 }),
    fornecedores: await httpJson(`${args.site}/api/fornecedores?ts=${ts}`, { method: "GET", headers: { cookie, origin }, timeoutMs: 30_000 }),
    inventario: await httpJson(`${args.site}/api/inventario?ts=${ts}`, { method: "GET", headers: { cookie, origin }, timeoutMs: 30_000 }),
    entradas: await httpJson(`${args.site}/api/entradas?ts=${ts}`, { method: "GET", headers: { cookie, origin }, timeoutMs: 30_000 }),
    desperdicios: await httpJson(`${args.site}/api/desperdicios?ts=${ts}`, { method: "GET", headers: { cookie, origin }, timeoutMs: 30_000 }),
    fichas: await httpJson(`${args.site}/api/fichas-tecnicas?ts=${ts}`, { method: "GET", headers: { cookie, origin }, timeoutMs: 30_000 }),
    prePreparo: await httpJson(`${args.site}/api/pre-preparo?ts=${ts}`, { method: "GET", headers: { cookie, origin }, timeoutMs: 30_000 }),
  };

  const bubbleItemsSample = Array.isArray(bubbleDump.item?.sample) ? bubbleDump.item.sample : [];
  const bubbleCustoSample = Array.isArray(bubbleDump.custo_medio_item?.sample) ? bubbleDump.custo_medio_item.sample : [];
  const byBubbleItemId = indexInsumosByBubbleId(insumosRows);
  const inventarioRows = inventarioDb.data ?? [];
  const entradasRows = entradasDb.data ?? [];
  const desperdiciosRows = desperdiciosDb.data ?? [];
  const fichasPayload = fichasDb.data?.payload ?? [];
  const prePayload = preDb.data?.payload ?? [];
  const preById = indexPayloadById(prePayload);
  const fichasById = indexPayloadById(fichasPayload);
  const motivosById = new Map(
    (Array.isArray(bubbleDump.motivos_desperdicios?.sample) ? bubbleDump.motivos_desperdicios.sample : [])
      .map((r) => [String(r?._id ?? "").trim(), String(pickAnyCI(r, ["nome", "motivo", "descricao"]) ?? "").trim()])
      .filter((x) => x[0] && x[1]),
  );

  const itemExamples = bubbleItemsSample.slice(0, 10).map((raw) => {
    const b = normalizeItemFromBubble(raw);
    const s = byBubbleItemId.get(b.bubbleItemId) ?? null;
    return {
      bubbleId: b.bubbleItemId,
      bubbleItem: b.item,
      bubbleMedida: b.medida,
      bubbleCategoriaRaw: b.categoriaNome || b.categoriaId,
      supabaseId: s ? String(s?.id ?? "") : null,
      supabaseItem: s ? String(s?.item ?? "") : null,
      supabaseMedida: s ? String(s?.medida ?? "") : null,
      supabaseCategoria: s ? String(s?.categoria ?? "") : null,
      supabaseCustoMedio: s ? String(s?.custoMedio ?? s?.custo_medio ?? s?.custo ?? "") : null,
    };
  });

  const custoExamples = bubbleCustoSample.slice(0, 10).map((raw) => {
    const b = normalizeCustoFromBubble(raw);
    const s = b.bubbleItemId ? byBubbleItemId.get(b.bubbleItemId) ?? null : null;
    return {
      bubbleItemId: b.bubbleItemId || null,
      bubbleCustoMedio: b.custoMedio || null,
      supabaseId: s ? String(s?.id ?? "") : null,
      supabaseItem: s ? String(s?.item ?? "") : null,
      supabaseCustoMedio: s ? String(s?.custoMedio ?? s?.custo_medio ?? "") : null,
    };
  });

  const entradasExamples = (Array.isArray(bubbleDump.notas_fiscais?.sample) ? bubbleDump.notas_fiscais.sample : []).slice(0, 10).map((raw) => {
    const bubbleNotaId = String(raw?._id ?? "").trim() || extractBubbleId(JSON.stringify(raw ?? {}));
    const bubbleNumero = String(pickAnyCI(raw, ["codigo", "numero", "numero_nota", "nota_numero", "nf", "n_nf"]) ?? "").trim();
    const bubbleFornecedorId = extractBubbleId(pickAnyCI(raw, ["fornecedor_id", "fornecedor", "id_fornecedor"]) ?? "") || "";
    const bubbleFornecedorNome = String(pickAnyCI(raw, ["fornecedor_nome", "fornecedor", "razao_social"]) ?? "").trim();
    const bubbleValorNota = (() => {
      const n = parsePtNumber(pickAnyCI(raw, ["valor_nota", "valor", "total", "valor_total", "total_nota"]) ?? "");
      return n ? formatMoneyBRL(n) : "";
    })();
    const bubbleListaItens = Array.isArray(raw?.lista_itens) ? raw.lista_itens.map((x) => String(x ?? "").trim()).filter(Boolean) : [];
    const supaId = bubbleNotaId ? `${prefix}entrada:${bubbleNotaId}` : null;
    const supa = supaId ? entradasRows.find((r) => String(r?.id ?? "") === supaId) ?? null : null;
    const itensNota = Array.isArray(supa?.itens_nota) ? supa.itens_nota : [];
    const firstItem = itensNota[0] ?? null;
    return {
      bubbleNotaId,
      bubbleNumero: bubbleNumero || null,
      bubbleFornecedor: bubbleFornecedorNome || bubbleFornecedorId || null,
      bubbleValorNota: bubbleValorNota || null,
      bubbleItensCount: bubbleListaItens.length,
      supabaseId: supaId,
      supabaseNumero: supa ? String(supa?.numero ?? "") : null,
      supabaseFornecedor: supa ? String(supa?.fornecedor ?? "") : null,
      supabaseValorNota: supa ? String(supa?.valor_nota ?? "") : null,
      supabaseItensCount: itensNota.length,
      supabaseItem0: firstItem
        ? { nomeNaNota: String(firstItem?.nomeNaNota ?? ""), insumoEquivalente: String(firstItem?.insumoEquivalente ?? ""), equivalenteUnidade: String(firstItem?.equivalenteUnidade ?? "") }
        : null,
      needsFix: Boolean(firstItem && normalizeItemIdForMatch(String(firstItem?.insumoEquivalente ?? ""))),
    };
  });

  const inventarioExamples = (Array.isArray(bubbleDump.itens_inventarios?.sample) ? bubbleDump.itens_inventarios.sample : []).slice(0, 10).map((raw) => {
    const bubbleInvId = String(raw?.inventario_id ?? "").trim();
    const bubbleItemId = String(raw?.item_id ?? "").trim();
    const bubbleQtd = String(raw?.quantidade_contada ?? "").trim();
    const snap = getInventarioItemSnapshot(inventarioRows, bubbleInvId, bubbleItemId);
    return {
      bubbleInventarioId: bubbleInvId || null,
      bubbleItemId: bubbleItemId || null,
      bubbleQuantidadeContada: bubbleQtd || null,
      supabaseInventarioId: snap ? snap.inventarioId : null,
      supabaseCategoria: snap ? snap.categoria : null,
      supabaseItem: snap ? snap.item : null,
      supabaseUnidade: snap ? snap.unidade : null,
      supabaseEstoqueFinal: snap ? snap.estoqueFinal : null,
    };
  });

  const desperdiciosExamples = (Array.isArray(bubbleDump.desperdicio?.sample) ? bubbleDump.desperdicio.sample : []).slice(0, 10).map((raw) => {
    const bubbleDesperdicioId = String(raw?._id ?? "").trim();
    const bubbleItemId = String(raw?.item_id ?? raw?.item ?? "").trim();
    const bubbleQtd = String(raw?.quantidade ?? "").trim();
    const bubbleCusto = (() => {
      const n = parsePtNumber(pickAnyCI(raw, ["custo_total", "custo", "valor"]) ?? "");
      return n ? formatMoneyBRL(n) : "";
    })();
    const bubbleMotivoId = String(raw?.motivo ?? "").trim();
    const bubbleMotivoNome = String(raw?.motivo_text ?? motivosById.get(bubbleMotivoId) ?? "").trim();
    const supaId = bubbleDesperdicioId ? `${prefix}desperdicio:${bubbleDesperdicioId}` : null;
    const supa = supaId ? desperdiciosRows.find((r) => String(r?.id ?? "") === supaId) ?? null : null;
    return {
      bubbleDesperdicioId,
      bubbleItemId: bubbleItemId || null,
      bubbleQuantidade: bubbleQtd || null,
      bubbleCusto: bubbleCusto || null,
      bubbleMotivo: bubbleMotivoNome || bubbleMotivoId || null,
      supabaseId: supaId,
      supabaseItem: supa ? String(supa?.item ?? "") : null,
      supabaseQuantidade: supa ? String(supa?.quantidade ?? "") : null,
      supabaseCusto: supa ? String(supa?.custo ?? "") : null,
      supabaseMotivo: supa ? String(supa?.motivo ?? "") : null,
    };
  });

  const fornecedoresExamples = (Array.isArray(bubbleDump.fornecedores?.sample) ? bubbleDump.fornecedores.sample : []).slice(0, 10).map((raw) => {
    const bubbleFornecedorId = String(raw?._id ?? "").trim();
    const bubbleNome = String(pickAnyCI(raw, ["nome", "fornecedor", "razao_social", "title", "name"]) ?? "").trim();
    const k = bubbleNome ? bubbleNome.toUpperCase() : "";
    const exists = k ? Boolean(fornInfo && typeof fornInfo === "object" && fornInfo[k]) : false;
    return { bubbleFornecedorId, bubbleNome: bubbleNome || null, supabaseInfoKey: k || null, existsInSupabase: exists };
  });

  const prePreparoExamples = bubbleItemsSample
    .filter((r) => Boolean(r?.boolean_item_receita))
    .slice(0, 10)
    .map((raw) => {
      const id = String(raw?._id ?? "").trim();
      const nome = String(pickAnyCI(raw, ["nome", "item", "produto", "descricao"]) ?? "").trim();
      const s = id ? preById.get(id) ?? null : null;
      return {
        bubbleItemId: id || null,
        bubbleReceita: nome || null,
        supabaseReceita: s ? String(s?.receita ?? "") : null,
        supabaseCustoUnitario: s ? String(s?.custoUnitario ?? s?.custo_unitario ?? "") : null,
        supabaseRendimento: s ? String(s?.rendimento ?? "") : null,
      };
    });

  const fichasExamples = bubbleItemsSample
    .filter((r) => Boolean(r?.boolean_item_do_cardapio))
    .slice(0, 10)
    .map((raw) => {
      const id = String(raw?._id ?? "").trim();
      const nome = String(pickAnyCI(raw, ["nome", "item", "produto", "descricao"]) ?? "").trim();
      const s = id ? fichasById.get(id) ?? null : null;
      return {
        bubbleItemId: id || null,
        bubbleReceita: nome || null,
        supabaseReceita: s ? String(s?.receita ?? s?.Receita ?? "") : null,
        supabaseCmvAtual: s ? String(s?.cmvAtual ?? s?.cmv_atual ?? "") : null,
        supabaseCustoUnitario: s ? String(s?.custoUnitario ?? s?.custo_unitario ?? "") : null,
      };
    });

  const bubblePrePreparo = companyId
    ? await bubbleCountAndSampleDirect({
        baseUrl: creds.baseUrl,
        token: creds.token,
        type: "item",
        constraints: [
          { key: "empresa_id", constraint_type: "equals", value: companyId },
          { key: "boolean_item_receita", constraint_type: "equals", value: true },
        ],
        limit: args.bubbleLimit,
      })
    : { ok: false, total: null, sample: [], error: "missing_companyId", url: "" };

  const bubbleFichas = companyId
    ? await bubbleCountAndSampleDirect({
        baseUrl: creds.baseUrl,
        token: creds.token,
        type: "item",
        constraints: [
          { key: "empresa_id", constraint_type: "equals", value: companyId },
          { key: "boolean_item_do_cardapio", constraint_type: "equals", value: true },
        ],
        limit: args.bubbleLimit,
      })
    : { ok: false, total: null, sample: [], error: "missing_companyId", url: "" };

  const screens = {
    insumos: {
      bubble: { type: "item", total: bubbleDump.item?.total ?? null },
      supabase: { source: "insumos_state.payload.rows", total: Array.isArray(insumosRows) ? insumosRows.length : 0 },
      system: { endpoint: "/api/insumos", total: countSystemRows(system.insumos) },
      examples: itemExamples,
      mappingIssues: ["categoria (acentos/normalização)", "custoMedio (custo_medio_item / itens_notas)", "id técnico exibido em telas que não resolvem user-scoped id"],
    },
    entradas: {
      bubble: { type: "notas_fiscais", total: bubbleDump.notas_fiscais?.total ?? null },
      supabase: { table: "entradas", total: Array.isArray(entradasRows) ? entradasRows.length : 0 },
      system: { endpoint: "/api/entradas", total: countSystemRows(system.entradas) },
      examples: entradasExamples,
      mappingIssues: ["itens_nota derivado de notas_fiscais.lista_itens", "insumoEquivalente deve ser nome do insumo (UI usa por nome)", "itens label deve ser 'N Itens' (UI exibe direto)"],
    },
    inventario: {
      bubble: { type: "inventarios", total: bubbleDump.inventarios?.total ?? null, itensTotal: bubbleDump.itens_inventarios?.total ?? null },
      supabase: { table: "inventario", total: Array.isArray(inventarioRows) ? inventarioRows.length : 0 },
      system: { endpoint: "/api/inventario", total: countSystemRows(system.inventario) },
      examples: inventarioExamples,
      mappingIssues: ["estoqueFinal deve vir de itens_inventarios.quantidade_contada", "categoria deve preferir nome real do Bubble (sem perder acentos)"],
    },
    desperdicios: {
      bubble: { type: "desperdicio", total: bubbleDump.desperdicio?.total ?? null },
      supabase: { table: "desperdicios", total: Array.isArray(desperdiciosRows) ? desperdiciosRows.length : 0 },
      system: { endpoint: "/api/desperdicios", total: countSystemRows(system.desperdicios) },
      examples: desperdiciosExamples,
      mappingIssues: ["motivo deve ser nome (não id Bubble)", "custo deve vir de custo_total", "item deve manter relacionamento com insumo sem exibir id na UI"],
    },
    fornecedores: {
      bubble: { type: "fornecedores", total: bubbleDump.fornecedores?.total ?? null, itensTotal: bubbleDump.itens_fornecedores?.total ?? null },
      supabase: { source: "fornecedores_state.info", total: fornInfo && typeof fornInfo === "object" ? Object.keys(fornInfo).length : 0 },
      system: { endpoint: "/api/fornecedores", total: countSystemRows(system.fornecedores) },
      examples: fornecedoresExamples,
      mappingIssues: ["keys precisam ser nome uppercase (compatível com UI)", "produtos por fornecedor via itens_fornecedores (quando existir)"],
    },
    fichasTecnicas: {
      bubble: { type: "item (boolean_item_do_cardapio=true)", total: bubbleFichas.total ?? null, ok: bubbleFichas.ok, error: bubbleFichas.error || "" },
      supabase: { source: "fichas_tecnicas_state.payload", total: Array.isArray(fichasPayload) ? fichasPayload.length : 0 },
      system: { endpoint: "/api/fichas-tecnicas", total: countSystemRows(system.fichas) },
      examples: fichasExamples,
      mappingIssues: ["campos derivados (cmv, custoUnitario) devem bater com insumos/custos", "ids devem ser resolvíveis para nomes"],
    },
    prePreparo: {
      bubble: { type: "item (boolean_item_receita=true)", total: bubblePrePreparo.total ?? null, ok: bubblePrePreparo.ok, error: bubblePrePreparo.error || "" },
      supabase: { source: "pre_preparo_state.payload", total: Array.isArray(prePayload) ? prePayload.length : 0 },
      system: { endpoint: "/api/pre-preparo", total: countSystemRows(system.prePreparo) },
      examples: prePreparoExamples,
      mappingIssues: ["ingredientes devem referenciar insumos sem ids técnicos", "custoUnitario deve refletir custo médio/itens de nota"],
    },
    listaDeCompras: {
      bubble: { type: "itens_lista_compras", total: bubbleDump.itens_lista_compras?.total ?? null },
      supabase: { source: null, total: null },
      system: { computedFrom: "insumos_state + inventario + entradas + fornecedores_state", total: null },
      examples: [],
      mappingIssues: ["tela é derivada (não persistida) — auditoria compara Bubble vs cálculo derivado do sistema"],
    },
    cmvReal: {
      bubble: { qtd_compra_real: bubbleDump.qtd_compra_real?.total ?? null, faturamentos: bubbleDump.faturamentos?.total ?? null },
      supabase: { source: null, total: null },
      system: { computedFrom: "inventario + entradas + insumos_state (custo)", total: null },
      examples: [],
      mappingIssues: ["tela é derivada (não persistida) — auditoria compara Bubble vs cálculo derivado do sistema"],
    },
  };

  const derived = deriveCmvRealAndListaCompras({ insumosRows, inventarioRows, entradasRows, diasEstoque: 7, diasEntrega: 1 });
  screens.listaDeCompras.system.total = derived.lista.rowsComprar;
  screens.listaDeCompras.examples = [
    {
      systemPeriod: derived.period,
      systemTop: derived.lista.top,
      bubbleSample: (Array.isArray(bubbleDump.itens_lista_compras?.sample) ? bubbleDump.itens_lista_compras.sample : []).slice(0, 10),
    },
  ];

  screens.cmvReal.system.total = derived.ok ? 1 : 0;
  screens.cmvReal.examples = [
    {
      systemPeriod: derived.period,
      systemFlow: derived.cmv,
      systemItemsTop: derived.cmvItemsTop,
      bubbleFaturamentosSample: (Array.isArray(bubbleDump.faturamentos?.sample) ? bubbleDump.faturamentos.sample : []).slice(0, 5),
      bubbleQtdCompraRealSample: (Array.isArray(bubbleDump.qtd_compra_real?.sample) ? bubbleDump.qtd_compra_real.sample : []).slice(0, 5),
    },
  ];

  const divergences = [];
  if (typeof bubbleDump.itens_lista_compras?.total === "number") {
    divergences.push({
      screen: "listaDeCompras",
      bubbleTotal: bubbleDump.itens_lista_compras.total,
      systemRowsComprar: derived.lista.rowsComprar,
      note: "Bubble mantém itens_lista_compras persistido; sistema calcula lista por período (inventário+entradas). Não é 1:1.",
    });
  }
  if (typeof bubbleDump.qtd_compra_real?.total === "number" || typeof bubbleDump.faturamentos?.total === "number") {
    divergences.push({
      screen: "cmvReal",
      bubble: { faturamentos: bubbleDump.faturamentos?.total ?? null, qtd_compra_real: bubbleDump.qtd_compra_real?.total ?? null },
      system: { computedPeriodDays: derived.period.days, cmv: derived.cmv.cmv, compras: derived.cmv.compras },
      note: "Bubble persiste agregados (qtd_compra_real/faturamentos); sistema calcula CMV Real diretamente do inventário+entradas no período.",
    });
  }

  const out = {
    ok: true,
    ts: nowIso(),
    site: args.site,
    email: args.email,
    userId,
    bubbleUserId,
    runId,
    baseTypes,
    companyId,
    bubble: {
      creds: { baseUrl: creds.baseUrl },
      byType: bubbleDump,
    },
    supabase: {
      insumos_state: { rowsCount: Array.isArray(insumosRows) ? insumosRows.length : 0, sample: insumosRows.slice(0, args.systemLimit) },
      fornecedores_state: {
        infoKeys: fornInfo && typeof fornInfo === "object" ? Object.keys(fornInfo).length : 0,
        produtosKeys: fornProdutos && typeof fornProdutos === "object" ? Object.keys(fornProdutos).length : 0,
        equivalenciasKeys: fornEquivalencias && typeof fornEquivalencias === "object" ? Object.keys(fornEquivalencias).length : 0,
        sample: {
          info: fornInfo,
          produtos: fornProdutos,
          equivalencias: fornEquivalencias,
        },
      },
      inventario: { rowsCount: Array.isArray(inventarioDb.data) ? inventarioDb.data.length : 0, sample: (inventarioDb.data ?? []).slice(0, args.systemLimit) },
      entradas: { rowsCount: Array.isArray(entradasDb.data) ? entradasDb.data.length : 0, sample: (entradasDb.data ?? []).slice(0, args.systemLimit) },
      desperdicios: { rowsCount: Array.isArray(desperdiciosDb.data) ? desperdiciosDb.data.length : 0, sample: (desperdiciosDb.data ?? []).slice(0, args.systemLimit) },
      fichas_tecnicas_state: { rowsCount: Array.isArray(fichasDb.data?.payload) ? fichasDb.data.payload.length : 0, sample: (fichasDb.data?.payload ?? []).slice(0, args.systemLimit) },
      pre_preparo_state: { rowsCount: Array.isArray(preDb.data?.payload) ? preDb.data.payload.length : 0, sample: (preDb.data?.payload ?? []).slice(0, args.systemLimit) },
    },
    system,
    screens,
    derived,
    divergences,
    examples: {
      insumos_vs_bubble_item: itemExamples,
      custo_medio_vs_bubble: custoExamples,
    },
  };

  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  const outPath = path.join(OUT_DIR, `audit_${safeFileKey(args.email)}.json`);
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n", "utf8");
  process.stdout.write(JSON.stringify(out, null, 2) + "\n");
}

main().catch((err) => {
  const msg = err instanceof Error ? err.stack || err.message : String(err);
  process.stderr.write(`${msg}\n`);
  process.exit(1);
});
