import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin";
import { getUserIdFromRequest } from "../../../lib/requestUserId";
import { fetchBubbleObjPage, fetchBubbleObjPageWithConstraints, getBubbleObjCredentials } from "../../../lib/bubbleObjApi";
import { formatDateLabelDDMMYYYY, formatMoneyBRL, normalizeKey, parseDateLoose, parsePtNumber } from "../../../lib/bubbleCsv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

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

function getFieldLoose(obj: any, names: string[]) {
  if (!obj || typeof obj !== "object") return undefined;
  for (const n of names) {
    if (obj[n] != null) return obj[n];
  }
  const want = new Set(names.map((x) => normalizeKey(String(x))));
  for (const [k, v] of Object.entries(obj)) {
    if (want.has(normalizeKey(String(k)))) return v as any;
  }
  return undefined;
}

function extractRefId(value: unknown) {
  if (!value) return "";
  if (typeof value === "string") {
    const s = value.trim();
    if (!s) return "";
    const m = s.match(/"(?:unique_id|_id|id|bubble_id|user_id)"\s*:\s*"([^"]+)"/i);
    if (m) return String(m[1] ?? "").trim();
    return s;
  }
  if (typeof value === "object") {
    const v: any = value;
    const id = String(v?.unique_id ?? v?._id ?? v?.id ?? v?.bubble_id ?? "").trim();
    if (id) return id;
    try {
      const text = JSON.stringify(value);
      const m = text.match(/"(?:unique_id|_id|id|bubble_id|user_id)"\s*:\s*"([^"]+)"/i);
      return m ? String(m[1] ?? "").trim() : "";
    } catch {
      return "";
    }
  }
  return "";
}

function pickBubbleId(obj: any) {
  const id = getFieldLoose(obj, ["unique_id", "_id", "id", "bubble_id"]);
  return String(id ?? "").trim();
}

function normalizeUnit(input: unknown) {
  const raw = String(input ?? "").trim();
  if (!raw) return "";
  const u = raw.toLowerCase();
  if (u === "kg" || u === "kilo" || u === "kilos" || u === "quilo" || u === "quilos") return "Kg";
  if (u === "g" || u === "gr" || u === "grama" || u === "gramas") return "g";
  if (u === "l" || u === "lt" || u === "litro" || u === "litros") return "L";
  if (u === "ml") return "mL";
  if (u === "un" || u === "und" || u === "unid" || u === "unidade" || u === "unidades") return "Und";
  return raw.length <= 6 ? raw : raw.slice(0, 6);
}

function safeText(v: unknown) {
  return String(v ?? "").trim();
}

function looksLikeBubbleInternalId(value: unknown) {
  return /^\d+x\d+$/i.test(safeText(value));
}

function extractNameFromAny(v: unknown) {
  if (!v) return "";
  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return "";
    if (s.includes("$")) {
      const head = s.split("$")[0]?.trim() || "";
      if (head && /[A-Za-zÀ-ÿ]/.test(head)) return head;
    }
    if (s.startsWith("{")) {
      try {
        const obj = JSON.parse(s);
        const name = safeText((obj as any)?.nome ?? (obj as any)?.name ?? (obj as any)?.item ?? (obj as any)?.descricao);
        if (name) return name;
      } catch {}
    }
    return "";
  }
  if (typeof v === "object") {
    const obj: any = v;
    const name = safeText(obj?.nome ?? obj?.name ?? obj?.item ?? obj?.descricao ?? obj?.receita);
    return name;
  }
  return "";
}

async function fetchBubbleObjById(creds: Awaited<ReturnType<typeof getBubbleObjCredentials>>, type: string, id: string) {
  const url = new URL(`${creds.baseUrl.replace(/\/+$/, "")}/api/1.1/obj/${encodeURIComponent(type)}/${encodeURIComponent(id)}`);
  const res = await fetch(url, { method: "GET", headers: { Authorization: `Bearer ${creds.token}` }, cache: "no-store" });
  const text = await res.text().catch(() => "");
  let parsed: any = null;
  try {
    parsed = JSON.parse(text);
  } catch {}
  if (!res.ok) throw new Error(`bubble_${res.status}:${String(text).slice(0, 500)}`);
  return (parsed?.response ?? parsed ?? {}) as any;
}

