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
  const url = new URL(args.req.url);
  const override = String(url.searchParams.get("source") ?? "").trim().toLowerCase();
  if (args.isAdmin) {
    if (override === "compat") return true;
    if (override === "legacy") return false;
  }

  const enabled = String(process.env.BUBBLE_COMPAT_READ_FICHAS_TECNICAS ?? "").trim().toLowerCase();
  if (!(enabled === "1" || enabled === "true" || enabled === "yes" || enabled === "on")) return false;

  const allowUsers = new Set(parseCsvEnv(process.env.BUBBLE_COMPAT_READ_FICHAS_TECNICAS_USER_IDS).map((x) => x.toLowerCase()));
  const allowEmails = new Set(parseCsvEnv(process.env.BUBBLE_COMPAT_READ_FICHAS_TECNICAS_EMAILS).map((x) => x.toLowerCase()));
  const hasAllowList = allowUsers.size > 0 || allowEmails.size > 0;
  if (!hasAllowList) return true;

  const uid = String(args.userId ?? "").trim().toLowerCase();
  if (allowUsers.has(uid)) return true;

  const { data, error } = await args.supabase.from("user_profiles").select("email").eq("user_id", args.userId).maybeSingle();
  if (error) return false;
  const email = String((data as any)?.email ?? "").trim().toLowerCase();
  if (email && allowEmails.has(email)) return true;
  return false;
}

function formatQty3(value: number) {
  if (!Number.isFinite(value)) return "0,000";
  return value.toLocaleString("pt-BR", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}

function formatMoneyBRL(value: number) {
  if (!Number.isFinite(value)) return "R$0,00";
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatPercentTrim(value: number, maxFractionDigits: number) {
  const n = Number.isFinite(value) ? value : 0;
  return n.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: maxFractionDigits });
}

