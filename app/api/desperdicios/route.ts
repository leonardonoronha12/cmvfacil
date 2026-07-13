import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "../../lib/supabaseAdmin";
import { getUserIdFromRequest } from "../../lib/requestUserId";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
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

function isAdminUserId(userId: string) {
  const ids = new Set(parseCsvEnv(process.env.ADMIN_USER_IDS).map((x) => x.toLowerCase()));
  const emails = new Set(
    [...parseCsvEnv(process.env.ADMIN_USER_EMAILS), ...parseCsvEnv(process.env.ADMIN_EMAILS), ...parseCsvEnv(process.env.ADMIN_EMAILS_LEGACY)].map((x) =>
      x.toLowerCase(),
    ),
  );
  const raw = userId.toLowerCase();
  if (!isUuid(userId) && raw.includes("@") && process.env.ADMIN_SECRET) return true;
  if (ids.size && ids.has(raw)) return true;
  if (emails.size && emails.has(raw)) return true;
  return false;
}

function resolveUserScopedId(req: NextRequest) {
  const { accessToken, userId } = getUserIdFromRequest(req);
  if (!userId) return { accessToken, id: null as string | null, rawUserId: null as string | null };
  if (isUuid(userId)) return { accessToken, id: `user:${userId}`, rawUserId: userId };
  const url = new URL(req.url);
  const override = String(url.searchParams.get("userId") ?? "").trim();
  if (override && isUuid(override) && isAdminUserId(userId)) return { accessToken, id: `user:${override}`, rawUserId: userId };
  return { accessToken, id: null as string | null, rawUserId: userId };
}

async function shouldUseCompatSource(args: { req: NextRequest; supabase: ReturnType<typeof getSupabaseServerClient>; userId: string; isAdmin: boolean }) {
  return false;
}

function formatDateLabelLowerPT(d: Date) {
  const day = String(d.getDate()).padStart(2, "0");
  const year = d.getFullYear();
  const month = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"][d.getMonth()];
  return `${day} ${month}, ${year}`;
}

function formatDateLabelLowerPTFromValue(value: unknown) {
  const s = String(value ?? "").trim();
  if (!s) return "-";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) {
    const year = m[1] as string;
    const monthIndex = Math.max(0, Math.min(11, Number(m[2]) - 1));
    const day = String(m[3] ?? "").padStart(2, "0");
    const month = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"][monthIndex] ?? "";
    if (!month) return "-";
    return `${day} ${month}, ${year}`;
  }
  const d = new Date(s);
  if (!Number.isFinite(d.getTime())) return "-";
  const day = String(d.getUTCDate()).padStart(2, "0");
  const year = d.getUTCFullYear();
  const month = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"][d.getUTCMonth()];
  return `${day} ${month}, ${year}`;
}

function parseMaybeNumber(v: unknown) {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const s = String(v ?? "").replace(/[^\d,.-]/g, "").trim();
  if (!s) return 0;
  const neg = s.includes("-");
  const cleaned = s.replace(/-/g, "");
  const normalized = cleaned.replace(/\./g, "").replace(",", ".");
  const n = Number.parseFloat(normalized);
  if (!Number.isFinite(n)) return 0;
  return neg ? -n : n;
}

