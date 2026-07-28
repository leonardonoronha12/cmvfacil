import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "../../lib/supabaseAdmin";
import { getUserIdFromRequest } from "../../lib/requestUserId";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function dbg(hypothesisId: string, location: string, msg: string, data: unknown) {
  // #region debug-point D:csv-only-audit
  try {
    const fs = await import("node:fs");
    const p = ".dbg/csv-only-audit.env";
    let u = "http://127.0.0.1:7777/event";
    let s = "csv-only-audit";
    try {
      const e = fs.readFileSync(p, "utf8");
      u = e.match(/DEBUG_SERVER_URL=(.+)/)?.[1]?.trim() || u;
      s = e.match(/DEBUG_SESSION_ID=(.+)/)?.[1]?.trim() || s;
    } catch {}
    await fetch(u, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: s, runId: "pre", hypothesisId, location, msg: `[DEBUG] ${msg}`, data, ts: Date.now() }),
    }).catch(() => {});
  } catch {}
  // #endregion
}

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

async function resolveCompanyScopedStateId(
  supabase: ReturnType<typeof getSupabaseServerClient>,
  userScopedId: string,
) {
  const userId = userScopedId.startsWith("user:") ? userScopedId.slice("user:".length) : "";
  if (!isUuid(userId)) return userScopedId;
  const { data: memberRows, error } = await supabase
    .from("company_members")
    .select("company_id,role,permission_level")
    .eq("user_id", userId)
    .limit(50);
  if (error) throw new Error(error.message);
  const companyId = pickBestCompanyId((memberRows ?? []) as unknown[]);
  return companyId ? `company:${companyId}` : userScopedId;
}