function formatSignedPercent1(value: number) {
  const n = Number.isFinite(value) ? value : 0;
  const sign = n > 0 ? "+" : "";
  return `${sign}${formatPercentTrim(n, 1)}%`;
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

      const { data: recipesDb, error: rErr } = await supabase
        .from("items")
        .select("id,bubble_id,name,modo_preparo,rendimento,custo_total_receita,custo_medio,cmv_desejado,preco_venda_total,quadrante_ficha_tecnica,unidade_medida,category_id,item_receita,item_do_cardapio")
        .eq("company_id", companyId)
        .eq("item_receita", true)
        .eq("item_do_cardapio", true)
        .order("name", { ascending: true });
      if (rErr) return json({ error: rErr.message }, { status: 500 });

      const recipeIds = (recipesDb ?? []).map((r: any) => String(r?.id ?? "").trim()).filter(Boolean);
      const { data: ingDb, error: iErr } = recipeIds.length
        ? await supabase
            .from("recipe_ingredients")
            .select("id,bubble_id,recipe_item_id,ingredient_item_id,quantidade,custo,ingredient:items!recipe_ingredients_ingredient_item_id_fkey(id,bubble_id,name,unidade_medida)")
            .eq("company_id", companyId)
            .in("recipe_item_id", recipeIds)
            .order("created_at", { ascending: true })
        : { data: [], error: null as any };
      if (iErr) return json({ error: iErr.message }, { status: 500 });

      const catIds = new Set<string>();
      for (const r of recipesDb ?? []) {
        const cid = String((r as any)?.category_id ?? "").trim();
        if (cid) catIds.add(cid);
      }
      const { data: catRows, error: cErr } = catIds.size
        ? await supabase.from("categories").select("id,name").eq("company_id", companyId).in("id", Array.from(catIds))
        : { data: [], error: null as any };
      if (cErr) return json({ error: cErr.message }, { status: 500 });
      const categoryNameById = new Map<string, string>((catRows ?? []).map((r: any) => [String(r?.id ?? ""), String(r?.name ?? "")]));

      const ingredientsByRecipeId = new Map<string, any[]>();
      for (const row of (ingDb ?? []) as any[]) {
        const rid = String(row?.recipe_item_id ?? "").trim();
        if (!rid) continue;
        const list = ingredientsByRecipeId.get(rid) ?? [];
        list.push(row);
        ingredientsByRecipeId.set(rid, list);
      }

      const compat = (recipesDb ?? [])
        .map((r: any) => {
          const dbId = String(r?.id ?? "").trim();
          const bubbleId = String(r?.bubble_id ?? "").trim();
          const outId = bubbleId || (dbId ? `db:${dbId}` : "");
          if (!outId) return null;

          const receita = String(r?.name ?? "").trim() || "-";
          const unidade = String(r?.unidade_medida ?? "").trim() || "Und";
          const rendimentoNum = typeof r?.rendimento === "number" ? r.rendimento : 0;
          const rendimento = rendimentoNum > 0 ? `${formatQty3(rendimentoNum)} ${unidade}` : "-";
          const categoria = categoryNameById.get(String(r?.category_id ?? "")) || "Sem categoria";

          const modoPreparo = String(r?.modo_preparo ?? "").trim() || "-";
          const quadrante = String(r?.quadrante_ficha_tecnica ?? "").trim() || "-";

          const ingredientRows = (ingredientsByRecipeId.get(dbId) ?? []).map((it: any) => {
            const itDbId = String(it?.id ?? "").trim();
            const itBubbleId = String(it?.bubble_id ?? "").trim();
            const itId = itBubbleId || (itDbId ? `db:${itDbId}` : "");
            const ingredientName = String(it?.ingredient?.name ?? "").trim() || "-";
            const ingUnit = String(it?.ingredient?.unidade_medida ?? "").trim() || "Und";
            const qtyNum = typeof it?.quantidade === "number" ? it.quantidade : 0;
            const custoNum = typeof it?.custo === "number" ? it.custo : 0;
            return {
              id: itId,
              ingredientId: String(it?.ingredient?.bubble_id ?? "").trim() || null,
              item: ingredientName,
              quantidade: formatQty3(qtyNum),
              unidade: ingUnit,
              custo: formatMoneyBRL(custoNum),
              custoNum,
            };
          });

          const ingredientsTotalNum = ingredientRows.reduce((acc: number, it: any) => acc + (typeof it?.custoNum === "number" ? it.custoNum : 0), 0);
          const custoTotalNum = typeof r?.custo_total_receita === "number" && r.custo_total_receita > 0 ? r.custo_total_receita : ingredientsTotalNum;
          const custoTotal = formatMoneyBRL(custoTotalNum);

          const custoUnitarioNum = typeof r?.custo_medio === "number" && r.custo_medio > 0 ? r.custo_medio : rendimentoNum > 0 ? custoTotalNum / rendimentoNum : 0;
          const custoUnitario = `${formatMoneyBRL(custoUnitarioNum)} / ${unidade}`;

          const precoVendaNum = typeof r?.preco_venda_total === "number" ? r.preco_venda_total : 0;
          const precoVenda = precoVendaNum > 0 ? formatMoneyBRL(precoVendaNum) : "-";

          const cmvMetaNum = typeof r?.cmv_desejado === "number" ? r.cmv_desejado : 0;
          const cmvMeta = `${formatPercentTrim(cmvMetaNum, 2)}%`;

          const cmvAtualNum = precoVendaNum > 0 ? (custoUnitarioNum / precoVendaNum) * 100 : 0;
          const cmvAtual = `${formatPercentTrim(cmvAtualNum, 1)}%`;

          const cmvDeltaNum = cmvAtualNum - cmvMetaNum;
          const cmvDelta = formatSignedPercent1(cmvDeltaNum);

          const precoSugeridoNum = cmvMetaNum > 0 && custoUnitarioNum > 0 ? (custoUnitarioNum * 100) / cmvMetaNum : 0;
          const precoSugerido = precoSugeridoNum > 0 ? formatMoneyBRL(precoSugeridoNum) : "-";

          return {
            id: outId,
            bubble_id: bubbleId || null,
            receita,
            categoria,
            unidade,
            rendimento,
            precoVenda,
            precoSugerido,
            custoTotal,
            custoUnitario,
            cmvMeta,
            cmvAtual,
            cmvDelta,
            quadrante,
            modoPreparo,
            ingredientes: ingredientRows.map(({ custoNum: _c, ...rest }: any) => rest),
          };
        })
        .filter(Boolean);

      const legacyRows = compat.map((r: any) => ({
        id: r.id,
        origin: "bubble",
        receita: r.receita,
        precoVenda: r.precoVenda,
        custoUnitario: r.custoUnitario,
        cmvMeta: r.cmvMeta,
        cmvAtual: r.cmvAtual,
        cmvDelta: r.cmvDelta,
        bcg: r.quadrante === "estrela" || r.quadrante === "cavalo" || r.quadrante === "quebra-cabeca" || r.quadrante === "abacaxi" ? r.quadrante : "quebra-cabeca",
        thumb: "burger",
        ingredientRows: (r.ingredientes ?? []).map((it: any) => ({
          id: it.id,
          ingredientId: String(it.ingredientId ?? ""),
          item: it.item,
          quantidade: it.quantidade,
          unidade: it.unidade,
          custoTotal: Math.max(0, Number(String(it.custo ?? "").replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".")) || 0),
        })),
        modoPreparo: r.modoPreparo,
      }));

      return json({ source: "compat", readOnly: true, rows: legacyRows, compat: { totals: { recipes: compat.length }, recipes: compat } }, { status: 200 });
    }

    const { data, error } = await supabase.from("fichas_tecnicas_state").select("*").eq("id", id).maybeSingle();
    if (error) return json({ error: error.message }, { status: 500 });
    const payload = (data as any)?.payload;
    return json({ source: "legacy", readOnly: false, rows: Array.isArray(payload) ? payload : [] }, { status: 200 });
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
    const rows = Array.isArray((body as any).rows) ? ((body as any).rows as unknown[]) : null;
    if (!rows) return json({ error: "missing_rows" }, { status: 400 });
    const { accessToken, id } = resolveUserScopedId(req);
    if (!id) return json({ error: "unauthorized" }, { status: 401 });
    const supabase = getSupabaseServerClient(accessToken);
    const { error } = await supabase.from("fichas_tecnicas_state").upsert({ id, payload: rows } as any, { onConflict: "id" });
    if (error) return json({ error: error.message }, { status: 500 });
    return json({ ok: true }, { status: 200 });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