function formatMoneyBRL3(value: number) {
  if (!Number.isFinite(value)) return "R$0,000";
  const label = value.toLocaleString("pt-BR", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  return `R$${label}`;
}

async function syncEntradasFromBubbleObj(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  userId: string,
  bubbleUserIdOverride?: string,
) {
  const creds = await getBubbleObjCredentials();
  const notasTypeCandidates = ["notas_fiscais", "notas-fiscais", "notasfiscais", "notas"];
  const itensTypeCandidates = ["itens_notas", "itens-notas", "itensnota", "itens_nota", "itens_notas_fiscais"];

  const tryFetchAny = async (types: string[], limit: number) => {
    let lastErr: unknown = null;
    for (const t of types) {
      try {
        const out: any[] = [];
        for (let cursor = 0; cursor < 2000; cursor += limit) {
          const page = await fetchBubbleObjPage({ creds, type: t, cursor, limit });
          out.push(...(page.results ?? []));
          if (!page.results?.length) break;
          if (page.remaining === 0) break;
        }
        return { type: t, rows: out };
      } catch (err) {
        lastErr = err;
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("bubble_404") && msg.includes("type_not_found")) continue;
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr ?? "failed_to_fetch_bubble"));
  };

  const authUser = await supabase.auth.admin.getUserById(userId);
  const email = safeText(authUser.data?.user?.email).toLowerCase();
  if (!email) throw new Error("bubble_import_user_email_missing");

  let bubbleUser: any = null;
  const requestedBubbleUserId =
    safeText(bubbleUserIdOverride) ||
    (email === "luisfelipeisrael7@gmail.com" ? "1750957200765x256778778114202370" : "");
  if (requestedBubbleUserId) {
    for (const userType of ["user", "users", "User"]) {
      try {
        bubbleUser = await fetchBubbleObjById(creds, userType, requestedBubbleUserId);
        if (bubbleUser) break;
      } catch {
        continue;
      }
    }
  }
  for (const userType of ["user", "users", "User"]) {
    if (bubbleUser) break;
    try {
      const page = await fetchBubbleObjPageWithConstraints({
        creds,
        type: userType,
        cursor: 0,
        limit: 10,
        constraints: [{ key: "email", constraint_type: "equals", value: email }],
        timeoutMs: 12_000,
      });
      bubbleUser = (page.results ?? []).find(
        (row: any) => safeText(getFieldLoose(row, ["email", "Email"])).toLowerCase() === email,
      );
      if (bubbleUser) break;
    } catch {
      continue;
    }
  }
  if (!bubbleUser) throw new Error("bubble_import_user_not_found");

  const bubbleUserId = pickBubbleId(bubbleUser);
  const bubbleCompanyId = extractRefId(
    getFieldLoose(bubbleUser, ["empresa_id", "empresa", "company_id", "company", "Empresa"]),
  );
  if (!bubbleUserId && !bubbleCompanyId) throw new Error("bubble_import_user_scope_missing");

  const notasPick = await tryFetchAny(notasTypeCandidates, 100);
  const notas = (notasPick.rows ?? [])
    .filter((x) => x && typeof x === "object")
    .filter((nf) => {
      const companyId = extractRefId(
        getFieldLoose(nf, ["empresa_id", "empresa", "company_id", "company", "Empresa"]),
      );
      const ownerId = extractRefId(
        getFieldLoose(nf, ["Created By", "created_by", "createdBy", "usuario", "user_id", "responsavel"]),
      );
      return Boolean(
        (bubbleCompanyId && companyId && companyId === bubbleCompanyId) ||
          (bubbleUserId && ownerId && ownerId === bubbleUserId),
      );
    })
    .sort((a, b) => {
      const aDate =
        parseDateLoose(getFieldLoose(a, ["data_criacao", "created_date", "createdAt", "created_at", "Created Date"]) ?? null)?.getTime() ?? 0;
      const bDate =
        parseDateLoose(getFieldLoose(b, ["data_criacao", "created_date", "createdAt", "created_at", "Created Date"]) ?? null)?.getTime() ?? 0;
      return aDate - bDate || pickBubbleId(a).localeCompare(pickBubbleId(b));
    });
  if (!notas.length) return { entradasInserted: 0 };

  const itensPick = await tryFetchAny(itensTypeCandidates, 1);
  const itensType = itensPick.type;

  const supplierCache = new Map<string, string>();
  const resolveSupplierName = async (ref: unknown) => {
    const direct = safeText(ref);
    if (direct && /[A-Za-zÀ-ÿ]/.test(direct) && !direct.startsWith("{")) return direct.split("$")[0]?.trim() || direct;
    const id = extractRefId(ref);
    if (!id) return "";
    if (supplierCache.has(id)) return supplierCache.get(id) ?? "";
    try {
      const obj = await fetchBubbleObjById(creds, "fornecedores", id);
      const name = safeText(getFieldLoose(obj, ["nome", "name", "fornecedor"]) ?? "") || safeText(getFieldLoose(obj, ["Nome", "Name"]) ?? "");
      if (name) supplierCache.set(id, name);
      return name;
    } catch {
      supplierCache.set(id, "");
      return "";
    }
  };

  const constraintKeys = ["nota_fiscal", "notaFiscal", "nota", "nota_fiscal_id", "notaId", "nota_id"];
  const fetchItensForNota = async (notaId: string) => {
    let bestKey = "";
    let best: any[] = [];
    for (const key of constraintKeys) {
      try {
        const page0 = await fetchBubbleObjPageWithConstraints({
          creds,
          type: itensType,
          cursor: 0,
          limit: 100,
          constraints: [{ key, constraint_type: "equals", value: notaId }],
          timeoutMs: 12_000,
        });
        const acc: any[] = [...(page0.results ?? [])];
        if (page0.remaining && page0.remaining > 0) {
          for (let cursor = 100; cursor < 5000; cursor += 100) {
            const page = await fetchBubbleObjPageWithConstraints({
              creds,
              type: itensType,
              cursor,
              limit: 100,
              constraints: [{ key, constraint_type: "equals", value: notaId }],
              timeoutMs: 12_000,
            });
            acc.push(...(page.results ?? []));
            if (!page.results?.length) break;
            if (page.remaining === 0) break;
          }
        }
        if (!bestKey || acc.length > best.length) {
          bestKey = key;
          best = acc;
        }
        if (acc.length) break;
      } catch {
        continue;
      }
    }
    return { key: bestKey, rows: best };
  };

  const prefix = `user:${userId}:entrada:`;
  const entradaRows: any[] = [];

  for (const [notaIndex, nf] of notas.entries()) {
    const notaId = pickBubbleId(nf);
    if (!notaId) continue;

    const numeroOriginal = safeText(getFieldLoose(nf, ["codigo", "numero", "nota", "nf", "id_nota"]) ?? "");
    const numero = numeroOriginal && !looksLikeBubbleInternalId(numeroOriginal) ? numeroOriginal.replace(/^#/, "") : String(notaIndex + 1);
    const fornecedorRef = getFieldLoose(nf, ["fornecedor", "supplier", "fornecedor_id", "id_fornecedor"]);
    const fornecedor = (await resolveSupplierName(fornecedorRef)) || safeText(getFieldLoose(nf, ["fornecedor_nome", "supplier_name", "nome_fornecedor"]) ?? "") || "-";
    const responsavel = safeText(getFieldLoose(nf, ["responsavel", "responsavel_id", "user_id", "responsavel_user_id"]) ?? "");

    const dtLanc = parseDateLoose(getFieldLoose(nf, ["data_recebimento", "data_lancamento", "data", "dataRecebimento", "dataLancamento"]) ?? null);
    const dtCriacao = parseDateLoose(getFieldLoose(nf, ["data_criacao", "created_date", "createdAt", "created_at", "Created Date"]) ?? null);
    const dataLancamento = dtLanc ? formatDateLabelDDMMYYYY(dtLanc) : "-";
    const dataCriacao = dtCriacao ? formatDateLabelDDMMYYYY(dtCriacao) : "-";

    const { rows: itens } = await fetchItensForNota(notaId);

    const itensNota = (itens ?? [])
      .filter((x) => x && typeof x === "object")
      .map((it: any, idx: number) => {
        const itemRef =
          getFieldLoose(it, ["item", "insumo", "produto", "ingrediente", "item_id", "insumo_id", "produto_id"]) ?? getFieldLoose(it, ["Item", "Insumo", "Produto"]);
        const itemId = extractRefId(itemRef);
        const nome =
          safeText(getFieldLoose(it, ["nome", "name", "item_nome", "descricao", "produto", "insumo", "ingrediente", "item"]) ?? "") ||
          extractNameFromAny(itemRef ?? null) ||
          "-";
        const unitRaw = getFieldLoose(it, ["unidade", "unit", "medida", "unidade_medida", "unidadeMedida"]);
        const unidade = normalizeUnit(unitRaw) || "Und";
        const qtyNum = parsePtNumber(String(getFieldLoose(it, ["quantidade", "qtd", "qty"]) ?? ""));
        const subtotalNum = parsePtNumber(String(getFieldLoose(it, ["subtotal", "total", "valor", "subtotal_nota", "preco_total"]) ?? ""));
        const unitCostNum = parsePtNumber(String(getFieldLoose(it, ["custo_unitario", "custoUnitario", "preco_unitario", "valor_unitario"]) ?? ""));
        const qtyLabel = qtyNum.toLocaleString("pt-BR", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
        const subtotalLabel = subtotalNum > 0 ? formatMoneyBRL(subtotalNum) : "R$0,00";
        const unitCost = unitCostNum > 0 ? unitCostNum : qtyNum > 0 && subtotalNum > 0 ? subtotalNum / qtyNum : 0;
        const custoUnitarioLabel = `${formatMoneyBRL3(unitCost)} / ${unidade}`;
        return {
          id: `${notaId}:${idx + 1}`,
          itemId: itemId || null,
          nome,
          quantidadeLabel: `${qtyLabel} ${unidade}`,
          subtotalLabel,
          custoUnitarioLabel,
          unidade,
          ocultarCmv: false,
        };
      });

    const subtotalSum = itensNota.reduce((acc: number, it: any) => acc + parsePtNumber(String(it?.subtotalLabel ?? "")), 0);
    const valorNotaRaw = getFieldLoose(nf, ["valor_nota", "valorNota", "valor", "total"]) ?? null;
    const valorNum = parsePtNumber(String(valorNotaRaw ?? "")) || subtotalSum;
    const valorNota = valorNum > 0 ? formatMoneyBRL(valorNum) : "R$0,00";

    entradaRows.push({
      id: `${prefix}${notaId}`,
      numero,
      data_lancamento: dataLancamento,
      fornecedor,
      valor_nota: valorNota,
      itens: `${itensNota.length} ${itensNota.length === 1 ? "Item" : "Itens"}`,
      responsavel,
      data_criacao: dataCriacao,
      itens_nota: itensNota,
    });
  }

  if (!entradaRows.length) return { entradasInserted: 0 };
  const ids = new Set(entradaRows.map((row) => row.id));
  const existing = await supabase.from("entradas").select("id").like("id", `${prefix}%`);
  if (existing.error) throw new Error(existing.error.message);
  const staleIds = (existing.data ?? [])
    .map((row: any) => safeText(row?.id))
    .filter((id) => id && !ids.has(id));
  for (let index = 0; index < staleIds.length; index += 100) {
    const batch = staleIds.slice(index, index + 100);
    const removed = await supabase.from("entradas").delete().in("id", batch);
    if (removed.error) throw new Error(removed.error.message);
  }

  const { error } = await supabase.from("entradas").upsert(entradaRows as any, { onConflict: "id" });
  if (error) throw new Error(error.message);
  return { entradasInserted: entradaRows.length };
}

export async function POST(req: NextRequest) {
  try {
    const { userId } = getUserIdFromRequest(req);
    if (!userId) return json({ ok: false, error: "unauthorized" }, { status: 401 });

    let supabase: ReturnType<typeof getSupabaseAdmin>;
    try {
      supabase = getSupabaseAdmin();
    } catch {
      return json({ ok: false, error: "supabase_not_configured" }, { status: 500 });
    }

    const body = (await req.json().catch(() => ({}))) as { bubbleUserId?: string };
    const bubbleUserIdOverride = safeText(body?.bubbleUserId);
    const bucket = "bubble-imports";
    await ensureBucket(supabase, bucket);
    const statePath = `user:${userId}/bootstrap/sync-state.json`;
    const state = await downloadJsonFromStorage(supabase, bucket, statePath);
    const runPrefix = String(state?.runPrefix ?? "").trim();
    if (!runPrefix) {
      const { entradasInserted } = await syncEntradasFromBubbleObj(supabase, userId, bubbleUserIdOverride);
      return json({ ok: true, mode: "bubble_obj", entradasInserted }, { status: 200 });
    }

    const url = new URL("/api/bubble-import/import", req.url);
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: req.headers.get("cookie") ?? "" },
      body: JSON.stringify({ only: ["entradas"], includeUnknown: true, prefix: runPrefix }),
      cache: "no-store",
    });
    const text = await res.text();
    let parsed: any = null;
    try {
      parsed = JSON.parse(text);
    } catch {}
    if (!res.ok || !parsed?.ok) return json({ ok: false, error: parsed?.error || text || `failed_${res.status}` }, { status: 500 });

    const entradasInserted = typeof parsed?.summary?.entradas === "number" ? parsed.summary.entradas : null;
    return json({ ok: true, mode: "storage_import", runPrefix, entradasInserted }, { status: 200 });
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
