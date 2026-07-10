import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin, getSupabaseServerClient } from "../../lib/supabaseAdmin";
import { getUserIdFromRequest } from "../../lib/requestUserId";

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return NextResponse.json(data, { ...init, headers });
}

function resolveUserScopedId(req: NextRequest) {
  const { accessToken, userId } = getUserIdFromRequest(req);
  if (!userId) return { accessToken, rawUserId: null as string | null, userId: null as string | null, id: null as string | null };
  const raw = String(userId).trim();
  if (isUuid(raw)) return { accessToken, rawUserId: raw, userId: raw, id: `user:${raw}` };
  const url = new URL(req.url);
  const override = String(url.searchParams.get("userId") ?? "").trim();
  const allowAdminOverride = raw.includes("@") && Boolean((process.env.ADMIN_SECRET ?? "").trim());
  if (allowAdminOverride && override && isUuid(override)) return { accessToken, rawUserId: raw, userId: override, id: `user:${override}` };
  return { accessToken, rawUserId: raw, userId: null as string | null, id: null as string | null };
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function parsePermissionLevel(v: unknown) {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const n = Number(String(v ?? "").trim());
  return Number.isFinite(n) ? n : 0;
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

function formatQty3(value: number) {
  if (!Number.isFinite(value)) return "0,000";
  return value.toLocaleString("pt-BR", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}

function formatMoney(value: number) {
  return formatMoneyBRL(Number.isFinite(value) ? value : 0);
}

function formatDateOnlyPT(value: unknown) {
  const s = sanitize(value);
  if (!s) return "-";
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  const dt = new Date(s);
  if (!Number.isFinite(dt.getTime())) return s;
  const day = String(dt.getDate()).padStart(2, "0");
  const month = String(dt.getMonth() + 1).padStart(2, "0");
  const year = dt.getFullYear();
  return `${day}/${month}/${year}`;
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
  return paths;
}

function sanitize(value: unknown) {
  return String(value ?? "").replace(/[\u200B-\u200D\uFEFF\u00A0]/g, " ").trim();
}

function pickFirst(obj: any, keys: string[]) {
  if (!obj || typeof obj !== "object") return "";
  for (const k of keys) {
    const v = obj[k];
    const s = sanitize(v);
    if (s) return s;
  }
  return "";
}

function normalizeUpperUnit(value: string) {
  const v = sanitize(value).toLowerCase();
  if (!v) return "Und";
  if (v === "und" || v === "un" || v === "u") return "Und";
  if (v === "kg") return "Kg";
  if (v === "g") return "g";
  if (v === "l") return "L";
  if (v === "ml") return "ml";
  return sanitize(value).toUpperCase();
}

function parsePtNumber(value: string) {
  const s = sanitize(value).replace(/[^\d,.-]/g, "").trim();
  if (!s) return 0;
  const neg = s.includes("-");
  const cleaned = s.replace(/-/g, "");
  const parts = cleaned.split(",");
  const intPart = (parts[0] ?? "").replace(/\./g, "").replace(/[^\d]/g, "") || "0";
  const decPart = (parts[1] ?? "").replace(/[^\d]/g, "");
  const num = Number.parseFloat(`${intPart}.${decPart}`);
  return neg ? -num : num;
}

function formatMoneyBRL(value: number) {
  const v = Math.abs(value);
  const intPart = Math.floor(v);
  const dec = String(Math.round((v - intPart) * 100)).padStart(2, "0");
  const intLabel = String(intPart).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${value < 0 ? "-" : ""}R$${intLabel},${dec}`;
}

function normalizeDateLabel(value: string) {
  const s = sanitize(value);
  if (!s) return "";
  const m1 = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m1) return `${m1[3]}/${m1[2]}/${m1[1]}`;
  const m2 = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (m2) return `${m2[1]}/${m2[2]}/${m2[3]}`;
  return s;
}

function extractEtiquetasFromBubbleRows(rowsRaw: any[], userId: string) {
  const out: any[] = [];
  const seen = new Set<string>();
  for (const row of rowsRaw) {
    if (!row || typeof row !== "object") continue;
    const bubbleId =
      pickFirst(row, ["unique_id", "_id", "id", "bubble_id"]) ||
      pickFirst(row, ["codigo", "code", "numero", "id_etiqueta"]) ||
      "";
    const id = `user:${userId}:etiqueta:${bubbleId || String(out.length + 1)}`;
    if (seen.has(id)) continue;
    seen.add(id);

    const code = pickFirst(row, ["codigo", "code", "numero", "cod"]) || "";
    const recipeId =
      pickFirst(row, ["pre_preparo_id", "pre_preparo", "receita_id", "recipe_id", "produto_id", "item_id"]) ||
      "unknown";
    const receita =
      pickFirst(row, ["receita", "nome_receita", "pre_preparo_nome", "produto", "item", "nome"]) ||
      (code ? `Etiqueta ${code}` : "Etiqueta");
    const responsavel =
      pickFirst(row, ["responsavel", "usuario", "user", "nome_usuario", "criado_por", "created_by"]) ||
      "-";
    const quantidadeRaw = pickFirst(row, ["quantidade", "qtd", "qtde"]) || "1";
    const quantidadeNum = parsePtNumber(quantidadeRaw);
    const quantidade = quantidadeNum > 0 ? quantidadeNum.toLocaleString("pt-BR", { maximumFractionDigits: 3 }) : "1";
    const unidade = normalizeUpperUnit(pickFirst(row, ["unidade", "medida", "unit"]) || "Und");
    const custoRaw = pickFirst(row, ["custo", "valor", "total", "subtotal", "custo_total"]) || "R$0,00";
    const custoNum = parsePtNumber(custoRaw);
    const custo = custoNum ? formatMoneyBRL(custoNum) : sanitize(custoRaw) || "R$0,00";
    const dataProducao = normalizeDateLabel(pickFirst(row, ["data_producao", "dataProducao", "producao", "data"]) || "");
    const dataValidade = normalizeDateLabel(pickFirst(row, ["data_validade", "dataValidade", "validade"]) || "");
    if (!dataValidade) continue;

    const createdAt = sanitize((row as any)["Created Date"] ?? (row as any).created_date ?? (row as any).created_at ?? "");
    const desperdicadoRaw = pickFirst(row, ["boolean_desperdicado", "desperdicado", "waste"]) || "";
    const desperdicado = ["true", "sim", "1", "yes"].includes(desperdicadoRaw.toLowerCase());

    out.push({
      id,
      recipeId: sanitize(recipeId) || "unknown",
      receita: sanitize(receita) || "Etiqueta",
      responsavel: sanitize(responsavel) || "-",
      quantidade,
      unidade,
      custo,
      dataProducao: dataProducao || "-",
      dataValidade,
      code: code || undefined,
      createdAt: createdAt || undefined,
      wasteStatus: desperdicado ? "launched" : "pending",
    });
    if (out.length >= 2000) break;
  }
  return out;
}

export async function GET(req: NextRequest) {
  try {
    const { accessToken, userId } = resolveUserScopedId(req);
    const uid = String(userId ?? "").trim();
    if (!uid) return json({ rows: [] }, { status: 200 });

    const supabase = getSupabaseServerClient(accessToken);
    const { data: memberRows, error: memberErr } = await supabase.from("company_members").select("company_id,role,permission_level").eq("user_id", uid).limit(50);
    if (memberErr) return json({ error: memberErr.message }, { status: 500 });

    const companyId = pickBestCompanyId((memberRows ?? []) as any[]);
    if (!companyId) return json({ rows: [] }, { status: 200 });

    const { data: labels, error: lErr } = await supabase
      .from("labels")
      .select("id,bubble_id,codigo,item_nome,data_criacao_log,data_producao,data_validade,responsavel_nome_completo,boolean_desperdicado,quantidade_produzida,item_id,created_at")
      .eq("company_id", companyId)
      .order("data_validade", { ascending: true })
      .order("created_at", { ascending: true });
    if (lErr) return json({ error: lErr.message }, { status: 500 });

    const itemIds = Array.from(new Set((labels ?? []).map((l: any) => String(l?.item_id ?? "").trim()).filter(Boolean)));
    const { data: items, error: iErr } = itemIds.length
      ? await supabase.from("items").select("id,bubble_id,name,unidade_medida,custo_medio").eq("company_id", companyId).in("id", itemIds)
      : ({ data: [], error: null } as any);
    if (iErr) return json({ error: iErr.message }, { status: 500 });

    const itemById = new Map<string, any>((items ?? []).map((it: any) => [String(it?.id ?? "").trim(), it]));

    const rows = (labels ?? [])
      .map((lb: any) => {
        if (lb?.boolean_desperdicado) return null;
        const itemId = String(lb?.item_id ?? "").trim();
        const item = itemId ? itemById.get(itemId) ?? null : null;
        const recipeId = String(item?.bubble_id ?? "").trim() || (itemId ? `db:${itemId}` : "");
        const receita = sanitize(item?.name ?? lb?.item_nome ?? "") || "Etiqueta";
        const responsavel = sanitize(lb?.responsavel_nome_completo ?? "") || "-";
        const qtyNum = typeof lb?.quantidade_produzida === "number" ? lb.quantidade_produzida : 0;
        const quantidade = qtyNum > 0 ? formatQty3(qtyNum) : "1,000";
        const unidade = sanitize(item?.unidade_medida ?? "") || "Und";
        const custoUnitNum = typeof item?.custo_medio === "number" ? item.custo_medio : 0;
        const custo = custoUnitNum > 0 && qtyNum > 0 ? formatMoney(custoUnitNum * qtyNum) : formatMoney(0);
        const dataProducao = formatDateOnlyPT(lb?.data_producao);
        const dataValidade = formatDateOnlyPT(lb?.data_validade);
        if (!recipeId || !dataValidade || dataValidade === "-") return null;
        const bubbleId = String(lb?.bubble_id ?? "").trim();
        const id = bubbleId || (String(lb?.id ?? "").trim() ? `db:${String(lb.id).trim()}` : "");
        if (!id) return null;
        const code = sanitize(lb?.codigo ?? "") || undefined;
        const createdAt = sanitize(lb?.data_criacao_log ?? lb?.created_at ?? "") || undefined;
        return {
          id,
          recipeId,
          receita,
          responsavel,
          quantidade,
          unidade,
          custo,
          dataProducao,
          dataValidade,
          code,
          createdAt,
          wasteStatus: "pending",
        };
      })
      .filter(Boolean);

    return json({ source: "compat", readOnly: true, rows }, { status: 200 });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    return json({ error: "read_only" }, { status: 403 });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
