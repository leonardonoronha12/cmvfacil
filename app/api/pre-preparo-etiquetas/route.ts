import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin, getSupabaseServerClient } from "../../lib/supabaseAdmin";
import { getUserIdFromRequest } from "../../lib/requestUserId";

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return NextResponse.json(data, { ...init, headers });
}

function getUserScopedId(req: NextRequest) {
  const { accessToken, userId } = getUserIdFromRequest(req);
  if (!userId) return { accessToken, userId: null as string | null, id: null as string | null };
  return { accessToken, userId, id: `user:${userId}` };
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
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
    const { accessToken, userId, id } = getUserScopedId(req);
    if (!id) return json({ rows: [] }, { status: 200 });
    const supabase = getSupabaseServerClient(accessToken);
    const { data, error } = await supabase.from("pre_preparo_etiquetas_state").select("*").eq("id", id).maybeSingle();
    if (error) return json({ error: error.message }, { status: 500 });
    const payload = (data as any)?.payload;
    const rows = Array.isArray(payload) ? payload : [];
    if (rows.length) return json({ rows }, { status: 200 });

    const uid = String(userId ?? "").trim();
    if (!uid || !isUuid(uid)) return json({ rows: [] }, { status: 200 });

    let admin: ReturnType<typeof getSupabaseAdmin>;
    try {
      admin = getSupabaseAdmin();
    } catch {
      return json({ rows: [] }, { status: 200 });
    }

    const bucket = "bubble-imports";
    await ensureBucket(admin, bucket);
    const statePath = `user:${uid}/bootstrap/sync-state.json`;
    const state = await downloadJsonFromStorage(admin, bucket, statePath);
    const runPrefix = state && typeof state === "object" ? String((state as any)?.runPrefix ?? "").trim().replace(/^\/+|\/+$/g, "") : "";
    if (!runPrefix) return json({ rows: [] }, { status: 200 });

    const all = await listAllPaths(admin, bucket, runPrefix);
    const candidates = all
      .map((p) => p.path)
      .filter((p) => {
        const lower = p.toLowerCase();
        if (!lower.includes("bubble-api-")) return false;
        if (!lower.endsWith(".json")) return false;
        if (lower.endsWith("state.json")) return false;
        return lower.includes("etiqueta");
      })
      .sort((a, b) => b.localeCompare(a));
    const latest = candidates[0] ?? "";
    if (!latest) return json({ rows: [] }, { status: 200 });

    const bubble = await downloadJsonFromStorage(admin, bucket, latest);
    const list = bubble && typeof bubble === "object" ? (bubble as any).rows : null;
    const rowsRaw = Array.isArray(list) ? (list as any[]) : [];
    const extracted = extractEtiquetasFromBubbleRows(rowsRaw, uid);
    if (extracted.length) {
      await supabase.from("pre_preparo_etiquetas_state").upsert({ id, payload: extracted } as any, { onConflict: "id" });
    }
    return json({ rows: extracted }, { status: 200 });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as unknown;
    if (!body || typeof body !== "object") return json({ error: "invalid_body" }, { status: 400 });
    const rows = Array.isArray((body as any).rows) ? ((body as any).rows as unknown[]) : null;
    if (!rows) return json({ error: "missing_rows" }, { status: 400 });
    const { accessToken, id } = getUserScopedId(req);
    if (!id) return json({ error: "unauthorized" }, { status: 401 });
    const supabase = getSupabaseServerClient(accessToken);
    const { error } = await supabase.from("pre_preparo_etiquetas_state").upsert({ id, payload: rows } as any, { onConflict: "id" });
    if (error) return json({ error: error.message }, { status: 500 });
    return json({ ok: true }, { status: 200 });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