async function shouldUseCompatSource(args: { req: NextRequest; supabase: ReturnType<typeof getSupabaseServerClient>; userId: string; isAdmin: boolean }) {
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

function formatDateNumericPT(d: Date) {
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

function formatDateOnlyPT(value: unknown) {
  const s = String(value ?? "").trim();
  if (!s) return "-";
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? formatDateNumericPT(d) : "-";
}

export async function GET(req: NextRequest) {
  try {
    const { accessToken, id, rawUserId } = resolveUserScopedId(req);
    if (!id) return json({ error: "unauthorized" }, { status: 401 });
    const supabase = getSupabaseServerClient(accessToken);
    const userId = id.slice("user:".length);
    const stateId = await resolveCompanyScopedStateId(supabase, id);

    const isAdmin = Boolean(rawUserId && isAdminUserId(rawUserId));
    const useCompat = await shouldUseCompatSource({ req, supabase, userId, isAdmin });
    await dbg("D", "api/pre-preparo", "source_selected", {
      useCompat,
      rawUserId: rawUserId ? String(rawUserId) : null,
      userId,
      flags: { BUBBLE_COMPAT_READ_PRE_PREPARO: process.env.BUBBLE_COMPAT_READ_PRE_PREPARO ?? null },
    });
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
        .select("id,bubble_id,name,modo_preparo,rendimento,custo_total_receita,custo_medio,validade_data,validade_dias,unidade_medida,category_id,item_receita,item_do_cardapio")
        .eq("company_id", companyId)
        .eq("item_receita", true)
        .eq("item_do_cardapio", false)
        .order("name", { ascending: true });
      if (rErr) return json({ error: rErr.message }, { status: 500 });
      await dbg("D", "api/pre-preparo", "recipes_loaded", {
        companyId,
        recipes: (recipesDb ?? []).length,
        sampleNames: (recipesDb ?? []).slice(0, 20).map((r: any) => String(r?.name ?? "").trim()),
        containsCarreteiro: (recipesDb ?? []).some((r: any) => String(r?.name ?? "").trim().toLowerCase() === "carreteiro"),
      });

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
      await dbg("D", "api/pre-preparo", "ingredients_loaded", {
        recipeIds: recipeIds.length,
        ingredients: (ingDb ?? []).length,
        sample: (ingDb ?? []).slice(0, 10).map((r: any) => ({
          recipe_item_id: String(r?.recipe_item_id ?? ""),
          ingredient_item_id: String(r?.ingredient_item_id ?? ""),
          quantidade: r?.quantidade ?? null,
          custo: r?.custo ?? null,
        })),
      });

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

      const { data: labelDb, error: lErr } = recipeIds.length
        ? await supabase
            .from("labels")
            .select("id,bubble_id,codigo,data_producao,data_validade,quantidade_produzida,boolean_desperdicado,item_id,item_nome")
            .eq("company_id", companyId)
            .in("item_id", recipeIds)
            .order("data_producao", { ascending: false })
        : { data: [], error: null as any };
      if (lErr) return json({ error: lErr.message }, { status: 500 });
      await dbg("D", "api/pre-preparo", "labels_loaded", {
        labels: (labelDb ?? []).length,
        recipeIds: recipeIds.length,
        sample: (labelDb ?? []).slice(0, 10).map((r: any) => ({
          item_id: String(r?.item_id ?? ""),
          codigo: String(r?.codigo ?? ""),
          data_producao: r?.data_producao ?? null,
          data_validade: r?.data_validade ?? null,
          quantidade_produzida: r?.quantidade_produzida ?? null,
          boolean_desperdicado: Boolean(r?.boolean_desperdicado),
        })),
      });

      const labelsByRecipeId = new Map<string, any[]>();
      for (const lb of (labelDb ?? []) as any[]) {
        if ((lb as any)?.boolean_desperdicado) continue;
        const rid = String(lb?.item_id ?? "").trim();
        if (!rid) continue;
        const list = labelsByRecipeId.get(rid) ?? [];
        list.push(lb);
        labelsByRecipeId.set(rid, list);
      }

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

          const nome = String(r?.name ?? "").trim() || "-";
          const unidade = String(r?.unidade_medida ?? "").trim() || "Und";
          const rendimentoNum = typeof r?.rendimento === "number" ? r.rendimento : 0;
          const rendimento = rendimentoNum > 0 ? `${formatQty3(rendimentoNum)} ${unidade}` : "-";
          const categoria = categoryNameById.get(String(r?.category_id ?? "")) || "Sem categoria";

          const validadeDias = typeof r?.validade_dias === "number" ? r.validade_dias : null;
          const validadeData = r?.validade_data ? new Date(String(r.validade_data)) : null;
          const validade =
            typeof validadeDias === "number" && validadeDias > 0
              ? `${String(validadeDias)} dias`
              : validadeData && Number.isFinite(validadeData.getTime())
                ? formatDateNumericPT(validadeData)
                : "-";

          const modoPreparo = String(r?.modo_preparo ?? "").trim() || "-";

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

          const etiquetaRows = (labelsByRecipeId.get(dbId) ?? []).map((lb: any) => {
            const lDbId = String(lb?.id ?? "").trim();
            const lBubbleId = String(lb?.bubble_id ?? "").trim();
            const lid = lBubbleId || (lDbId ? `db:${lDbId}` : "");
            const codigo = String(lb?.codigo ?? "").trim() || lBubbleId || "-";
            const dataProducao = formatDateOnlyPT(lb?.data_producao);
            const dataValidade = formatDateOnlyPT(lb?.data_validade);
            const qtyProd = typeof lb?.quantidade_produzida === "number" ? lb.quantidade_produzida : 0;
            const quantidadeProduzida = qtyProd > 0 ? `${formatQty3(qtyProd)} ${unidade}` : "-";
            return { id: lid, bubble_id: lBubbleId || null, codigo, dataProducao, dataValidade, quantidadeProduzida };
          });

          return {
            id: outId,
            bubble_id: bubbleId || null,
            nome,
            categoria,
            unidade,
            rendimento,
            validade,
            validadeDias,
            custoTotal,
            custoUnitario,
            modoPreparo,
            ingredientes: ingredientRows.map(({ custoNum: _c, ...rest }: any) => rest),
            etiquetas: etiquetaRows,
          };
        })
        .filter(Boolean);

      const legacyRows = compat.map((r: any) => ({
        id: r.id,
        categoria: r.categoria,
        receita: r.nome,
        custoTotal: r.custoTotal,
        rendimento: r.rendimento,
        custoUnitario: r.custoUnitario,
        validadeDias: typeof r.validadeDias === "number" ? r.validadeDias : undefined,
        modoPreparo: r.modoPreparo,
        ingredientes: (r.ingredientes ?? []).map((it: any) => ({
          id: it.id,
          item: it.item,
          quantidade: it.quantidade,
          unidade: it.unidade,
          custoCents: Math.round(Number(String(it.custo ?? "").replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".")) * 100) || 0,
        })),
      }));

      return json(
        { source: "compat", readOnly: true, rows: legacyRows, compat: { totals: { prePreparos: compat.length }, prePreparos: compat } },
        { status: 200 },
      );
    }

    const { data, error } = await supabase.from("pre_preparo_state").select("*").eq("id", stateId).maybeSingle();
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
    const allowEmpty = (body as any).allowEmpty === true;
    const { accessToken, id } = resolveUserScopedId(req);
    if (!id) return json({ error: "unauthorized" }, { status: 401 });
    const supabase = getSupabaseServerClient(accessToken);
    const stateId = await resolveCompanyScopedStateId(supabase, id);
    if (rows.length === 0 && !allowEmpty) {
      const { data: current, error: currentError } = await supabase
        .from("pre_preparo_state")
        .select("payload")
        .eq("id", stateId)
        .maybeSingle();
      if (currentError) return json({ error: currentError.message }, { status: 500 });
      const currentRows = Array.isArray((current as any)?.payload) ? ((current as any).payload as unknown[]) : [];
      if (currentRows.length > 0) {
        return json(
          {
            error: "stale_empty_write_rejected",
            persistedRows: currentRows.length,
          },
          { status: 409 },
        );
      }
    }
    const { error } = await supabase.from("pre_preparo_state").upsert({ id: stateId, payload: rows } as any, { onConflict: "id" });
    if (error) return json({ error: error.message }, { status: 500 });
    const { data: persisted, error: verifyError } = await supabase
      .from("pre_preparo_state")
      .select("id,payload")
      .eq("id", stateId)
      .maybeSingle();
    if (verifyError) return json({ error: verifyError.message, code: "save_verification_failed" }, { status: 500 });
    const persistedRows = Array.isArray((persisted as any)?.payload) ? ((persisted as any).payload as unknown[]) : null;
    if (!persistedRows || persistedRows.length !== rows.length) {
      return json(
        {
          error: "save_verification_failed",
          expectedRows: rows.length,
          persistedRows: persistedRows?.length ?? 0,
        },
        { status: 500 },
      );
    }
    return json({ ok: true, persistedRows: persistedRows.length }, { status: 200 });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