function formatQty3(value: number) {
  if (!Number.isFinite(value)) return "0,000";
  return value.toLocaleString("pt-BR", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}

function formatMoneyBRL(value: number) {
  if (!Number.isFinite(value)) return "R$0,00";
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export async function GET(req: NextRequest) {
  try {
    const { accessToken, id, rawUserId } = resolveUserScopedId(req);
    if (!id) return json({ source: "legacy", readOnly: false, rows: [] }, { status: 200 });
    const supabase = getSupabaseServerClient(accessToken);
    const userId = id.slice("user:".length);

    const isAdmin = Boolean(rawUserId && isAdminUserId(rawUserId));
    const useCompat = await shouldUseCompatSource({ req, supabase, userId, isAdmin });

    if (useCompat) {
      const { data: memberRows, error: memberErr } = await supabase
        .from("company_members")
        .select("company_id,role,permission_level")
        .eq("user_id", userId)
        .limit(50);
      if (memberErr) return json({ error: memberErr.message }, { status: 500 });
      const companyId = pickBestCompanyId((memberRows ?? []) as any[]);
      if (!companyId) return json({ error: "missing_company" }, { status: 500 });

      const { data: wastesDb, error: wErr } = await supabase
        .from("wastes")
        .select(
          "id,bubble_id,lancamento,motivo_text,quantidade,custo_total,custo_unitario,unidade_medida,raw,item:items(id,bubble_id,name,unidade_medida),motivo:waste_reasons(id,bubble_id,titulo),etiqueta:labels(id,bubble_id,codigo,item_nome,data_validade,data_producao)",
        )
        .eq("company_id", companyId)
        .order("lancamento", { ascending: false })
        .order("created_at", { ascending: false });
      if (wErr) return json({ error: wErr.message }, { status: 500 });

      const compatRows = (wastesDb ?? [])
        .map((w: any) => {
          const dbId = String(w?.id ?? "").trim();
          const bubbleId = String(w?.bubble_id ?? "").trim();
          const outId = bubbleId || (dbId ? `db:${dbId}` : "");
          if (!outId) return null;

          const data = formatDateLabelLowerPTFromValue(w?.lancamento);
          const itemName = String(w?.item?.name ?? w?.etiqueta?.item_nome ?? (w?.raw as any)?.item_nome ?? "").trim() || "-";
          const unidade = String(w?.unidade_medida ?? w?.item?.unidade_medida ?? "").trim() || "Und";
          const qty = typeof w?.quantidade === "number" ? w.quantidade : parseMaybeNumber(w?.quantidade);
          const qtyLabel = formatQty3(qty);

          const custoTotalNum = typeof w?.custo_total === "number" ? w.custo_total : parseMaybeNumber(w?.custo_total);
          const custoUnitNum =
            typeof w?.custo_unitario === "number"
              ? w.custo_unitario
              : parseMaybeNumber(w?.custo_unitario) || (qty > 0 ? custoTotalNum / qty : 0);

          const motivoTitulo = String(w?.motivo?.titulo ?? "").trim();
          const motivoText = String(w?.motivo_text ?? "").trim();
          const motivo = motivoTitulo || motivoText || "Sem motivo";

          const etiquetaBubbleId = String(w?.etiqueta?.bubble_id ?? "").trim() || null;
          const etiquetaCodigo = String(w?.etiqueta?.codigo ?? "").trim();
          const etiqueta = etiquetaBubbleId ? (etiquetaCodigo ? `${etiquetaCodigo}` : etiquetaBubbleId) : null;

          return {
            id: outId,
            bubble_id: bubbleId || null,
            data,
            itemId: String(w?.item?.bubble_id ?? "").trim() || null,
            item: itemName,
            quantidade: `${qtyLabel} ${unidade}`.trim(),
            quantidadeNum: qtyLabel,
            unidade,
            custoUnitario: formatMoneyBRL(custoUnitNum),
            custoTotal: formatMoneyBRL(custoTotalNum),
            motivoId: String(w?.motivo?.bubble_id ?? "").trim() || null,
            motivo,
            etiquetaId: etiquetaBubbleId,
            etiqueta,
          };
        })
        .filter(Boolean);

      const legacyRows = compatRows.map((r: any) => ({
        id: String(r.id),
        data: String(r.data),
        item: String(r.item),
        quantidade: String(r.quantidade),
        custo: String(r.custoTotal),
        motivo: String(r.motivo),
      }));

      return json(
        {
          source: "compat",
          readOnly: true,
          rows: legacyRows,
          compat: { totals: { wastes: compatRows.length }, wastes: compatRows },
        },
        { status: 200 },
      );
    }

    const prefix = `${id}:`;
    const { data, error } = await supabase.from("desperdicios").select("*").like("id", `${prefix}%`).order("created_at", { ascending: false });
    if (error) return json({ error: error.message }, { status: 500 });
    return json({ source: "legacy", readOnly: false, rows: data ?? [] }, { status: 200 });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const src = String(new URL(req.url).searchParams.get("source") ?? "").trim().toLowerCase();
    if (src === "compat") return json({ error: "read_only" }, { status: 403 });
    const body = (await req.json().catch(() => null)) as unknown;
    if (!body || typeof body !== "object") return json({ error: "invalid_body" }, { status: 400 });
    const { accessToken, id } = resolveUserScopedId(req);
    const prefix = id ? `${id}:` : "";
    if (!prefix) return json({ error: "unauthorized" }, { status: 401 });
    const desperdicioId = String((body as any).id ?? "").trim();
    if (!desperdicioId || !desperdicioId.startsWith(prefix)) return json({ error: "invalid_id_scope" }, { status: 400 });
    const supabase = getSupabaseServerClient(accessToken);
    const { error } = await supabase.from("desperdicios").upsert(body as any, { onConflict: "id" });
    if (error) return json({ error: error.message }, { status: 500 });
    return json({ ok: true }, { status: 200 });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const src = String(url.searchParams.get("source") ?? "").trim().toLowerCase();
    if (src === "compat") return json({ error: "read_only" }, { status: 403 });
    const id = (url.searchParams.get("id") ?? "").trim();
    if (!id) return json({ error: "missing_id" }, { status: 400 });
    const { accessToken, id: userScopedId } = resolveUserScopedId(req);
    const prefix = userScopedId ? `${userScopedId}:` : "";
    if (!prefix) return json({ error: "unauthorized" }, { status: 401 });
    if (!id.startsWith(prefix)) return json({ error: "invalid_id_scope" }, { status: 400 });
    const supabase = getSupabaseServerClient(accessToken);
    const { error } = await supabase.from("desperdicios").delete().eq("id", id);
    if (error) return json({ error: error.message }, { status: 500 });
    return json({ ok: true }, { status: 200 });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
